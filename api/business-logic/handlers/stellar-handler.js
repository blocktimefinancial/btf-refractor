/**
 * Stellar Blockchain Handler
 *
 * Implements the BlockchainHandler interface for Stellar blockchain.
 * Handles Stellar-specific transaction parsing, signing, and verification.
 *
 * @module business-logic/handlers/stellar-handler
 */

const {
  TransactionBuilder,
  FeeBumpTransaction,
  Keypair,
  StrKey,
} = require("@stellar/stellar-sdk");
const {
  inspectTransactionSigners,
} = require("@stellar-expert/tx-signers-inspector");
const BlockchainHandler = require("./blockchain-handler");
const { standardError } = require("../std-error");
const {
  getBlockchainConfig,
  getNetworkConfig,
} = require("../blockchain-registry");
const { hintMatchesKey, hintToMask } = require("../signature-hint-utils");
const logger = require("../../utils/logger").forComponent("stellar-handler");

/**
 * Network name to passphrase mapping
 * Matches blockchain-registry network names
 */
const NETWORK_PASSPHRASES = {
  public: "Public Global Stellar Network ; September 2015",
  testnet: "Test SDF Network ; September 2015",
  futurenet: "Test SDF Future Network ; October 2022",
};

/**
 * Network name to Horizon URL mapping
 * Can be overridden by config
 */
const DEFAULT_HORIZON_URLS = {
  public: "https://horizon.stellar.org",
  testnet: "https://horizon-testnet.stellar.org",
  futurenet: "https://horizon-futurenet.stellar.org",
};

class StellarHandler extends BlockchainHandler {
  constructor() {
    super("stellar");
    this.config = getBlockchainConfig("stellar");
  }

  /**
   * Parse a Stellar transaction from XDR
   * @param {string} payload - The XDR-encoded transaction
   * @param {string} encoding - The encoding format (only base64 supported)
   * @param {string} networkName - The network name (public, testnet, futurenet)
   * @returns {Object} Parsed Stellar Transaction object
   */
  parseTransaction(payload, encoding, networkName) {
    if (encoding !== "base64") {
      throw standardError(
        400,
        `Stellar only supports base64 encoding, got: ${encoding}`,
      );
    }

    const passphrase = this.getNetworkPassphrase(networkName);

    let txEnvelope;
    try {
      txEnvelope = TransactionBuilder.fromXDR(payload, passphrase);
    } catch (e) {
      logger.warn("Failed to parse Stellar XDR", { error: e.message });
      throw standardError(400, "Invalid Stellar transaction XDR");
    }

    if (txEnvelope instanceof FeeBumpTransaction) {
      throw standardError(406, "FeeBump transactions not supported");
    }

    return txEnvelope;
  }

  /**
   * Compute the transaction hash
   * @param {Object} transaction - The Stellar transaction
   * @returns {{ hash: string, hashRaw: Buffer }} Transaction hash
   */
  computeHash(transaction) {
    const hashRaw = transaction.hash();
    return {
      hash: hashRaw.toString("hex"),
      hashRaw,
    };
  }

  /**
   * Extract signatures from a Stellar transaction
   * @param {Object} transaction - The Stellar transaction
   * @returns {Array<Object>} Array of signature objects
   */
  extractSignatures(transaction) {
    return transaction.signatures.slice();
  }

  /**
   * Clear signatures from a transaction
   * @param {Object} transaction - The Stellar transaction
   * @returns {Object} Transaction with signatures cleared
   */
  clearSignatures(transaction) {
    transaction._signatures = [];
    return transaction;
  }

  /**
   * Verify a signature against a Stellar public key
   * @param {string} publicKey - The Stellar public key (G...)
   * @param {Buffer} signature - The signature to verify
   * @param {Buffer} message - The transaction hash
   * @returns {boolean} True if signature is valid
   */
  verifySignature(publicKey, signature, message) {
    try {
      return Keypair.fromPublicKey(publicKey).verify(message, signature);
    } catch (e) {
      logger.debug("Signature verification failed", {
        publicKey,
        error: e.message,
      });
      return false;
    }
  }

