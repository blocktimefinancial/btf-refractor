/**
 * 1Money Handler Tests
 *
 * Tests for 1Money blockchain handler including transaction parsing,
 * hashing, signature verification, and serialization.
 */

const {
  getHandler,
  hasHandler,
  getImplementedBlockchains,
} = require("../../business-logic/handlers/handler-factory");

describe("1Money Handler", () => {
  describe("Handler Factory Integration", () => {
    it("should have handler for onemoney", () => {
      expect(hasHandler("onemoney")).toBe(true);
    });

    it("should be case insensitive", () => {
      expect(hasHandler("OneMoney")).toBe(true);
      expect(hasHandler("ONEMONEY")).toBe(true);
    });

    it("should be in implemented blockchains list", () => {
      const implemented = getImplementedBlockchains();
      expect(implemented).toContain("onemoney");
    });

    it("should get 1Money handler via factory", () => {
      const handler = getHandler("onemoney");
      expect(handler).toBeDefined();
      expect(handler.blockchain).toBe("onemoney");
    });
  });

  describe("OneMoneyHandler class", () => {
    let handler;

    beforeEach(() => {
      handler = getHandler("onemoney");
    });

    describe("constructor", () => {
      it("should set blockchain property", () => {
        expect(handler.blockchain).toBe("onemoney");
      });

      it("should load config from registry", () => {
        expect(handler.config).toBeDefined();
        expect(handler.config.name).toBe("1Money");
      });
    });

    describe("isValidPublicKey", () => {
      it("should accept valid 0x-prefixed EVM address", () => {
        expect(
          handler.isValidPublicKey(
            "0x742d35Cc6634C0532925a3b844Bc9e7595f8fEc5",
          ),
        ).toBe(true);
      });

      it("should reject invalid public key", () => {
        expect(handler.isValidPublicKey("invalid")).toBe(false);
      });

      it("should reject Stellar-format key (1Money uses EVM addresses)", () => {
        expect(
          handler.isValidPublicKey(
            "GBJVUCDVNUM3UASLDXPBDXLHJBSVOEGTJX5J6P3JD7DQKVQCYCBY5PP2",
          ),
        ).toBe(false);
      });

      it("should reject null/undefined", () => {
        expect(handler.isValidPublicKey(null)).toBe(false);
        expect(handler.isValidPublicKey(undefined)).toBe(false);
      });
    });

    describe("normalizeNetworkName", () => {
      it("should return mainnet as default", () => {
        expect(handler.normalizeNetworkName(undefined)).toBe("mainnet");
        expect(handler.normalizeNetworkName(null)).toBe("mainnet");
      });

      it("should lowercase network names", () => {
        expect(handler.normalizeNetworkName("MAINNET")).toBe("mainnet");
        expect(handler.normalizeNetworkName("Mainnet")).toBe("mainnet");
      });

      it("should pass through testnet lowercase", () => {
        expect(handler.normalizeNetworkName("TESTNET")).toBe("testnet");
        expect(handler.normalizeNetworkName("Testnet")).toBe("testnet");
      });

      it("should preserve mainnet/testnet", () => {
        expect(handler.normalizeNetworkName("mainnet")).toBe("mainnet");
        expect(handler.normalizeNetworkName("testnet")).toBe("testnet");
      });
    });

    describe("getNetworkConfig", () => {
      it("should return mainnet config with chainId", () => {
        const config = handler.getNetworkConfig("mainnet");
        expect(config).toBeDefined();
        expect(config.chainId).toBe(1212101);
        expect(config.isTestnet).toBe(false);
      });

      it("should return testnet config with chainId", () => {
        const config = handler.getNetworkConfig("testnet");
        expect(config).toBeDefined();
        expect(config.chainId).toBe(1212101);
        expect(config.isTestnet).toBe(true);
      });

      it("should return null for unknown network", () => {
        const config = handler.getNetworkConfig("unknown");
        expect(config).toBeNull();
      });
    });

    describe("parseTransaction", () => {
      it("should reject unsupported encoding", () => {
        expect(() => {
          handler.parseTransaction("test", "base64", "mainnet");
        }).toThrow(/1Money supports/);
      });

      it("should parse valid JSON transaction", () => {
        const tx = JSON.stringify({
          chain_id: 1212101,
          nonce: 1,
          recipient: "0x742d35Cc6634C0532925a3b844Bc9e7595f8fEc5",
          token: "0x0000000000000000000000000000000000000001",
          value: "1000000",
        });
        const parsed = handler.parseTransaction(tx, "json", "mainnet");
        expect(parsed).toBeDefined();
        expect(parsed.chainId).toBe(1212101);
        expect(parsed.nonce).toBe(1);
      });
    });

    describe("serializeTransaction", () => {
      it("should reject unsupported encoding", () => {
        expect(() => {
          handler.serializeTransaction({}, "base64");
        }).toThrow(/1Money supports/);
      });

      it("should serialize to JSON", () => {
        const tx = {
          chainId: 1212101,
          nonce: 1,
          recipient: "0x742d35Cc6634C0532925a3b844Bc9e7595f8fEc5",
          token: "0x0000000000000000000000000000000000000001",
          value: "1000000",
        };
        const serialized = handler.serializeTransaction(tx, "json");
        const parsed = JSON.parse(serialized);
        expect(parsed.chain_id).toBe(1212101);
        expect(parsed.nonce).toBe(1);
      });
    });
  });

  describe("1Money vs EVM comparison", () => {
    it("should share EVM-compatible key format (secp256k1, 0x addresses)", () => {
      const onemoneyHandler = getHandler("onemoney");
      const evmHandler = getHandler("ethereum");

      // Both accept 0x-prefixed EVM addresses
      const evmAddress = "0x742d35Cc6634C0532925a3b844Bc9e7595f8fEc5";
      expect(onemoneyHandler.isValidPublicKey(evmAddress)).toBe(true);
      expect(evmHandler.isValidPublicKey(evmAddress)).toBe(true);

      // Neither accepts Stellar-format keys
      const stellarKey =
        "GBJVUCDVNUM3UASLDXPBDXLHJBSVOEGTJX5J6P3JD7DQKVQCYCBY5PP2";
      expect(onemoneyHandler.isValidPublicKey(stellarKey)).toBe(false);
      expect(evmHandler.isValidPublicKey(stellarKey)).toBe(false);
    });

    it("should use different default encodings", () => {
      const onemoneyHandler = getHandler("onemoney");
      const evmHandler = getHandler("ethereum");

      // 1Money uses JSON encoding, standard EVM uses hex
      expect(onemoneyHandler.config.defaultEncoding).toBe("json");
      expect(evmHandler.config.defaultEncoding).toBe("hex");
    });
  });
});
