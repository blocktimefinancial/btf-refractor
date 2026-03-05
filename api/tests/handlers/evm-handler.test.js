/**
 * EVM Handler Tests
 *
 * Tests for EVM blockchain handler including transaction parsing,
 * hashing, signature verification, and serialization.
 */

const {
  EvmHandler,
  createEvmHandler,
  isEvmBlockchain,
  EVM_BLOCKCHAINS,
} = require("../../business-logic/handlers/evm-handler");
const {
  getHandler,
  hasHandler,
  getImplementedBlockchains,
} = require("../../business-logic/handlers/handler-factory");

describe("EVM Handler", () => {
  // Sample EVM transaction data (unsigned EIP-1559 transaction)
  // This is a minimal valid transaction for testing
  const sampleUnsignedTxHex = "02e901808080808080808080c0"; // Type 2 tx with minimal fields

  // A more realistic unsigned transaction (chain ID 1, to address, value)
  // Type 0 legacy transaction: chainId=1, nonce=0, gasPrice=1gwei, gasLimit=21000, to=0x..., value=0.01 eth
  const legacyUnsignedTx =
    "e9808504a817c8008252089400000000000000000000000000000000000000008080018080";

  describe("isEvmBlockchain", () => {
    it("should return true for Ethereum", () => {
      expect(isEvmBlockchain("ethereum")).toBe(true);
      expect(isEvmBlockchain("Ethereum")).toBe(true);
      expect(isEvmBlockchain("ETHEREUM")).toBe(true);
    });

    it("should return true for Polygon", () => {
      expect(isEvmBlockchain("polygon")).toBe(true);
    });

    it("should return true for Arbitrum", () => {
      expect(isEvmBlockchain("arbitrum")).toBe(true);
    });

    it("should return true for Optimism", () => {
      expect(isEvmBlockchain("optimism")).toBe(true);
    });

    it("should return true for Base", () => {
      expect(isEvmBlockchain("base")).toBe(true);
    });

    it("should return true for Avalanche", () => {
      expect(isEvmBlockchain("avalanche")).toBe(true);
    });

    it("should return false for Stellar", () => {
      expect(isEvmBlockchain("stellar")).toBe(false);
    });

    it("should return false for Solana", () => {
      expect(isEvmBlockchain("solana")).toBe(false);
    });

    it("should return false for unknown chains", () => {
      expect(isEvmBlockchain("unknown")).toBe(false);
      expect(isEvmBlockchain("")).toBe(false);
    });
  });

  describe("EVM_BLOCKCHAINS constant", () => {
    it("should contain all EVM chains", () => {
      expect(EVM_BLOCKCHAINS).toContain("ethereum");
      expect(EVM_BLOCKCHAINS).toContain("polygon");
      expect(EVM_BLOCKCHAINS).toContain("arbitrum");
      expect(EVM_BLOCKCHAINS).toContain("optimism");
      expect(EVM_BLOCKCHAINS).toContain("base");
      expect(EVM_BLOCKCHAINS).toContain("avalanche");
      expect(EVM_BLOCKCHAINS).toContain("onemoney");
    });

    it("should have 7 chains", () => {
      expect(EVM_BLOCKCHAINS.length).toBe(7);
    });
  });

  describe("createEvmHandler factory", () => {
    it("should create handler for Ethereum", () => {
      const handler = createEvmHandler("ethereum");
      expect(handler).toBeInstanceOf(EvmHandler);
      expect(handler.blockchain).toBe("ethereum");
    });

    it("should create handler for Polygon", () => {
      const handler = createEvmHandler("polygon");
      expect(handler).toBeInstanceOf(EvmHandler);
      expect(handler.blockchain).toBe("polygon");
    });

    it("should throw for unknown blockchain", () => {
      expect(() => createEvmHandler("unknown")).toThrow();
    });
  });

  describe("EvmHandler class", () => {
    let handler;

    beforeEach(() => {
      handler = new EvmHandler("ethereum");
    });

    describe("constructor", () => {
      it("should set blockchain property", () => {
        expect(handler.blockchain).toBe("ethereum");
      });

      it("should load config from registry", () => {
        expect(handler.config).toBeDefined();
        expect(handler.config.name).toBe("Ethereum");
      });
    });

    describe("isValidPublicKey (address validation)", () => {
      it("should accept valid EVM address", () => {
        expect(
          handler.isValidPublicKey(
            "0x742d35Cc6634C0532925a3b844Bc9e7595f8fEc5",
          ),
        ).toBe(true);
      });

      it("should accept lowercase address", () => {
        expect(
          handler.isValidPublicKey(
            "0x742d35cc6634c0532925a3b844bc9e7595f8fec5",
          ),
        ).toBe(true);
      });

      it("should accept uppercase address", () => {
        expect(
          handler.isValidPublicKey(
            "0x742D35CC6634C0532925A3B844BC9E7595F8FEC5",
          ),
        ).toBe(true);
      });

      it("should reject address without 0x prefix", () => {
        expect(
          handler.isValidPublicKey("742d35Cc6634C0532925a3b844Bc9e7595f8fEc5"),
        ).toBe(false);
      });

      it("should reject short address", () => {
        expect(
          handler.isValidPublicKey("0x742d35Cc6634C0532925a3b844Bc9e759"),
        ).toBe(false);
      });

      it("should reject long address", () => {
        expect(
          handler.isValidPublicKey(
            "0x742d35Cc6634C0532925a3b844Bc9e7595f8fEc5ab",
          ),
        ).toBe(false);
      });

      it("should reject non-hex characters", () => {
        expect(
          handler.isValidPublicKey(
            "0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
          ),
        ).toBe(false);
      });

      it("should reject null/undefined", () => {
        expect(handler.isValidPublicKey(null)).toBe(false);
        expect(handler.isValidPublicKey(undefined)).toBe(false);
      });

      it("should reject non-string", () => {
        expect(handler.isValidPublicKey(123)).toBe(false);
        expect(handler.isValidPublicKey({})).toBe(false);
      });
    });

    describe("normalizeNetworkName", () => {
      it("should return mainnet as default for null/undefined", () => {
        expect(handler.normalizeNetworkName(undefined)).toBe("mainnet");
        expect(handler.normalizeNetworkName(null)).toBe("mainnet");
        // Empty string also defaults to mainnet
        expect(handler.normalizeNetworkName("")).toBe("mainnet");
      });

      it("should lowercase network names", () => {
        expect(handler.normalizeNetworkName("Mainnet")).toBe("mainnet");
        expect(handler.normalizeNetworkName("SEPOLIA")).toBe("sepolia");
      });
    });

    describe("getNetworkConfig", () => {
      it("should return mainnet config", () => {
        const config = handler.getNetworkConfig("mainnet");
        expect(config).toBeDefined();
        expect(config.chainId).toBe(1);
        expect(config.isTestnet).toBe(false);
      });

      it("should return sepolia config", () => {
        const config = handler.getNetworkConfig("sepolia");
        expect(config).toBeDefined();
        expect(config.chainId).toBe(11155111);
        expect(config.isTestnet).toBe(true);
      });

      it("should return null for unknown network", () => {
        const config = handler.getNetworkConfig("unknownnet");
        expect(config).toBeNull();
      });
    });

    describe("getChainId", () => {
      it("should return chain ID for mainnet", () => {
        expect(handler.getChainId("mainnet")).toBe(1);
      });

      it("should return chain ID for sepolia", () => {
        expect(handler.getChainId("sepolia")).toBe(11155111);
      });

      it("should return null for unknown network", () => {
        expect(handler.getChainId("unknown")).toBeNull();
      });
    });

    describe("getTransactionType", () => {
      it("should identify legacy transactions", () => {
        expect(handler.getTransactionType({ type: 0 })).toBe("Legacy");
      });

      it("should identify EIP-2930 transactions", () => {
        expect(handler.getTransactionType({ type: 1 })).toBe(
          "EIP-2930 (Access List)",
        );
      });

      it("should identify EIP-1559 transactions", () => {
        expect(handler.getTransactionType({ type: 2 })).toBe(
          "EIP-1559 (Dynamic Fee)",
        );
      });

      it("should handle unknown types", () => {
        expect(handler.getTransactionType({ type: 99 })).toBe("Unknown");
      });
    });
  });

  describe("Handler Factory Integration", () => {
    it("should include EVM chains in implemented blockchains", () => {
      const implemented = getImplementedBlockchains();
      expect(implemented).toContain("stellar");
      expect(implemented).toContain("ethereum");
      expect(implemented).toContain("polygon");
      expect(implemented).toContain("arbitrum");
      expect(implemented).toContain("optimism");
      expect(implemented).toContain("base");
      expect(implemented).toContain("avalanche");
    });

    it("should have handler for Ethereum", () => {
      expect(hasHandler("ethereum")).toBe(true);
    });

    it("should have handler for Polygon", () => {
      expect(hasHandler("polygon")).toBe(true);
    });

    it("should have handler for Arbitrum", () => {
      expect(hasHandler("arbitrum")).toBe(true);
    });

    it("should have handler for Optimism", () => {
      expect(hasHandler("optimism")).toBe(true);
    });

    it("should have handler for Base", () => {
      expect(hasHandler("base")).toBe(true);
    });

    it("should have handler for Avalanche", () => {
      expect(hasHandler("avalanche")).toBe(true);
    });

    it("should get EVM handler via factory", () => {
      const handler = getHandler("ethereum");
      expect(handler).toBeDefined();
      expect(handler.blockchain).toBe("ethereum");
    });

    it("should get different handlers for different chains", () => {
      const ethHandler = getHandler("ethereum");
      const polyHandler = getHandler("polygon");

      expect(ethHandler.blockchain).toBe("ethereum");
      expect(polyHandler.blockchain).toBe("polygon");
    });
  });

  describe("EVM Handler for different chains", () => {
    const chains = [
      { name: "ethereum", mainnetChainId: 1 },
      { name: "polygon", mainnetChainId: 137 },
      { name: "arbitrum", mainnetChainId: 42161 },
      { name: "optimism", mainnetChainId: 10 },
      { name: "base", mainnetChainId: 8453 },
      { name: "avalanche", mainnetChainId: 43114 },
    ];

    chains.forEach(({ name, mainnetChainId }) => {
      describe(`${name} handler`, () => {
        let handler;

        beforeEach(() => {
          handler = createEvmHandler(name);
        });

        it(`should create handler for ${name}`, () => {
          expect(handler.blockchain).toBe(name);
        });

        it(`should return correct mainnet chain ID`, () => {
          expect(handler.getChainId("mainnet")).toBe(mainnetChainId);
        });

        it("should validate EVM addresses", () => {
          expect(
            handler.isValidPublicKey(
              "0x742d35Cc6634C0532925a3b844Bc9e7595f8fEc5",
            ),
          ).toBe(true);
        });
      });
    });
  });
});
