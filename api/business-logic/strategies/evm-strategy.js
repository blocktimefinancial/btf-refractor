/**
 * EVM Signing Strategy
 *
 * Handles EVM-compatible blockchain transaction initialization, signer discovery,
 * and signature processing. Covers Ethereum, Polygon, Arbitrum, Optimism, Base, etc.
 *
 * @module business-logic/strategies/evm-strategy
 */

const TxSignature = require("../../models/tx-signature");
const { standardError } = require("../std-error");
const { getHandler } = require("../handlers/handler-factory");

/**
 * Initialize a Signer context for an EVM transaction.
 *
 * @param {Signer} signer - Parent Signer instance (mutated in place)
 * @param {Object} request - Original request object
 */
function initEvm(signer, request) {
  const handler = getHandler(signer.blockchain);
  const defaultEncoding = handler.config?.defaultEncoding || "hex";
  const { payload, networkName, encoding = defaultEncoding } = request;

  if (!payload) {
    throw standardError(400, "Missing payload for EVM transaction");
  }

  signer.tx = handler.parseTransaction(payload, encoding, networkName);

  const { hash, hashRaw } = handler.computeHash(signer.tx);
  signer.hash = hash;
  signer.hashRaw = hashRaw;

  signer.signaturesToProcess = handler.extractSignatures(signer.tx);

  signer.txInfo = handler.parseTransactionParams(signer.tx, request);
  signer.txInfo.hash = signer.hash;
  signer._handler = handler;
}

/**
 * Discover potential signers for an EVM transaction.
 *
 * @param {Signer} signer - Parent Signer instance (mutated in place)
 */
async function initEvmSigners(signer) {
  const handler = signer._handler || getHandler(signer.blockchain);

  signer.potentialSigners = await handler.getPotentialSigners(
    signer.tx,
    signer.txInfo.networkName,
  );

  signer.schema = {
    checkFeasibility: (signerKeys) => {
      return signerKeys.length > 0;
    },
    getAllPotentialSigners: () => signer.potentialSigners,
  };
}

/**
 * Process a single EVM signature (v, r, s components).
 *
 * @param {Signer} signer - Parent Signer instance
 * @param {Object} rawSignature - { v, r, s, from }
 */
function processEvmSignature(signer, rawSignature) {
  const signaturePair = new TxSignature();
  const { v, r, s, from } = rawSignature;

  signaturePair.signature = JSON.stringify({ v, r, s });

  const signerAddress = from?.toLowerCase();

  if (signerAddress) {
    if (
      signer.potentialSigners.length === 0 ||
      signer.potentialSigners.some(
        (addr) => addr.toLowerCase() === signerAddress,
      )
    ) {
      signaturePair.key = signerAddress;
      if (!signer.txInfo.signatures.some((s) => s.key === signaturePair.key)) {
        signer.txInfo.signatures.push(signaturePair);
        signer.accepted.push(signaturePair);
      }
    } else {
      signaturePair.key = signerAddress;
      signer.rejected.push(signaturePair);
    }
  } else {
    signaturePair.key = "unknown";
    signer.rejected.push(signaturePair);
  }
}

/**
 * HSM signing path for EVM chains.
 *
 * @param {Signer} signer
 * @param {string} keyId
 * @param {Object} hsm - HsmSigningAdapter instance
 */
async function signEvmWithHsm(signer, keyId, hsm) {
  const result = await hsm.signEvmTransaction(keyId, signer.tx);
  if (result && result.v !== undefined) {
    processEvmSignature(signer, result);
  }
}

module.exports = {
  initEvm,
  initEvmSigners,
  processEvmSignature,
  signEvmWithHsm,
};
