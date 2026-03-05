const Joi = require("joi");
const Joigoose = require("joigoose");
const mongoose = require("mongoose");
const {
  getSupportedBlockchains,
  isValidBlockchain,
  isValidNetwork,
  getBlockchainConfig,
} = require("../business-logic/blockchain-registry");

// Initialize Joigoose
const joigoose = Joigoose(mongoose);

// Transaction status enum
const txStatusEnum = ["pending", "ready", "processing", "processed", "failed"];

// Supported blockchains from registry
const supportedBlockchains = getSupportedBlockchains();

// ============================================================================
// Signature Schemas (blockchain-agnostic)
// ============================================================================

/**
 * Stellar signature schema (Ed25519, G-prefixed keys)
 */
const stellarSignatureSchema = Joi.object({
  key: Joi.string()
    .pattern(/^G[A-Z2-7]{55}$/)
    .required()
    .description("Stellar public key (Ed25519, G-prefix)"),
  signature: Joi.string()
    .base64()
    .required()
    .description("Base64-encoded signature bytes"),
});

/**
 * Ethereum/EVM signature schema (secp256k1, 0x-prefixed addresses)
 */
const evmSignatureSchema = Joi.object({
  key: Joi.string()
    .pattern(/^0x[a-fA-F0-9]{40}$/)
    .required()
    .description("Ethereum address (0x-prefixed, 40 hex chars)"),
  signature: Joi.string()
    .pattern(/^0x[a-fA-F0-9]+$/)
    .required()
    .description("Hex-encoded signature (0x-prefixed)"),
});

/**
 * Generic signature schema (flexible for other blockchains)
 */
const genericSignatureSchema = Joi.object({
  key: Joi.string()
    .min(1)
    .max(256)
    .required()
    .description("Public key or address"),
  signature: Joi.string()
    .min(1)
    .max(1024)
    .required()
    .description("Encoded signature"),
  encoding: Joi.string()
    .valid("base64", "hex", "base58")
    .default("base64")
    .description("Signature encoding format"),
});

/**
 * Universal signature schema - accepts any valid signature format
 * Validation is blockchain-specific at runtime
 */
const txSignatureSchema = Joi.object({
  key: Joi.string()
    .min(1)
    .max(256)
    .required()
    .description("Public key or address (format depends on blockchain)"),
  signature: Joi.string()
    .min(1)
    .max(1024)
    .required()
    .description("Encoded signature (format depends on blockchain)"),
});

// ============================================================================
// Transaction Model Schema (blockchain-agnostic)
// ============================================================================

