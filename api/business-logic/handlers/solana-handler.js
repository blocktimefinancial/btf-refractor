/**
 * Solana Blockchain Handler
 *
 * Implements the BlockchainHandler interface for Solana blockchain.
 * Solana uses ed25519 keys (same curve as Stellar and Algorand) with
 * base58-encoded addresses and a custom binary transaction format.
 *
 * Key characteristics:
 * - ed25519 key format (base58-encoded 32-byte public keys)
 * - Binary serialization (compact-u16 length prefixes) with base64/base58 transport
 * - Multi-signer model (fee payer + additional signers per instruction accounts)
 * - 64-byte Ed25519 signatures; first signature = transaction ID
 * - Max 1,232 bytes per serialized transaction (PACKET_DATA_SIZE)
 * - Recent blockhash for expiry (150 slots) or durable nonce
 *
 * HSM Integration:
 * - Signs via hsmKeyStore.signSolanaTransaction() (KEK-DEK envelope)
 * - 32-byte ed25519 seed wrapped with RSA-OAEP in Azure Managed HSM
 * - Full 64-byte key (seed‖pubkey) reconstructed only during signing
 * - Compatible with azureCryptoService for direct HSM ed25519 signing
 *
 * @module business-logic/handlers/solana-handler
 */

const crypto = require("crypto");
const BlockchainHandler = require("./blockchain-handler");
const { standardError } = require("../std-error");
const {
  getBlockchainConfig,
  getNetworkConfig,
} = require("../blockchain-registry");
const logger = require("../../utils/logger").forComponent("solana-handler");

/**
 * Solana address constants
 * Addresses are base58-encoded 32-byte ed25519 public keys (32-44 chars)
 */
const SOLANA_PUBKEY_BYTES = 32;
const SOLANA_SIGNATURE_BYTES = 64;
const SOLANA_MAX_TX_SIZE = 1232; // PACKET_DATA_SIZE

/**
 * Base58 alphabet used by Solana (Bitcoin-style, no 0/O/I/l)
 */
const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Default RPC endpoints per network
 */
const DEFAULT_RPC_URLS = {
  mainnet: "https://api.mainnet-beta.solana.com",
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
};

/**
 * Well-known Solana program IDs
 */
const KNOWN_PROGRAMS = {
  "11111111111111111111111111111111": "System Program",
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: "Token Program",
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: "Token-2022",
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: "Associated Token",
  ComputeBudget111111111111111111111111111111: "Compute Budget",
  MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr: "Memo v2",
  Memo1UhkJBfCVP4kyu3jJV2TJqFaAXfuyGEEHEvPAhire: "Memo v1",
};

class SolanaHandler extends BlockchainHandler {
  constructor() {
    super("solana");
    this.config = getBlockchainConfig("solana");
  }

  /**
   * Parse a Solana transaction from its encoded payload.
   *
   * Accepts:
   * - base64 string (standard Solana RPC transport)
   * - base58 string
   * - hex string
   * - JSON object (partially decoded transaction)
   *
   * Returns a normalized transaction object suitable for hashing and signing.
   *
   * @param {string|Object} payload - Encoded transaction or JSON object
   * @param {string} encoding - 'base64', 'base58', 'hex', or 'json'
   * @param {string} networkName - The network name (mainnet, devnet, testnet)
   * @returns {Object} Parsed Solana transaction object
   */
  parseTransaction(payload, encoding, networkName) {
    const normalizedEncoding = (encoding || "base64").toLowerCase();

    if (!["base64", "base58", "hex", "json"].includes(normalizedEncoding)) {
      throw standardError(
        400,
        `Solana supports base64, base58, hex, or json encoding, got: ${normalizedEncoding}`,
      );
    }

    try {
      let txnBytes;
      let txnObj;

      switch (normalizedEncoding) {
        case "base64":
          // base64 is the standard Solana RPC transport encoding
          txnBytes = Buffer.from(payload, "base64");
          txnObj = this._deserializeTransaction(txnBytes);
          break;

        case "base58":
          txnBytes = this._base58Decode(payload);
          txnObj = this._deserializeTransaction(txnBytes);
          break;

        case "hex":
          txnBytes = Buffer.from(payload, "hex");
          txnObj = this._deserializeTransaction(txnBytes);
          break;

        case "json":
          // JSON representation of transaction fields
          txnObj = typeof payload === "string" ? JSON.parse(payload) : payload;
          break;

        default:
          throw standardError(
            400,
            `Unsupported encoding: ${normalizedEncoding}`,
          );
      }

      // Attach metadata for later use
      txnObj._networkName = this.normalizeNetworkName(networkName);
      txnObj._originalEncoding = normalizedEncoding;
      txnObj._rawBytes = txnBytes || null;

      return txnObj;
    } catch (e) {
      if (e.status) throw e;
      logger.warn("Failed to parse Solana transaction", {
        error: e.message,
        encoding: normalizedEncoding,
      });
      throw standardError(400, "Invalid Solana transaction data");
    }
  }

