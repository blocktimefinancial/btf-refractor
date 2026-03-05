const {
    TransactionBuilder,
    FeeBumpTransaction,
    Keypair,
  } = require("@stellar/stellar-sdk"),
  {
    inspectTransactionSigners,
  } = require("@stellar-expert/tx-signers-inspector"),
  TxSignature = require("../models/tx-signature"),
  { resolveNetwork, resolveNetworkParams } = require("./network-resolver"),
  { standardError } = require("./std-error"),
  storageLayer = require("../storage/storage-layer"),
  { loadTxSourceAccountsInfo } = require("./account-info-provider"),
  {
    sliceTx,
    parseTxParams,
    parseBlockchainAgnosticParams,
  } = require("./tx-params-parser"),
  { rehydrateTx } = require("./tx-loader"),
  { hintMatchesKey, hintToMask } = require("./signature-hint-utils"),
  { getHandler, hasHandler } = require("./handlers/handler-factory"),
  { isEvmBlockchain } = require("./handlers/evm-handler"),
  {
    validateOriginator,
    checkOriginatorStatus,
  } = require("./originator-verifier"),
  logger = require("../utils/logger").forComponent("signer");

class Signer {
  /**
   * @param {Object} request
   */
  constructor(request) {
    // Determine blockchain from request
    const blockchain = request.blockchain || "stellar";
    this.blockchain = blockchain.toLowerCase();

    // Check if we have a handler for this blockchain
    if (!hasHandler(this.blockchain)) {
      throw standardError(
        501,
        `Signing not yet implemented for blockchain: ${this.blockchain}`,
      );
    }

    // Route to appropriate initialization
    if (this.blockchain === "stellar") {
      this._initStellarCompatible(request);
    } else if (this.blockchain === "algorand" || this.blockchain === "solana") {
      this._initAlgorand(request);
    } else if (isEvmBlockchain(this.blockchain)) {
      this._initEvm(request);
    } else {
      throw standardError(
        501,
        `Signing not yet implemented for blockchain: ${this.blockchain}`,
      );
    }

    this.accepted = [];
    this.rejected = [];
    this.status = "created"; //always assume that the tx is new one until we fetched details from db
  }

  /**
   * Initialize for Stellar blockchain
   * @private
   */
  _initStellarCompatible(request) {
    const handler = getHandler(this.blockchain);

    // For legacy Stellar requests, get xdr and network
    // For new format, use payload and networkName
    const payload = request.payload || request.xdr;
    const networkName = request.networkName || request.network;

    if (!payload) {
      throw standardError(
        400,
        `Missing transaction payload for ${this.blockchain}`,
      );
    }

    let txEnvelope;
    try {
      txEnvelope = handler.parseTransaction(payload, "base64", networkName);
    } catch (e) {
      if (e.status) throw e;
      throw standardError(400, `Invalid transaction data`);
    }

    if (txEnvelope instanceof FeeBumpTransaction)
      throw standardError(406, `FeeBump transactions not supported`);

    const { tx, signatures } = sliceTx(txEnvelope);
    this.tx = tx;
    this.hashRaw = tx.hash();
    this.hash = this.hashRaw.toString("hex");
    this.signaturesToProcess = signatures;

    // Use handler's parseTransactionParams if available, otherwise fall back
    if (handler.parseTransactionParams) {
      this.txInfo = handler.parseTransactionParams(tx, request);
    } else {
      this.txInfo = parseTxParams(tx, request);
    }
    this.txInfo.hash = this.hash;
    this.txInfo.blockchain = this.blockchain;

    // Store handler reference
    this._handler = handler;
  }

  /**
   * Initialize for Algorand/Solana blockchain (ed25519)
   * Both use ed25519 keys — Algorand with base32 addresses,
   * Solana with base58 addresses. Same signing flow.
   * @private
   */
  _initAlgorand(request) {
    const handler = getHandler(this.blockchain);
    const { payload, networkName, encoding = "base64" } = request;

    if (!payload) {
      throw standardError(400, "Missing payload for Algorand transaction");
    }

    // Parse the transaction
    this.tx = handler.parseTransaction(payload, encoding, networkName);

    // Compute hash (SHA-512/256 with "TX" prefix)
    const { hash, hashRaw } = handler.computeHash(this.tx);
    this.hash = hash;
    this.hashRaw = hashRaw;

    // Extract existing signatures (if any)
    this.signaturesToProcess = handler.extractSignatures(this.tx);

    // Parse transaction params for storage
    this.txInfo = handler.parseTransactionParams(this.tx, request);
    this.txInfo.hash = this.hash;
    this.txInfo.blockchain = this.blockchain;

    // Store handler reference
    this._handler = handler;
  }

