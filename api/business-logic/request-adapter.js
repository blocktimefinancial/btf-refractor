/**
 * Request Adapter for Blockchain-Agnostic Transaction Handling
 *
 * Normalizes incoming transaction requests into a unified internal format,
 * supporting both legacy Stellar format and new blockchain-agnostic format.
 *
 * @module business-logic/request-adapter
 */

const {
  parseTxUri,
  isValidTxUri,
  isValidCAIPUri,
  convertLegacyStellarToUri,
  parseCAIPUri,
} = require("./tx-uri");
const { isValidBlockchain, isValidNetwork } = require("./blockchain-registry");
const { standardError } = require("./std-error");
const logger = require("../utils/logger").forComponent("request-adapter");

/**
 * Normalized transaction request structure
 * @typedef {Object} NormalizedRequest
 * @property {string} blockchain - Blockchain identifier (e.g., 'stellar', 'ethereum')
 * @property {string} networkName - Network name (e.g., 'mainnet', 'testnet')
 * @property {string} payload - Encoded transaction payload
 * @property {string} encoding - Payload encoding (base64, hex, base58, etc.)
 * @property {string} txUri - Full transaction URI
 * @property {string|Object} [txJson] - JSON representation of the transaction
 * @property {string} [originator] - Public key/address of transaction originator
 * @property {string} [originatorSignature] - Originator's signature of the tx hash
 * @property {string} [callbackUrl] - Optional callback URL
 * @property {boolean} [submit] - Whether to auto-submit when ready
 * @property {Array<string>} [desiredSigners] - List of desired signer keys
 * @property {number} [minTime] - Minimum execution time
 * @property {number} [maxTime] - Maximum execution time (expires)
 * @property {Object} [legacy] - Legacy format fields for backward compatibility
 * @property {string} [legacy.xdr] - Original XDR (Stellar)
 * @property {number} [legacy.network] - Original network ID (0, 1, 2)
 */

/**
 * Network ID to network name mapping for Stellar
 * Uses canonical names that match blockchain-registry.js
 */
const STELLAR_NETWORK_MAP = {
  0: "public",
  1: "testnet",
  2: "futurenet",
};

/**
 * Network name to ID mapping for Stellar (reverse lookup)
 * Includes common aliases (mainnet/pubnet -> public)
 */
const STELLAR_NETWORK_ID_MAP = {
  public: 0,
  mainnet: 0,
  pubnet: 0,
  testnet: 1,
  futurenet: 2,
};

/**
 * Normalize txJson field to a consistent format
 * @param {string|Object|null|undefined} txJson - Raw txJson from request
 * @returns {string|null} Normalized txJson as string or null
 */
function normalizeTxJson(txJson) {
  if (txJson === null || txJson === undefined) {
    return null;
  }
  if (typeof txJson === "string") {
    return txJson;
  }
  if (typeof txJson === "object") {
    return JSON.stringify(txJson);
  }
  return null;
}

/**
 * Detect the format of an incoming transaction request
 * @param {Object} body - Request body
 * @returns {'legacy' | 'txUri' | 'components' | 'unknown'} Request format
 */
function detectRequestFormat(body) {
  if (!body || typeof body !== "object") {
    return "unknown";
  }

  // Check for txUri format (simple or CAIP)
  if (body.txUri) {
    if (isValidTxUri(body.txUri) || isValidCAIPUri(body.txUri)) {
      return "txUri";
    }
    return "unknown";
  }

  // Check for component-based blockchain-agnostic format
  if (body.blockchain && body.payload) {
    return "components";
  }

  // Check for legacy Stellar format
  if (body.xdr && (body.network !== undefined || body.networkName)) {
    return "legacy";
  }

  return "unknown";
}

/**
 * Normalize a legacy Stellar request to internal format
 * @param {Object} body - Request body with xdr and network
 * @returns {NormalizedRequest} Normalized request
 */
function normalizeLegacyRequest(body) {
  const {
    xdr,
    network,
    callbackUrl,
    submit,
    desiredSigners,
    expires,
    txJson,
    originator,
    originatorSignature,
  } = body;

  // Resolve network name from ID or string
  let networkName;
  let networkId;

  if (typeof network === "number") {
    networkName = STELLAR_NETWORK_MAP[network];
    networkId = network;
    if (!networkName) {
      throw standardError(400, `Invalid network ID: ${network}`);
    }
  } else if (typeof network === "string") {
    networkName = network.toLowerCase();
    networkId = STELLAR_NETWORK_ID_MAP[networkName];
    if (networkId === undefined) {
      throw standardError(400, `Invalid network name: ${network}`);
    }
  } else {
    throw standardError(400, "Network is required");
  }

  // Generate txUri from legacy format
  const txUri = convertLegacyStellarToUri(xdr, networkName);

  // Normalize txJson (stringify if object)
  const normalizedTxJson = normalizeTxJson(txJson);

  return {
    blockchain: "stellar",
    networkName,
    payload: xdr,
    encoding: "base64",
    txUri,
    txJson: normalizedTxJson,
    originator: originator || null,
    originatorSignature: originatorSignature || null,
    callbackUrl,
    submit: submit === true,
    desiredSigners: desiredSigners || [],
    minTime: 0, // Will be extracted from transaction
    maxTime: expires,
    legacy: {
      xdr,
      network: networkId,
    },
  };
}

/**
 * Normalize a txUri-based request to internal format
 * @param {Object} body - Request body with txUri
 * @returns {NormalizedRequest} Normalized request
 */