// Joi schema for TxModel
const txModelSchema = Joi.object({
  // ---- Core identification ----
  hash: Joi.string()
    .pattern(/^[a-f0-9]{64}$/)
    .required()
    .description("Transaction hash (SHA-256 or blockchain-specific)"),

  // ---- Blockchain-agnostic fields (new) ----
  blockchain: Joi.string()
    .valid(...supportedBlockchains)
    .default("stellar")
    .description("Blockchain identifier (e.g., stellar, ethereum, solana)"),

  networkName: Joi.string()
    .max(64)
    .allow(null)
    .description("Network name (e.g., public, testnet, mainnet, sepolia)"),

  txUri: Joi.string()
    .max(100000)
    .allow(null)
    .description("Full transaction URI (tx:... or blockchain://... format)"),

  payload: Joi.string()
    .max(100000)
    .allow(null)
    .description("Encoded transaction payload (blockchain-specific format)"),

  encoding: Joi.string()
    .valid("base64", "hex", "base58", "msgpack", "base32")
    .default("base64")
    .description("Payload encoding format"),

  // ---- JSON representation ----
  txJson: Joi.alternatives()
    .try(
      Joi.string().max(500000), // JSON string up to 500KB
      Joi.object() // Or direct object
    )
    .allow(null)
    .description(
      "JSON representation of the transaction for human readability"
    ),

  // ---- Originator (transaction creator attestation) ----
  originator: Joi.string()
    .max(256)
    .allow(null)
    .description(
      "Public key or address of the transaction originator (format depends on blockchain)"
    ),

  originatorSignature: Joi.string()
    .max(1024)
    .allow(null)
    .description(
      "Signature of the transaction hash by the originator, proving authorship"
    ),

  // ---- Legacy Stellar fields (kept for backward compatibility) ----
  network: Joi.number()
    .integer()
    .min(0)
    .max(2)
    .allow(null)
    .description(
      "Legacy network identifier (0=pubnet, 1=testnet, 2=futurenet) - Stellar only"
    ),

  xdr: Joi.string()
    .max(100000)
    .allow(null)
    .description(
      "Legacy: Transaction XDR without signatures (base64-encoded) - Stellar only"
    ),

  // ---- Signatures ----
  signatures: Joi.array()
    .items(txSignatureSchema)
    .default([])
    .description("Applied transaction signatures"),

  // ---- Submission options ----
  submit: Joi.boolean()
    .default(false)
    .description("Submit transaction to network once signed"),

  callbackUrl: Joi.string()
    .uri()
    .allow(null)
    .description("Callback URL for transaction notification"),

  // ---- Signer management ----
  desiredSigners: Joi.array()
    .items(Joi.string().max(256))
    .default([])
    .description("List of signers requested by transaction author"),

  // ---- Timing ----
  minTime: Joi.number()
    .integer()
    .min(0)
    .default(0)
    .description(
      "Point in time when transaction becomes valid (UNIX timestamp)"
    ),

  maxTime: Joi.number()
    .integer()
    .min(0)
    .allow(null)
    .description("Transaction expiration date (UNIX timestamp)"),
  status: Joi.string()
    .valid(...txStatusEnum)
    .default("pending")
    .description("Current transaction status"),
  submitted: Joi.number()
    .integer()
    .min(0)
    .allow(null)
    .description("Submitted transaction timestamp (UNIX timestamp)"),
  createdAt: Joi.date()
    .default(Date.now)
    .description("Record creation timestamp"),
  updatedAt: Joi.date()
    .default(Date.now)
    .description("Record last update timestamp"),
  retryCount: Joi.number()
    .integer()
    .min(0)
    .default(0)
    .description("Number of processing retry attempts"),
  lastError: Joi.string()
    .allow(null)
    .description("Last error message if processing failed"),
});

// Convert Joi schemas to Mongoose schemas
const TxSignatureMongooseSchemaDefinition = joigoose.convert(txSignatureSchema);
const TxModelMongooseSchemaDefinition = joigoose.convert(txModelSchema);

// Remove the hash field from Mongoose schema since we use _id as hash
delete TxModelMongooseSchemaDefinition.hash;

// Create actual Mongoose schemas
const TxSignatureMongooseSchema = new mongoose.Schema(
  TxSignatureMongooseSchemaDefinition
);
const TxModelMongooseSchema = new mongoose.Schema(
  TxModelMongooseSchemaDefinition,
  {
    _id: false, // Disable auto-generated _id
  }
);

// Add custom _id field using the hash
TxModelMongooseSchema.add({
  _id: {
    type: String,
    required: true,
    validate: {
      validator: function (v) {
        return /^[a-f0-9]{64}$/.test(v);
      },
      message: "Transaction hash must be a 64-character hex string",
    },
  },
});

// Add custom transformations and indexes
TxModelMongooseSchema.set("collection", "tx");
TxModelMongooseSchema.set("timestamps", true);

// Indexes for efficient querying
// Primary lookup is by _id (hash)
TxModelMongooseSchema.index({ status: 1, minTime: 1 }); // Ready transactions query
TxModelMongooseSchema.index({ blockchain: 1, status: 1 }); // Blockchain-specific queries
TxModelMongooseSchema.index({ blockchain: 1, networkName: 1, status: 1 }); // Network-specific queries
TxModelMongooseSchema.index({ network: 1, status: 1 }); // Legacy Stellar queries
TxModelMongooseSchema.index({ maxTime: 1 }, { sparse: true }); // Expiration queries
TxModelMongooseSchema.index({ createdAt: 1 }); // Time-based queries

// Pre-save middleware for validation and data processing
TxModelMongooseSchema.pre("save", function (next) {
  this.updatedAt = new Date();

  // Auto-populate blockchain-agnostic fields from legacy fields for Stellar
  if (!this.blockchain && this.network !== undefined && this.network !== null) {
    this.blockchain = "stellar";
  }

  if (
    !this.networkName &&
    this.network !== undefined &&
    this.network !== null
  ) {
    const networkMap = { 0: "public", 1: "testnet", 2: "futurenet" };
    this.networkName = networkMap[this.network] || null;
  }

  if (!this.payload && this.xdr) {
    this.payload = this.xdr;
    this.encoding = "base64";
  }

  // Validate signatures match desired signers if specified
  if (this.desiredSigners && this.desiredSigners.length > 0) {
    const signatureKeys = this.signatures.map((sig) => sig.key);
    const missingSigners = this.desiredSigners.filter(
      (signer) => !signatureKeys.includes(signer)
    );

    if (missingSigners.length === 0 && this.status === "pending") {
      this.status = "ready";
    }
  }

  next();
});