  /**
   * Initialize for EVM-compatible blockchains
   * @private
   */
  _initEvm(request) {
    const handler = getHandler(this.blockchain);
    const defaultEncoding = handler.config?.defaultEncoding || "hex";
    const { payload, networkName, encoding = defaultEncoding } = request;

    if (!payload) {
      throw standardError(400, "Missing payload for EVM transaction");
    }

    // Parse the transaction
    this.tx = handler.parseTransaction(payload, encoding, networkName);

    // Compute hash
    const { hash, hashRaw } = handler.computeHash(this.tx);
    this.hash = hash;
    this.hashRaw = hashRaw;

    // Extract existing signatures (if any)
    this.signaturesToProcess = handler.extractSignatures(this.tx);

    // Parse transaction params
    this.txInfo = handler.parseTransactionParams(this.tx, request);
    this.txInfo.hash = this.hash;

    // Store handler reference for later use
    this._handler = handler;
  }

  /**
   * @type {Transaction}
   */
  tx;
  /**
   * @type {String}
   */
  hash;
  /**
   * @type {Buffer}
   */
  hashRaw;
  /**
   * @type {'draft'|'created'|'updated'|'unchanged'}
   */
  status = "draft";
  /**
   * @type {TxModel}
   */
  txInfo;
  /**
   * @type {Array<TxSignature>}
   */
  accepted;
  /**
   * @type {Array<TxSignature>}
   */
  rejected;
  /**
   * @type {Array<Object>}
   */
  signaturesToProcess;
  /**
   * @type {Array<String>}
   */
  potentialSigners;
  /**
   * @type {Object}
   */
  schema;

  async init() {
    //check if we have already processed it
    let txInfo = await storageLayer.dataProvider.findTransaction(this.hash);
    if (txInfo) {
      this.txInfo = txInfo; //replace tx info with info from db
      // Ensure hash remains as string (MongoDB returns ObjectId)
      this.txInfo.hash = this.hash;
      this.status = "unchanged";
    } else {
      this.status = "created";
    }

    // Route to blockchain-specific initialization
    if (this.blockchain === "stellar") {
      await this._initStellarSigners();
    } else if (this.blockchain === "algorand" || this.blockchain === "solana") {
      await this._initAlgorandSigners();
    } else if (isEvmBlockchain(this.blockchain)) {
      await this._initEvmSigners();
    }

    return this;
  }

  /**
   * Verify the originator signature if present
   * Call this after init() to verify that the transaction was created by a trusted party
   * @param {Object} options - Verification options
   * @param {boolean} [options.requireOriginator=false] - Require originator to be present
   * @param {boolean} [options.verifySignature=true] - Verify signature if present
   * @returns {Object} Verification result { hasOriginator, isVerified }
   * @throws {Error} If validation fails and options require it
   */
  verifyOriginator(options = {}) {
    const { originator, originatorSignature } = this.txInfo;

    // Validate originator (throws on failure if required)
    validateOriginator(
      this.blockchain,
      originator,
      originatorSignature,
      this.hash,
      options,
    );

    // Return status
    return checkOriginatorStatus({
      blockchain: this.blockchain,
      originator,
      originatorSignature,
      hash: this.hash,
    });
  }

  /**
   * Get originator status without throwing errors
   * @returns {{ hasOriginator: boolean, isVerified: boolean, originator: string|null }}
   */
  getOriginatorStatus() {
    const { originator, originatorSignature } = this.txInfo;

    const status = checkOriginatorStatus({
      blockchain: this.blockchain,
      originator,
      originatorSignature,
      hash: this.hash,
    });

    return {
      ...status,
      originator: originator || null,
    };
  }

