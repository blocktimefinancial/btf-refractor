/**
 * Blockchain Registry
 *
 * Central registry of supported blockchains and their configurations.
 * Each blockchain defines:
 * - Supported networks
 * - Default encoding for transactions
 * - Network-specific configurations (RPC endpoints, chain IDs, etc.)
 * - Key/signature format information
 */

/**
 * Blockchain configuration structure
 * @typedef {Object} BlockchainConfig
 * @property {string} name - Human-readable name
 * @property {string} defaultEncoding - Default encoding for transactions
 * @property {string[]} supportedEncodings - All supported encodings
 * @property {Object.<string, NetworkConfig>} networks - Network configurations
 * @property {Object} keyFormat - Key format information
 */

/**
 * Network configuration structure
 * @typedef {Object} NetworkConfig
 * @property {string} name - Human-readable name
 * @property {string} [passphrase] - Network passphrase (Stellar)
 * @property {number} [chainId] - Chain ID (Ethereum)
 * @property {string} [horizon] - Horizon URL (Stellar)
 * @property {string} [rpc] - RPC endpoint
 * @property {boolean} [isTestnet] - Whether this is a test network
 */

/**
 * Registry of all supported blockchains
 */
const BLOCKCHAIN_REGISTRY = {
  stellar: {
    name: "Stellar",
    defaultEncoding: "base64",
    supportedEncodings: ["base64"],
    keyFormat: {
      type: "ed25519",
      publicKeyPrefix: "G",
      publicKeyLength: 56,
      signatureEncoding: "base64",
    },
    networks: {
      public: {
        name: "Public Network",
        passphrase: "Public Global Stellar Network ; September 2015",
        horizon: "https://horizon.stellar.org",
        isTestnet: false,
      },
      testnet: {
        name: "Test Network",
        passphrase: "Test SDF Network ; September 2015",
        horizon: "https://horizon-testnet.stellar.org",
        isTestnet: true,
      },
      futurenet: {
        name: "Future Network",
        passphrase: "Test SDF Future Network ; October 2022",
        horizon: "https://horizon-futurenet.stellar.org",
        isTestnet: true,
      },
    },
  },

  ethereum: {
    name: "Ethereum",
    defaultEncoding: "hex",
    supportedEncodings: ["hex"],
    keyFormat: {
      type: "secp256k1",
      addressPrefix: "0x",
      addressLength: 42,
      signatureEncoding: "hex",
    },
    networks: {
      mainnet: {
        name: "Mainnet",
        chainId: 1,
        isTestnet: false,
      },
      sepolia: {
        name: "Sepolia Testnet",
        chainId: 11155111,
        isTestnet: true,
      },
      goerli: {
        name: "Goerli Testnet",
        chainId: 5,
        isTestnet: true,
      },
      holesky: {
        name: "Holesky Testnet",
        chainId: 17000,
        isTestnet: true,
      },
    },
  },

  solana: {
    name: "Solana",
    defaultEncoding: "base64",
    supportedEncodings: ["base64", "base58"],
    keyFormat: {
      type: "ed25519",
      publicKeyEncoding: "base58",
      publicKeyLength: 44, // Base58 encoded
      signatureEncoding: "base64",
    },
    networks: {
      mainnet: {
        name: "Mainnet Beta",
        rpc: "https://api.mainnet-beta.solana.com",
        isTestnet: false,
      },
      devnet: {
        name: "Devnet",
        rpc: "https://api.devnet.solana.com",
        isTestnet: true,
      },
      testnet: {
        name: "Testnet",
        rpc: "https://api.testnet.solana.com",
        isTestnet: true,
      },
    },
  },

  bitcoin: {
    name: "Bitcoin",
    defaultEncoding: "hex",
    supportedEncodings: ["hex"],
    keyFormat: {
      type: "secp256k1",
      addressFormats: ["p2pkh", "p2sh", "p2wpkh", "p2wsh", "p2tr"],
      signatureEncoding: "hex",
    },
    networks: {
      mainnet: {
        name: "Mainnet",
        isTestnet: false,
      },
      testnet: {
        name: "Testnet",
        isTestnet: true,
      },
      signet: {
        name: "Signet",
        isTestnet: true,
      },
    },
  },

  polygon: {
    name: "Polygon",
    defaultEncoding: "hex",
    supportedEncodings: ["hex"],
    keyFormat: {
      type: "secp256k1",
      addressPrefix: "0x",
      addressLength: 42,
      signatureEncoding: "hex",
    },
    networks: {
      mainnet: {
        name: "Polygon Mainnet",
        chainId: 137,
        isTestnet: false,
      },
      amoy: {
        name: "Amoy Testnet",
        chainId: 80002,
        isTestnet: true,
      },
    },
  },

  avalanche: {
    name: "Avalanche",
    defaultEncoding: "hex",
    supportedEncodings: ["hex"],
    keyFormat: {
      type: "secp256k1",
      addressPrefix: "0x",
      addressLength: 42,
      signatureEncoding: "hex",
    },
    networks: {
      mainnet: {
        name: "C-Chain Mainnet",
        chainId: 43114,
        isTestnet: false,
      },
      fuji: {
        name: "Fuji Testnet",
        chainId: 43113,
        isTestnet: true,
      },
    },
  },

  arbitrum: {
    name: "Arbitrum",
    defaultEncoding: "hex",
    supportedEncodings: ["hex"],
    keyFormat: {
      type: "secp256k1",
      addressPrefix: "0x",
      addressLength: 42,
      signatureEncoding: "hex",
    },
    networks: {
      mainnet: {
        name: "Arbitrum One",
        chainId: 42161,
        isTestnet: false,
      },
      sepolia: {
        name: "Arbitrum Sepolia",
        chainId: 421614,
        isTestnet: true,
      },
    },
  },

  optimism: {
    name: "Optimism",
    defaultEncoding: "hex",
    supportedEncodings: ["hex"],
    keyFormat: {
      type: "secp256k1",
      addressPrefix: "0x",
      addressLength: 42,
      signatureEncoding: "hex",
    },
    networks: {
      mainnet: {
        name: "OP Mainnet",
        chainId: 10,
        isTestnet: false,
      },
      sepolia: {
        name: "OP Sepolia",
        chainId: 11155420,
        isTestnet: true,
      },
    },
  },

  base: {
    name: "Base",
    defaultEncoding: "hex",
    supportedEncodings: ["hex"],
    keyFormat: {
      type: "secp256k1",
      addressPrefix: "0x",
      addressLength: 42,
      signatureEncoding: "hex",
    },
    networks: {
      mainnet: {
        name: "Base Mainnet",
        chainId: 8453,
        isTestnet: false,
      },
      sepolia: {
        name: "Base Sepolia",
        chainId: 84532,
        isTestnet: true,
      },
    },
  },

  onemoney: {
    name: "1Money",
    defaultEncoding: "json",
    supportedEncodings: ["json", "hex"],
    keyFormat: {
      type: "secp256k1",
      addressPrefix: "0x",
      addressLength: 42,
      signatureEncoding: "hex",
    },
    networks: {
      mainnet: {
        name: "1Money Mainnet",
        chainId: 1212101,
        rpc: "https://api.1money.network",
        isTestnet: false,
      },
      testnet: {
        name: "1Money Testnet",
        chainId: 1212101,
        rpc: "https://api.testnet.1money.network",
        isTestnet: true,
      },
    },
  },

  aptos: {
    name: "Aptos",
    defaultEncoding: "hex",
    supportedEncodings: ["hex", "base64"],
    keyFormat: {
      type: "ed25519",
      addressPrefix: "0x",
      addressLength: 66, // 64 hex chars + 0x prefix
      signatureEncoding: "hex",
    },
    networks: {
      mainnet: {
        name: "Aptos Mainnet",
        rpc: "https://fullnode.mainnet.aptoslabs.com",
        isTestnet: false,
      },
      testnet: {
        name: "Aptos Testnet",
        rpc: "https://fullnode.testnet.aptoslabs.com",
        isTestnet: true,
      },
      devnet: {
        name: "Aptos Devnet",
        rpc: "https://fullnode.devnet.aptoslabs.com",
        isTestnet: true,
      },
    },
  },

  algorand: {
    name: "Algorand",
    defaultEncoding: "base64",
    supportedEncodings: ["base64", "msgpack", "base32"],
    keyFormat: {
      type: "ed25519",
      addressFormat: "base32",
      addressLength: 58, // Base32 encoded with checksum
      signatureEncoding: "base64",
    },
    networks: {
      mainnet: {
        name: "Algorand Mainnet",
        rpc: "https://mainnet-api.algonode.cloud",
        isTestnet: false,
      },
      testnet: {
        name: "Algorand Testnet",
        rpc: "https://testnet-api.algonode.cloud",
        isTestnet: true,
      },
      betanet: {
        name: "Algorand Betanet",
        rpc: "https://betanet-api.algonode.cloud",
        isTestnet: true,
      },
    },
  },
};