  /**
   * Deserialize a Solana transaction from raw bytes.
   *
   * Solana wire format:
   *   [compact-u16 num_sigs] [sigs × 64B] [message...]
   *
   * Message format:
   *   [header: 3 bytes] [compact-u16 num_keys] [keys × 32B]
   *   [recent_blockhash: 32B] [compact-u16 num_ixs] [instructions...]
   *
   * @param {Buffer} bytes - Raw transaction bytes
   * @returns {Object} Parsed transaction object
   * @private
   */
  _deserializeTransaction(bytes) {
    if (!bytes || bytes.length === 0) {
      throw standardError(400, "Empty Solana transaction payload");
    }

    if (bytes.length > SOLANA_MAX_TX_SIZE) {
      throw standardError(
        400,
        `Solana transaction exceeds max size: ${bytes.length} > ${SOLANA_MAX_TX_SIZE}`,
      );
    }

    let offset = 0;

    // --- Signatures ---
    const { value: numSigs, bytesRead: sigCountBytes } = this._readCompactU16(
      bytes,
      offset,
    );
    offset += sigCountBytes;

    const signatures = [];
    for (let i = 0; i < numSigs; i++) {
      if (offset + SOLANA_SIGNATURE_BYTES > bytes.length) {
        throw standardError(400, "Transaction truncated in signature section");
      }
      const sig = bytes.slice(offset, offset + SOLANA_SIGNATURE_BYTES);
      signatures.push(sig);
      offset += SOLANA_SIGNATURE_BYTES;
    }

    // Everything from here is the message (used for signing)
    const messageOffset = offset;

    // --- Message Header ---
    if (offset + 3 > bytes.length) {
      throw standardError(400, "Transaction truncated in message header");
    }
    const numRequiredSignatures = bytes[offset];
    const numReadonlySignedAccounts = bytes[offset + 1];
    const numReadonlyUnsignedAccounts = bytes[offset + 2];
    offset += 3;

    // --- Account Keys ---
    const { value: numKeys, bytesRead: keyCountBytes } = this._readCompactU16(
      bytes,
      offset,
    );
    offset += keyCountBytes;

    const accountKeys = [];
    for (let i = 0; i < numKeys; i++) {
      if (offset + SOLANA_PUBKEY_BYTES > bytes.length) {
        throw standardError(400, "Transaction truncated in account keys");
      }
      accountKeys.push(bytes.slice(offset, offset + SOLANA_PUBKEY_BYTES));
      offset += SOLANA_PUBKEY_BYTES;
    }

    // --- Recent Blockhash ---
    if (offset + 32 > bytes.length) {
      throw standardError(400, "Transaction truncated at blockhash");
    }
    const recentBlockhash = bytes.slice(offset, offset + 32);
    offset += 32;

    // --- Instructions ---
    const { value: numIxs, bytesRead: ixCountBytes } = this._readCompactU16(
      bytes,
      offset,
    );
    offset += ixCountBytes;

    const instructions = [];
    for (let i = 0; i < numIxs; i++) {
      // Program ID index
      if (offset >= bytes.length) {
        throw standardError(400, "Transaction truncated in instructions");
      }
      const programIdIndex = bytes[offset];
      offset += 1;

      // Account indices
      const { value: numAccounts, bytesRead: accCountBytes } =
        this._readCompactU16(bytes, offset);
      offset += accCountBytes;

      const accountIndices = [];
      for (let j = 0; j < numAccounts; j++) {
        if (offset >= bytes.length) {
          throw standardError(
            400,
            "Transaction truncated in instruction accounts",
          );
        }
        accountIndices.push(
          bytes[j + offset - numAccounts + accountIndices.length],
        );
        offset += 0; // handled below
      }
      // Re-read account indices properly
      accountIndices.length = 0;
      offset -= 0; // Reset — actually just read bytes sequentially
      for (let j = 0; j < numAccounts; j++) {
        accountIndices.push(bytes[offset]);
        offset += 1;
      }

      // Instruction data
      const { value: dataLen, bytesRead: dataLenBytes } = this._readCompactU16(
        bytes,
        offset,
      );
      offset += dataLenBytes;

      if (offset + dataLen > bytes.length) {
        throw standardError(400, "Transaction truncated in instruction data");
      }
      const data = bytes.slice(offset, offset + dataLen);
      offset += dataLen;

      instructions.push({
        programIdIndex,
        accountIndices,
        data,
      });
    }

    // Extract message bytes for signing verification
    const messageBytes = bytes.slice(messageOffset);

    return {
      signatures,
      message: {
        header: {
          numRequiredSignatures,
          numReadonlySignedAccounts,
          numReadonlyUnsignedAccounts,
        },
        accountKeys,
        recentBlockhash,
        instructions,
      },
      _messageBytes: messageBytes,
      _rawBytes: bytes,
    };
  }

