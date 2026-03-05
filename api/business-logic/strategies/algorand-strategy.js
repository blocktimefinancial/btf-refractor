/**
 * Algorand / Solana Signing Strategy
 *
 * Handles ed25519-based blockchain transaction initialization, signer discovery,
 * and signature processing. Covers Algorand (base32) and Solana (base58).
 *
 * @module business-logic/strategies/algorand-strategy
 */

const TxSignature = require("../../models/tx-signature");
const { standardError } = require("../std-error");
const { getHandler } = require("../handlers/handler-factory");

/**
 * Initialize a Signer context for an Algorand/Solana transaction.
 *
 * @param {Signer} signer - Parent Signer instance (mutated in place)
 * @param {Object} request - Original request object
 */
function initAlgorand(signer, request) {
  const handler = getHandler(signer.blockchain);
  const { payload, networkName, encoding = "base64" } = request;

  if (!payload) {
    throw standardError(400, "Missing payload for Algorand transaction");
  }

  signer.tx = handler.parseTransaction(payload, encoding, networkName);

  const { hash, hashRaw } = handler.computeHash(signer.tx);
  signer.hash = hash;
  signer.hashRaw = hashRaw;

  signer.signaturesToProcess = handler.extractSignatures(signer.tx);

  signer.txInfo = handler.parseTransactionParams(signer.tx, request);
  signer.txInfo.hash = signer.hash;
  signer.txInfo.blockchain = signer.blockchain;
  signer._handler = handler;
}

/**
 * Discover potential signers for an Algorand/Solana transaction.
 *
 * @param {Signer} signer - Parent Signer instance (mutated in place)
 */
async function initAlgorandSigners(signer) {
  const handler = signer._handler || getHandler(signer.blockchain);

  signer.potentialSigners = await handler.getPotentialSigners(
    signer.tx,
    signer.txInfo.networkName,
  );

  signer.schema = {
    checkFeasibility: (signerKeys) => {
      if (signer.tx._msig) {
        const threshold = signer.tx._msig.thr || 1;
        const validSigners = signerKeys.filter((key) =>
          signer.potentialSigners.includes(key),
        );
        return validSigners.length >= threshold;
      }
      return (
        signerKeys.length > 0 &&
        signerKeys.some((key) => signer.potentialSigners.includes(key))
      );
    },
    getAllPotentialSigners: () => signer.potentialSigners,
  };
}

/**
 * Process a single Algorand/Solana ed25519 signature.
 *
 * @param {Signer} signer - Parent Signer instance
 * @param {Object} rawSignature - { from, signature, type }
 */
function processAlgorandSignature(signer, rawSignature) {
  const handler = signer._handler || getHandler(signer.blockchain);
  const signaturePair = new TxSignature();

  const { from, signature } = rawSignature;

  signaturePair.signature =
    typeof signature === "string"
      ? signature
      : Buffer.from(signature).toString("base64");

  const match = handler.matchSignatureToSigner(
    rawSignature,
    signer.potentialSigners,
    signer.hashRaw,
  );

  if (match.key) {
    signaturePair.key = match.key;
    if (!signer.txInfo.signatures.some((s) => s.key === signaturePair.key)) {
      signer.txInfo.signatures.push(signaturePair);
      signer.accepted.push(signaturePair);
    }
  } else {
    signaturePair.key = from || "unknown";
    signer.rejected.push(signaturePair);
  }
}

/**
 * Verify an Algorand/Solana ed25519 signature.
 *
 * @param {Signer} signer
 * @param {string} key
 * @param {Buffer} signature
 * @returns {boolean}
 */
function verifyAlgorandSignature(signer, key, signature) {
  const handler = signer._handler || getHandler(signer.blockchain);
  return handler.verifySignature(key, signature, signer.hashRaw);
}

/**
 * HSM signing path for Algorand.
 *
 * @param {Signer} signer
 * @param {string} keyId
 * @param {Object} hsm - HsmSigningAdapter instance
 */
async function signAlgorandWithHsm(signer, keyId, hsm) {
  const result = await hsm.signAlgorandTransaction(keyId, signer.tx);
  if (result && result.signedTxn) {
    const sigObj = {
      type: "single",
      signature: Buffer.from(result.signedTxn).toString("base64"),
      from: result.address || result.txId,
    };
    processAlgorandSignature(signer, sigObj);
  }
}

/**
 * HSM signing path for Solana.
 *
 * @param {Signer} signer
 * @param {string} keyId
 * @param {Object} hsm - HsmSigningAdapter instance
 */
async function signSolanaWithHsm(signer, keyId, hsm) {
  const messageBytes = signer.txInfo.messageBytes || signer.tx;
  const result = await hsm.signSolanaTransaction(keyId, messageBytes);
  if (result && result.signature) {
    const sigObj = {
      type: "ed25519",
      signature:
        typeof result.signature === "string"
          ? result.signature
          : Buffer.from(result.signature).toString("base64"),
      from: result.publicKey,
    };
    processAlgorandSignature(signer, sigObj);
  }
}

module.exports = {
  initAlgorand,
  initAlgorandSigners,
  processAlgorandSignature,
  verifyAlgorandSignature,
  signAlgorandWithHsm,
  signSolanaWithHsm,
};
