/**
 * Originator Verification Utility
 *
 * Provides functions to verify that a transaction was created by a trusted originator.
 * The originator signs the transaction hash to prove authorship, allowing potential
 * signers to verify the transaction came from a trusted source before signing.
 *
 * @module business-logic/originator-verifier
 */

const { getHandler, hasHandler } = require("./handlers/handler-factory");
const { isEvmBlockchain } = require("./handlers/evm-handler");
const { standardError } = require("./std-error");
const logger = require("../utils/logger").forComponent("originator-verifier");

/**
 * Validate that an originator key is valid for the given blockchain
 * @param {string} blockchain - Blockchain identifier
 * @param {string} originator - Originator public key or address
 * @returns {boolean} True if valid format
 */
function isValidOriginator(blockchain, originator) {
  if (!originator || typeof originator !== "string") {
    return false;
  }

  if (!hasHandler(blockchain)) {
    logger.warn("No handler for blockchain", { blockchain });
    return false;
  }

  const handler = getHandler(blockchain);
  return handler.isValidPublicKey(originator);
}

/**
 * Verify that the originator signature is valid for the transaction hash
 * @param {string} blockchain - Blockchain identifier
 * @param {string} originator - Originator public key or address
 * @param {string} originatorSignature - Signature to verify
 * @param {Buffer|string} hash - Transaction hash (hex string or Buffer)
 * @returns {boolean} True if signature is valid
 */
function verifyOriginatorSignature(
  blockchain,
  originator,
  originatorSignature,
  hash,
) {
  if (!originator || !originatorSignature) {
    return false;
  }

  if (!hasHandler(blockchain)) {
    logger.warn("No handler for blockchain", { blockchain });
    return false;
  }

  const handler = getHandler(blockchain);

  // Convert hash to Buffer if it's a hex string
  let hashBuffer;
  if (typeof hash === "string") {
    hashBuffer = Buffer.from(hash, "hex");
  } else if (Buffer.isBuffer(hash)) {
    hashBuffer = hash;
  } else {
    logger.error("Invalid hash format", { hashType: typeof hash });
    return false;
  }

  // Convert signature to appropriate format for the blockchain
  let signatureBuffer;
  try {
    signatureBuffer = decodeSignature(blockchain, originatorSignature);
  } catch (e) {
    logger.debug("Failed to decode originator signature", {
      blockchain,
      error: e.message,
    });
    return false;
  }

  try {
    return handler.verifySignature(originator, signatureBuffer, hashBuffer);
  } catch (e) {
    logger.debug("Originator signature verification failed", {
      blockchain,
      originator,
      error: e.message,
    });
    return false;
  }
}

/**
 * Decode a signature from its encoded form based on blockchain
 * @param {string} blockchain - Blockchain identifier
 * @param {string} signature - Encoded signature
 * @returns {Buffer} Decoded signature bytes
 */
function decodeSignature(blockchain, signature) {
  // EVM chains use hex encoding with 0x prefix
  if (isEvmBlockchain(blockchain)) {
    if (signature.startsWith("0x")) {
      return Buffer.from(signature.slice(2), "hex");
    }
    return Buffer.from(signature, "hex");
  }

  // Stellar and compatible chains use base64 encoding
  return Buffer.from(signature, "base64");
}

/**
 * Validate originator fields on a transaction request
 * Throws an error if originator is provided but invalid
 * @param {string} blockchain - Blockchain identifier
 * @param {string|null} originator - Originator key (optional)
 * @param {string|null} originatorSignature - Originator signature (optional)
 * @param {Buffer|string} hash - Transaction hash
 * @param {Object} options - Validation options
 * @param {boolean} [options.requireOriginator=false] - Require originator to be present
 * @param {boolean} [options.verifySignature=true] - Verify signature if present
 * @throws {Error} If validation fails
 */
function validateOriginator(
  blockchain,
  originator,
  originatorSignature,
  hash,
  options = {},
) {
  const { requireOriginator = false, verifySignature = true } = options;

  // Check if originator is required
  if (requireOriginator && !originator) {
    throw standardError(400, "Originator is required for this operation");
  }

  // If no originator provided, nothing to validate
  if (!originator) {
    return;
  }

  // Validate originator key format
  if (!isValidOriginator(blockchain, originator)) {
    throw standardError(
      400,
      `Invalid originator key format for blockchain '${blockchain}'`,
    );
  }

  // If signature is provided, validate it
  if (originatorSignature && verifySignature) {
    const isValid = verifyOriginatorSignature(
      blockchain,
      originator,
      originatorSignature,
      hash,
    );

    if (!isValid) {
      throw standardError(400, "Invalid originator signature");
    }

    logger.debug("Originator signature verified", { blockchain, originator });
  } else if (originatorSignature && !verifySignature) {
    // Signature provided but verification disabled
    logger.debug("Originator signature present but verification skipped", {
      blockchain,
      originator,
    });
  }
}

/**
 * Check if a transaction has a valid originator attestation
 * @param {Object} txInfo - Transaction info object
 * @param {string} txInfo.blockchain - Blockchain identifier
 * @param {string} txInfo.originator - Originator key
 * @param {string} txInfo.originatorSignature - Originator signature
 * @param {string} txInfo.hash - Transaction hash
 * @returns {{ hasOriginator: boolean, isVerified: boolean }}
 */
function checkOriginatorStatus(txInfo) {
  const { blockchain, originator, originatorSignature, hash } = txInfo;

  if (!originator) {
    return { hasOriginator: false, isVerified: false };
  }

  if (!originatorSignature) {
    return { hasOriginator: true, isVerified: false };
  }

  const isVerified = verifyOriginatorSignature(
    blockchain,
    originator,
    originatorSignature,
    hash,
  );

  return { hasOriginator: true, isVerified };
}

module.exports = {
  isValidOriginator,
  verifyOriginatorSignature,
  validateOriginator,
  checkOriginatorStatus,
  decodeSignature,
  isEvmBlockchain,
};