  /**
   * Compute the transaction hash (signature / TxID).
   *
   * For Solana, the "hash" used for signing is the serialized message bytes.
   * The transaction ID is the first signature (base58-encoded).
   * For our purposes, we hash the message with SHA-256 to get a deterministic
   * transaction identifier before signing.
   *
   * @param {Object} transaction - The parsed transaction
   * @returns {{ hash: string, hashRaw: Buffer }} Transaction hash
   */
  computeHash(transaction) {
    let messageBytes;

    if (transaction._messageBytes) {
      messageBytes = transaction._messageBytes;
    } else if (transaction._rawBytes) {
      // Extract message from raw bytes (skip signature section)
      const { value: numSigs, bytesRead } = this._readCompactU16(
        transaction._rawBytes,
        0,
      );
      const messageOffset = bytesRead + numSigs * SOLANA_SIGNATURE_BYTES;
      messageBytes = transaction._rawBytes.slice(messageOffset);
    } else {
      throw standardError(
        400,
        "Cannot compute hash without serialized message bytes",
      );
    }

    // SHA-256 of message bytes — used as the signing payload for ed25519
    // (Solana signs the raw message bytes directly, but we store a SHA-256
    // hash as the deterministic transaction identifier)
    const hashRaw = crypto.createHash("sha256").update(messageBytes).digest();

    return {
      hash: hashRaw.toString("hex"),
      hashRaw,
      // Also store the raw message bytes — ed25519 signing uses these directly
      _signingPayload: messageBytes,
    };
  }

  /**
   * Extract signatures from a Solana transaction.
   *
   * Each signature is 64 bytes of Ed25519 over the serialized message.
   * Signatures map 1:1 to the first N account keys in the message header
   * (where N = numRequiredSignatures).
   *
   * An all-zeros signature indicates an unfilled slot.
   *
   * @param {Object} transaction - The parsed transaction
   * @returns {Array<Object>} Array of signature objects
   */
  extractSignatures(transaction) {
    const signatures = [];
    const txSigs = transaction.signatures || [];
    const accountKeys = transaction.message?.accountKeys || [];
    const numRequired = transaction.message?.header?.numRequiredSignatures || 0;

    for (let i = 0; i < txSigs.length; i++) {
      const sig = txSigs[i];

      // Skip all-zeros signatures (unfilled slots)
      const isZero = Buffer.isBuffer(sig) ? sig.every((b) => b === 0) : false;

      if (isZero) continue;

      // The i-th signature corresponds to the i-th account key
      const signerKey = accountKeys[i];
      const signerAddress = signerKey
        ? this._base58Encode(
            Buffer.isBuffer(signerKey) ? signerKey : Buffer.from(signerKey),
          )
        : "unknown";

      signatures.push({
        type: i === 0 ? "fee-payer" : "signer",
        signature: Buffer.isBuffer(sig) ? sig.toString("base64") : sig,
        from: signerAddress,
        index: i,
      });
    }

    return signatures;
  }

