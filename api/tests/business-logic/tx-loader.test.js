const { rehydrateTx, loadRehydrateTx } = require("../../business-logic/tx-loader");

// Mock storageLayer
jest.mock("../../storage/storage-layer", () => ({
  dataProvider: {
    findTransaction: jest.fn(),
  },
}));

const storageLayer = require("../../storage/storage-layer");

describe("tx-loader", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── rehydrateTx ────────────────────────────────────────────
  describe("rehydrateTx", () => {
    it("rehydrates a stellar transaction with network and xdr", () => {
      const txInfo = {
        hash: "abc123",
        network: 1,
        xdr: "AAAAAgAAAABTWgh1bRm6Aksd3hHdZ0hlVxDTTfqfP2kfxwVWAsCDjgAAAGQAAAAAAAAAAQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAQAAAABTWgh1bRm6Aksd3hHdZ0hlVxDTTfqfP2kfxwVWAsCDjgAAAAAAAAAAAJiWgAAAAAAAAAAA",
        signatures: [],
        status: "pending",
        submit: false,
      };

      const result = rehydrateTx(txInfo);

      expect(result.network).toBe("testnet");
      expect(result.xdr).toBeDefined();
      expect(result.blockchain).toBe("stellar");
      expect(result.networkName).toBeDefined();
      expect(result.encoding).toBe("base64");
      expect(result.payload).toBeDefined();
      expect(result.txUri).toBeDefined();
      // hash is in the spread
      expect(result.hash).toBe("abc123");
    });

    it("adds signatures to the rehydrated transaction", () => {
      const txInfo = {
        hash: "abc123",
        network: 1,
        xdr: "AAAAAgAAAABTWgh1bRm6Aksd3hHdZ0hlVxDTTfqfP2kfxwVWAsCDjgAAAGQAAAAAAAAAAQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAQAAAABTWgh1bRm6Aksd3hHdZ0hlVxDTTfqfP2kfxwVWAsCDjgAAAAAAAAAAAJiWgAAAAAAAAAAA",
        signatures: [
          {
            key: "GBJVUCDVNUM3UASLDXPBDXLHJBSVOEGTJX5J6P3JD7DQKVQCYCBY5PP2",
            signature:
              "b1N3ZHZIjuxU+5Fgz1Kj65FntxUOK4V8fxePNmoIc1J5DESkBcPzWTs8ULLldhnqJo6I4+L+xSzZt8+yiwQDBQ==",
          },
        ],
        status: "ready",
      };

      const result = rehydrateTx(txInfo);

      expect(result.network).toBe("testnet");
      expect(result.xdr).toBeDefined();
      // XDR should be different (now has signature)
      expect(result.xdr).not.toBe(txInfo.xdr);
    });

    it("handles Buffer signatures", () => {
      const txInfo = {
        hash: "abc123",
        network: 1,
        xdr: "AAAAAgAAAABTWgh1bRm6Aksd3hHdZ0hlVxDTTfqfP2kfxwVWAsCDjgAAAGQAAAAAAAAAAQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAQAAAABTWgh1bRm6Aksd3hHdZ0hlVxDTTfqfP2kfxwVWAsCDjgAAAAAAAAAAAJiWgAAAAAAAAAAA",
        signatures: [
          {
            key: "GBJVUCDVNUM3UASLDXPBDXLHJBSVOEGTJX5J6P3JD7DQKVQCYCBY5PP2",
            signature: Buffer.from(
              "b1N3ZHZIjuxU+5Fgz1Kj65FntxUOK4V8fxePNmoIc1J5DESkBcPzWTs8ULLldhnqJo6I4+L+xSzZt8+yiwQDBQ==",
              "base64"
            ),
          },
        ],
        status: "ready",
      };

      const result = rehydrateTx(txInfo);
      expect(result.xdr).toBeDefined();
    });

    it("includes txJson if present", () => {
      const txInfo = {
        hash: "abc123",
        network: 0,
        xdr: "AAAAAgAAAABTWgh1bRm6Aksd3hHdZ0hlVxDTTfqfP2kfxwVWAsCDjgAAAGQAAAAAAAAAAQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAQAAAABTWgh1bRm6Aksd3hHdZ0hlVxDTTfqfP2kfxwVWAsCDjgAAAAAAAAAAAJiWgAAAAAAAAAAA",
        signatures: [],
        txJson: '{"fee":"100"}',
      };

      const result = rehydrateTx(txInfo);
      expect(result.txJson).toBe('{"fee":"100"}');
    });

    it("includes originator fields if present", () => {
      const txInfo = {
        hash: "abc123",
        network: 0,
        xdr: "AAAAAgAAAABTWgh1bRm6Aksd3hHdZ0hlVxDTTfqfP2kfxwVWAsCDjgAAAGQAAAAAAAAAAQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAQAAAABTWgh1bRm6Aksd3hHdZ0hlVxDTTfqfP2kfxwVWAsCDjgAAAAAAAAAAAJiWgAAAAAAAAAAA",
        signatures: [],
        originator: "GBJVUCDVNUM3UASLDXPBDXLHJBSVOEGTJX5J6P3JD7DQKVQCYCBY5PP2",
        originatorSignature: "somesig==",
      };

      const result = rehydrateTx(txInfo);
      expect(result.originator).toBe(
        "GBJVUCDVNUM3UASLDXPBDXLHJBSVOEGTJX5J6P3JD7DQKVQCYCBY5PP2"
      );
      expect(result.originatorSignature).toBe("somesig==");
    });

    it("handles non-stellar blockchain (generic)", () => {
      const txInfo = {
        hash: "abc123",
        blockchain: "ethereum",
        networkName: "mainnet",
        payload: "0xdeadbeef",
        encoding: "hex",
        txUri: "ethereum:mainnet/tx/abc123",
        signatures: [],
      };

      const result = rehydrateTx(txInfo);
      expect(result.blockchain).toBe("ethereum");
      expect(result.networkName).toBe("mainnet");
      expect(result.payload).toBe("0xdeadbeef");
      expect(result.encoding).toBe("hex");
      expect(result.txUri).toBe("ethereum:mainnet/tx/abc123");
    });

    it("keeps legacy xdr for non-stellar with xdr field", () => {
      const txInfo = {
        hash: "abc123",
        network: 0,
        blockchain: "ethereum",
        networkName: "mainnet",
        xdr: "legacy-xdr-data",
        payload: "0xdeadbeef",
        encoding: "hex",
        signatures: [],
      };

      const result = rehydrateTx(txInfo);
      expect(result.xdr).toBe("legacy-xdr-data");
      expect(result.network).toBe("public");
    });
  });

  // ─── loadRehydrateTx ────────────────────────────────────────
  describe("loadRehydrateTx", () => {
    it("loads and rehydrates a transaction from storage", async () => {
      storageLayer.dataProvider.findTransaction.mockResolvedValue({
        hash: "abc123",
        network: 1,
        xdr: "AAAAAgAAAABTWgh1bRm6Aksd3hHdZ0hlVxDTTfqfP2kfxwVWAsCDjgAAAGQAAAAAAAAAAQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAQAAAABTWgh1bRm6Aksd3hHdZ0hlVxDTTfqfP2kfxwVWAsCDjgAAAAAAAAAAAJiWgAAAAAAAAAAA",
        signatures: [],
        status: "pending",
      });

      const result = await loadRehydrateTx("abc123");
      expect(storageLayer.dataProvider.findTransaction).toHaveBeenCalledWith(
        "abc123"
      );
      expect(result.hash).toBe("abc123");
      expect(result.network).toBe("testnet");
    });

    it("rejects with 404 when transaction not found", async () => {
      storageLayer.dataProvider.findTransaction.mockResolvedValue(null);

      await expect(loadRehydrateTx("nonexistent")).rejects.toMatchObject({
        status: 404,
      });
    });
  });
});
