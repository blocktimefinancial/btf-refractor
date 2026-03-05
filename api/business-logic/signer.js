/**
 * Signer — Thin Orchestrator
 *
 * Routes transaction initialization, signature processing, and HSM signing
 * to blockchain-specific strategy modules. Keeps shared state (hash, txInfo,
 * accepted/rejected lists) and cross-cutting logic (originator verification,
 * persistence, readiness checks) in one place.
 *
 * Strategies:
 *   strategies/stellar-strategy.js   — Stellar (ed25519, XDR)
 *   strategies/algorand-strategy.js  — Algorand & Solana (ed25519)
 *   strategies/evm-strategy.js       — Ethereum, Polygon, Arbitrum, etc.
 *
 * @module business-logic/signer
 */

const { standardError } = require("./std-error");
const storageLayer = require("../storage/storage-layer");
const { rehydrateTx } = require("./tx-loader");
const { hasHandler } = require("./handlers/handler-factory");
const { isEvmBlockchain } = require("./handlers/evm-handler");
const {
  validateOriginator,
  checkOriginatorStatus,
} = require("./originator-verifier");
const logger = require("../utils/logger").forComponent("signer");

// Strategy modules — each provides init, initSigners, processSignature, signWithHsm
const stellar = require("./strategies/stellar-strategy");
const algorand = require("./strategies/algorand-strategy");
const evm = require("./strategies/evm-strategy");

class Signer {
  // ── Field declarations ──────────────────────────────────────────
  /** @type {Object} */
  tx;
  /** @type {String} */
  hash;
  /** @type {Buffer} */
  hashRaw;
  /** @type {'draft'|'created'|'updated'|'unchanged'} */
  status;
  /** @type {Object} */
  txInfo;
  /** @type {Array} */
  accepted;
  /** @type {Array} */
  rejected;
  /** @type {Array} */
  signaturesToProcess;
  /** @type {Array<String>} */
  potentialSigners;
  /** @type {Object} */
  schema;

