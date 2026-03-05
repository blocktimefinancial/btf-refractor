/**
 * Blockchain Registry Tests
 */

const {
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
} = require("../../business-logic/blockchain-registry");

describe("Blockchain Registry", () => {
  describe("BLOCKCHAIN_REGISTRY", () => {
    it("should contain stellar configuration", () => {
      expect(BLOCKCHAIN_REGISTRY.stellar).toBeDefined();
      expect(BLOCKCHAIN_REGISTRY.stellar.name).toBe("Stellar");
    });

    it("should contain ethereum configuration", () => {
      expect(BLOCKCHAIN_REGISTRY.ethereum).toBeDefined();
      expect(BLOCKCHAIN_REGISTRY.ethereum.name).toBe("Ethereum");
    });

    it("should contain solana configuration", () => {
      expect(BLOCKCHAIN_REGISTRY.solana).toBeDefined();
      expect(BLOCKCHAIN_REGISTRY.solana.name).toBe("Solana");
    });

    it("should contain bitcoin configuration", () => {
      expect(BLOCKCHAIN_REGISTRY.bitcoin).toBeDefined();
      expect(BLOCKCHAIN_REGISTRY.bitcoin.name).toBe("Bitcoin");
    });
  });

  describe("getBlockchainConfig()", () => {
    it("should return config for valid blockchain", () => {
      const config = getBlockchainConfig("stellar");
      expect(config).toBeDefined();
      expect(config.name).toBe("Stellar");
      expect(config.defaultEncoding).toBe("base64");
    });

    it("should be case-insensitive", () => {
      expect(getBlockchainConfig("STELLAR")).toBeDefined();
      expect(getBlockchainConfig("Stellar")).toBeDefined();
      expect(getBlockchainConfig("stelLAR")).toBeDefined();
    });

    it("should return null for invalid blockchain", () => {
      expect(getBlockchainConfig("invalid")).toBeNull();
      expect(getBlockchainConfig("")).toBeNull();
      expect(getBlockchainConfig(null)).toBeNull();
      expect(getBlockchainConfig(undefined)).toBeNull();
    });
  });

  describe("getNetworkConfig()", () => {
    it("should return config for valid network", () => {
      const config = getNetworkConfig("stellar", "testnet");
      expect(config).toBeDefined();
      expect(config.name).toBe("Test Network");
      expect(config.isTestnet).toBe(true);
    });

    it("should be case-insensitive", () => {
      expect(getNetworkConfig("STELLAR", "TESTNET")).toBeDefined();
      expect(getNetworkConfig("stellar", "TESTNET")).toBeDefined();
    });

    it("should return null for invalid network", () => {
      expect(getNetworkConfig("stellar", "invalid")).toBeNull();
      expect(getNetworkConfig("stellar", "")).toBeNull();
      expect(getNetworkConfig("stellar", null)).toBeNull();
    });

    it("should return null for invalid blockchain", () => {
      expect(getNetworkConfig("invalid", "testnet")).toBeNull();
    });
  });

  describe("isValidBlockchain()", () => {
    it("should return true for valid blockchains", () => {
      expect(isValidBlockchain("stellar")).toBe(true);
      expect(isValidBlockchain("ethereum")).toBe(true);
      expect(isValidBlockchain("solana")).toBe(true);
      expect(isValidBlockchain("bitcoin")).toBe(true);
    });

    it("should return false for invalid blockchains", () => {
      expect(isValidBlockchain("invalid")).toBe(false);
      expect(isValidBlockchain("")).toBe(false);
      expect(isValidBlockchain(null)).toBe(false);
    });
  });

  describe("isValidNetwork()", () => {
    it("should return true for valid networks", () => {
      expect(isValidNetwork("stellar", "public")).toBe(true);
      expect(isValidNetwork("stellar", "testnet")).toBe(true);
      expect(isValidNetwork("ethereum", "mainnet")).toBe(true);
      expect(isValidNetwork("ethereum", "sepolia")).toBe(true);
    });

    it("should return false for invalid networks", () => {
      expect(isValidNetwork("stellar", "mainnet")).toBe(false); // Stellar uses 'public', not 'mainnet'
      expect(isValidNetwork("ethereum", "public")).toBe(false); // Ethereum uses 'mainnet', not 'public'
    });
  });

  describe("getSupportedBlockchains()", () => {
    it("should return array of blockchain identifiers", () => {
      const blockchains = getSupportedBlockchains();
      expect(Array.isArray(blockchains)).toBe(true);
      expect(blockchains).toContain("stellar");
      expect(blockchains).toContain("ethereum");
      expect(blockchains).toContain("solana");
      expect(blockchains).toContain("bitcoin");
    });
  });

  describe("getNetworks()", () => {
    it("should return networks for stellar", () => {
      const networks = getNetworks("stellar");
      expect(networks).toContain("public");
      expect(networks).toContain("testnet");
      expect(networks).toContain("futurenet");
    });

    it("should return networks for ethereum", () => {
      const networks = getNetworks("ethereum");
      expect(networks).toContain("mainnet");
      expect(networks).toContain("sepolia");
    });

    it("should return empty array for invalid blockchain", () => {
      expect(getNetworks("invalid")).toEqual([]);
    });
  });

  describe("getDefaultEncoding()", () => {
    it("should return base64 for stellar", () => {
      expect(getDefaultEncoding("stellar")).toBe("base64");
    });

    it("should return hex for ethereum", () => {
      expect(getDefaultEncoding("ethereum")).toBe("hex");
    });

    it("should return null for invalid blockchain", () => {
      expect(getDefaultEncoding("invalid")).toBeNull();
    });
  });

  describe("isEncodingSupported()", () => {
    it("should return true for supported encodings", () => {
      expect(isEncodingSupported("stellar", "base64")).toBe(true);
      expect(isEncodingSupported("ethereum", "hex")).toBe(true);
      expect(isEncodingSupported("solana", "base64")).toBe(true);
      expect(isEncodingSupported("solana", "base58")).toBe(true);
    });

    it("should return false for unsupported encodings", () => {
      expect(isEncodingSupported("stellar", "hex")).toBe(false);
      expect(isEncodingSupported("ethereum", "base64")).toBe(false);
    });
  });

  describe("getTestNetworks()", () => {
    it("should return all test networks", () => {
      const testNets = getTestNetworks();
      expect(Array.isArray(testNets)).toBe(true);

      const stellarTestnet = testNets.find(
        (n) => n.blockchain === "stellar" && n.network === "testnet"
      );
      expect(stellarTestnet).toBeDefined();

      const ethSepolia = testNets.find(
        (n) => n.blockchain === "ethereum" && n.network === "sepolia"
      );
      expect(ethSepolia).toBeDefined();
    });

    it("should not include production networks", () => {
      const testNets = getTestNetworks();
      const stellarPublic = testNets.find(
        (n) => n.blockchain === "stellar" && n.network === "public"
      );
      expect(stellarPublic).toBeUndefined();
    });
  });

  describe("getProductionNetworks()", () => {
    it("should return all production networks", () => {
      const prodNets = getProductionNetworks();
      expect(Array.isArray(prodNets)).toBe(true);

      const stellarPublic = prodNets.find(
        (n) => n.blockchain === "stellar" && n.network === "public"
      );
      expect(stellarPublic).toBeDefined();

      const ethMainnet = prodNets.find(
        (n) => n.blockchain === "ethereum" && n.network === "mainnet"
      );
      expect(ethMainnet).toBeDefined();
    });

    it("should not include test networks", () => {
      const prodNets = getProductionNetworks();
      const stellarTestnet = prodNets.find(
        (n) => n.blockchain === "stellar" && n.network === "testnet"
      );
      expect(stellarTestnet).toBeUndefined();
    });
  });

  describe("Stellar-specific configuration", () => {
    it("should have correct network passphrases", () => {
      const publicNet = getNetworkConfig("stellar", "public");
      expect(publicNet.passphrase).toBe(
        "Public Global Stellar Network ; September 2015"
      );

      const testNet = getNetworkConfig("stellar", "testnet");
      expect(testNet.passphrase).toBe("Test SDF Network ; September 2015");
    });

    it("should have ed25519 key format", () => {
      const config = getBlockchainConfig("stellar");
      expect(config.keyFormat.type).toBe("ed25519");
      expect(config.keyFormat.publicKeyPrefix).toBe("G");
    });
  });

  describe("Ethereum-specific configuration", () => {
    it("should have correct chain IDs", () => {
      const mainnet = getNetworkConfig("ethereum", "mainnet");
      expect(mainnet.chainId).toBe(1);

      const sepolia = getNetworkConfig("ethereum", "sepolia");
      expect(sepolia.chainId).toBe(11155111);
    });

    it("should have secp256k1 key format", () => {
      const config = getBlockchainConfig("ethereum");
      expect(config.keyFormat.type).toBe("secp256k1");
      expect(config.keyFormat.addressPrefix).toBe("0x");
    });
  });

  describe("1Money (onemoney) configuration", () => {
    it("should contain onemoney configuration", () => {
      expect(BLOCKCHAIN_REGISTRY.onemoney).toBeDefined();
      expect(BLOCKCHAIN_REGISTRY.onemoney.name).toBe("1Money");
    });

    it("should have json as default encoding", () => {
      expect(getDefaultEncoding("onemoney")).toBe("json");
    });

    it("should have secp256k1 key format", () => {
      const config = getBlockchainConfig("onemoney");
      expect(config.keyFormat.type).toBe("secp256k1");
      expect(config.keyFormat.addressPrefix).toBe("0x");
    });

    it("should have mainnet network", () => {
      expect(isValidNetwork("onemoney", "mainnet")).toBe(true);
    });

    it("should support json and hex encoding", () => {
      expect(isEncodingSupported("onemoney", "json")).toBe(true);
      expect(isEncodingSupported("onemoney", "hex")).toBe(true);
    });
  });

  describe("Aptos configuration", () => {
    it("should contain aptos configuration", () => {
      expect(BLOCKCHAIN_REGISTRY.aptos).toBeDefined();
      expect(BLOCKCHAIN_REGISTRY.aptos.name).toBe("Aptos");
    });

    it("should have hex as default encoding", () => {
      expect(getDefaultEncoding("aptos")).toBe("hex");
    });

    it("should have ed25519 key format", () => {
      const config = getBlockchainConfig("aptos");
      expect(config.keyFormat.type).toBe("ed25519");
      expect(config.keyFormat.addressPrefix).toBe("0x");
    });

    it("should have all expected networks", () => {
      expect(isValidNetwork("aptos", "mainnet")).toBe(true);
      expect(isValidNetwork("aptos", "testnet")).toBe(true);
      expect(isValidNetwork("aptos", "devnet")).toBe(true);
    });

    it("should have correct testnet flags", () => {
      const mainnet = getNetworkConfig("aptos", "mainnet");
      expect(mainnet.isTestnet).toBe(false);

      const testnet = getNetworkConfig("aptos", "testnet");
      expect(testnet.isTestnet).toBe(true);

      const devnet = getNetworkConfig("aptos", "devnet");
      expect(devnet.isTestnet).toBe(true);
    });

    it("should support hex encoding", () => {
      expect(isEncodingSupported("aptos", "hex")).toBe(true);
    });
  });

  describe("Algorand configuration", () => {
    it("should contain algorand configuration", () => {
      expect(BLOCKCHAIN_REGISTRY.algorand).toBeDefined();
      expect(BLOCKCHAIN_REGISTRY.algorand.name).toBe("Algorand");
    });

    it("should have base64 as default encoding", () => {
      expect(getDefaultEncoding("algorand")).toBe("base64");
    });

    it("should have ed25519 key format with base32 prefix", () => {
      const config = getBlockchainConfig("algorand");
      expect(config.keyFormat.type).toBe("ed25519");
      expect(config.keyFormat.addressFormat).toBe("base32");
    });

    it("should have all expected networks", () => {
      expect(isValidNetwork("algorand", "mainnet")).toBe(true);
      expect(isValidNetwork("algorand", "testnet")).toBe(true);
      expect(isValidNetwork("algorand", "betanet")).toBe(true);
    });

    it("should have correct testnet flags", () => {
      const mainnet = getNetworkConfig("algorand", "mainnet");
      expect(mainnet.isTestnet).toBe(false);

      const testnet = getNetworkConfig("algorand", "testnet");
      expect(testnet.isTestnet).toBe(true);

      const betanet = getNetworkConfig("algorand", "betanet");
      expect(betanet.isTestnet).toBe(true);
    });

    it("should support base64 and msgpack encodings", () => {
      expect(isEncodingSupported("algorand", "base64")).toBe(true);
      expect(isEncodingSupported("algorand", "msgpack")).toBe(true);
    });
  });
});