  /**
   * Clear all signatures from the transaction (set to all-zeros)
   * @param {Object} transaction - The transaction
   * @returns {Object} Transaction with cleared signatures
   */
  clearSignatures(transaction) {
    if (transaction.signatures) {
      transaction.signatures = transaction.signatures.map(() =>
        Buffer.alloc(SOLANA_SIGNATURE_BYTES, 0),
      );
    }
    return transaction;
  }

  /**
   * Verify an ed25519 signature against a Solana public key.
   *
   * Uses Node.js crypto to verify ed25519.
   *
   * @param {string} publicKey - Base58-encoded Solana address or hex public key
   * @param {Buffer|string} signature - 64-byte ed25519 signature
   * @param {Buffer} message - The signed message (raw message bytes)
   * @returns {boolean} True if signature is valid
   */
  verifySignature(publicKey, signature, message) {
    try {
      // Resolve public key bytes
      let pubKeyBytes;
      if (typeof publicKey === "string") {
        if (publicKey.length === 64) {
          // Hex-encoded 32-byte public key
          pubKeyBytes = Buffer.from(publicKey, "hex");
        } else if (
          publicKey.length === 44 &&
          /^[A-Za-z0-9+/=]+$/.test(publicKey)
        ) {
          // Base64-encoded 32-byte public key
          pubKeyBytes = Buffer.from(publicKey, "base64");
        } else {
          // Base58-encoded address (most common for Solana)
          pubKeyBytes = this._base58Decode(publicKey);
        }
      } else if (Buffer.isBuffer(publicKey)) {
        pubKeyBytes = publicKey;
      } else {
        pubKeyBytes = Buffer.from(publicKey);
      }

      if (pubKeyBytes.length !== SOLANA_PUBKEY_BYTES) {
        logger.debug("Invalid Solana public key length", {
          length: pubKeyBytes.length,
        });
        return false;
      }

      // Normalize signature to Buffer
      let sigBytes;
      if (Buffer.isBuffer(signature)) {
        sigBytes = signature;
      } else if (typeof signature === "string") {
        // Try base64 first, then hex
        sigBytes =
          signature.length === 88
            ? Buffer.from(signature, "base64")
            : Buffer.from(signature, "hex");
      } else {
        sigBytes = Buffer.from(signature);
      }

      // Ed25519 signature must be 64 bytes
      if (sigBytes.length !== SOLANA_SIGNATURE_BYTES) {
        logger.debug("Invalid ed25519 signature length", {
          length: sigBytes.length,
        });
        return false;
      }

      // For Solana, the signed payload is the raw message bytes, NOT a hash.
      // However, our hashRaw is a SHA-256 of the message bytes. If `message`
      // appears to be 32 bytes (a hash), we need the original message bytes.
      // The caller should pass the _signingPayload from computeHash() or
      // the _messageBytes from the transaction.
      let signedPayload = message;

      // Verify using Node.js crypto ed25519
      const keyObject = crypto.createPublicKey({
        key: Buffer.concat([
          // Ed25519 public key DER prefix (RFC 8032 / RFC 8410)
          Buffer.from("302a300506032b6570032100", "hex"),
          pubKeyBytes,
        ]),
        format: "der",
        type: "spki",
      });

      return crypto.verify(null, signedPayload, keyObject, sigBytes);
    } catch (e) {
      logger.debug("Solana signature verification failed", {
        publicKey:
          typeof publicKey === "string"
            ? publicKey.substring(0, 8) + "..."
            : "(buffer)",
        error: e.message,
      });
      return false;
    }
  }

