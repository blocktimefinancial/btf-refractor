/**
 * Tests for Originator Verification
 */

const {
  isValidOriginator,
  verifyOriginatorSignature,
  validateOriginator,
  checkOriginatorStatus,
  decodeSignature,
  isEvmBlockchain,
} = require("../../business-logic/originator-verifier");

// Mock the handler-factory
jest.mock("../../business-logic/handlers/handler-factory", () => ({
  hasHandler: jest.fn((blockchain) => {
    return ["stellar", "ethereum", "onemoney"].includes(blockchain);
  }),
  getHandler: jest.fn((blockchain) => {
    if (blockchain === "stellar" || blockchain === "onemoney") {
      return {
        isValidPublicKey: (key) => /^G[A-Z2-7]{55}$/.test(key),
        verifySignature: jest.fn((publicKey, signature, message) => {
          // Mock verification - return true for valid test signature
          return (
            publicKey ===
              "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF" &&
            signature.length === 64
          );
        }),
      };
    }
    if (blockchain === "ethereum") {
      return {
        isValidPublicKey: (key) => /^0x[a-fA-F0-9]{40}$/.test(key),
        verifySignature: jest.fn((address, signature, message) => {
          // Mock verification - return true for valid test signature
          return (
            address === "0x1234567890123456789012345678901234567890" &&
            signature.length > 0
          );
        }),
      };
    }
    return null;
  }),
}));