/**
 * Get configuration for a blockchain
 *
 * @param {string} blockchain - Blockchain identifier
 * @returns {BlockchainConfig|null} Configuration or null if not found
 */
function getBlockchainConfig(blockchain) {
  if (!blockchain || typeof blockchain !== "string") {
    return null;
  }
  return BLOCKCHAIN_REGISTRY[blockchain.toLowerCase()] || null;
}

/**
 * Get configuration for a specific network on a blockchain
 *
 * @param {string} blockchain - Blockchain identifier
 * @param {string} network - Network identifier
 * @returns {NetworkConfig|null} Network configuration or null if not found
 */
function getNetworkConfig(blockchain, network) {
  const blockchainConfig = getBlockchainConfig(blockchain);
  if (!blockchainConfig || !network) {
    return null;
  }
  return blockchainConfig.networks[network.toLowerCase()] || null;
}

/**
 * Check if a blockchain is supported
 *
 * @param {string} blockchain - Blockchain identifier
 * @returns {boolean} True if supported
 */
function isValidBlockchain(blockchain) {
  return getBlockchainConfig(blockchain) !== null;
}

/**
 * Check if a network is valid for a blockchain
 *
 * @param {string} blockchain - Blockchain identifier
 * @param {string} network - Network identifier
 * @returns {boolean} True if valid
 */