  /**
   * Initialize Stellar-specific signer discovery
   * @private
   */
  async _initStellarSigners() {
    const { horizon } = resolveNetworkParams(this.txInfo.network);
    const accountsInfo = await loadTxSourceAccountsInfo(
      this.tx,
      this.txInfo.network,
    );
    //discover signers
    this.schema = await inspectTransactionSigners(this.tx, {
      horizon,
      accountsInfo,
    });
    //get all signers that can potentially sign the transaction
    this.potentialSigners = this.schema.getAllPotentialSigners();
  }\n\n  /**\n   * Initialize Algorand-specific signer discovery (ed25519)
   * @private
   */
  async _initAlgorandSigners() {
    const handler = this._handler || getHandler(this.blockchain);

    // Get potential signers (sender, multisig participants)
    this.potentialSigners = await handler.getPotentialSigners(
      this.tx,
      this.txInfo.networkName,
    );

    // Algorand schema: single-sig needs 1 signature, multisig needs >= threshold
    this.schema = {
      checkFeasibility: (signerKeys) => {
        if (this.tx._msig) {
          // Multisig: need at least threshold signatures from valid signers
          const threshold = this.tx._msig.thr || 1;
          const validSigners = signerKeys.filter((key) =>
            this.potentialSigners.includes(key),
          );
          return validSigners.length >= threshold;
        }
        // Single-sig: at least one valid signature
        return (
          signerKeys.length > 0 &&
          signerKeys.some((key) => this.potentialSigners.includes(key))
        );
      },
      getAllPotentialSigners: () => this.potentialSigners,
    };
  }

  /**
   * Initialize EVM-specific signer discovery
   * @private
   */
  async _initEvmSigners() {
    const handler = this._handler || getHandler(this.blockchain);

    // Get potential signers from the handler
    this.potentialSigners = await handler.getPotentialSigners(
      this.tx,
      this.txInfo.networkName,
    );

    // For EVM, we don't have a complex signer schema like Stellar
    // EVM transactions have exactly one signer (the sender)
    this.schema = {
      // Simple feasibility check: is the transaction signed?
      checkFeasibility: (signerKeys) => {
        // EVM needs exactly one signature from the sender
        return signerKeys.length > 0;
      },
      getAllPotentialSigners: () => this.potentialSigners,
    };
  }

  get isReady() {
    // For EVM transactions, check if we have a valid signature
    if (isEvmBlockchain(this.blockchain)) {
      return this.txInfo.signatures && this.txInfo.signatures.length > 0;
    }
    // For Stellar, Algorand, and others: use the schema-based feasibility check
    return this.schema.checkFeasibility(
      this.txInfo.signatures.map((s) => s.key),
    );
  }

  /**
   * Process a Stellar signature
   * @param {Object} rawSignature - Stellar signature object
   * @private
   */
  _processStellarSignature(rawSignature) {
    //get props from the raw signature
    const { hint, signature } = rawSignature._attributes;
    //init wrapped signature object
    const signaturePair = new TxSignature();
    // Convert signature to base64 string for MongoDB storage
    signaturePair.signature =
      signature instanceof Buffer ? signature.toString("base64") : signature;
    //find matching signer from potential signers list
    signaturePair.key = this.potentialSigners.find(
      (key) =>
        hintMatchesKey(hint, key) &&
        this._verifyStellarSignature(key, signature),
    );
    //verify the signature
    if (signaturePair.key) {
      //filter out duplicates
      if (!this.txInfo.signatures.some((s) => s.key === signaturePair.key)) {
        //add to the valid signatures list
        this.txInfo.signatures.push(signaturePair);
        this.accepted.push(signaturePair);
      }
    } else {
      signaturePair.key = hintToMask(hint);
      this.rejected.push(signaturePair);
    }
  }

  /**
   * Process an EVM signature
   * @param {Object} rawSignature - EVM signature object with v, r, s
   * @private
   */
  _processEvmSignature(rawSignature) {
    const handler = this._handler || getHandler(this.blockchain);
    const signaturePair = new TxSignature();

    // For EVM, the signature contains v, r, s components
    const { v, r, s, from } = rawSignature;

    // Store signature as JSON for EVM
    signaturePair.signature = JSON.stringify({ v, r, s });

    // The signer is the 'from' address (recovered from the signature)
    const signerAddress = from?.toLowerCase();

    if (signerAddress) {
      // Verify this signer is expected (if we have potential signers)
      if (
        this.potentialSigners.length === 0 ||
        this.potentialSigners.some(
          (addr) => addr.toLowerCase() === signerAddress,
        )
      ) {
        signaturePair.key = signerAddress;

        // Check for duplicates
        if (!this.txInfo.signatures.some((s) => s.key === signaturePair.key)) {
          this.txInfo.signatures.push(signaturePair);
          this.accepted.push(signaturePair);
        }
      } else {
        signaturePair.key = signerAddress;
        this.rejected.push(signaturePair);
      }
    } else {
      signaturePair.key = "unknown";
      this.rejected.push(signaturePair);
    }
  }