describe("Originator Verifier", () => {
  // Valid test keys
  const validStellarKey =
    "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  const validEthAddress = "0x1234567890123456789012345678901234567890";
  const testHash = "a".repeat(64);
  const testHashBuffer = Buffer.from(testHash, "hex");

  describe("isEvmBlockchain()", () => {
    it("should return true for EVM chains", () => {
      expect(isEvmBlockchain("ethereum")).toBe(true);
      expect(isEvmBlockchain("polygon")).toBe(true);
      expect(isEvmBlockchain("arbitrum")).toBe(true);
      expect(isEvmBlockchain("optimism")).toBe(true);
      expect(isEvmBlockchain("base")).toBe(true);
      expect(isEvmBlockchain("avalanche")).toBe(true);
    });

    it("should return false for non-EVM chains", () => {
      expect(isEvmBlockchain("stellar")).toBe(false);
      expect(isEvmBlockchain("solana")).toBe(false);
      expect(isEvmBlockchain("onemoney")).toBe(false);
    });
  });

  describe("decodeSignature()", () => {
    it("should decode base64 signature for Stellar", () => {
      const base64Sig = Buffer.from("test signature").toString("base64");
      const result = decodeSignature("stellar", base64Sig);
      expect(result.toString()).toBe("test signature");
    });

    it("should decode hex signature with 0x prefix for EVM", () => {
      const hexSig = "0x" + Buffer.from("test").toString("hex");
      const result = decodeSignature("ethereum", hexSig);
      expect(result.toString()).toBe("test");
    });

    it("should decode hex signature without 0x prefix for EVM", () => {
      const hexSig = Buffer.from("test").toString("hex");
      const result = decodeSignature("ethereum", hexSig);
      expect(result.toString()).toBe("test");
    });
  });

  describe("isValidOriginator()", () => {
    it("should return true for valid Stellar key", () => {
      expect(isValidOriginator("stellar", validStellarKey)).toBe(true);
    });

    it("should return true for valid Ethereum address", () => {
      expect(isValidOriginator("ethereum", validEthAddress)).toBe(true);
    });

    it("should return false for invalid key format", () => {
      expect(isValidOriginator("stellar", "invalid")).toBe(false);
      expect(isValidOriginator("ethereum", "invalid")).toBe(false);
    });

    it("should return false for null or undefined", () => {
      expect(isValidOriginator("stellar", null)).toBe(false);
      expect(isValidOriginator("stellar", undefined)).toBe(false);
    });

    it("should return false for unsupported blockchain", () => {
      expect(isValidOriginator("unsupported", validStellarKey)).toBe(false);
    });
  });

  describe("verifyOriginatorSignature()", () => {
    it("should return false if originator is missing", () => {
      expect(verifyOriginatorSignature("stellar", null, "sig", testHash)).toBe(
        false
      );
    });

    it("should return false if signature is missing", () => {
      expect(
        verifyOriginatorSignature("stellar", validStellarKey, null, testHash)
      ).toBe(false);
    });

    it("should return false for unsupported blockchain", () => {
      expect(
        verifyOriginatorSignature("unsupported", "key", "sig", testHash)
      ).toBe(false);
    });

    it("should verify valid Stellar signature", () => {
      // Create a 64-byte signature (mock expects this length)
      const validSig = Buffer.alloc(64).toString("base64");
      const result = verifyOriginatorSignature(
        "stellar",
        validStellarKey,
        validSig,
        testHash
      );
      expect(result).toBe(true);
    });

    it("should verify with Buffer hash", () => {
      const validSig = Buffer.alloc(64).toString("base64");
      const result = verifyOriginatorSignature(
        "stellar",
        validStellarKey,
        validSig,
        testHashBuffer
      );
      expect(result).toBe(true);
    });

    it("should return false for invalid signature", () => {
      const invalidSig = "short";
      const result = verifyOriginatorSignature(
        "stellar",
        validStellarKey,
        invalidSig,
        testHash
      );
      expect(result).toBe(false);
    });
  });

  describe("validateOriginator()", () => {
    it("should not throw if originator is not required and not provided", () => {
      expect(() => {
        validateOriginator("stellar", null, null, testHash, {
          requireOriginator: false,
        });
      }).not.toThrow();
    });

    it("should throw if originator is required but not provided", () => {
      expect(() => {
        validateOriginator("stellar", null, null, testHash, {
          requireOriginator: true,
        });
      }).toThrow(/Originator is required/);
    });

    it("should throw for invalid originator key format", () => {
      expect(() => {
        validateOriginator("stellar", "invalid-key", null, testHash);
      }).toThrow(/Invalid originator key format/);
    });

    it("should throw for invalid signature when verification enabled", () => {
      expect(() => {
        validateOriginator(
          "stellar",
          validStellarKey,
          "invalid-sig",
          testHash,
          { verifySignature: true }
        );
      }).toThrow(/Invalid originator signature/);
    });

    it("should not verify signature when verification disabled", () => {
      expect(() => {
        validateOriginator("stellar", validStellarKey, "any-sig", testHash, {
          verifySignature: false,
        });
      }).not.toThrow();
    });

    it("should pass for valid originator and signature", () => {
      const validSig = Buffer.alloc(64).toString("base64");
      expect(() => {
        validateOriginator("stellar", validStellarKey, validSig, testHash, {
          verifySignature: true,
        });
      }).not.toThrow();
    });
  });

  describe("checkOriginatorStatus()", () => {
    it("should return hasOriginator=false when no originator", () => {
      const result = checkOriginatorStatus({
        blockchain: "stellar",
        originator: null,
        originatorSignature: null,
        hash: testHash,
      });
      expect(result.hasOriginator).toBe(false);
      expect(result.isVerified).toBe(false);
    });

    it("should return hasOriginator=true, isVerified=false when no signature", () => {
      const result = checkOriginatorStatus({
        blockchain: "stellar",
        originator: validStellarKey,
        originatorSignature: null,
        hash: testHash,
      });
      expect(result.hasOriginator).toBe(true);
      expect(result.isVerified).toBe(false);
    });

    it("should return isVerified=true for valid signature", () => {
      const validSig = Buffer.alloc(64).toString("base64");
      const result = checkOriginatorStatus({
        blockchain: "stellar",
        originator: validStellarKey,
        originatorSignature: validSig,
        hash: testHash,
      });
      expect(result.hasOriginator).toBe(true);
      expect(result.isVerified).toBe(true);
    });

    it("should return isVerified=false for invalid signature", () => {
      const result = checkOriginatorStatus({
        blockchain: "stellar",
        originator: validStellarKey,
        originatorSignature: "invalid",
        hash: testHash,
      });
      expect(result.hasOriginator).toBe(true);
      expect(result.isVerified).toBe(false);
    });
  });
});
