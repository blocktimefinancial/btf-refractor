/**
 * HSM Signing Adapter Tests
 *
 * Unit tests for the HSM signing adapter with fully mocked HSM providers.
 * Validates all blockchain signing paths, key creation, health checks,
 * error handling, and dependency injection.
 */

const HsmSigningAdapter = require("../../business-logic/hsm-signing-adapter");

// ── Mock Providers ──────────────────────────────────────────────────

function createMockHsmKeyStore() {
  return {
    signStellarTransaction: jest.fn().mockResolvedValue("signed-xdr-base64"),
    signAlgorandTransaction: jest.fn().mockResolvedValue({
      signedTxn: new Uint8Array(64),
      txId: "ALGO_TX_ID_123",
      address: "MFRGGMIJDQSGCZLPMFRSQ",
    }),
    signAlgorandData: jest.fn().mockResolvedValue({
      signature: "base64sig==",
      address: "MFRGGMIJDQSGCZLPMFRSQ",
    }),
    signSolanaTransaction: jest.fn().mockResolvedValue({
      signature: Buffer.alloc(64, 0xab),
      publicKey: "3FhjakEKmij2VBrvpS98ePNzg4K5Lfe8Rx6TSwYZTqvN",
    }),
    signEthereumTransaction: jest.fn().mockResolvedValue({
      v: 28,
      r: "0xabc",
      s: "0xdef",
      hash: "0x123",
      from: "0x742d35Cc6634C0532925a3b844Bc9e7595f8fEc5",
    }),
    createStellarKey: jest.fn().mockResolvedValue({
      keyId: "key_stellar_001",
      publicKey: "GABCD...",
    }),
    createEthereumKey: jest.fn().mockResolvedValue({
      keyId: "key_eth_001",
      address: "0x742d35Cc6634C0532925a3b844Bc9e7595f8fEc5",
    }),
    createSolanaKey: jest.fn().mockResolvedValue({
      keyId: "key_sol_001",
      publicKey: "3FhjakEKmij2VBrvpS98ePNzg4K5Lfe8Rx6TSwYZTqvN",
    }),
    createAlgorandKey: jest.fn().mockResolvedValue({
      keyId: "key_algo_001",
      address: "MFRGGMIJDQSGCZLPMFRSQ",
      publicKey: "abcdef0123456789",
    }),
    healthCheck: jest.fn().mockResolvedValue({
      hsm: "connected",
      kekAvailable: true,
    }),
  };
}

function createMockAzureCryptoService() {
  return {
    signStellarTransaction: jest
      .fn()
      .mockResolvedValue("direct-signed-xdr-base64"),
  };
}

// ═════════════════════════════════════════════════════════════════════
//  Tests
// ═════════════════════════════════════════════════════════════════════

