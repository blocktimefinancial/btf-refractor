/**
 * Transaction Submitter
 *
 * Routes transaction submissions to the appropriate blockchain handler.
 * Supports Stellar and EVM-compatible chains.
 *
 * @module business-logic/finalization/tx-submitter
 */

const { hasHandler, getHandler } = require("../handlers/handler-factory");
const { isEvmBlockchain, EVM_BLOCKCHAINS } = require("../handlers/evm-handler");
const {
  submitTransaction: submitStellarTransaction,
} = require("./horizon-handler");
const {
  getBlockchainConfig,
  getNetworkConfig,
} = require("../blockchain-registry");
const { standardError } = require("../std-error");
const logger = require("../../utils/logger").forComponent("tx-submitter");

/**
 * Submit an EVM transaction to the network
 * @param {Object} txInfo - Transaction info
 * @returns {Promise<Object>} Updated transaction info with result
 */
async function submitEvmTransaction(txInfo) {
  const blockchain = txInfo.blockchain;
  const networkName = txInfo.networkName || "mainnet";
  const networkConfig = getNetworkConfig(blockchain, networkName);

  if (!networkConfig) {
    throw standardError(400, `Unknown network: ${blockchain}/${networkName}`);
  }

  // Get RPC endpoint from config or environment
  const rpcUrl =
    networkConfig.rpc || process.env[`${blockchain.toUpperCase()}_RPC_URL`];

  if (!rpcUrl) {
    throw standardError(
      501,
      `No RPC endpoint configured for ${blockchain}/${networkName}. Set ${blockchain.toUpperCase()}_RPC_URL environment variable.`,
    );
  }

  logger.info("Submitting EVM transaction", {
    hash: txInfo.hash,
    blockchain,
    network: networkName,
    rpcUrl: rpcUrl.replace(/\/\/.*@/, "//***@"), // Hide credentials
  });

  // Get the signed transaction payload
  const payload = txInfo.payload.startsWith("0x")
    ? txInfo.payload
    : `0x${txInfo.payload}`;

  try {
    // Use eth_sendRawTransaction RPC method
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_sendRawTransaction",
        params: [payload],
      }),
    });

    const result = await response.json();

    if (result.error) {
      logger.error("EVM transaction submission failed", {
        hash: txInfo.hash,
        error: result.error,
      });

      const err = new Error(result.error.message || "EVM RPC error");
      err.code = result.error.code;
      throw err;
    }

    // Success - result.result contains the transaction hash
    logger.info("EVM transaction submitted successfully", {
      hash: txInfo.hash,
      txHash: result.result,
    });

    txInfo.status = "submitted";
    txInfo.result = {
      hash: result.result,
      submittedAt: new Date().toISOString(),
    };

    return txInfo;
  } catch (error) {
    logger.error("EVM transaction submission error", {
      hash: txInfo.hash,
      error: error.message,
    });

    throw error;
  }
}

/**
 * Submit a transaction to the appropriate blockchain
 * @param {Object} txInfo - Transaction info with blockchain field
 * @returns {Promise<Object>} Updated transaction info with result
 */
async function submitTransaction(txInfo) {
  const blockchain = txInfo.blockchain || "stellar";

  logger.debug("Submitting transaction", {
    hash: txInfo.hash,
    blockchain,
    network: txInfo.networkName || txInfo.network,
  });

  // Route to appropriate blockchain handler
  switch (blockchain) {
    case "stellar":
      return submitStellarTransaction(txInfo);

    // EVM-compatible blockchains
    case "ethereum":
    case "polygon":
    case "arbitrum":
    case "optimism":
    case "base":
    case "avalanche":
      return submitEvmTransaction(txInfo);

    default:
      // Check if it's an EVM chain
      if (isEvmBlockchain(blockchain)) {
        return submitEvmTransaction(txInfo);
      }

      // Check if blockchain is recognized in registry (but submission not implemented)
      const blockchainConfig = getBlockchainConfig(blockchain);
      if (blockchainConfig) {
        throw standardError(
          501,
          `Transaction submission not yet implemented for blockchain: ${blockchain}`,
        );
      } else {
        throw standardError(400, `Unsupported blockchain: ${blockchain}`);
      }
  }
}

/**
 * Check if transaction submission is supported for a blockchain
 * @param {string} blockchain - Blockchain identifier
 * @returns {boolean} True if submission is supported
 */
function isSubmissionSupported(blockchain) {
  const normalizedBlockchain = blockchain.toLowerCase();
  const supportedBlockchains = [
    "stellar",
    "ethereum",
    "polygon",
    "arbitrum",
    "optimism",
    "base",
    "avalanche",
  ];
  return (
    supportedBlockchains.includes(normalizedBlockchain) ||
    isEvmBlockchain(normalizedBlockchain)
  );
}

/**
 * Get list of blockchains that support transaction submission
 * @returns {Array<string>} List of blockchain identifiers
 */
function getSupportedSubmissionBlockchains() {
  return [
    "stellar",
    "ethereum",
    "polygon",
    "arbitrum",
    "optimism",
    "base",
    "avalanche",
  ];
}

module.exports = {
  submitTransaction,
  submitEvmTransaction,
  isSubmissionSupported,
  getSupportedSubmissionBlockchains,
};