  /**
   * @param {Object} request
   */
  constructor(request) {
    const blockchain = request.blockchain || "stellar";
    this.blockchain = blockchain.toLowerCase();

    if (!hasHandler(this.blockchain)) {
      throw standardError(
        501,
        `Signing not yet implemented for blockchain: ${this.blockchain}`,
      );
    }

    // Route to blockchain-specific initialization
    if (this.blockchain === "stellar") {
      stellar.initStellarCompatible(this, request);
    } else if (this.blockchain === "algorand" || this.blockchain === "solana") {
      algorand.initAlgorand(this, request);
    } else if (isEvmBlockchain(this.blockchain)) {
      evm.initEvm(this, request);
    } else {
      throw standardError(
        501,
        `Signing not yet implemented for blockchain: ${this.blockchain}`,
      );
    }

    this.accepted = [];
    this.rejected = [];
    this.status = "created";
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  async init() {
    let txInfo = await storageLayer.dataProvider.findTransaction(this.hash);
    if (txInfo) {
      this.txInfo = txInfo;
      this.txInfo.hash = this.hash;
      this.status = "unchanged";
    } else {
      this.status = "created";
    }

    // Route to blockchain-specific signer discovery
    if (this.blockchain === "stellar") {
      await stellar.initStellarSigners(this);
    } else if (this.blockchain === "algorand" || this.blockchain === "solana") {
      await algorand.initAlgorandSigners(this);
    } else if (isEvmBlockchain(this.blockchain)) {
      await evm.initEvmSigners(this);
    }

    return this;
  }

  // ── Originator verification ─────────────────────────────────────

  verifyOriginator(options = {}) {
    const { originator, originatorSignature } = this.txInfo;
    validateOriginator(
      this.blockchain,
      originator,
      originatorSignature,
      this.hash,
      options,
    );
    return checkOriginatorStatus({
      blockchain: this.blockchain,
      originator,
      originatorSignature,
      hash: this.hash,
    });
  }

  getOriginatorStatus() {
    const { originator, originatorSignature } = this.txInfo;
    const status = checkOriginatorStatus({
      blockchain: this.blockchain,
      originator,
      originatorSignature,
      hash: this.hash,
    });
    return { ...status, originator: originator || null };
  }

  // ── Readiness ───────────────────────────────────────────────────

  get isReady() {
    if (!this.schema) return false;
    if (isEvmBlockchain(this.blockchain)) {
      return this.txInfo.signatures && this.txInfo.signatures.length > 0;
    }
    return this.schema.checkFeasibility(
      this.txInfo.signatures.map((s) => s.key),
    );
  }

  // ── Signature processing ────────────────────────────────────────

  processSignature(rawSignature) {
    if (isEvmBlockchain(this.blockchain)) {
      evm.processEvmSignature(this, rawSignature);
    } else if (this.blockchain === "algorand" || this.blockchain === "solana") {
      algorand.processAlgorandSignature(this, rawSignature);
    } else {
      stellar.processStellarSignature(this, rawSignature);
    }
  }

  verifySignature(key, signature) {
    if (isEvmBlockchain(this.blockchain)) {
      const { getHandler } = require("./handlers/handler-factory");
      const handler = this._handler || getHandler(this.blockchain);
      return handler.verifySignedTransaction(this.tx, key);
    }
    if (this.blockchain === "algorand" || this.blockchain === "solana") {
      return algorand.verifyAlgorandSignature(this, key, signature);
    }
    return stellar.verifyStellarSignature(this, key, signature);
  }

  processNewSignatures() {
    if (!this.signaturesToProcess.length) return;

    if (isEvmBlockchain(this.blockchain)) {
      for (const signature of this.signaturesToProcess) {
        const sigJson = JSON.stringify({
          v: signature.v,
          r: signature.r,
          s: signature.s,
        });
        if (
          !this.txInfo.signatures.some(
            (existing) => existing.signature === sigJson,
          )
        ) {
          this.processSignature(signature);
        }
      }
    } else if (this.blockchain === "algorand" || this.blockchain === "solana") {
      for (const signature of this.signaturesToProcess) {
        const sigStr =
          typeof signature.signature === "string"
            ? signature.signature
            : Buffer.from(signature.signature).toString("base64");
        if (
          !this.txInfo.signatures.some(
            (existing) => existing.signature === sigStr,
          )
        ) {
          this.processSignature(signature);
        }
      }
    } else {
      const newSignatures = this.signaturesToProcess.filter((sig) => {
        const newSignature = sig.signature().toString("base64");
        return !this.txInfo.signatures.some(
          (existing) => existing.signature === newSignature,
        );
      });
      for (const signature of newSignatures) {
        this.processSignature(signature);
      }
    }

    if (this.accepted.length && this.status !== "created") {
      this.setStatus("updated");
    }
    this.signaturesToProcess = [];
  }

  // ── HSM signing ─────────────────────────────────────────────────

  async signWithHsm(keyId, options = {}) {
    if (!keyId || typeof keyId !== "string") {
      throw standardError(400, "keyId must be a non-empty string");
    }

    const HsmSigningAdapter = require("./hsm-signing-adapter");
    const hsm = new HsmSigningAdapter({ tier: options.tier || "envelope" });

    logger.info("Signing transaction with HSM", {
      hash: this.hash,
      blockchain: this.blockchain,
      keyId,
      tier: options.tier || "envelope",
    });

    const acceptedBefore = this.accepted.length;

    if (this.blockchain === "stellar") {
      await stellar.signStellarWithHsm(this, keyId, hsm);
    } else if (this.blockchain === "algorand") {
      await algorand.signAlgorandWithHsm(this, keyId, hsm);
    } else if (this.blockchain === "solana") {
      await algorand.signSolanaWithHsm(this, keyId, hsm);
    } else if (isEvmBlockchain(this.blockchain)) {
      await evm.signEvmWithHsm(this, keyId, hsm);
    } else {
      throw standardError(
        501,
        `HSM signing not supported for blockchain: ${this.blockchain}`,
      );
    }

    if (this.accepted.length > acceptedBefore && this.status !== "created") {
      this.setStatus("updated");
    }

    logger.info("HSM signing complete", {
      hash: this.hash,
      blockchain: this.blockchain,
      newSignatures: this.accepted.length - acceptedBefore,
    });
  }

  // ── Persistence ─────────────────────────────────────────────────

  async saveChanges() {
    if (!["created", "updated"].includes(this.status)) return;
    if (!this.txInfo.status) {
      this.txInfo.status = "pending";
    }
    const wasReady = this.txInfo.status === "ready";
    if (this.txInfo.status === "pending" && this.isReady) {
      this.txInfo.status = "ready";
    }
    await storageLayer.dataProvider.saveTransaction(this.txInfo);

    if (!wasReady && this.txInfo.status === "ready") {
      const finalizer = require("./finalization/finalizer");
      logger.info("Transaction became ready, triggering finalizer", {
        hash: this.txInfo.hash,
      });
      setImmediate(() => finalizer.triggerImmediateCheck());
    }
  }

  /**
   * @param {'draft'|'created'|'updated'|'unchanged'} newStatus
   */
  setStatus(newStatus) {
    if (this.status === "created" || this.status === "updated") return;
    this.status = newStatus;
  }

  toJSON() {
    return {
      ...rehydrateTx(this.txInfo),
      changes: { accepted: this.accepted, rejected: this.rejected },
    };
  }
}

module.exports = Signer;
