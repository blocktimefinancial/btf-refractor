/**
 * Tests for Transaction Submitter
 *
 * Tests the blockchain-agnostic transaction submission routing.
 */

const {
  submitTransaction,
  isSubmissionSupported,
  getSupportedSubmissionBlockchains,
} = require("../../business-logic/finalization/tx-submitter");

// Mock the horizon handler
jest.mock("../../business-logic/finalization/horizon-handler", () => ({
  submitTransaction: jest.fn().mockResolvedValue({ result: "success" }),
}));

describe("Transaction Submitter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("isSubmissionSupported()", () => {
    it("should return true for Stellar", () => {
      expect(isSubmissionSupported("stellar")).toBe(true);
    });

    it("should return true for Stellar (case insensitive)", () => {
      expect(isSubmissionSupported("STELLAR")).toBe(true);
      expect(isSubmissionSupported("Stellar")).toBe(true);
    });

    it("should return true for Ethereum", () => {
      expect(isSubmissionSupported("ethereum")).toBe(true);
    });

    it("should return true for all EVM chains", () => {
      expect(isSubmissionSupported("polygon")).toBe(true);
      expect(isSubmissionSupported("arbitrum")).toBe(true);
      expect(isSubmissionSupported("optimism")).toBe(true);
      expect(isSubmissionSupported("base")).toBe(true);
      expect(isSubmissionSupported("avalanche")).toBe(true);
    });

    it("should return false for unknown blockchain", () => {
      expect(isSubmissionSupported("unknown")).toBe(false);
    });
  });

  describe("getSupportedSubmissionBlockchains()", () => {
    it("should return array with stellar", () => {
      const blockchains = getSupportedSubmissionBlockchains();
      expect(Array.isArray(blockchains)).toBe(true);
      expect(blockchains).toContain("stellar");
    });

    it("should return array with EVM chains", () => {
      const blockchains = getSupportedSubmissionBlockchains();
      expect(blockchains).toContain("ethereum");
      expect(blockchains).toContain("polygon");
      expect(blockchains).toContain("arbitrum");
      expect(blockchains).toContain("optimism");
      expect(blockchains).toContain("base");
      expect(blockchains).toContain("avalanche");
    });
  });

  describe("submitTransaction()", () => {
    const horizonHandler = require("../../business-logic/finalization/horizon-handler");

    it("should route Stellar transactions to horizon handler", async () => {
      const txInfo = {
        hash: "abc123",
        blockchain: "stellar",
        network: 1,
        xdr: "test-xdr",
      };

      await submitTransaction(txInfo);

      expect(horizonHandler.submitTransaction).toHaveBeenCalledWith(txInfo);
    });

    it("should default to Stellar when blockchain not specified", async () => {
      const txInfo = {
        hash: "abc123",
        network: 1,
        xdr: "test-xdr",
      };

      await submitTransaction(txInfo);

      expect(horizonHandler.submitTransaction).toHaveBeenCalledWith(txInfo);
    });

    it("should throw error for EVM chain without RPC endpoint configured", async () => {
      const txInfo = {
        hash: "abc123",
        blockchain: "ethereum",
        networkName: "sepolia",
        payload: "0xabc",
      };

      await expect(submitTransaction(txInfo)).rejects.toThrow(
        /No RPC endpoint configured/
      );
    });

    it("should throw UnsupportedBlockchainError for unknown blockchain", async () => {
      const txInfo = {
        hash: "abc123",
        blockchain: "unknown-chain",
        networkName: "mainnet",
        payload: "abc",
      };

      await expect(submitTransaction(txInfo)).rejects.toThrow(
        /Unsupported blockchain/
      );
    });
  });

  describe("EVM submission error propagation", () => {
    const { submitEvmTransaction } = require("../../business-logic/finalization/tx-submitter");
    let originalFetch;
    let originalEnv;

    beforeEach(() => {
      originalFetch = global.fetch;
      originalEnv = process.env.ETHEREUM_RPC_URL;
      // Provide an RPC URL so the function reaches the fetch call
      process.env.ETHEREUM_RPC_URL = "https://rpc.test.example.com";
    });

    afterEach(() => {
      global.fetch = originalFetch;
      if (originalEnv !== undefined) {
        process.env.ETHEREUM_RPC_URL = originalEnv;
      } else {
        delete process.env.ETHEREUM_RPC_URL;
      }
    });

    it("should throw when EVM RPC returns an error response", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        json: () => Promise.resolve({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32000, message: "insufficient funds" },
        }),
      });

      const txInfo = {
        hash: "evm-test-hash",
        blockchain: "ethereum",
        networkName: "mainnet",
        payload: "0xabc123",
      };

      await expect(submitEvmTransaction(txInfo)).rejects.toThrow("insufficient funds");
    });

    it("should throw when EVM RPC network call fails", async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));

      const txInfo = {
        hash: "evm-test-hash-2",
        blockchain: "ethereum",
        networkName: "mainnet",
        payload: "0xabc123",
      };

      await expect(submitEvmTransaction(txInfo)).rejects.toThrow("ECONNREFUSED");
    });

    it("should not silently swallow RPC errors", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        json: () => Promise.resolve({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32603, message: "nonce too low" },
        }),
      });

      const txInfo = {
        hash: "evm-test-hash-3",
        blockchain: "ethereum",
        networkName: "mainnet",
        payload: "0xdef456",
      };

      // Must throw — never return a txInfo with status "failed"
      const promise = submitEvmTransaction(txInfo);
      await expect(promise).rejects.toThrow();
      // Verify it throws with the error message, not silently returns
      await expect(submitEvmTransaction({...txInfo})).rejects.toThrow("nonce too low");
    });
  });
});
