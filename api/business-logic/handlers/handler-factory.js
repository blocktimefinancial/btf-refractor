/**
 * Blockchain Handler Factory
 *
 * Routes requests to the appropriate blockchain-specific handler.
 * Provides a unified interface for transaction operations across blockchains.
 *
 * @module business-logic/handlers/handler-factory
 */

const { standardError } = require("../std-error");
const { isValidBlockchain } = require("../blockchain-registry");
const { isEvmBlockchain, createEvmHandler } = require("./evm-handler");
const logger = require("../../utils/logger").forComponent("handler-factory");

// Handler registry - lazy loaded
const handlers = {};

/**
 * Get the handler for a specific blockchain
 * @param {string} blockchain - The blockchain identifier
 * @returns {BlockchainHandler} The blockchain handler
 * @throws {Error} If blockchain is not supported
 */
function getHandler(blockchain) {
  const normalizedBlockchain = blockchain.toLowerCase();

  // Check if blockchain is valid
  if (!isValidBlockchain(normalizedBlockchain)) {
    throw standardError(400, `Unsupported blockchain: ${blockchain}`);
  }

  // Return cached handler if available
  if (handlers[normalizedBlockchain]) {
    return handlers[normalizedBlockchain];
  }

  // Try to load the handler
  try {
    switch (normalizedBlockchain) {
      case "stellar":
        handlers[normalizedBlockchain] = require("./stellar-handler");
        break;

      // 1Money network (EVM-compatible secp256k1 keys and signatures)
      case "onemoney":
        handlers[normalizedBlockchain] = require("./onemoney-handler");
        break;

      // Algorand (ed25519, same curve as Stellar)
      case "algorand":
        handlers[normalizedBlockchain] = require("./algorand-handler");
        break;

      // EVM-compatible blockchains
      case "ethereum":
      case "polygon":
      case "arbitrum":
      case "optimism":
      case "base":
      case "avalanche":
        handlers[normalizedBlockchain] = createEvmHandler(normalizedBlockchain);
        break;

      // Future blockchain handlers will be added here:
      // case 'solana':
      //   handlers[normalizedBlockchain] = require('./solana-handler');
      //   break;

      default:
        // Check if it's an EVM chain we might have missed
        if (isEvmBlockchain(normalizedBlockchain)) {
          handlers[normalizedBlockchain] =
            createEvmHandler(normalizedBlockchain);
          break;
        }
        throw standardError(
          501,
          `Blockchain '${blockchain}' is recognized but handler is not yet implemented`,
        );
    }
  } catch (e) {
    if (e.status) {
      throw e; // Re-throw standardError
    }
    logger.error("Failed to load blockchain handler", {
      blockchain,
      error: e.message,
    });
    throw standardError(500, `Failed to initialize handler for ${blockchain}`);
  }

  return handlers[normalizedBlockchain];
}

/**
 * Check if a blockchain handler is available
 * @param {string} blockchain - The blockchain identifier
 * @returns {boolean} True if handler is available
 */
function hasHandler(blockchain) {
  const normalizedBlockchain = blockchain.toLowerCase();

  // List of blockchains with implemented handlers
  const implementedHandlers = [
    "stellar",
    "onemoney",
    "algorand",
    "ethereum",
    "polygon",
    "arbitrum",
    "optimism",
    "base",
    "avalanche",
  ];

  return (
    implementedHandlers.includes(normalizedBlockchain) ||
    isEvmBlockchain(normalizedBlockchain)
  );
}

/**
 * Get list of blockchains with implemented handlers
 * @returns {Array<string>} List of blockchain identifiers
 */
function getImplementedBlockchains() {
  return [
    "stellar",
    "onemoney",
    "algorand",
    "ethereum",
    "polygon",
    "arbitrum",
    "optimism",
    "base",
    "avalanche",
  ];
}

/**
 * Parse a transaction using the appropriate handler
 * @param {string} blockchain - The blockchain identifier
 * @param {string} payload - The encoded transaction payload
 * @param {string} encoding - The encoding format
 * @param {string} networkName - The network name
 * @returns {Object} Parsed transaction object
 */
function parseTransaction(blockchain, payload, encoding, networkName) {
  const handler = getHandler(blockchain);
  return handler.parseTransaction(payload, encoding, networkName);
}

/**
 * Compute transaction hash using the appropriate handler
 * @param {string} blockchain - The blockchain identifier
 * @param {Object} transaction - The parsed transaction
 * @returns {{ hash: string, hashRaw: Buffer }} Transaction hash
 */
function computeHash(blockchain, transaction) {
  const handler = getHandler(blockchain);
  return handler.computeHash(transaction);
}

/**
 * Get potential signers using the appropriate handler
 * @param {string} blockchain - The blockchain identifier
 * @param {Object} transaction - The parsed transaction
 * @param {string} networkName - The network name
 * @param {Object} [options] - Additional options (accountsInfo, etc.)
 * @returns {Promise<Array<string>>} List of potential signer keys
 */
async function getPotentialSigners(
  blockchain,
  transaction,
  networkName,
  options = {},
) {
  const handler = getHandler(blockchain);
  return handler.getPotentialSigners(
    transaction,
    networkName,
    options.accountsInfo,
  );
}

/**
 * Verify a signature using the appropriate handler
 * @param {string} blockchain - The blockchain identifier
 * @param {string} publicKey - The public key
 * @param {Buffer} signature - The signature
 * @param {Buffer} message - The message (usually tx hash)
 * @returns {boolean} True if valid
 */
function verifySignature(blockchain, publicKey, signature, message) {
  const handler = getHandler(blockchain);
  return handler.verifySignature(publicKey, signature, message);
}

/**
 * Serialize a transaction using the appropriate handler
 * @param {string} blockchain - The blockchain identifier
 * @param {Object} transaction - The transaction to serialize
 * @param {string} encoding - The encoding format
 * @returns {string} Encoded transaction
 */
function serializeTransaction(blockchain, transaction, encoding) {
  const handler = getHandler(blockchain);
  return handler.serializeTransaction(transaction, encoding);
}

/**
 * Validate a public key using the appropriate handler
 * @param {string} blockchain - The blockchain identifier
 * @param {string} publicKey - The public key to validate
 * @returns {boolean} True if valid
 */
function isValidPublicKey(blockchain, publicKey) {
  const handler = getHandler(blockchain);
  return handler.isValidPublicKey(publicKey);
}

module.exports = {
  getHandler,
  hasHandler,
  getImplementedBlockchains,
  parseTransaction,
  computeHash,
  getPotentialSigners,
  verifySignature,
  serializeTransaction,
  isValidPublicKey,
};
