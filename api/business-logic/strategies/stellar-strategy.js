/**
 * Stellar Signing Strategy
 *
 * Handles Stellar-specific transaction initialization, signer discovery,
 * and signature processing. Extracted from signer.js for maintainability.
 *
 * @module business-logic/strategies/stellar-strategy
 */

const {
  TransactionBuilder,
  FeeBumpTransaction,
  Keypair,
} = require("@stellar/stellar-sdk");
const {
  inspectTransactionSigners,
} = require("@stellar-expert/tx-signers-inspector");
const TxSignature = require("../../models/tx-signature");
const { resolveNetworkParams } = require("../network-resolver");
const { standardError } = require("../std-error");
const { loadTxSourceAccountsInfo } = require("../account-info-provider");
const { sliceTx, parseTxParams } = require("../tx-params-parser");
const { hintMatchesKey, hintToMask } = require("../signature-hint-utils");
const { getHandler } = require("../handlers/handler-factory");

/**
 * Initialize a Signer context for a Stellar transaction.
 * Parses the XDR/payload, computes the hash, and extracts signatures.
 *
 * @param {Signer} signer - The parent Signer instance (mutated in place)
 * @param {Object} request - Original request object
 */
function initStellarCompatible(signer, request) {
  const handler = getHandler(signer.blockchain);
  const payload = request.payload || request.xdr;
  const networkName = request.networkName || request.network;

  if (!payload) {
    throw standardError(
      400,
      `Missing transaction payload for ${signer.blockchain}`,
    );
  }

  let txEnvelope;
  try {
    txEnvelope = handler.parseTransaction(payload, "base64", networkName);
  } catch (e) {
    if (e.status) throw e;
    throw standardError(400, "Invalid transaction data");
  }

  if (txEnvelope instanceof FeeBumpTransaction) {
    throw standardError(406, "FeeBump transactions not supported");
  }

  const { tx, signatures } = sliceTx(txEnvelope);
  signer.tx = tx;
  signer.hashRaw = tx.hash();
  signer.hash = signer.hashRaw.toString("hex");
  signer.signaturesToProcess = signatures;

  if (handler.parseTransactionParams) {
    signer.txInfo = handler.parseTransactionParams(tx, request);
  } else {
    signer.txInfo = parseTxParams(tx, request);
  }
  signer.txInfo.hash = signer.hash;
  signer.txInfo.blockchain = signer.blockchain;
  signer._handler = handler;
}

/**
 * Discover potential signers for a Stellar transaction.
 *
 * @param {Signer} signer - The parent Signer instance (mutated in place)
 */
async function initStellarSigners(signer) {
  const { horizon } = resolveNetworkParams(signer.txInfo.network);
  const accountsInfo = await loadTxSourceAccountsInfo(
    signer.tx,
    signer.txInfo.network,
  );
  signer.schema = await inspectTransactionSigners(signer.tx, {
    horizon,
    accountsInfo,
  });
  signer.potentialSigners = signer.schema.getAllPotentialSigners();
}

/**
 * Process a single Stellar ed25519 signature.
 *
 * @param {Signer} signer - The parent Signer instance
 * @param {Object} rawSignature - Stellar DecoratedSignature
 */
function processStellarSignature(signer, rawSignature) {
  const { hint, signature } = rawSignature._attributes;
  const signaturePair = new TxSignature();
  signaturePair.signature =
    signature instanceof Buffer ? signature.toString("base64") : signature;

  signaturePair.key = signer.potentialSigners.find(
    (key) =>
      hintMatchesKey(hint, key) &&
      verifyStellarSignature(signer, key, signature),
  );

  if (signaturePair.key) {
    if (!signer.txInfo.signatures.some((s) => s.key === signaturePair.key)) {
      signer.txInfo.signatures.push(signaturePair);
      signer.accepted.push(signaturePair);
    }
  } else {
    signaturePair.key = hintToMask(hint);
    signer.rejected.push(signaturePair);
  }
}

/**
 * Verify a Stellar ed25519 signature.
 *
 * @param {Signer} signer
 * @param {string} key - Stellar public key (G...)
 * @param {Buffer} signature
 * @returns {boolean}
 */
function verifyStellarSignature(signer, key, signature) {
  return Keypair.fromPublicKey(key).verify(signer.hashRaw, signature);
}

/**
 * HSM signing path for Stellar.
 *
 * @param {Signer} signer
 * @param {string} keyId - HSM key identifier
 * @param {Object} hsm - HsmSigningAdapter instance
 */
async function signStellarWithHsm(signer, keyId, hsm) {
  const signedXdr = await hsm.signStellarTransaction(keyId, signer.tx);
  const { passphrase } = resolveNetworkParams(signer.txInfo.network);
  const signedTx = TransactionBuilder.fromXDR(signedXdr, passphrase);
  const newSigs = signedTx.signatures.filter((sig) => {
    const sigBase64 = sig.signature().toString("base64");
    return !signer.txInfo.signatures.some(
      (existing) => existing.signature === sigBase64,
    );
  });
  for (const sig of newSigs) {
    processStellarSignature(signer, sig);
  }
}

module.exports = {
  initStellarCompatible,
  initStellarSigners,
  processStellarSignature,
  verifyStellarSignature,
  signStellarWithHsm,
};