  /**
   * Add a signature to a Stellar transaction
   * @param {Object} transaction - The Stellar transaction
   * @param {string} publicKey - The signer's public key
   * @param {string} signature - The base64-encoded signature
   * @returns {Object} Transaction with signature added
   */
  addSignature(transaction, publicKey, signature) {
    transaction.addSignature(publicKey, signature);
    return transaction;
  }

  /**
   * Serialize a Stellar transaction back to XDR
   * @param {Object} transaction - The Stellar transaction
   * @param {string} encoding - The encoding format (only base64)
   * @returns {string} XDR-encoded transaction
   */
  serializeTransaction(transaction, encoding = "base64") {
    if (encoding !== "base64") {
      throw standardError(400, `Stellar only supports base64 encoding`);
    }
    return transaction.toXDR();
  }

  /**
   * Get potential signers for a Stellar transaction
   * Uses the tx-signers-inspector library
   * @param {Object} transaction - The Stellar transaction
   * @param {string} networkName - The network name
   * @param {Object} [accountsInfo] - Pre-loaded account info (optional)
   * @returns {Promise<Array<string>>} List of potential signer public keys
   */
  async getPotentialSigners(transaction, networkName, accountsInfo = null) {
    const horizon = this.getHorizonUrl(networkName);

    const schema = await inspectTransactionSigners(transaction, {
      horizon,
      accountsInfo,
    });

    return schema.getAllPotentialSigners();
  }

  /**
   * Get the signer schema for a transaction
   * Used for checking if transaction is fully signed
   * @param {Object} transaction - The Stellar transaction
   * @param {string} networkName - The network name
   * @param {Object} [accountsInfo] - Pre-loaded account info
   * @returns {Promise<Object>} Signer schema object
   */
  async getSignerSchema(transaction, networkName, accountsInfo = null) {
    const horizon = this.getHorizonUrl(networkName);

    return inspectTransactionSigners(transaction, {
      horizon,
      accountsInfo,
    });
  }

  /**
   * Check if all required signatures are present
   * @param {Object} signerSchema - The signer schema from getSignerSchema
   * @param {Array<string>} signerKeys - The keys that have signed
   * @returns {boolean} True if transaction is fully signed
   */
  checkFeasibility(signerSchema, signerKeys) {
    return signerSchema.checkFeasibility(signerKeys);
  }

  /**
   * Match a signature hint to find the corresponding signer
   * @param {Object} rawSignature - The raw signature object from transaction
   * @param {Array<string>} potentialSigners - List of potential signer keys
   * @param {Buffer} hashRaw - The transaction hash for verification
   * @returns {{ key: string|null, signature: string, hint: string }} Match result
   */
  matchSignatureToSigner(rawSignature, potentialSigners, hashRaw) {
    const { hint, signature } = rawSignature._attributes;

    // Convert signature to base64 for storage
    const signatureBase64 =
      signature instanceof Buffer ? signature.toString("base64") : signature;

    // Find matching signer
    const matchedKey = potentialSigners.find(
      (key) =>
        hintMatchesKey(hint, key) &&
        this.verifySignature(key, signature, hashRaw),
    );

    return {
      key: matchedKey || null,
      signature: signatureBase64,
      hint: matchedKey ? null : hintToMask(hint),
    };
  }

  /**
   * Get network configuration for Stellar
   * @param {string} networkName - The network name
   * @returns {Object} Network configuration
   */
  getNetworkConfig(networkName) {
    const normalizedNetwork = this.normalizeNetworkName(networkName);
    return getNetworkConfig("stellar", normalizedNetwork);
  }

  /**
   * Get the network passphrase
   * @param {string} networkName - The network name
   * @returns {string} Network passphrase
   */
  getNetworkPassphrase(networkName) {
    const normalized = this.normalizeNetworkName(networkName);
    const passphrase = NETWORK_PASSPHRASES[normalized];
    if (!passphrase) {
      throw standardError(400, `Unknown Stellar network: ${networkName}`);
    }
    return passphrase;
  }

