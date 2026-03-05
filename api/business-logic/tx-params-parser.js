const { StrKey } = require("@stellar/stellar-sdk"),
  { standardError } = require("./std-error"),
  { resolveNetwork, resolveNetworkId } = require("./network-resolver"),
  TxModel = require("../models/tx-model"),
  { getUnixTimestamp } = require("./timestamp-utils"),
  { hasHandler, getHandler } = require("./handlers/handler-factory"),
  { isValidBlockchain, isValidNetwork } = require("./blockchain-registry");

/**
 * Parse transaction parameters for Stellar (legacy)
 *
 * @param {Transaction} tx - Stellar Transaction object
 * @param {Object} request - Original request
 * @param {'pubnet'|'testnet'|'futurenet'} request.network - Network
 * @param {String} [request.callbackUrl] - Callback URL
 * @param {Boolean} [request.submit] - Auto-submit flag
 * @param {Array<String>} [request.desiredSigners] - Desired signers
 * @param {Number} [request.expires] - Expiration timestamp
 * @param {String|Object} [request.txJson] - JSON representation of the transaction
 * @param {String} [request.originator] - Originator public key
 * @param {String} [request.originatorSignature] - Originator's signature of tx hash
 * @returns {TxModel}
 */
function parseTxParams(
  tx,
  {
    network,
    callbackUrl,
    submit,
    desiredSigners,
    expires = 0,
    txJson,
    originator,
    originatorSignature,
  }
) {
  const now = getUnixTimestamp();
  const txInfo = new TxModel();
  txInfo.network = resolveNetworkId(network);
  txInfo.xdr = tx.toXDR();
  txInfo.signatures = [];

  // Add blockchain-agnostic fields for Stellar
  txInfo.blockchain = "stellar";
  txInfo.networkName = resolveNetwork(network)?.network || "public";
  txInfo.payload = txInfo.xdr;
  txInfo.encoding = "base64";

  // Store JSON representation if provided
  if (txJson) {
    txInfo.txJson =
      typeof txJson === "string" ? txJson : JSON.stringify(txJson);
  }

  // Store originator attestation if provided
  if (originator) {
    txInfo.originator = originator;
  }
  if (originatorSignature) {
    txInfo.originatorSignature = originatorSignature;
  }

  if (callbackUrl) {
    if (
      !/^http(s)?:\/\/[-a-zA-Z0-9_+.]{2,256}\.[a-z]{2,4}\b(\/[-a-zA-Z0-9@:%_+.~#?&/=]*)?$/m.test(
        callbackUrl
      )
    )
      throw standardError(
        400,
        'Invalid URL supplied in "callbackUrl" parameter.'
      );
    txInfo.callbackUrl = callbackUrl;
  }
  if (desiredSigners && desiredSigners.length) {
    if (!(desiredSigners instanceof Array))
      throw standardError(
        400,
        'Invalid "requestedSigners" parameter. Expected an array of Stellar public keys.'
      );
    for (const key of desiredSigners)
      if (!StrKey.isValidEd25519PublicKey(key))
        throw standardError(
          400,
          `Invalid "requestedSigners" parameter. Key ${key} is not a valid Stellar public key.`
        );
    txInfo.desiredSigners = desiredSigners;
  }

  txInfo.minTime = (tx.timeBounds && parseInt(tx.timeBounds.minTime)) || 0;

  if (expires) {
    if (expires > 2147483647 || expires < 0)
      throw standardError(
        400,
        `Invalid "expires" parameter. ${expires} is not a valid UNIX date.`
      );
    if (expires < now)
      throw standardError(
        400,
        `Invalid "expires" parameter. ${expires} date has already passed.`
      );
  }

  //retrieve expiration time from the transaction itself
  const txExpiration = (tx.timeBounds && parseInt(tx.timeBounds.maxTime)) || 0;
  if (txExpiration && txExpiration < now)
    throw standardError(
      400,
      `Invalid transactions "timebounds.maxTime" value - the transaction already expired.`
    );
  if (txExpiration > 0 && txExpiration < expires) {
    expires = txExpiration;
  }
  if (expires > 0) {
    txInfo.maxTime = expires;
  }

  if (submit === true) {
    txInfo.submit = true;
  }
  return txInfo;
}

/**
 * Parse transaction parameters for any blockchain (blockchain-agnostic)
 *
 * @param {Object} request - Normalized request from request-adapter
 * @param {string} request.blockchain - Blockchain identifier
 * @param {string} request.networkName - Network name
 * @param {string} request.payload - Encoded transaction payload
 * @param {string} request.encoding - Payload encoding
 * @param {string} [request.txUri] - Transaction URI
 * @param {string|Object} [request.txJson] - JSON representation of the transaction
 * @param {string} [request.callbackUrl] - Callback URL
 * @param {boolean} [request.submit] - Auto-submit flag
 * @param {Array<string>} [request.desiredSigners] - Desired signers
 * @param {number} [request.minTime] - Minimum time
 * @param {number} [request.maxTime] - Maximum time / expiration
 * @param {string} [request.originator] - Originator public key/address
 * @param {string} [request.originatorSignature] - Originator's signature of tx hash
 * @param {Object} [request.legacy] - Legacy format fields
 * @returns {TxModel}
 */
function parseBlockchainAgnosticParams(request) {
  const {
    blockchain,
    networkName,
    payload,
    encoding,
    txUri,
    txJson,
    originator,
    originatorSignature,
    callbackUrl,
    submit,
    desiredSigners,
    minTime = 0,
    maxTime,
    legacy,
  } = request;

  const now = getUnixTimestamp();

  // Validate blockchain
  if (!isValidBlockchain(blockchain)) {
    throw standardError(400, `Unsupported blockchain: ${blockchain}`);
  }

  // Validate network
  if (!isValidNetwork(blockchain, networkName)) {
    throw standardError(
      400,
      `Invalid network '${networkName}' for blockchain '${blockchain}'`
    );
  }

  // Check if handler is implemented
  if (!hasHandler(blockchain)) {
    throw standardError(
      501,
      `Blockchain '${blockchain}' is not yet fully implemented`
    );
  }

  const txInfo = new TxModel();

  // Core blockchain-agnostic fields
  txInfo.blockchain = blockchain;
  txInfo.networkName = networkName;
  txInfo.payload = payload;
  txInfo.encoding = encoding;
  txInfo.txUri = txUri;
  txInfo.signatures = [];

  // Store JSON representation if provided
  if (txJson) {
    txInfo.txJson =
      typeof txJson === "string" ? txJson : JSON.stringify(txJson);
  }

  // Store originator attestation if provided
  if (originator) {
    txInfo.originator = originator;
  }
  if (originatorSignature) {
    txInfo.originatorSignature = originatorSignature;
  }

  // Legacy fields for Stellar compatibility
  if (blockchain === "stellar" && legacy) {
    txInfo.network = legacy.network;
    txInfo.xdr = legacy.xdr || payload;
  }

  // Callback URL validation
  if (callbackUrl) {
    if (
      !/^http(s)?:\/\/[-a-zA-Z0-9_+.]{2,256}\.[a-z]{2,4}\b(\/[-a-zA-Z0-9@:%_+.~#?&/=]*)?$/m.test(
        callbackUrl
      )
    ) {
      throw standardError(
        400,
        'Invalid URL supplied in "callbackUrl" parameter.'
      );
    }
    txInfo.callbackUrl = callbackUrl;
  }

  // Desired signers validation
  if (desiredSigners?.length) {
    if (!Array.isArray(desiredSigners)) {
      throw standardError(
        400,
        'Invalid "desiredSigners" parameter. Expected an array of public keys.'
      );
    }

    // Validate keys using blockchain-specific handler
    const handler = getHandler(blockchain);
    for (const key of desiredSigners) {
      if (!handler.isValidPublicKey(key)) {
        throw standardError(
          400,
          `Invalid "desiredSigners" parameter. Key ${key} is not a valid ${blockchain} public key.`
        );
      }
    }
    txInfo.desiredSigners = desiredSigners;
  }

  // Time bounds
  txInfo.minTime = minTime;
  if (maxTime && maxTime > 0) {
    if (maxTime > 2147483647 || maxTime < 0) {
      throw standardError(
        400,
        `Invalid "maxTime" parameter. ${maxTime} is not a valid UNIX date.`
      );
    }
    if (maxTime < now) {
      throw standardError(
        400,
        `Invalid "maxTime" parameter. ${maxTime} date has already passed.`
      );
    }
    txInfo.maxTime = maxTime;
  }

  // Submit flag
  if (submit === true) {
    txInfo.submit = true;
  }

  return txInfo;
}

/**
 * Slice signatures from a transaction (Stellar-specific)
 * @param {Transaction} tx - Stellar transaction
 * @returns {{ tx: Transaction, signatures: Array }} Transaction and extracted signatures
 */
function sliceTx(tx) {
  const signatures = tx.signatures.slice();
  tx._signatures = [];
  return { tx, signatures };
}

module.exports = {
  parseTxParams,
  parseBlockchainAgnosticParams,
  sliceTx,
};
