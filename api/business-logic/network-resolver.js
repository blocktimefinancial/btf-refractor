// Edit LJM - Added MAINNET to the network resolver
// Edit LJM - Changed default to return the network passed in in lowercase
// Updated to support blockchain-agnostic network resolution

const { standardError } = require("./std-error"),
  { networks } = require("../app.config"),
  {
    getBlockchainConfig,
    getNetworkConfig,
    isValidBlockchain,
    isValidNetwork,
  } = require("./blockchain-registry");

function normalizeNetworkName(network) {
  switch (network) {
    case "public":
    case "PUBLIC":
    case "mainnet":
    case "MAINNET":
    case "main":
    case "MAIN":
    case "0":
    case 0:
      return "public";
    case "testnet":
    case "test":
    case "TESTNET":
    case "TEST":
    case "1":
    case 1:
      return "testnet";
    case "FUTURENET":
    case "futurenet":
    case 2:
    case "2":
      return "futurenet";
    default:
      return String(network).toLowerCase();
  }
}

/**
 * Resolve Stellar network configuration (legacy)
 * @param {String} network - Network identifier
 * @return {{horizon: String, network: String, passphrase: String}}
 */
function resolveNetwork(network) {
  return networks[normalizeNetworkName(network)];
}

/**
 * Resolve legacy Stellar network ID
 * @param {String} network - Network identifier
 * @return {Number} Network ID (0, 1, or 2)
 */
function resolveNetworkId(network) {
  switch (normalizeNetworkName(network)) {
    case "public":
    case "0":
      return 0;
    case "testnet":
    case "1":
      return 1;
    case "futurenet":
    case "2":
      return 2;
    default:
      throw standardError(400, "Unidentified network: " + network);
  }
}

/**
 * Resolve Stellar network parameters (legacy)
 * @param {String} network - Network identifier
 * @return {{horizon: String, network: String, passphrase: String}}
 */
function resolveNetworkParams(network) {
  return networks[normalizeNetworkName(network)];
}

// ============================================================================
// Blockchain-Agnostic Network Resolution
// ============================================================================

/**
 * Resolve network configuration for any blockchain
 * @param {string} blockchain - Blockchain identifier
 * @param {string} networkName - Network name
 * @returns {Object} Network configuration
 */
function resolveBlockchainNetwork(blockchain, networkName) {
  if (!isValidBlockchain(blockchain)) {
    throw standardError(400, `Unsupported blockchain: ${blockchain}`);
  }

  // For Stellar, normalize network name
  const normalizedNetwork =
    blockchain === "stellar" ? normalizeNetworkName(networkName) : networkName;

  if (!isValidNetwork(blockchain, normalizedNetwork)) {
    throw standardError(
      400,
      `Invalid network '${networkName}' for blockchain '${blockchain}'`,
    );
  }

  return getNetworkConfig(blockchain, normalizedNetwork);
}

/**
 * Get RPC/API endpoint for a blockchain network
 * @param {string} blockchain - Blockchain identifier
 * @param {string} networkName - Network name
 * @returns {string|null} The endpoint URL or null
 */
function resolveNetworkEndpoint(blockchain, networkName) {
  const config = resolveBlockchainNetwork(blockchain, networkName);

  // Different blockchains have different endpoint field names
  if (blockchain === "stellar") {
    return config?.horizon || null;
  }

  // Generic RPC endpoint
  return config?.rpcUrl || config?.endpoint || null;
}

/**
 * Get chain ID for a blockchain network
 * @param {string} blockchain - Blockchain identifier
 * @param {string} networkName - Network name
 * @returns {string|number|null} The chain ID
 */
function resolveChainId(blockchain, networkName) {
  const config = resolveBlockchainNetwork(blockchain, networkName);
  return config?.chainId || null;
}

/**
 * Check if a network is a testnet
 * @param {string} blockchain - Blockchain identifier
 * @param {string} networkName - Network name
 * @returns {boolean} True if testnet
 */
function isTestnet(blockchain, networkName) {
  const config = resolveBlockchainNetwork(blockchain, networkName);
  return config?.isTestnet === true;
}

/**
 * Get default network for a blockchain
 * @param {string} blockchain - Blockchain identifier
 * @param {boolean} [useTestnet=false] - Whether to prefer testnet
 * @returns {string} Default network name
 */
function getDefaultNetwork(blockchain, useTestnet = false) {
  const blockchainConfig = getBlockchainConfig(blockchain);
  const networks = Object.keys(blockchainConfig.networks);

  if (useTestnet) {
    // Find first testnet
    for (const network of networks) {
      if (blockchainConfig.networks[network]?.isTestnet) {
        return network;
      }
    }
  }

  // Find first non-testnet (mainnet)
  for (const network of networks) {
    if (!blockchainConfig.networks[network]?.isTestnet) {
      return network;
    }
  }

  // Fallback to first network
  return networks[0];
}

module.exports = {
  // Legacy Stellar functions
  resolveNetwork,
  resolveNetworkId,
  resolveNetworkParams,
  normalizeNetworkName,

  // Blockchain-agnostic functions
  resolveBlockchainNetwork,
  resolveNetworkEndpoint,
  resolveChainId,
  isTestnet,
  getDefaultNetwork,
};