  /**
   * Get Horizon URL for network
   * @param {string} networkName - The network name
   * @returns {string} Horizon URL
   */
  getHorizonUrl(networkName) {
    const normalized = this.normalizeNetworkName(networkName);

    // Try to get from config first
    try {
      const networkConfig = this.getNetworkConfig(normalized);
      if (networkConfig?.horizon) {
        return networkConfig.horizon;
      }
    } catch (e) {
      // Fall back to defaults
    }

    return DEFAULT_HORIZON_URLS[normalized] || DEFAULT_HORIZON_URLS.public;
  }

  /**
   * Normalize network name to canonical form
   * @param {string|number} networkName - The network name or ID
   * @returns {string} Normalized network name
   */
  normalizeNetworkName(networkName) {
    const normalized = String(networkName).toLowerCase();

    switch (normalized) {
      case "0":
      case "public":
      case "pubnet":
      case "mainnet":
      case "main":
        return "public";
      case "1":
      case "testnet":
      case "test":
        return "testnet";
      case "2":
      case "futurenet":
      case "future":
        return "futurenet";
      default:
        return normalized;
    }
  }

  /**
   * Validate a Stellar public key format
   * @param {string} publicKey - The public key to validate
   * @returns {boolean} True if valid Stellar public key
   */
  isValidPublicKey(publicKey) {
    return StrKey.isValidEd25519PublicKey(publicKey);
  }

  /**
   * Parse transaction parameters for storage
   * @param {Object} transaction - The Stellar transaction
   * @param {Object} request - The original request
   * @returns {Object} Parsed parameters
   */
  parseTransactionParams(transaction, request) {
    const { callbackUrl, submit, desiredSigners, expires = 0 } = request;
    const now = Math.floor(Date.now() / 1000);

    const params = {
      blockchain: "stellar",
      networkName: this.normalizeNetworkName(
        request.networkName || request.network,
      ),
      xdr: transaction.toXDR(),
      payload: transaction.toXDR(),
      encoding: "base64",
      signatures: [],
    };

    // Parse callback URL
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

    // Parse desired signers
    if (desiredSigners?.length) {
      if (!Array.isArray(desiredSigners)) {
        throw standardError(
          400,
          'Invalid "desiredSigners" parameter. Expected an array of Stellar public keys.',
        );
      }
      for (const key of desiredSigners) {
        if (!this.isValidPublicKey(key)) {
          throw standardError(
            400,
            `Invalid "desiredSigners" parameter. Key ${key} is not a valid Stellar public key.`,
          );
        }
      }
      params.desiredSigners = desiredSigners;
    }

    // Parse time bounds
    params.minTime =
      (transaction.timeBounds && parseInt(transaction.timeBounds.minTime)) || 0;

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
    }

    const txExpiration =
      (transaction.timeBounds && parseInt(transaction.timeBounds.maxTime)) || 0;
    if (txExpiration && txExpiration < now) {
      throw standardError(
        400,
        "Invalid transaction timebounds.maxTime value - the transaction already expired.",
      );
    }

    let maxTime = expires;
    if (txExpiration > 0 && (maxTime === 0 || txExpiration < maxTime)) {
      maxTime = txExpiration;
    }
    if (maxTime > 0) {
      params.maxTime = maxTime;
    }

    // Submit flag
    if (submit === true) {
      params.submit = true;
    }

    return params;
  }

  /**
   * Get legacy network ID from network name
   * @param {string} networkName - The network name
   * @returns {number} Legacy network ID (0, 1, 2)
   */
  getLegacyNetworkId(networkName) {
    const normalized = this.normalizeNetworkName(networkName);
    switch (normalized) {
      case "public":
        return 0;
      case "testnet":
        return 1;
      case "futurenet":
        return 2;
      default:
        throw standardError(
          400,
          `Cannot convert network "${networkName}" to legacy ID`,
        );
    }
  }
}

// Export singleton instance
module.exports = new StellarHandler();