function isValidNetwork(blockchain, network) {
  return getNetworkConfig(blockchain, network) !== null;
}

/**
 * Get all supported blockchains
 *
 * @returns {string[]} Array of blockchain identifiers
 */
function getSupportedBlockchains() {
  return Object.keys(BLOCKCHAIN_REGISTRY);
}

/**
 * Get all networks for a blockchain
 *
 * @param {string} blockchain - Blockchain identifier
 * @returns {string[]} Array of network identifiers
 */
function getNetworks(blockchain) {
  const config = getBlockchainConfig(blockchain);
  if (!config) {
    return [];
  }
  return Object.keys(config.networks);
}

/**
 * Get the default encoding for a blockchain
 *
 * @param {string} blockchain - Blockchain identifier
 * @returns {string|null} Default encoding or null
 */
function getDefaultEncoding(blockchain) {
  const config = getBlockchainConfig(blockchain);
  return config?.defaultEncoding || null;
}

/**
 * Check if an encoding is supported for a blockchain
 *
 * @param {string} blockchain - Blockchain identifier
 * @param {string} encoding - Encoding to check
 * @returns {boolean} True if supported
 */
function isEncodingSupported(blockchain, encoding) {
  const config = getBlockchainConfig(blockchain);
  if (!config) {
    return false;
  }
  return config.supportedEncodings.includes(encoding.toLowerCase());
}

/**
 * Get all test networks across all blockchains
 *
 * @returns {Array<{blockchain: string, network: string}>} Array of test networks
 */
function getTestNetworks() {
  const testNetworks = [];
  for (const [blockchain, config] of Object.entries(BLOCKCHAIN_REGISTRY)) {
    for (const [network, networkConfig] of Object.entries(config.networks)) {
      if (networkConfig.isTestnet) {
        testNetworks.push({ blockchain, network });
      }
    }
  }
  return testNetworks;
}

/**
 * Get all production networks across all blockchains
 *
 * @returns {Array<{blockchain: string, network: string}>} Array of production networks
 */
function getProductionNetworks() {
  const prodNetworks = [];
  for (const [blockchain, config] of Object.entries(BLOCKCHAIN_REGISTRY)) {
    for (const [network, networkConfig] of Object.entries(config.networks)) {
      if (!networkConfig.isTestnet) {
        prodNetworks.push({ blockchain, network });
      }
    }
  }
  return prodNetworks;
}

module.exports = {
  BLOCKCHAIN_REGISTRY,
  getBlockchainConfig,
  getNetworkConfig,
  isValidBlockchain,
  isValidNetwork,
  getSupportedBlockchains,
  getNetworks,
  getDefaultEncoding,
  isEncodingSupported,
  getTestNetworks,
  getProductionNetworks,
};