function normalizeTxUriRequest(body) {
  const {
    txUri,
    callbackUrl,
    submit,
    desiredSigners,
    minTime,
    maxTime,
    txJson,
    originator,
    originatorSignature,
  } = body;

  // Normalize txJson (stringify if object)
  const normalizedTxJson = normalizeTxJson(txJson);

  let parsed;

  // Try simple format first (tx:blockchain:network;encoding,payload)
  if (isValidTxUri(txUri)) {
    parsed = parseTxUri(txUri);
  } else if (isValidCAIPUri(txUri)) {
    parsed = parseCAIPUri(txUri);
  } else {
    throw standardError(400, `Invalid transaction URI format: ${txUri}`);
  }

  if (!parsed) {
    throw standardError(400, `Failed to parse transaction URI: ${txUri}`);
  }

  const { blockchain, network, encoding, payload } = parsed;

  // For Stellar, add legacy format for backward compatibility
  let legacy;
  if (blockchain === "stellar") {
    const networkId = STELLAR_NETWORK_ID_MAP[network];
    if (networkId !== undefined) {
      legacy = {
        xdr: payload,
        network: networkId,
      };
    }
  }

  return {
    blockchain,
    networkName: network,
    payload,
    encoding,
    txUri,
    txJson: normalizedTxJson,
    originator: originator || null,
    originatorSignature: originatorSignature || null,
    callbackUrl,
    submit: submit === true,
    desiredSigners: desiredSigners || [],
    minTime: minTime || 0,
    maxTime,
    legacy,
  };
}

/**
 * Normalize a component-based request to internal format
 * @param {Object} body - Request body with blockchain, networkName, payload
 * @returns {NormalizedRequest} Normalized request
 */
function normalizeComponentRequest(body) {
  const {
    blockchain,
    networkName,
    payload,
    encoding = "base64",
    callbackUrl,
    submit,
    desiredSigners,
    minTime,
    maxTime,
    txJson,
    originator,
    originatorSignature,
  } = body;

  // Normalize txJson (stringify if object)
  const normalizedTxJson = normalizeTxJson(txJson);

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

  // Build txUri from components
  const txUri = `tx:${blockchain}:${networkName};${encoding},${payload}`;

  // For Stellar, add legacy format for backward compatibility
  let legacy;
  if (blockchain === "stellar") {
    const networkId = STELLAR_NETWORK_ID_MAP[networkName];
    if (networkId !== undefined && encoding === "base64") {
      legacy = {
        xdr: payload,
        network: networkId,
      };
    }
  }

  return {
    blockchain,
    networkName,
    payload,
    encoding,
    txUri,
    txJson: normalizedTxJson,
    originator: originator || null,
    originatorSignature: originatorSignature || null,
    callbackUrl,
    submit: submit === true,
    desiredSigners: desiredSigners || [],
    minTime: minTime || 0,
    maxTime,
    legacy,
  };
}

/**
 * Normalize any transaction request format to internal structure
 * @param {Object} body - Request body (any format)
 * @returns {NormalizedRequest} Normalized request
 * @throws {Error} If request format is invalid or unsupported
 */
function normalizeRequest(body) {
  const format = detectRequestFormat(body);

  logger.debug("Request format detected", {
    format,
    hasXdr: !!body?.xdr,
    hasTxUri: !!body?.txUri,
  });

  switch (format) {
    case "legacy":
      return normalizeLegacyRequest(body);
    case "txUri":
      return normalizeTxUriRequest(body);
    case "components":
      return normalizeComponentRequest(body);
    case "unknown":
    default:
      throw standardError(
        400,
        "Invalid request format. Provide either: " +
          "(1) xdr + network (legacy Stellar), " +
          "(2) txUri (blockchain-agnostic URI), or " +
          "(3) blockchain + networkName + payload (component format)"
      );
  }
}

/**
 * Check if a normalized request is for Stellar blockchain
 * @param {NormalizedRequest} request - Normalized request
 * @returns {boolean} True if Stellar
 */
function isStellarRequest(request) {
  return request.blockchain === "stellar";
}

/**
 * Convert normalized request back to legacy Stellar format
 * Used for backward compatibility with existing business logic
 * @param {NormalizedRequest} request - Normalized request
 * @returns {Object} Legacy format { xdr, network }
 */
function toLegacyFormat(request) {
  if (!isStellarRequest(request)) {
    throw standardError(
      400,
      `Cannot convert ${request.blockchain} to legacy Stellar format`
    );
  }

  if (request.legacy) {
    return {
      xdr: request.legacy.xdr,
      network: request.legacy.network,
      callbackUrl: request.callbackUrl,
      submit: request.submit,
      desiredSigners: request.desiredSigners,
      expires: request.maxTime,
    };
  }

  // Convert from components
  const networkId = STELLAR_NETWORK_ID_MAP[request.networkName];
  if (networkId === undefined) {
    throw standardError(
      400,
      `Cannot map network '${request.networkName}' to Stellar network ID`
    );
  }

  return {
    xdr: request.payload,
    network: networkId,
    callbackUrl: request.callbackUrl,
    submit: request.submit,
    desiredSigners: request.desiredSigners,
    expires: request.maxTime,
  };
}

module.exports = {
  // Core normalization
  normalizeRequest,
  detectRequestFormat,

  // Format-specific normalizers
  normalizeLegacyRequest,
  normalizeTxUriRequest,
  normalizeComponentRequest,

  // Utilities
  isStellarRequest,
  toLegacyFormat,

  // Constants
  STELLAR_NETWORK_MAP,
  STELLAR_NETWORK_ID_MAP,
};