  /**
   * Add a signature to a Solana transaction.
   *
   * Solana signatures are positional — the i-th signature corresponds
   * to the i-th required signer in the account keys array.
   *
   * @param {Object} transaction - The parsed transaction
   * @param {string} publicKey - The signer's base58 address or hex public key
   * @param {string} signature - Base64-encoded 64-byte ed25519 signature
   * @returns {Object} Transaction with signature added
   */
  addSignature(transaction, publicKey, signature) {
    const sigBytes =
      typeof signature === "string"
        ? Buffer.from(signature, "base64")
        : Buffer.isBuffer(signature)
          ? signature
          : Buffer.from(signature);

    // Find the signer's index in the account keys
    const pubKeyBytes =
      typeof publicKey === "string" && publicKey.length !== 64
        ? this._base58Decode(publicKey)
        : Buffer.from(publicKey, publicKey.length === 64 ? "hex" : "base64");

    const accountKeys = transaction.message?.accountKeys || [];
    const signerIndex = accountKeys.findIndex((key) => {
      const keyBuf = Buffer.isBuffer(key) ? key : Buffer.from(key);
      return keyBuf.equals(pubKeyBytes);
    });

    if (signerIndex === -1) {
      logger.warn("Signer not found in transaction account keys", {
        publicKey:
          typeof publicKey === "string"
            ? publicKey.substring(0, 8) + "..."
            : "(buffer)",
      });
      // Append to signatures anyway — the caller may know better
      if (!transaction.signatures) transaction.signatures = [];
      transaction.signatures.push(sigBytes);
    } else {
      // Ensure signatures array is large enough
      if (!transaction.signatures) transaction.signatures = [];
      while (transaction.signatures.length <= signerIndex) {
        transaction.signatures.push(Buffer.alloc(SOLANA_SIGNATURE_BYTES, 0));
      }
      transaction.signatures[signerIndex] = sigBytes;
    }

    return transaction;
  }

  /**
   * Serialize a Solana transaction back to encoded form.
   *
   * @param {Object} transaction - The transaction to serialize
   * @param {string} encoding - 'base64', 'base58', or 'hex'
   * @returns {string} Encoded transaction
   */
  serializeTransaction(transaction, encoding = "base64") {
    const normalizedEncoding = (encoding || "base64").toLowerCase();

    if (!["base64", "base58", "hex"].includes(normalizedEncoding)) {
      throw standardError(
        400,
        `Solana supports base64, base58, or hex encoding, got: ${normalizedEncoding}`,
      );
    }

    // If we have the raw bytes, use them (most reliable)
    const rawBytes = transaction._rawBytes;
    if (rawBytes) {
      switch (normalizedEncoding) {
        case "base64":
          return rawBytes.toString("base64");
        case "base58":
          return this._base58Encode(rawBytes);
        case "hex":
          return rawBytes.toString("hex");
      }
    }

    // Reconstruct from parsed fields
    const bytes = this._serializeFromFields(transaction);
    switch (normalizedEncoding) {
      case "base64":
        return bytes.toString("base64");
      case "base58":
        return this._base58Encode(bytes);
      case "hex":
        return bytes.toString("hex");
      default:
        return bytes.toString("base64");
    }
  }

  /**
   * Get potential signers for a Solana transaction.
   *
   * The required signers are the first numRequiredSignatures accounts
   * in the accountKeys array.
   *
   * @param {Object} transaction - The parsed transaction
   * @param {string} networkName - The network name
   * @returns {Promise<Array<string>>} List of potential signer addresses (base58)
   */
  async getPotentialSigners(transaction, networkName) {
    const signers = [];
    const header = transaction.message?.header;
    const accountKeys = transaction.message?.accountKeys || [];

    if (!header) {
      // For JSON-format transactions, try to extract signers from metadata
      if (transaction.feePayer) {
        signers.push(transaction.feePayer);
      }
      return signers;
    }

    const numSigners = header.numRequiredSignatures || 0;
    for (let i = 0; i < Math.min(numSigners, accountKeys.length); i++) {
      const keyBuf = Buffer.isBuffer(accountKeys[i])
        ? accountKeys[i]
        : Buffer.from(accountKeys[i]);
      signers.push(this._base58Encode(keyBuf));
    }

    return signers;
  }

  /**
   * Check if all required signatures are present
   * @param {Object} transaction - The parsed transaction
   * @param {Array<string>} signerKeys - The keys that have signed
   * @returns {Promise<boolean>} True if transaction is fully signed
   */
  async isFullySigned(transaction, signerKeys) {
    const numRequired = transaction.message?.header?.numRequiredSignatures || 1;
    return signerKeys.length >= numRequired;
  }

