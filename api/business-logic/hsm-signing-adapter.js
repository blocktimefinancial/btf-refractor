/**
 * HSM Signing Adapter
 *
 * Provides HSM-backed signing for the Refractor API by integrating
 * with btf-lib-v1's hsmKeyStore (KEK-DEK envelope encryption) and
 * azureCryptoService (direct HSM signing).
 *
 * Key design decisions:
 * - Tier 1 (direct HSM): Used for finalization signing (server-side)
 * - Tier 2 (envelope): Used for managed wallet signing
 * - Both tiers protected by Azure CVM memory encryption
 *
 * Dependency injection: The constructor accepts optional overrides for
 * hsmKeyStore and azureCryptoService, enabling unit testing without
 * real HSM connectivity.
 *
 * @module business-logic/hsm-signing-adapter
 */

const logger = require("../utils/logger").forComponent("hsm-signing-adapter");
const config = require("../app.config");

// ── Default provider loaders ────────────────────────────────────────
// These resolve lazily so the module can be required even when
// btf-lib-v1 is not yet installed (tests inject mocks instead).
function loadHsmKeyStore() {
  try {
    return require("../../btf-lib-v1/secret/hsmKeyStore");
  } catch {
    return null;
  }
}

function loadAzureCryptoService() {
  try {
    return require("../../btf-lib-v1/secret/azureCryptoService");
  } catch {
    return null;
  }
}

// ── Supported blockchains for HSM operations ────────────────────────
const HSM_SUPPORTED_BLOCKCHAINS = [
  "stellar",
  "algorand",
  "solana",
  "ethereum",
  "onemoney",
  "polygon",
  "arbitrum",
  "optimism",
  "base",
  "avalanche",
];

