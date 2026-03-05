/**
 * Algorand Blockchain Handler
 *
 * Implements the BlockchainHandler interface for Algorand blockchain.
 * Algorand uses ed25519 keys (same curve as Stellar) with base32 addresses
 * and msgpack-encoded transactions.
 *
 * Key characteristics:
 * - ed25519 key format (base32-encoded addresses with 4-byte checksum)
 * - msgpack encoding for transactions (base64 for transport)
 * - Single-signer model (one sender per transaction)
 * - Group transactions for atomic multi-party operations
 *
 * HSM Integration:
 * - Signs via hsmKeyStore.signAlgorandTransaction() (KEK-DEK envelope)
 * - 32-byte ed25519 seed wrapped with RSA-OAEP in Azure Managed HSM
 * - Full 64-byte key (seed‖pubkey) reconstructed only during signing
 * - Compatible with azureCryptoService for direct HSM ed25519 signing
 *
 * @module business-logic/handlers/algorand-handler
 */

const crypto = require("crypto");
const BlockchainHandler = require("./blockchain-handler");
const { standardError } = require("../std-error");
const {
  getBlockchainConfig,
  getNetworkConfig,
} = require("../blockchain-registry");
const logger = require("../../utils/logger").forComponent("algorand-handler");

/**
 * Algorand address constants
 * Addresses are base32-encoded: 32-byte public key + 4-byte checksum = 58 chars
 */
const ALGORAND_ADDRESS_LENGTH = 58;
const ALGORAND_CHECKSUM_BYTES = 4;
const ALGORAND_PUBLIC_KEY_BYTES = 32;

/**
 * Default RPC endpoints per network
 */
const DEFAULT_RPC_URLS = {
  mainnet: "https://mainnet-api.algonode.cloud",
  testnet: "https://testnet-api.algonode.cloud",
  betanet: "https://betanet-api.algonode.cloud",
};

/**
 * Algorand transaction types
 */
const TX_TYPES = {
  pay: "Payment",
  keyreg: "Key Registration",
  acfg: "Asset Config",
  axfer: "Asset Transfer",
  afrz: "Asset Freeze",
  appl: "Application Call",
  stpf: "State Proof",
};

class AlgorandHandler extends BlockchainHandler {
  constructor() {
    super("algorand");
    this.config = getBlockchainConfig("algorand");
  }

