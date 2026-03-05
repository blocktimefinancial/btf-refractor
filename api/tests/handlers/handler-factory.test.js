/**
 * Tests for Handler Factory
 *
 * Tests the blockchain handler factory and routing logic.
 */

const {
  getHandler,
  hasHandler,
  getImplementedBlockchains,
  parseTransaction,
  computeHash,
  isValidPublicKey,
} = require("../../business-logic/handlers/handler-factory");

describe("Handler Factory", () => {
  describe("getHandler()", () => {
    it("should return Stellar handler for stellar blockchain", () => {
      const handler = getHandler("stellar");
      expect(handler).toBeDefined();
      expect(handler.blockchain).toBe("stellar");
    });

    it("should return same handler for case variations", () => {
      const handler1 = getHandler("stellar");
      const handler2 = getHandler("STELLAR");
      const handler3 = getHandler("Stellar");
      expect(handler1).toBe(handler2);
      expect(handler2).toBe(handler3);
    });

    it("should throw for unsupported blockchain", () => {
      expect(() => {
        getHandler("unsupported-chain");
      }).toThrow(/Unsupported blockchain/);
    });

    it("should throw 501 for recognized but unimplemented blockchain", () => {
      // Bitcoin is recognized in the registry but has no handler yet
      try {
        getHandler("bitcoin");
        fail("Should have thrown");
      } catch (e) {
        expect(e.status).toBe(501);
        expect(e.message).toContain("not yet implemented");
      }
    });

    it("should return EVM handler for Ethereum", () => {
      const handler = getHandler("ethereum");
      expect(handler).toBeDefined();
      expect(handler.blockchain).toBe("ethereum");
    });

    it("should return EVM handlers for all EVM chains", () => {
      const evmChains = [
        "polygon",
        "arbitrum",
        "optimism",
        "base",
        "avalanche",
      ];
      for (const chain of evmChains) {
        const handler = getHandler(chain);
        expect(handler).toBeDefined();
        expect(handler.blockchain).toBe(chain);
      }
    });

    it("should return 1Money handler for onemoney", () => {
      const handler = getHandler("onemoney");
      expect(handler).toBeDefined();
      expect(handler.blockchain).toBe("onemoney");
    });
  });

  describe("hasHandler()", () => {
    it("should return true for Stellar", () => {
      expect(hasHandler("stellar")).toBe(true);
    });

    it("should return true for 1Money", () => {
      expect(hasHandler("onemoney")).toBe(true);
    });

    it("should return true for Ethereum", () => {
      expect(hasHandler("ethereum")).toBe(true);
    });

    it("should return true for all EVM chains", () => {
      expect(hasHandler("polygon")).toBe(true);
      expect(hasHandler("arbitrum")).toBe(true);
      expect(hasHandler("optimism")).toBe(true);
      expect(hasHandler("base")).toBe(true);
      expect(hasHandler("avalanche")).toBe(true);
    });

    it("should return true for Solana", () => {
      expect(hasHandler("solana")).toBe(true);
    });

    it("should return false for unimplemented blockchain", () => {
      expect(hasHandler("cardano")).toBe(false);
    });

    it("should return false for unknown blockchain", () => {
      expect(hasHandler("unknown")).toBe(false);
    });

    it("should be case insensitive", () => {
      expect(hasHandler("STELLAR")).toBe(true);
      expect(hasHandler("Stellar")).toBe(true);
      expect(hasHandler("ETHEREUM")).toBe(true);
    });
  });

  describe("getImplementedBlockchains()", () => {
    it("should return array with stellar", () => {
      const blockchains = getImplementedBlockchains();
      expect(Array.isArray(blockchains)).toBe(true);
      expect(blockchains).toContain("stellar");
    });

    it("should return array with onemoney", () => {
      const blockchains = getImplementedBlockchains();
      expect(blockchains).toContain("onemoney");
    });

    it("should return array with EVM chains", () => {
      const blockchains = getImplementedBlockchains();
      expect(blockchains).toContain("ethereum");
      expect(blockchains).toContain("polygon");
      expect(blockchains).toContain("arbitrum");
      expect(blockchains).toContain("optimism");
      expect(blockchains).toContain("base");
      expect(blockchains).toContain("avalanche");
    });

    it("should return array with solana", () => {
      const blockchains = getImplementedBlockchains();
      expect(blockchains).toContain("solana");
    });
  });

  describe("isValidPublicKey()", () => {
    it("should validate Stellar public key through factory", () => {
      const validKey =
        "GBJVUCDVNUM3UASLDXPBDXLHJBSVOEGTJX5J6P3JD7DQKVQCYCBY5PP2";
      expect(isValidPublicKey("stellar", validKey)).toBe(true);
    });

    it("should reject invalid Stellar public key", () => {
      expect(isValidPublicKey("stellar", "invalid")).toBe(false);
    });
  });
});