describe("HsmSigningAdapter", () => {
  let mockHsmKeyStore;
  let mockAzureCrypto;

  beforeEach(() => {
    mockHsmKeyStore = createMockHsmKeyStore();
    mockAzureCrypto = createMockAzureCryptoService();
  });

  // ── Constructor & Initialization ────────────────────────────────

  describe("constructor", () => {
    it("should initialize with default options (envelope tier)", () => {
      const adapter = new HsmSigningAdapter({
        hsmKeyStore: mockHsmKeyStore,
      });
      expect(adapter.tier).toBe("envelope");
      expect(adapter.dbName).toBe("refractor");
    });

    it("should accept direct tier with azureCryptoService", () => {
      const adapter = new HsmSigningAdapter({
        tier: "direct",
        azureCryptoService: mockAzureCrypto,
      });
      expect(adapter.tier).toBe("direct");
    });

    it("should accept custom dbName", () => {
      const adapter = new HsmSigningAdapter({
        dbName: "custom-db",
        hsmKeyStore: mockHsmKeyStore,
      });
      expect(adapter.dbName).toBe("custom-db");
    });

    it("should throw for invalid tier", () => {
      expect(
        () =>
          new HsmSigningAdapter({
            tier: "invalid",
            hsmKeyStore: mockHsmKeyStore,
          }),
      ).toThrow(/Invalid HSM tier/);
    });

    it("should throw if direct tier lacks azureCryptoService", () => {
      expect(
        () =>
          new HsmSigningAdapter({
            tier: "direct",
            azureCryptoService: null,
          }),
      ).toThrow(/requires azureCryptoService/);
    });

    it("should throw if envelope tier lacks hsmKeyStore", () => {
      expect(
        () =>
          new HsmSigningAdapter({
            tier: "envelope",
            hsmKeyStore: null,
          }),
      ).toThrow(/requires hsmKeyStore/);
    });
  });

  // ── Stellar Signing ─────────────────────────────────────────────

  describe("signStellarTransaction", () => {
    it("should sign via envelope encryption (tier 2)", async () => {
      const adapter = new HsmSigningAdapter({
        hsmKeyStore: mockHsmKeyStore,
      });
      const result = await adapter.signStellarTransaction("key_001", {
        xdr: "test-xdr",
      });
      expect(result).toBe("signed-xdr-base64");
      expect(mockHsmKeyStore.signStellarTransaction).toHaveBeenCalledWith({
        keyId: "key_001",
        dbName: "refractor",
        transaction: { xdr: "test-xdr" },
      });
    });

    it("should sign via direct HSM (tier 1)", async () => {
      const adapter = new HsmSigningAdapter({
        tier: "direct",
        azureCryptoService: mockAzureCrypto,
        hsmKeyStore: mockHsmKeyStore,
      });
      const result = await adapter.signStellarTransaction("key_001", {
        xdr: "test-xdr",
      });
      expect(result).toBe("direct-signed-xdr-base64");
      expect(mockAzureCrypto.signStellarTransaction).toHaveBeenCalledWith({
        keyName: "key_001",
        transaction: { xdr: "test-xdr" },
      });
    });

    it("should reject empty keyId", async () => {
      const adapter = new HsmSigningAdapter({
        hsmKeyStore: mockHsmKeyStore,
      });
      await expect(adapter.signStellarTransaction("", {})).rejects.toThrow(
        /keyId must be a non-empty string/,
      );
    });

    it("should reject null keyId", async () => {
      const adapter = new HsmSigningAdapter({
        hsmKeyStore: mockHsmKeyStore,
      });
      await expect(adapter.signStellarTransaction(null, {})).rejects.toThrow(
        /keyId must be a non-empty string/,
      );
    });
  });

  // ── Algorand Signing ────────────────────────────────────────────

  describe("signAlgorandTransaction", () => {
    it("should sign via envelope encryption", async () => {
      const adapter = new HsmSigningAdapter({
        hsmKeyStore: mockHsmKeyStore,
      });
      const tx = { type: "pay", amount: 1000 };
      const result = await adapter.signAlgorandTransaction("key_algo", tx);

      expect(result.txId).toBe("ALGO_TX_ID_123");
      expect(result.signedTxn).toBeInstanceOf(Uint8Array);
      expect(mockHsmKeyStore.signAlgorandTransaction).toHaveBeenCalledWith({
        keyId: "key_algo",
        dbName: "refractor",
        transaction: tx,
      });
    });
  });

  describe("signAlgorandData", () => {
    it("should sign arbitrary data", async () => {
      const adapter = new HsmSigningAdapter({
        hsmKeyStore: mockHsmKeyStore,
      });
      const result = await adapter.signAlgorandData(
        "key_algo",
        Buffer.from("hello"),
      );

      expect(result.signature).toBe("base64sig==");
      expect(mockHsmKeyStore.signAlgorandData).toHaveBeenCalledWith({
        keyId: "key_algo",
        dbName: "refractor",
        data: Buffer.from("hello"),
      });
    });
  });

  // ── Solana Signing ──────────────────────────────────────────────

  describe("signSolanaTransaction", () => {
    it("should sign via envelope encryption", async () => {
      const adapter = new HsmSigningAdapter({
        hsmKeyStore: mockHsmKeyStore,
      });
      const msgBytes = Buffer.from("solana-message-bytes");
      const result = await adapter.signSolanaTransaction("key_sol", msgBytes);

      expect(result.signature).toBeInstanceOf(Buffer);
      expect(result.signature.length).toBe(64);
      expect(result.publicKey).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/); // base58
      expect(mockHsmKeyStore.signSolanaTransaction).toHaveBeenCalledWith({
        keyId: "key_sol",
        dbName: "refractor",
        messageBytes: msgBytes,
      });
    });
  });

  // ── EVM Signing ─────────────────────────────────────────────────

  describe("signEvmTransaction", () => {
    it("should sign via envelope encryption", async () => {
      const adapter = new HsmSigningAdapter({
        hsmKeyStore: mockHsmKeyStore,
      });
      const tx = { to: "0xabc", value: "1000" };
      const result = await adapter.signEvmTransaction("key_evm", tx);

      expect(result.v).toBe(28);
      expect(result.r).toBe("0xabc");
      expect(result.s).toBe("0xdef");
      expect(mockHsmKeyStore.signEthereumTransaction).toHaveBeenCalledWith({
        keyId: "key_evm",
        dbName: "refractor",
        transaction: tx,
      });
    });
  });

  // ── 1Money Signing ──────────────────────────────────────────────

  describe("signOneMoneyTransaction", () => {
    it("should sign via envelope encryption with blockchain tag", async () => {
      const adapter = new HsmSigningAdapter({
        hsmKeyStore: mockHsmKeyStore,
      });
      const tx = { chain_id: 1212101, nonce: 1 };
      const result = await adapter.signOneMoneyTransaction("key_1m", tx);

      expect(result.v).toBe(28);
      expect(mockHsmKeyStore.signEthereumTransaction).toHaveBeenCalledWith({
        keyId: "key_1m",
        dbName: "refractor",
        blockchain: "onemoney",
        transaction: tx,
      });
    });
  });

  // ── Generic sign() Router ───────────────────────────────────────

  describe("sign", () => {
    let adapter;

    beforeEach(() => {
      adapter = new HsmSigningAdapter({
        hsmKeyStore: mockHsmKeyStore,
      });
    });

    it("should route stellar to signStellarTransaction", async () => {
      await adapter.sign("stellar", "key_001", { xdr: "test" });
      expect(mockHsmKeyStore.signStellarTransaction).toHaveBeenCalled();
    });

    it("should route algorand to signAlgorandTransaction", async () => {
      await adapter.sign("algorand", "key_001", { type: "pay" });
      expect(mockHsmKeyStore.signAlgorandTransaction).toHaveBeenCalled();
    });

    it("should route solana to signSolanaTransaction", async () => {
      await adapter.sign("solana", "key_001", Buffer.from("msg"));
      expect(mockHsmKeyStore.signSolanaTransaction).toHaveBeenCalled();
    });

    it("should route onemoney to signOneMoneyTransaction", async () => {
      await adapter.sign("onemoney", "key_001", { chain_id: 1212101 });
      expect(mockHsmKeyStore.signEthereumTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ blockchain: "onemoney" }),
      );
    });

    it("should route ethereum to signEvmTransaction", async () => {
      await adapter.sign("ethereum", "key_001", {});
      expect(mockHsmKeyStore.signEthereumTransaction).toHaveBeenCalled();
    });

    it("should route polygon to signEvmTransaction", async () => {
      await adapter.sign("polygon", "key_001", {});
      expect(mockHsmKeyStore.signEthereumTransaction).toHaveBeenCalled();
    });

    it("should route arbitrum to signEvmTransaction", async () => {
      await adapter.sign("arbitrum", "key_001", {});
      expect(mockHsmKeyStore.signEthereumTransaction).toHaveBeenCalled();
    });

    it("should throw for unsupported blockchain", async () => {
      await expect(adapter.sign("cardano", "key_001", {})).rejects.toThrow(
        /not supported for blockchain: cardano/,
      );
    });
  });

  // ── Key Creation ────────────────────────────────────────────────

  describe("createKey", () => {
    let adapter;

    beforeEach(() => {
      adapter = new HsmSigningAdapter({
        hsmKeyStore: mockHsmKeyStore,
      });
    });

    it("should create a Stellar key", async () => {
      const result = await adapter.createKey("stellar");
      expect(result.keyId).toBe("key_stellar_001");
      expect(mockHsmKeyStore.createStellarKey).toHaveBeenCalledWith(
        expect.objectContaining({ dbName: "refractor", blockchain: "stellar" }),
      );
    });

    it("should create a Solana key", async () => {
      const result = await adapter.createKey("solana");
      expect(result.keyId).toBe("key_sol_001");
      expect(mockHsmKeyStore.createSolanaKey).toHaveBeenCalled();
    });

    it("should create an Algorand key", async () => {
      const result = await adapter.createKey("algorand");
      expect(result.keyId).toBe("key_algo_001");
      expect(mockHsmKeyStore.createAlgorandKey).toHaveBeenCalled();
    });

    it("should create an Ethereum key", async () => {
      const result = await adapter.createKey("ethereum");
      expect(result.keyId).toBe("key_eth_001");
      expect(mockHsmKeyStore.createEthereumKey).toHaveBeenCalled();
    });

    it("should create a 1Money key using Ethereum key creation", async () => {
      await adapter.createKey("onemoney");
      expect(mockHsmKeyStore.createEthereumKey).toHaveBeenCalledWith(
        expect.objectContaining({ blockchain: "onemoney" }),
      );
    });

    it("should create a Polygon key using Ethereum key creation", async () => {
      await adapter.createKey("polygon");
      expect(mockHsmKeyStore.createEthereumKey).toHaveBeenCalledWith(
        expect.objectContaining({ blockchain: "polygon" }),
      );
    });

    it("should pass additional options to the creation function", async () => {
      await adapter.createKey("stellar", { label: "treasury-key" });
      expect(mockHsmKeyStore.createStellarKey).toHaveBeenCalledWith(
        expect.objectContaining({
          label: "treasury-key",
          dbName: "refractor",
        }),
      );
    });

    it("should throw for unsupported blockchain", async () => {
      await expect(adapter.createKey("cardano")).rejects.toThrow(
        /not supported for cardano/,
      );
    });
  });

  // ── Health Check ────────────────────────────────────────────────

  describe("healthCheck", () => {
    it("should return ok status on success", async () => {
      const adapter = new HsmSigningAdapter({
        hsmKeyStore: mockHsmKeyStore,
      });
      const result = await adapter.healthCheck();

      expect(result.status).toBe("ok");
      expect(result.tier).toBe("envelope");
      expect(typeof result.latencyMs).toBe("number");
      expect(result.hsm).toBe("connected");
    });

    it("should return error status on failure", async () => {
      mockHsmKeyStore.healthCheck.mockRejectedValue(
        new Error("Connection refused"),
      );
      const adapter = new HsmSigningAdapter({
        hsmKeyStore: mockHsmKeyStore,
      });
      const result = await adapter.healthCheck();

      expect(result.status).toBe("error");
      expect(result.error).toBe("Connection refused");
      expect(typeof result.latencyMs).toBe("number");
    });
  });

  // ── Static Helpers ──────────────────────────────────────────────

  describe("static methods", () => {
    it("should report supported blockchains", () => {
      expect(HsmSigningAdapter.isSupported("stellar")).toBe(true);
      expect(HsmSigningAdapter.isSupported("solana")).toBe(true);
      expect(HsmSigningAdapter.isSupported("algorand")).toBe(true);
      expect(HsmSigningAdapter.isSupported("ethereum")).toBe(true);
      expect(HsmSigningAdapter.isSupported("onemoney")).toBe(true);
      expect(HsmSigningAdapter.isSupported("polygon")).toBe(true);
      expect(HsmSigningAdapter.isSupported("cardano")).toBe(false);
      expect(HsmSigningAdapter.isSupported("bitcoin")).toBe(false);
    });

    it("should return list of supported blockchains", () => {
      const supported = HsmSigningAdapter.getSupportedBlockchains();
      expect(supported).toContain("stellar");
      expect(supported).toContain("solana");
      expect(supported).toContain("algorand");
      expect(supported).toContain("ethereum");
      expect(supported).toContain("onemoney");
      expect(supported.length).toBe(10);
    });

    it("should return a copy (not the internal array)", () => {
      const a = HsmSigningAdapter.getSupportedBlockchains();
      const b = HsmSigningAdapter.getSupportedBlockchains();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });
  });
});