// Instance methods
TxModelMongooseSchema.methods.isExpired = function () {
  return this.maxTime && this.maxTime < Math.floor(Date.now() / 1000);
};

TxModelMongooseSchema.methods.isReady = function () {
  return this.status === "ready" && !this.isExpired();
};

TxModelMongooseSchema.methods.isLegacyStellar = function () {
  return this.xdr !== null && this.network !== null;
};

TxModelMongooseSchema.methods.getPayload = function () {
  return this.payload || this.xdr;
};

TxModelMongooseSchema.methods.getNetworkName = function () {
  if (this.networkName) return this.networkName;
  if (this.network !== null) {
    const networkMap = { 0: "public", 1: "testnet", 2: "futurenet" };
    return networkMap[this.network] || null;
  }
  return null;
};

TxModelMongooseSchema.methods.addSignature = function (key, signature) {
  // Check if signature already exists
  const existingIndex = this.signatures.findIndex((sig) => sig.key === key);

  if (existingIndex >= 0) {
    this.signatures[existingIndex].signature = signature;
  } else {
    this.signatures.push({ key, signature });
  }

  // Auto-update status if all desired signers have signed
  if (this.desiredSigners && this.desiredSigners.length > 0) {
    const signatureKeys = this.signatures.map((sig) => sig.key);
    const hasAllSignatures = this.desiredSigners.every((signer) =>
      signatureKeys.includes(signer)
    );

    if (hasAllSignatures && this.status === "pending") {
      this.status = "ready";
    }
  }
};

// Static methods for common queries
TxModelMongooseSchema.statics.findReady = function (
  limit = 100,
  blockchain = null
) {
  const now = Math.floor(Date.now() / 1000);
  const query = {
    status: "ready",
    minTime: { $lte: now },
    $or: [{ maxTime: null }, { maxTime: { $gt: now } }],
  };

  if (blockchain) {
    query.blockchain = blockchain;
  }

  return this.find(query).limit(limit);
};

TxModelMongooseSchema.statics.findReadyByBlockchain = function (
  blockchain,
  limit = 100
) {
  return this.findReady(limit, blockchain);
};

TxModelMongooseSchema.statics.findExpired = function (blockchain = null) {
  const now = Math.floor(Date.now() / 1000);
  const query = {
    status: { $in: ["pending", "ready"] },
    maxTime: { $ne: null, $lte: now },
  };

  if (blockchain) {
    query.blockchain = blockchain;
  }

  return this.find(query);
};

TxModelMongooseSchema.statics.findByBlockchain = function (
  blockchain,
  options = {}
) {
  const { status, networkName, limit = 100 } = options;
  const query = { blockchain };

  if (status) {
    query.status = status;
  }
  if (networkName) {
    query.networkName = networkName;
  }

  return this.find(query).limit(limit);
};

// ============================================================================
// API Request Validation Schemas (subset of full model for client submissions)
// ============================================================================

/**
 * Schema for legacy Stellar transaction submission (backward compatible)
 */
const legacyStellarSubmissionSchema = Joi.object({
  xdr: Joi.string()
    .max(100000)
    .required()
    .description("Transaction XDR (base64-encoded)"),
  network: Joi.alternatives()
    .try(
      Joi.number().integer().min(0).max(2),
      Joi.string().valid(
        "public",
        "testnet",
        "futurenet",
        "PUBLIC",
        "TESTNET",
        "FUTURENET"
      )
    )
    .required()
    .description(
      "Network identifier (0=pubnet, 1=testnet, 2=futurenet or string name)"
    ),
  signatures: Joi.array()
    .items(stellarSignatureSchema)
    .default([])
    .description("Applied transaction signatures"),
  submit: Joi.boolean()
    .default(false)
    .description("Submit transaction to network once fully signed"),
  callbackUrl: Joi.string()
    .uri()
    .allow(null, "")
    .description("Callback URL for transaction notification"),
  desiredSigners: Joi.array()
    .items(Joi.string().pattern(/^G[A-Z2-7]{55}$/))
    .default([])
    .description("List of signers requested by transaction author"),
  minTime: Joi.number()
    .integer()
    .min(0)
    .default(0)
    .description(
      "Point in time when transaction becomes valid (UNIX timestamp)"
    ),
  maxTime: Joi.number()
    .integer()
    .min(0)
    .allow(null)
    .description("Transaction expiration date (UNIX timestamp)"),
});