  /**
   * Process an Algorand ed25519 signature
   * @param {Object} rawSignature - Algorand signature object with from/signature fields
   * @private
   */
  _processAlgorandSignature(rawSignature) {
    const handler = this._handler || getHandler(this.blockchain);
    const signaturePair = new TxSignature();

    const { from, signature, type } = rawSignature;

    // Store the base64-encoded ed25519 signature
    signaturePair.signature =
      typeof signature === "string"
        ? signature
        : Buffer.from(signature).toString("base64");

    // Match signature to a known signer by verifying against all potential signers
    const match = handler.matchSignatureToSigner(
      rawSignature,
      this.potentialSigners,
      this.hashRaw,
    );

    if (match.key) {
      signaturePair.key = match.key;

      // Filter out duplicates
      if (!this.txInfo.signatures.some((s) => s.key === signaturePair.key)) {
        this.txInfo.signatures.push(signaturePair);
        this.accepted.push(signaturePair);
      }
    } else {
      signaturePair.key = from || "unknown";
      this.rejected.push(signaturePair);
    }
  }

  /**
   * @param {Object} rawSignature
   */
  processSignature(rawSignature) {
    if (isEvmBlockchain(this.blockchain)) {
      this._processEvmSignature(rawSignature);
    } else if (this.blockchain === "algorand" || this.blockchain === "solana") {
      this._processAlgorandSignature(rawSignature);
    } else {
      this._processStellarSignature(rawSignature);
    }
  }

  /**
   * Verify Stellar signature
   * @private
   */
  _verifyStellarSignature(key, signature) {
    return Keypair.fromPublicKey(key).verify(this.hashRaw, signature);
  }

  /**
   * Verify Algorand ed25519 signature
   * @private
   */
  _verifyAlgorandSignature(key, signature) {
    const handler = this._handler || getHandler(this.blockchain);
    return handler.verifySignature(key, signature, this.hashRaw);
  }

  verifySignature(key, signature) {
    if (isEvmBlockchain(this.blockchain)) {
      // For EVM, verification happens during signature recovery
      const handler = this._handler || getHandler(this.blockchain);
      return handler.verifySignedTransaction(this.tx, key);
    }
    if (this.blockchain === "algorand" || this.blockchain === "solana") {
      return this._verifyAlgorandSignature(key, signature);
    }
    return this._verifyStellarSignature(key, signature);
  }

  processNewSignatures() {
    if (!this.signaturesToProcess.length) return;

    if (isEvmBlockchain(this.blockchain)) {
      // For EVM, process the already-extracted signatures
      for (let signature of this.signaturesToProcess) {
        // Check if this signature is already stored
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
      // Algorand/Solana path - ed25519 signatures as base64 strings
      for (let signature of this.signaturesToProcess) {
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
      // Stellar path - skip existing
      const newSignatures = this.signaturesToProcess.filter((sig) => {
        const newSignature = sig.signature().toString("base64");
        return !this.txInfo.signatures.some(
          (existing) => existing.signature === newSignature,
        );
      });
      //search for invalid signature
      for (let signature of newSignatures) {
        this.processSignature(signature);
      }
    }

    //save changes if any
    if (this.accepted.length && this.status !== "created") {
      this.setStatus("updated");
    }
    this.signaturesToProcess = [];
  }

  async saveChanges() {
    //save changes if any
    if (!["created", "updated"].includes(this.status)) return;
    if (!this.txInfo.status) {
      this.txInfo.status = "pending";
    }
    const wasReady = this.txInfo.status === "ready";
    if (this.txInfo.status === "pending" && this.isReady) {
      this.txInfo.status = "ready";
    }
    await storageLayer.dataProvider.saveTransaction(this.txInfo);

    // If transaction just became ready, trigger immediate finalizer check
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