  /**
   * Match a signature to its signer.
   *
   * For Solana, signatures are positional (mapped to account keys by index).
   * We also verify against each potential signer's public key as a fallback.
   *
   * @param {Object} signatureObj - Signature object with `from` and `signature` fields
   * @param {Array<string>} potentialSigners - List of potential signer addresses
   * @param {Buffer} hashRaw - The message bytes for verification
   * @returns {{ key: string|null, signature: string }} Match result
   */
  matchSignatureToSigner(signatureObj, potentialSigners, hashRaw) {
    const sig = signatureObj.signature;

    // If the signature already declares its signer (from positional mapping)
    if (signatureObj.from && potentialSigners.includes(signatureObj.from)) {
      // Verify the signature
      const signingPayload = hashRaw._signingPayload || hashRaw;
      if (this.verifySignature(signatureObj.from, sig, signingPayload)) {
        return { key: signatureObj.from, signature: sig };
      }
    }

    // Brute-force verify against all potential signers
    for (const signer of potentialSigners) {
      const signingPayload = hashRaw._signingPayload || hashRaw;
      if (this.verifySignature(signer, sig, signingPayload)) {
        return { key: signer, signature: sig };
      }
    }

    return { key: null, signature: sig };
  }

  /**
   * Get network configuration for Solana
   * @param {string} networkName - The network name
   * @returns {Object} Network configuration
   */
  getNetworkConfig(networkName) {
    const normalized = this.normalizeNetworkName(networkName);
    return getNetworkConfig("solana", normalized);
  }

  /**
   * Get the RPC URL for a network
   * @param {string} networkName - The network name
   * @returns {string} RPC endpoint URL
   */
  getRpcUrl(networkName) {
    const normalized = this.normalizeNetworkName(networkName);

    // Check environment variable first
    const envKey = `SOLANA_${normalized.toUpperCase()}_RPC_URL`;
    if (process.env[envKey]) {
      return process.env[envKey];
    }

    // Try config
    const netConfig = this.getNetworkConfig(normalized);
    if (netConfig?.rpc) {
      return netConfig.rpc;
    }

    return DEFAULT_RPC_URLS[normalized] || DEFAULT_RPC_URLS.mainnet;
  }

  /**
   * Normalize network name to canonical form
   * @param {string} networkName - The network name
   * @returns {string} Normalized network name
   */
  normalizeNetworkName(networkName) {
    if (!networkName) return "mainnet";
    const normalized = String(networkName).toLowerCase();

    switch (normalized) {
      case "mainnet":
      case "main":
      case "mainnet-beta":
        return "mainnet";
      case "devnet":
      case "dev":
        return "devnet";
      case "testnet":
      case "test":
        return "testnet";
      default:
        return normalized;
    }
  }

  /**
   * Validate a Solana address (base58-encoded 32-byte ed25519 public key).
   *
   * @param {string} address - The Solana address to validate
   * @returns {boolean} True if valid Solana address
   */
  isValidPublicKey(address) {
    if (!address || typeof address !== "string") return false;

    // Solana addresses are 32-44 chars, base58-encoded
    if (address.length < 32 || address.length > 44) return false;

    // Validate base58 characters
    if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(address)) return false;