class HsmSigningAdapter {
  /**
   * @param {Object} options
   * @param {string} [options.tier='envelope'] - 'direct' (azureCryptoService) or 'envelope' (hsmKeyStore)
   * @param {string} [options.dbName='refractor'] - Database name for key storage
   * @param {Object} [options.hsmKeyStore] - Override hsmKeyStore provider (for testing)
   * @param {Object} [options.azureCryptoService] - Override azureCryptoService provider (for testing)
   */
  constructor(options = {}) {
    this.tier = options.tier || "envelope";
    this.dbName = options.dbName || (config.hsm && config.hsm.databaseName) || "refractor";

    // Dependency injection — use provided overrides or load real modules
    // Use nullish coalescing so explicit null/undefined triggers lazy loading
    this._hsmKeyStore =
      options.hsmKeyStore !== undefined
        ? options.hsmKeyStore
        : loadHsmKeyStore();
    this._azureCryptoService =
      options.azureCryptoService !== undefined
        ? options.azureCryptoService
        : loadAzureCryptoService();

    // Validate tier
    if (!["direct", "envelope"].includes(this.tier)) {
      throw new Error(
        `Invalid HSM tier: ${this.tier}. Must be 'direct' or 'envelope'.`,
      );
    }

    // Validate that the required provider is available
    if (this.tier === "direct" && !this._azureCryptoService) {
      throw new Error(
        "HSM tier 'direct' requires azureCryptoService (btf-lib-v1/secret/azureCryptoService).",
      );
    }
    if (this.tier === "envelope" && !this._hsmKeyStore) {
      throw new Error(
        "HSM tier 'envelope' requires hsmKeyStore (btf-lib-v1/secret/hsmKeyStore).",
      );
    }

    logger.info("HsmSigningAdapter initialized", {
      tier: this.tier,
      dbName: this.dbName,
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Stellar — ed25519
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Sign a Stellar transaction using HSM-protected keys.
   *
   * @param {string} keyId - Key identifier in the HSM key store
   * @param {Object} transaction - Stellar SDK Transaction object
   * @returns {Promise<string>} Signed XDR
   */
  async signStellarTransaction(keyId, transaction) {
    this._validateKeyId(keyId);

    if (this.tier === "direct") {
      // Tier 1: Key never leaves HSM
      logger.debug("Signing Stellar transaction via direct HSM", { keyId });
      return this._azureCryptoService.signStellarTransaction({
        keyName: keyId,
        transaction,
      });
    }

    // Tier 2: Envelope encryption (KEK-DEK)
    logger.debug("Signing Stellar transaction via envelope encryption", {
      keyId,
    });
    return this._hsmKeyStore.signStellarTransaction({
      keyId,
      dbName: this.dbName,
      transaction,
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Algorand — ed25519
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Sign an Algorand transaction using HSM-protected ed25519 keys.
   *
   * Flow: unwrap 32-byte seed → reconstruct 64-byte key (seed‖pubkey)
   *       → algosdk.signTransaction() → secureZero() immediately
   *
   * @param {string} keyId - Key identifier in the HSM key store
   * @param {Object} transaction - Algorand transaction (msgpack or SDK object)
   * @returns {Promise<Object>} { signedTxn: Uint8Array, txId: string }
   */
  async signAlgorandTransaction(keyId, transaction) {
    this._validateKeyId(keyId);

    logger.debug("Signing Algorand transaction via envelope encryption", {
      keyId,
    });
    return this._hsmKeyStore.signAlgorandTransaction({
      keyId,
      dbName: this.dbName,
      transaction,
    });
  }

  /**
   * Sign arbitrary data with an Algorand ed25519 key via HSM.
   * Uses tweetnacl.sign.detached() — same ed25519 primitive as algosdk.
   *
   * @param {string} keyId - Key identifier
   * @param {Buffer|string|Uint8Array} data - Data to sign
   * @returns {Promise<Object>} { signature: string (base64), address: string }
   */
  async signAlgorandData(keyId, data) {
    this._validateKeyId(keyId);

    return this._hsmKeyStore.signAlgorandData({
      keyId,
      dbName: this.dbName,
      data,
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Solana — ed25519
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Sign a Solana transaction via HSM.
   * Solana uses ed25519 (same curve as Algorand/Stellar). HSM unwraps the
   * 32-byte ed25519 seed, reconstructs the full 64-byte keypair
   * (seed‖pubkey), signs the transaction message bytes, and zeros memory.
   *
   * @param {string} keyId - Key identifier in the HSM key store
   * @param {Buffer|Uint8Array} messageBytes - Serialized Solana message bytes to sign
   * @returns {Promise<Object>} { signature: Buffer(64), publicKey: string (base58) }
   */
  async signSolanaTransaction(keyId, messageBytes) {
    this._validateKeyId(keyId);

    logger.debug("Signing Solana transaction via envelope encryption", {
      keyId,
    });
    return this._hsmKeyStore.signSolanaTransaction({
      keyId,
      dbName: this.dbName,
      messageBytes,
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  //  EVM — secp256k1 (Ethereum, Polygon, Arbitrum, Optimism, Base, Avalanche)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Sign an EVM transaction using HSM-protected secp256k1 keys.
   * Also used for 1Money Network — 1Money uses the same secp256k1 keys,
   * 0x addresses, and ECDSA v/r/s signatures as Ethereum.
   *
   * @param {string} keyId - Key identifier
   * @param {Object} transaction - EVM transaction object
   * @returns {Promise<Object>} Signed transaction
   */
  async signEvmTransaction(keyId, transaction) {
    this._validateKeyId(keyId);

    logger.debug("Signing EVM transaction via envelope encryption", { keyId });
    return this._hsmKeyStore.signEthereumTransaction({
      keyId,
      dbName: this.dbName,
      transaction,
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  //  1Money — secp256k1 (EVM-compatible)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Sign a 1Money payment message using HSM-protected secp256k1 keys.
   * Under the hood this is identical to signEvmTransaction — 1Money uses
   * Ethereum's elliptic curve cryptography (secp256k1/ECDSA).
   *
   * Flow: unwrap secp256k1 private key → RLP encode payment fields →
   *       keccak256 hash → ECDSA sign → return { v, r, s }
   *
   * @param {string} keyId - Key identifier in the HSM key store
   * @param {Object} transaction - 1Money payment message
   * @returns {Promise<Object>} { v, r, s, hash, from }
   */
  async signOneMoneyTransaction(keyId, transaction) {
    this._validateKeyId(keyId);

    logger.debug("Signing 1Money transaction via envelope encryption", {
      keyId,
    });
    // 1Money keys are Ethereum keys — reuse the same HSM signing path
    return this._hsmKeyStore.signEthereumTransaction({
      keyId,
      dbName: this.dbName,
      blockchain: "onemoney",
      transaction,
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Key Management
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Create a new HSM-managed key for a blockchain.
   *
   * @param {string} blockchain - Target blockchain identifier
   * @param {Object} [options={}] - Additional creation options
   * @returns {Promise<Object>} Key metadata ({ keyId, publicKey, ... })
   */
  async createKey(blockchain, options = {}) {
    const normalized = blockchain.toLowerCase();

    const createFn = {
      stellar: () => this._hsmKeyStore.createStellarKey,
      ethereum: () => this._hsmKeyStore.createEthereumKey,
      onemoney: () => this._hsmKeyStore.createEthereumKey, // EVM-compatible secp256k1
      solana: () => this._hsmKeyStore.createSolanaKey,
      algorand: () => this._hsmKeyStore.createAlgorandKey,
      polygon: () => this._hsmKeyStore.createEthereumKey,
      arbitrum: () => this._hsmKeyStore.createEthereumKey,
      optimism: () => this._hsmKeyStore.createEthereumKey,
      base: () => this._hsmKeyStore.createEthereumKey,
      avalanche: () => this._hsmKeyStore.createEthereumKey,
    }[normalized];

    if (!createFn) {
      throw new Error(`HSM key creation not supported for ${blockchain}`);
    }

    logger.info("Creating HSM-managed key", { blockchain: normalized });

    return createFn()({
      ...options,
      dbName: this.dbName,
      blockchain: normalized,
    });
  }

  /**
   * Route a signing request to the correct method based on blockchain.
   *
   * @param {string} blockchain - Blockchain identifier
   * @param {string} keyId - The key identifier
   * @param {Object} payload - Transaction or message bytes to sign
   * @returns {Promise<Object>} Signed result (format varies by chain)
   */
  async sign(blockchain, keyId, payload) {
    const normalized = blockchain.toLowerCase();

    switch (normalized) {
      case "stellar":
        return this.signStellarTransaction(keyId, payload);
      case "algorand":
        return this.signAlgorandTransaction(keyId, payload);
      case "solana":
        return this.signSolanaTransaction(keyId, payload);
      case "onemoney":
        return this.signOneMoneyTransaction(keyId, payload);
      case "ethereum":
      case "polygon":
      case "arbitrum":
      case "optimism":
      case "base":
      case "avalanche":
        return this.signEvmTransaction(keyId, payload);
      default:
        throw new Error(
          `HSM signing not supported for blockchain: ${blockchain}`,
        );
    }
  }

  /**
   * Health check for HSM connectivity.
   * @returns {Promise<Object>} { status: 'ok'|'error', latencyMs, ... }
   */
  async healthCheck() {
    const start = Date.now();
    try {
      const result = await this._hsmKeyStore.healthCheck();
      return {
        status: "ok",
        tier: this.tier,
        latencyMs: Date.now() - start,
        ...result,
      };
    } catch (err) {
      logger.error("HSM health check failed", { error: err.message });
      return {
        status: "error",
        tier: this.tier,
        latencyMs: Date.now() - start,
        error: err.message,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Static Helpers
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Check if a blockchain is supported for HSM operations.
   * @param {string} blockchain
   * @returns {boolean}
   */
  static isSupported(blockchain) {
    return HSM_SUPPORTED_BLOCKCHAINS.includes(blockchain.toLowerCase());
  }

  /**
   * Get the list of supported blockchains.
   * @returns {string[]}
   */
  static getSupportedBlockchains() {
    return [...HSM_SUPPORTED_BLOCKCHAINS];
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Private
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Validate that a keyId is a non-empty string.
   * @private
   */
  _validateKeyId(keyId) {
    if (!keyId || typeof keyId !== "string") {
      throw new Error("keyId must be a non-empty string");
    }
  }
}

module.exports = HsmSigningAdapter;