  /**
   * Parse an Algorand transaction from its encoded payload.
   *
   * Accepts:
   * - base64 string (base64-encoded msgpack)
   * - hex string
   * - JSON object (unsigned transaction fields)
   *
   * Returns a normalized transaction object suitable for hashing and signing.
   *
   * @param {string|Object} payload - Encoded transaction or JSON object
   * @param {string} encoding - 'base64', 'msgpack', 'hex', or 'json'
   * @param {string} networkName - The network name (mainnet, testnet, betanet)
   * @returns {Object} Parsed Algorand transaction object
   */
  parseTransaction(payload, encoding, networkName) {
    const normalizedEncoding = (encoding || "base64").toLowerCase();

    if (!["base64", "msgpack", "hex", "json"].includes(normalizedEncoding)) {
      throw standardError(
        400,
        `Algorand supports base64, msgpack, hex, or json encoding, got: ${normalizedEncoding}`,
      );
    }

    try {
      let txnBytes;
      let txnObj;

      switch (normalizedEncoding) {
        case "base64":
        case "msgpack":
          // base64-encoded msgpack is the standard Algorand transport format
          txnBytes = Buffer.from(payload, "base64");
          txnObj = this._decodeMsgpack(txnBytes);
          break;

        case "hex":
          txnBytes = Buffer.from(payload, "hex");
          txnObj = this._decodeMsgpack(txnBytes);
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

      // Validate required transaction fields
      this._validateTransactionFields(txnObj);

      // Attach metadata for later use
      txnObj._networkName = this.normalizeNetworkName(networkName);
      txnObj._originalEncoding = normalizedEncoding;
      txnObj._rawBytes = txnBytes || null;

      return txnObj;
    } catch (e) {
      if (e.status) throw e;
      logger.warn("Failed to parse Algorand transaction", {
        error: e.message,
        encoding: normalizedEncoding,
      });
      throw standardError(400, "Invalid Algorand transaction data");
    }
  }

  /**
   * Decode msgpack bytes into a transaction object.
   * Algorand transactions are msgpack-encoded with a "TX" prefix tag.
   *
   * @param {Buffer} bytes - Raw msgpack bytes
   * @returns {Object} Decoded transaction object
   * @private
   */
  _decodeMsgpack(bytes) {
    // Algorand signed transactions wrap the txn in { sig, msig, lsig, txn }
    // Unsigned transactions are prefixed with "TX" tag for hashing
    // For transport, they're typically the raw msgpack of the transaction fields

    // Check if this is a signed transaction envelope
    // Signed txns have a 'txn' key wrapping the actual transaction
    let decoded;
    try {
      // Use a lightweight msgpack decode
      decoded = this._simpleMsgpackDecode(bytes);
    } catch (e) {
      throw standardError(400, "Failed to decode msgpack transaction data");
    }

    // If it's a signed transaction envelope, extract the inner txn
    if (decoded && decoded.txn && typeof decoded.txn === "object") {
      const envelope = decoded;
      const txn = envelope.txn;

      // Preserve any existing signatures
      if (envelope.sig) {
        txn._sig = envelope.sig;
      }
      if (envelope.msig) {
        txn._msig = envelope.msig;
      }
      if (envelope.lsig) {
        txn._lsig = envelope.lsig;
      }

      return txn;
    }

    return decoded;
  }

  /**
   * Simple msgpack decoder for Algorand transactions.
   * Handles the subset of msgpack used by Algorand SDK.
   *
   * @param {Buffer} buffer - Msgpack bytes
   * @returns {Object} Decoded object
   * @private
   */
  _simpleMsgpackDecode(buffer) {
    // For production, this should use the algosdk or @msgpack/msgpack library.
    // This is a placeholder that works with the base64 round-trip pattern:
    // the caller passes the raw bytes which will be forwarded to algosdk
    // at signing time.
    //
    // Store raw bytes and parse known fields for metadata extraction.
    return {
      _rawMsgpack: buffer,
      _isPacked: true,
    };
  }

  /**
   * Validate required Algorand transaction fields
   * @param {Object} txnObj - Transaction object
   * @private
   */
  _validateTransactionFields(txnObj) {
    // For raw msgpack passthrough, we accept the packed form
    if (txnObj._isPacked && txnObj._rawMsgpack) {
      // Minimal validation: check buffer is non-empty
      if (!txnObj._rawMsgpack.length) {
        throw standardError(400, "Empty Algorand transaction payload");
      }
      return;
    }

    // For JSON-decoded transactions, validate known fields
    if (!txnObj.type && !txnObj.txn_type) {
      // Algorand SDK uses 'type' field; some formats use shorthand
      logger.debug("Transaction has no explicit type field, may be raw format");
    }
  }

  /**
   * Compute the transaction hash (TxID).
   *
   * Algorand TxID = SHA-512/256("TX" || msgpack(transaction))
   * This matches the algosdk computation.
   *
   * @param {Object} transaction - The parsed transaction
   * @returns {{ hash: string, hashRaw: Buffer }} Transaction hash (hex)
   */
  computeHash(transaction) {
    let hashInput;

    if (transaction._rawMsgpack || transaction._rawBytes) {
      // Use raw bytes with "TX" prefix tag
      const rawBytes = transaction._rawMsgpack || transaction._rawBytes;
      const txTag = Buffer.from("TX");
      hashInput = Buffer.concat([txTag, rawBytes]);
    } else {
      // For JSON transactions, we need to msgpack-encode first
      // In production this would use algosdk.encodeObj()
      throw standardError(
        400,
        "Cannot compute hash for JSON-format transactions without algosdk encoding",
      );
    }

    // Algorand uses SHA-512/256 for transaction IDs
    const hashRaw = crypto.createHash("sha512-256").update(hashInput).digest();

    return {
      hash: hashRaw.toString("hex"),
      hashRaw,
    };
  }

  /**
   * Extract signatures from an Algorand transaction.
   *
   * Algorand supports three signature types:
   * - sig: Single ed25519 signature (64 bytes)
   * - msig: Multisig (threshold + array of ed25519 key/sig pairs)
   * - lsig: Logic signature (TEAL program)
   *
   * @param {Object} transaction - The parsed transaction
   * @returns {Array<Object>} Array of signature objects
   */
  extractSignatures(transaction) {
    const signatures = [];

    // Single signature
    if (transaction._sig) {
      signatures.push({
        type: "single",
        signature: Buffer.isBuffer(transaction._sig)
          ? transaction._sig.toString("base64")
          : transaction._sig,
        from: transaction.snd || transaction.sender,
      });
    }

    // Multisig
    if (transaction._msig) {
      const msig = transaction._msig;
      if (msig.subsig && Array.isArray(msig.subsig)) {
        for (const subsig of msig.subsig) {
          if (subsig.s) {
            signatures.push({
              type: "multisig",
              signature: Buffer.isBuffer(subsig.s)
                ? subsig.s.toString("base64")
                : subsig.s,
              from: subsig.pk ? this._publicKeyToAddress(subsig.pk) : "unknown",
              threshold: msig.thr,
              version: msig.v,
            });
          }
        }
      }
    }

    // Logic signatures are not directly extractable as key-based sigs
    if (transaction._lsig) {
      signatures.push({
        type: "logicsig",
        from: transaction.snd || transaction.sender,
      });
    }

    return signatures;
  }

  /**
   * Clear all signatures from the transaction
   * @param {Object} transaction - The transaction
   * @returns {Object} Transaction without signatures
   */
  clearSignatures(transaction) {
    delete transaction._sig;
    delete transaction._msig;
    delete transaction._lsig;
    return transaction;
  }

  /**
   * Verify an ed25519 signature against an Algorand public key/address.
   *
   * Uses Node.js crypto to verify ed25519 without requiring algosdk.
   *
   * @param {string} publicKey - Algorand address (base32) or hex public key
   * @param {Buffer|string} signature - 64-byte ed25519 signature
   * @param {Buffer} message - The signed message (TX-prefixed msgpack hash)
   * @returns {boolean} True if signature is valid
   */
  verifySignature(publicKey, signature, message) {
    try {
      // Resolve public key bytes
      let pubKeyBytes;
      if (publicKey.length === ALGORAND_ADDRESS_LENGTH) {
        // Base32 Algorand address → extract 32-byte pubkey
        pubKeyBytes = this._addressToPublicKey(publicKey);
      } else if (publicKey.length === 64) {
        // Hex-encoded 32-byte public key
        pubKeyBytes = Buffer.from(publicKey, "hex");
      } else if (publicKey.length === 44) {
        // Base64-encoded 32-byte public key
        pubKeyBytes = Buffer.from(publicKey, "base64");
      } else {
        logger.debug("Unknown Algorand public key format", {
          length: publicKey.length,
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
      if (sigBytes.length !== 64) {
        logger.debug("Invalid ed25519 signature length", {
          length: sigBytes.length,
        });
        return false;
      }

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

      return crypto.verify(null, message, keyObject, sigBytes);
    } catch (e) {
      logger.debug("Algorand signature verification failed", {
        publicKey: publicKey.substring(0, 8) + "...",
        error: e.message,
      });
      return false;
    }
  }

  /**
   * Add a signature to an Algorand transaction.
   *
   * For single-sig: sets the _sig field.
   * For multisig: appends to the _msig.subsig array.
   *
   * @param {Object} transaction - The parsed transaction
   * @param {string} publicKey - The signer's address or public key
   * @param {string} signature - Base64-encoded 64-byte ed25519 signature
   * @returns {Object} Transaction with signature added
   */
  addSignature(transaction, publicKey, signature) {
    const sigBytes =
      typeof signature === "string"
        ? Buffer.from(signature, "base64")
        : signature;

    if (transaction._msig) {
      // Multisig: find the subsig slot for this key and fill it
      const pubKeyBytes =
        publicKey.length === ALGORAND_ADDRESS_LENGTH
          ? this._addressToPublicKey(publicKey)
          : Buffer.from(publicKey, "hex");

      const subsig = transaction._msig.subsig.find(
        (s) => s.pk && Buffer.from(s.pk).equals(pubKeyBytes),
      );

      if (subsig) {
        subsig.s = sigBytes;
      } else {
        transaction._msig.subsig.push({ pk: pubKeyBytes, s: sigBytes });
      }
    } else {
      // Single signature
      transaction._sig = sigBytes;
    }

    return transaction;
  }

  /**
   * Serialize an Algorand transaction back to encoded form.
   *
   * @param {Object} transaction - The transaction to serialize
   * @param {string} encoding - 'base64' or 'hex'
   * @returns {string} Encoded transaction
   */
  serializeTransaction(transaction, encoding = "base64") {
    const normalizedEncoding = (encoding || "base64").toLowerCase();

    if (!["base64", "hex", "msgpack"].includes(normalizedEncoding)) {
      throw standardError(
        400,
        `Algorand supports base64, hex, or msgpack encoding, got: ${normalizedEncoding}`,
      );
    }

    // If we have the raw msgpack bytes, use them
    const rawBytes = transaction._rawMsgpack || transaction._rawBytes;
    if (!rawBytes) {
      throw standardError(
        400,
        "Cannot serialize JSON-format transactions without algosdk encoding",
      );
    }

    switch (normalizedEncoding) {
      case "base64":
      case "msgpack":
        return rawBytes.toString("base64");
      case "hex":
        return rawBytes.toString("hex");
      default:
        return rawBytes.toString("base64");
    }
  }

  /**
   * Get potential signers for an Algorand transaction.
   *
   * For single-sig: the sender is the only potential signer.
   * For multisig: all subsig public keys are potential signers.
   *
   * @param {Object} transaction - The parsed transaction
   * @param {string} networkName - The network name
   * @returns {Promise<Array<string>>} List of potential signer addresses
   */
  async getPotentialSigners(transaction, networkName) {
    const signers = [];

    // For multisig transactions, extract all participant keys
    if (transaction._msig && transaction._msig.subsig) {
      for (const subsig of transaction._msig.subsig) {
        if (subsig.pk) {
          signers.push(this._publicKeyToAddress(subsig.pk));
        }
      }
    }

    // The sender is always a potential signer
    const sender = transaction.snd || transaction.sender || transaction.from;
    if (sender) {
      const senderAddr =
        typeof sender === "string" && sender.length === ALGORAND_ADDRESS_LENGTH
          ? sender
          : this._publicKeyToAddress(sender);

      if (!signers.includes(senderAddr)) {
        signers.push(senderAddr);
      }
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
    if (transaction._msig) {
      // Multisig: need >= threshold signatures
      const threshold = transaction._msig.thr || 1;
      const signedCount = signerKeys.length;
      return signedCount >= threshold;
    }

    // Single-sig: need exactly one signature
    return signerKeys.length >= 1;
  }

  /**
   * Match a signature to its signer.
   *
   * For Algorand, signatures don't carry "hints" like Stellar.
   * We verify against each potential signer's public key.
   *
   * @param {Object} signatureObj - Signature object with `from` and `signature` fields
   * @param {Array<string>} potentialSigners - List of potential signer addresses
   * @param {Buffer} hashRaw - The transaction hash for verification
   * @returns {{ key: string|null, signature: string }} Match result
   */
  matchSignatureToSigner(signatureObj, potentialSigners, hashRaw) {
    const sig = signatureObj.signature;

    // If the signature already declares its signer
    if (signatureObj.from && potentialSigners.includes(signatureObj.from)) {
      if (this.verifySignature(signatureObj.from, sig, hashRaw)) {
        return { key: signatureObj.from, signature: sig };
      }
    }

    // Brute-force verify against all potential signers
    for (const signer of potentialSigners) {
      if (this.verifySignature(signer, sig, hashRaw)) {
        return { key: signer, signature: sig };
      }
    }

    return { key: null, signature: sig };
  }

  /**
   * Get network configuration for Algorand
   * @param {string} networkName - The network name
   * @returns {Object} Network configuration
   */
  getNetworkConfig(networkName) {
    const normalized = this.normalizeNetworkName(networkName);
    return getNetworkConfig("algorand", normalized);
  }

  /**
   * Get the RPC URL for a network
   * @param {string} networkName - The network name
   * @returns {string} RPC endpoint URL
   */
  getRpcUrl(networkName) {
    const normalized = this.normalizeNetworkName(networkName);

    // Check environment variable first
    const envKey = `ALGORAND_${normalized.toUpperCase()}_RPC_URL`;
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
      case "mainnet-v1.0":
        return "mainnet";
      case "testnet":
      case "test":
      case "testnet-v1.0":
        return "testnet";
      case "betanet":
      case "beta":
      case "betanet-v1.0":
        return "betanet";
      default:
        return normalized;
    }
  }

  /**
   * Validate an Algorand address.
   *
   * Algorand addresses are 58-character base32 strings where:
   * - First 52 chars encode the 32-byte public key
   * - Last 6 chars encode the 4-byte checksum (SHA-512/256 of pubkey, last 4 bytes)
   *
   * @param {string} address - The Algorand address to validate
   * @returns {boolean} True if valid Algorand address
   */
  isValidPublicKey(address) {
    if (!address || typeof address !== "string") return false;

    // Algorand addresses are exactly 58 characters, uppercase base32
    if (address.length !== ALGORAND_ADDRESS_LENGTH) return false;
    if (!/^[A-Z2-7]{58}$/.test(address)) return false;

    try {
      // Decode base32 and verify checksum
      const decoded = this._base32Decode(address);
      if (
        decoded.length !==
        ALGORAND_PUBLIC_KEY_BYTES + ALGORAND_CHECKSUM_BYTES
      ) {
        return false;
      }

      const publicKey = decoded.slice(0, ALGORAND_PUBLIC_KEY_BYTES);
      const checksum = decoded.slice(ALGORAND_PUBLIC_KEY_BYTES);

      // Checksum = last 4 bytes of SHA-512/256(publicKey)
      const hash = crypto.createHash("sha512-256").update(publicKey).digest();
      const expectedChecksum = hash.slice(-ALGORAND_CHECKSUM_BYTES);

      return checksum.equals(expectedChecksum);
    } catch (e) {
      return false;
    }
  }

  /**
   * Parse transaction parameters for storage
   * @param {Object} transaction - The Algorand transaction
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
      blockchain: "algorand",
      networkName,
      payload: this._getPayloadForStorage(transaction),
      encoding: "base64",
      signatures: [],
    };

    // Extract transaction type if available
    if (transaction.type || transaction.txn_type) {
      params.txType = transaction.type || transaction.txn_type;
    }

    // Extract sender
    const sender = transaction.snd || transaction.sender || transaction.from;
    if (sender) {
      params.source =
        typeof sender === "string" && sender.length === ALGORAND_ADDRESS_LENGTH
          ? sender
          : this._publicKeyToAddress(sender);
    }

    // Callback URL validation
    if (callbackUrl) {
      if (
        !/^http(s)?:\/\/[-a-zA-Z0-9_+.]{2,256}\.[a-z]{2,4}\b(\/[-a-zA-Z0-9@:%_+.~#?&/=]*)?$/m.test(
          callbackUrl,
        )
      ) {
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
          'Invalid "desiredSigners" parameter. Expected an array of Algorand addresses.',
        );
      }
      for (const addr of desiredSigners) {
        if (!this.isValidPublicKey(addr)) {
          throw standardError(
            400,
            `Invalid "desiredSigners" parameter. Address ${addr} is not a valid Algorand address.`,
          );
        }
      }
      params.desiredSigners = desiredSigners;
    }

    // Algorand transactions have first-valid / last-valid rounds instead of timestamps
    // firstValid / lastValid are round numbers
    if (transaction.fv || transaction.first_valid) {
      params.minTime = transaction.fv || transaction.first_valid;
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
    if (transaction._rawMsgpack) {
      return transaction._rawMsgpack.toString("base64");
    }
    if (transaction._rawBytes) {
      return transaction._rawBytes.toString("base64");
    }
    // JSON fallback
    return Buffer.from(JSON.stringify(transaction)).toString("base64");
  }

  /**
   * Convert a 32-byte ed25519 public key to an Algorand address.
   *
   * Address = Base32(publicKey ‖ checksum)
   * where checksum = last 4 bytes of SHA-512/256(publicKey)
   *
   * @param {Buffer|Uint8Array} publicKey - 32-byte ed25519 public key
   * @returns {string} 58-character Algorand address
   * @private
   */
  _publicKeyToAddress(publicKey) {
    const pubKeyBuf = Buffer.isBuffer(publicKey)
      ? publicKey
      : Buffer.from(publicKey);

    const hash = crypto.createHash("sha512-256").update(pubKeyBuf).digest();
    const checksum = hash.slice(-ALGORAND_CHECKSUM_BYTES);

    const addrBytes = Buffer.concat([pubKeyBuf, checksum]);
    return this._base32Encode(addrBytes);
  }

  /**
   * Extract the 32-byte ed25519 public key from an Algorand address.
   *
   * @param {string} address - 58-character Algorand address
   * @returns {Buffer} 32-byte ed25519 public key
   * @private
   */
  _addressToPublicKey(address) {
    const decoded = this._base32Decode(address);
    return decoded.slice(0, ALGORAND_PUBLIC_KEY_BYTES);
  }

  /**
   * Base32 encode (RFC 4648, no padding, uppercase — Algorand standard)
   * @param {Buffer} data - Data to encode
   * @returns {string} Base32-encoded string
   * @private
   */
  _base32Encode(data) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = 0;
    let value = 0;
    let output = "";

    for (let i = 0; i < data.length; i++) {
      value = (value << 8) | data[i];
      bits += 8;

      while (bits >= 5) {
        output += alphabet[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }

    if (bits > 0) {
      output += alphabet[(value << (5 - bits)) & 31];
    }

    return output;
  }

  /**
   * Base32 decode (RFC 4648, no padding, uppercase — Algorand standard)
   * @param {string} encoded - Base32-encoded string
   * @returns {Buffer} Decoded bytes
   * @private
   */
  _base32Decode(encoded) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = 0;
    let value = 0;
    const output = [];

    for (let i = 0; i < encoded.length; i++) {
      const idx = alphabet.indexOf(encoded[i]);
      if (idx === -1)
        throw new Error(`Invalid base32 character: ${encoded[i]}`);

      value = (value << 5) | idx;
      bits += 5;

      if (bits >= 8) {
        output.push((value >>> (bits - 8)) & 255);
        bits -= 8;
      }
    }

    return Buffer.from(output);
  }
}

// Export singleton instance
module.exports = new AlgorandHandler();