    try {
      // Decode and check it's exactly 32 bytes
      const decoded = this._base58Decode(address);
      return decoded.length === SOLANA_PUBKEY_BYTES;
    } catch (e) {
      return false;
    }
  }

  /**
   * Parse transaction parameters for storage
   * @param {Object} transaction - The Solana transaction
   * @param {Object} request - The original request
   * @returns {Object} Parsed parameters
   */
  parseTransactionParams(transaction, request) {
    const { callbackUrl, submit, desiredSigners, expires = 0 } = request;
    const now = Math.floor(Date.now() / 1000);
    const networkName = this.normalizeNetworkName(
      request.networkName || request.network,
    );

    const params = {
      blockchain: "solana",
      networkName,
      payload: this._getPayloadForStorage(transaction),
      encoding: "base64",
      signatures: [],
    };

    // Extract fee payer (first account key)
    const accountKeys = transaction.message?.accountKeys || [];
    if (accountKeys.length > 0) {
      const feePayer = Buffer.isBuffer(accountKeys[0])
        ? this._base58Encode(accountKeys[0])
        : accountKeys[0];
      params.source = feePayer;
      params.feePayer = feePayer;
    }

    // Extract recent blockhash
    if (transaction.message?.recentBlockhash) {
      const bh = transaction.message.recentBlockhash;
      params.recentBlockhash = Buffer.isBuffer(bh)
        ? this._base58Encode(bh)
        : bh;
    }

    // Extract instruction program IDs for metadata
    if (transaction.message?.instructions?.length) {
      params.programs = transaction.message.instructions.map((ix) => {
        const progKey = accountKeys[ix.programIdIndex];
        const progAddr = progKey
          ? Buffer.isBuffer(progKey)
            ? this._base58Encode(progKey)
            : progKey
          : `program_${ix.programIdIndex}`;
        return KNOWN_PROGRAMS[progAddr] || progAddr;
      });
    }

    // Callback URL validation
    if (callbackUrl) {
      const { isValidCallbackUrl } = require("../../utils/url-validator");
      if (!isValidCallbackUrl(callbackUrl)) {
        throw standardError(
          400,
          'Invalid URL supplied in "callbackUrl" parameter.',
        );
      }
      params.callbackUrl = callbackUrl;
    }

    // Desired signers
    if (desiredSigners?.length) {
      if (!Array.isArray(desiredSigners)) {
        throw standardError(
          400,
          'Invalid "desiredSigners" parameter. Expected an array of Solana addresses.',
        );
      }
      for (const addr of desiredSigners) {
        if (!this.isValidPublicKey(addr)) {
          throw standardError(
            400,
            `Invalid "desiredSigners" parameter. Address ${addr} is not a valid Solana address.`,
          );
        }
      }
      params.desiredSigners = desiredSigners;
    }

    // Handle expiration
    if (expires) {
      if (expires > 2147483647 || expires < 0) {
        throw standardError(
          400,
          `Invalid "expires" parameter. ${expires} is not a valid UNIX date.`,
        );
      }
      if (expires < now) {
        throw standardError(
          400,
          `Invalid "expires" parameter. ${expires} date has already passed.`,
        );
      }
      params.maxTime = expires;
    }

    // Submit flag
    if (submit === true) {
      params.submit = true;
    }

    return params;
  }

  // ===================================================================
  // Private utility methods
  // ===================================================================

  /**
   * Get the payload in storable format
   * @param {Object} transaction - The parsed transaction
   * @returns {string} Base64-encoded payload
   * @private
   */
  _getPayloadForStorage(transaction) {
    if (transaction._rawBytes) {
      return transaction._rawBytes.toString("base64");
    }
    // JSON fallback
    return Buffer.from(JSON.stringify(transaction)).toString("base64");
  }

  /**
   * Serialize a transaction from its parsed fields.
   * Rebuilds the wire format from signatures + message components.
   *
   * @param {Object} transaction - Parsed transaction object
   * @returns {Buffer} Serialized transaction bytes
   * @private
   */
  _serializeFromFields(transaction) {
    const parts = [];

    // Signatures
    const sigs = transaction.signatures || [];
    parts.push(this._writeCompactU16(sigs.length));
    for (const sig of sigs) {
      const sigBuf = Buffer.isBuffer(sig) ? sig : Buffer.from(sig, "base64");
      // Pad or truncate to 64 bytes
      const padded = Buffer.alloc(SOLANA_SIGNATURE_BYTES, 0);
      sigBuf.copy(
        padded,
        0,
        0,
        Math.min(sigBuf.length, SOLANA_SIGNATURE_BYTES),
      );
      parts.push(padded);
    }

    // Message header
    const header = transaction.message?.header || {};
    parts.push(
      Buffer.from([
        header.numRequiredSignatures || 0,
        header.numReadonlySignedAccounts || 0,
        header.numReadonlyUnsignedAccounts || 0,
      ]),
    );

    // Account keys
    const keys = transaction.message?.accountKeys || [];
    parts.push(this._writeCompactU16(keys.length));
    for (const key of keys) {
      parts.push(Buffer.isBuffer(key) ? key : Buffer.from(key));
    }

    // Recent blockhash
    const bh = transaction.message?.recentBlockhash;
    if (bh) {
      parts.push(Buffer.isBuffer(bh) ? bh : this._base58Decode(bh));
    }

    // Instructions
    const ixs = transaction.message?.instructions || [];
    parts.push(this._writeCompactU16(ixs.length));
    for (const ix of ixs) {
      parts.push(Buffer.from([ix.programIdIndex]));

      const accIdxs = ix.accountIndices || [];
      parts.push(this._writeCompactU16(accIdxs.length));
      parts.push(Buffer.from(accIdxs));

      const data = ix.data || Buffer.alloc(0);
      const dataBuf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      parts.push(this._writeCompactU16(dataBuf.length));
      parts.push(dataBuf);
    }

    return Buffer.concat(parts);
  }

  /**
   * Read a compact-u16 value from a buffer.
   * Solana uses 1-3 bytes for variable length encoding.
   *
   * @param {Buffer} buffer - Source buffer
   * @param {number} offset - Read offset
   * @returns {{ value: number, bytesRead: number }}
   * @private
   */
  _readCompactU16(buffer, offset) {
    let value = 0;
    let bytesRead = 0;
    let shift = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (offset + bytesRead >= buffer.length) {
        throw new Error("Unexpected end of buffer reading compact-u16");
      }
      const byte = buffer[offset + bytesRead];
      bytesRead += 1;

      value |= (byte & 0x7f) << shift;

      if ((byte & 0x80) === 0) {
        break;
      }
      shift += 7;

      if (bytesRead > 3) {
        throw new Error("compact-u16 exceeds 3 bytes");
      }
    }

    return { value, bytesRead };
  }

  /**
   * Write a compact-u16 value to a buffer.
   *
   * @param {number} value - The value to encode
   * @returns {Buffer} Encoded bytes (1-3 bytes)
   * @private
   */
  _writeCompactU16(value) {
    const bytes = [];
    let remaining = value;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      let byte = remaining & 0x7f;
      remaining >>= 7;

      if (remaining > 0) {
        byte |= 0x80;
      }

      bytes.push(byte);

      if (remaining === 0) break;
    }

    return Buffer.from(bytes);
  }

  /**
   * Base58 encode (Bitcoin-style, no 0/O/I/l — Solana standard)
   * @param {Buffer} data - Data to encode
   * @returns {string} Base58-encoded string
   * @private
   */
  _base58Encode(data) {
    if (data.length === 0) return "";

    // Count leading zeros
    let zeros = 0;
    for (let i = 0; i < data.length && data[i] === 0; i++) {
      zeros++;
    }

    // Convert to base58
    const size = Math.ceil((data.length * 138) / 100) + 1;
    const b58 = new Uint8Array(size);
    let length = 0;

    for (let i = zeros; i < data.length; i++) {
      let carry = data[i];
      let j = 0;

      for (let k = size - 1; (carry !== 0 || j < length) && k >= 0; k--, j++) {
        carry += 256 * b58[k];
        b58[k] = carry % 58;
        carry = Math.floor(carry / 58);
      }

      length = j;
    }

    // Skip leading zeros in base58 result
    let start = size - length;
    while (start < size && b58[start] === 0) {
      start++;
    }

    // Build string
    let result = "1".repeat(zeros);
    for (let i = start; i < size; i++) {
      result += BASE58_ALPHABET[b58[i]];
    }

    return result;
  }

  /**
   * Base58 decode (Bitcoin-style — Solana standard)
   * @param {string} encoded - Base58-encoded string
   * @returns {Buffer} Decoded bytes
   * @private
   */
  _base58Decode(encoded) {
    if (encoded.length === 0) return Buffer.alloc(0);

    // Count leading '1's (represent zero bytes)
    let zeros = 0;
    for (let i = 0; i < encoded.length && encoded[i] === "1"; i++) {
      zeros++;
    }

    // Allocate enough space
    const size = Math.ceil((encoded.length * 733) / 1000) + 1;
    const b256 = new Uint8Array(size);
    let length = 0;

    for (let i = zeros; i < encoded.length; i++) {
      const ch = BASE58_ALPHABET.indexOf(encoded[i]);
      if (ch === -1) {
        throw new Error(`Invalid base58 character: ${encoded[i]}`);
      }

      let carry = ch;
      let j = 0;

      for (let k = size - 1; (carry !== 0 || j < length) && k >= 0; k--, j++) {
        carry += 58 * b256[k];
        b256[k] = carry % 256;
        carry = Math.floor(carry / 256);
      }

      length = j;
    }

    // Skip leading zeros in base256 result
    let start = size - length;
    while (start < size && b256[start] === 0) {
      start++;
    }

    // Build result with leading zero bytes
    const result = Buffer.alloc(zeros + (size - start));
    for (let i = start; i < size; i++) {
      result[zeros + i - start] = b256[i];
    }

    return result;
  }
}

// Export singleton instance
module.exports = new SolanaHandler();
