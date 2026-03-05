const { normalizeNetworkName, resolveNetwork } = require("./network-resolver"),
  storageLayer = require("../storage/storage-layer"),
  { TransactionBuilder } = require("@stellar/stellar-sdk"),
  { convertLegacyStellarToUri } = require("./tx-uri");

/**
 * Network ID to network name mapping for response
 * Uses canonical names that match blockchain-registry.js
 */
const NETWORK_ID_TO_NAME = {
  0: "public",
  1: "testnet",
  2: "futurenet",
};

async function loadRehydrateTx(hash) {
  const txInfo = await storageLayer.dataProvider.findTransaction(hash);
  if (!txInfo) {
    const notFound = new Error(`Transaction ${hash} not found.`);
    notFound.status = 404;
    return Promise.reject(notFound);
  }
  return rehydrateTx(txInfo);
}

/**
 *
 * @param {TxModel} txInfo
 * @return {TxModel}
 */
function rehydrateTx(txInfo) {
  const { network, xdr, ...res } = txInfo;

  // Determine blockchain (default to stellar for legacy records)
  const blockchain = txInfo.blockchain || "stellar";
  const isStellar = blockchain === "stellar";

  if (isStellar) {
    // Stellar-specific rehydration
    const tx = TransactionBuilder.fromXDR(
      xdr,
      resolveNetwork(network).passphrase
    );
    //rehydrate - set network and add signatures from tx info
    res.network = normalizeNetworkName(network);
    for (const { key, signature } of txInfo.signatures) {
      // Signature is already a base64 string from MongoDB
      const signatureString =
        typeof signature === "string"
          ? signature
          : signature.toString("base64");
      tx.addSignature(key, signatureString);
    }
    res.xdr = tx.toXDR();

    // Add blockchain-agnostic fields for Stellar
    res.blockchain = "stellar";
    res.networkName = NETWORK_ID_TO_NAME[network] || res.network;
    res.payload = res.xdr;
    res.encoding = "base64";
    res.txUri = convertLegacyStellarToUri(res.xdr, res.networkName);
    // Include txJson if present
    if (txInfo.txJson) {
      res.txJson = txInfo.txJson;
    }
    // Include originator fields if present
    if (txInfo.originator) {
      res.originator = txInfo.originator;
    }
    if (txInfo.originatorSignature) {
      res.originatorSignature = txInfo.originatorSignature;
    }
  } else {
    // Generic blockchain handling (future)
    res.blockchain = blockchain;
    res.networkName = txInfo.networkName;
    res.payload = txInfo.payload || xdr;
    res.encoding = txInfo.encoding || "base64";
    res.txUri = txInfo.txUri;
    // Include txJson if present
    if (txInfo.txJson) {
      res.txJson = txInfo.txJson;
    }
    // Include originator fields if present
    if (txInfo.originator) {
      res.originator = txInfo.originator;
    }
    if (txInfo.originatorSignature) {
      res.originatorSignature = txInfo.originatorSignature;
    }
    // Keep legacy xdr for backward compatibility if present
    if (xdr) {
      res.xdr = xdr;
      res.network = normalizeNetworkName(network);
    }
  }

  return res;
}

module.exports = { loadRehydrateTx, rehydrateTx };