/**
 * Schema for blockchain-agnostic transaction submission (new format)
 */
const blockchainAgnosticSubmissionSchema = Joi.object({
  // Transaction URI (primary format for new submissions)
  txUri: Joi.string()
    .max(100000)
    .description(
      "Full transaction URI (tx:blockchain:network;encoding,payload or blockchain://namespace:chainId/tx/encoding;payload)"
    ),

  // Alternative: provide components separately
  blockchain: Joi.string()
    .valid(...supportedBlockchains)
    .description("Blockchain identifier"),

  networkName: Joi.string()
    .max(64)
    .description("Network name (e.g., mainnet, testnet)"),

  payload: Joi.string().max(100000).description("Encoded transaction payload"),

  encoding: Joi.string()
    .valid("base64", "hex", "base58", "msgpack", "base32")
    .default("base64")
    .description("Payload encoding format"),

  // Common fields
  signatures: Joi.array()
    .items(txSignatureSchema)
    .default([])
    .description("Applied transaction signatures"),

  submit: Joi.boolean()
    .default(false)
    .description("Submit transaction to network once fully signed"),

  callbackUrl: Joi.string()
    .uri()
    .allow(null, "")
    .description("Callback URL for transaction notification"),

  desiredSigners: Joi.array()
    .items(Joi.string().max(256))
    .default([])
    .description("List of signers requested by transaction author"),

  minTime: Joi.number()
    .integer()
    .min(0)
    .default(0)
    .description(
      "Point in time when transaction becomes valid (UNIX timestamp)"
    ),

  maxTime: Joi.number()
    .integer()
    .min(0)
    .allow(null)
    .description("Transaction expiration date (UNIX timestamp)"),
})
  .or("txUri", "payload") // Must provide either txUri or payload
  .with("payload", ["blockchain", "networkName"]); // If payload, need blockchain and network

/**
 * Combined schema that accepts both legacy and new formats
 * Tries legacy format first (for backward compatibility), then new format
 */
const txSubmissionSchema = Joi.alternatives()
  .try(legacyStellarSubmissionSchema, blockchainAgnosticSubmissionSchema)
  .description(
    "Transaction submission - accepts legacy Stellar format (xdr + network) or new blockchain-agnostic format (txUri or blockchain + networkName + payload)"
  );

/**
 * Schema for transaction hash parameter validation
 */
const txHashSchema = Joi.object({
  hash: Joi.string()
    .pattern(/^[a-f0-9]{64}$/)
    .required()
    .description("Transaction hash (SHA-256, 64 hex characters)"),
});

/**
 * Schema for monitoring query parameters
 */
const monitoringQuerySchema = Joi.object({
  limit: Joi.number()
    .integer()
    .min(1)
    .max(1000)
    .default(100)
    .description("Maximum number of results to return"),
  status: Joi.string()
    .valid(...txStatusEnum)
    .description("Filter by transaction status"),
  blockchain: Joi.string()
    .valid(...supportedBlockchains)
    .description("Filter by blockchain"),
  networkName: Joi.string().max(64).description("Filter by network name"),
  network: Joi.number()
    .integer()
    .min(0)
    .max(2)
    .description(
      "Legacy: Filter by Stellar network (0=pubnet, 1=testnet, 2=futurenet)"
    ),
});

module.exports = {
  // Joi schemas - Signatures
  txSignatureSchema,
  stellarSignatureSchema,
  evmSignatureSchema,
  genericSignatureSchema,

  // Joi schemas - Transaction model
  txModelSchema,

  // Joi schemas - API requests
  txSubmissionSchema,
  legacyStellarSubmissionSchema,
  blockchainAgnosticSubmissionSchema,
  txHashSchema,
  monitoringQuerySchema,

  // Mongoose schemas
  TxSignatureMongooseSchema,
  TxModelMongooseSchema,

  // Enums and constants
  txStatusEnum,
  supportedBlockchains,
};
