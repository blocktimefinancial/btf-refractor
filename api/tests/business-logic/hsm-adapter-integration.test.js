/**
 * HSM Adapter Integration Tests (Mocked)
 *
 * Deeper integration tests that:
 * 1. Test the adapter with app.config.js values
 * 2. Validate error propagation chains across all blockchains
 * 3. Test concurrent signing safety
 * 4. Test edge cases: keyId validation, missing providers, tier switching
 * 5. Test interaction with attestation module
 */

const HsmSigningAdapter = require("../../business-logic/hsm-signing-adapter");
const {
  isCvmAttestationRequired,
  getAttestationStatus,
} = require("../../utils/attestation");

// ── Shared Mock Factories ───────────────────────────────────────

function createFullMockHsmKeyStore() {
  return {
    signStellarTransaction: jest
      .fn()
      .mockResolvedValue("signed-stellar-xdr"),
    signAlgorandTransaction: jest.fn().mockResolvedValue({
      signedTxn: new Uint8Array(64),
      txId: "ALGO_TX_001",
    }),
    signAlgorandData: jest.fn().mockResolvedValue({
      signature: "algo-data-sig-base64",
      address: "MFRGGMIJDQSGCZLPMFRSQ",
    }),
    signSolanaTransaction: jest.fn().mockResolvedValue({
      signature: Buffer.alloc(64, 0xfe),
      publicKey: "3FhjakEKmij2VBrvpS98ePNzg4K5Lfe8Rx6TSwYZTqvN",
    }),
    signEthereumTransaction: jest.fn().mockResolvedValue({
      v: 27,
      r: "0x1234",
      s: "0x5678",
      hash: "0xabcdef",
      from: "0x742d35Cc6634C0532925a3b844Bc9e7595f8fEc5",
    }),
    createStellarKey: jest.fn().mockResolvedValue({
      keyId: "hsm-stellar-001",
      publicKey: "GABCDEF...",
    }),
    createEthereumKey: jest.fn().mockResolvedValue({
      keyId: "hsm-eth-001",
      address: "0x742d35Cc",
    }),
    createSolanaKey: jest.fn().mockResolvedValue({
      keyId: "hsm-sol-001",
      publicKey: "3FhjakEKmij",
    }),
    createAlgorandKey: jest.fn().mockResolvedValue({
      keyId: "hsm-algo-001",
      address: "MFRGGMIJ",
    }),
    healthCheck: jest.fn().mockResolvedValue({
      hsm: "connected",
      kekAvailable: true,
      latency: 12,
    }),
  };
}

// ═════════════════════════════════════════════════════════════════════

describe("HSM Adapter — Integration Tests (Mocked)", () => {
  let mockKs;

  beforeEach(() => {
    mockKs = createFullMockHsmKeyStore();
  });

  // ── Multi-chain signing batch ─────────────────────────────────

  describe("multi-chain signing", () => {
    it("should sign transactions for all supported blockchains in sequence", async () => {
      const adapter = new HsmSigningAdapter({ hsmKeyStore: mockKs });

      // Stellar
      const stellar = await adapter.sign("stellar", "k1", { xdr: "AAA" });
      expect(stellar).toBe("signed-stellar-xdr");

      // Algorand
      const algo = await adapter.sign("algorand", "k2", { type: "pay" });
      expect(algo.txId).toBe("ALGO_TX_001");

      // Solana
      const sol = await adapter.sign("solana", "k3", Buffer.from("msg"));
      expect(sol.signature.length).toBe(64);

      // Ethereum
      const eth = await adapter.sign("ethereum", "k4", { to: "0xabc" });
      expect(eth.v).toBe(27);

      // 1Money
      const om = await adapter.sign("onemoney", "k5", { chain_id: 1212101 });
      expect(om.v).toBe(27);

      // Polygon
      const poly = await adapter.sign("polygon", "k6", { to: "0xabc" });
      expect(poly.hash).toBe("0xabcdef");

      // Arbitrum
      const arb = await adapter.sign("arbitrum", "k7", { to: "0xabc" });
      expect(arb.from).toBe("0x742d35Cc6634C0532925a3b844Bc9e7595f8fEc5");
    });

    it("should isolate calls — each blockchain gets correct args", async () => {
      const adapter = new HsmSigningAdapter({ hsmKeyStore: mockKs });

      await adapter.sign("stellar", "stellar-key-1", { xdr: "AAAA" });
      await adapter.sign("ethereum", "eth-key-1", { to: "0x123", value: "10" });

      // Stellar call
      expect(mockKs.signStellarTransaction).toHaveBeenCalledWith({
        keyId: "stellar-key-1",
        dbName: "refractor",
        transaction: { xdr: "AAAA" },
      });

      // EVM call (should NOT contain blockchain tag — only 1Money does)
      expect(mockKs.signEthereumTransaction).toHaveBeenCalledWith({
        keyId: "eth-key-1",
        dbName: "refractor",
        transaction: { to: "0x123", value: "10" },
      });
    });
  });

  // ── Concurrent signing safety ─────────────────────────────────

  describe("concurrent signing", () => {
    it("should handle parallel signing requests without interference", async () => {
      // Simulate delayed mock responses
      let resolveFirst;
      const delayedPromise = new Promise((r) => {
        resolveFirst = r;
      });
      mockKs.signStellarTransaction
        .mockResolvedValueOnce(delayedPromise)
        .mockResolvedValueOnce("second-xdr");

      const adapter = new HsmSigningAdapter({ hsmKeyStore: mockKs });

      const p1 = adapter.signStellarTransaction("key-a", { xdr: "A" });
      const p2 = adapter.signStellarTransaction("key-b", { xdr: "B" });

      // Resolve the delayed promise
      resolveFirst("first-xdr");

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe("first-xdr");
      expect(r2).toBe("second-xdr");
    });
  });

  // ── Error propagation ─────────────────────────────────────────

  describe("error propagation", () => {
    const HSM_ERROR = new Error("HSM connection timeout");
    const CHAINS = [
      {
        name: "stellar",
        method: "signStellarTransaction",
        mockFn: "signStellarTransaction",
        args: ["key-1", { xdr: "test" }],
      },
      {
        name: "algorand",
        method: "signAlgorandTransaction",
        mockFn: "signAlgorandTransaction",
        args: ["key-1", { type: "pay" }],
      },
      {
        name: "solana",
        method: "signSolanaTransaction",
        mockFn: "signSolanaTransaction",
        args: ["key-1", Buffer.from("msg")],
      },
      {
        name: "evm",
        method: "signEvmTransaction",
        mockFn: "signEthereumTransaction",
        args: ["key-1", { to: "0x" }],
      },
      {
        name: "onemoney",
        method: "signOneMoneyTransaction",
        mockFn: "signEthereumTransaction",
        args: ["key-1", { chain_id: 1 }],
      },
    ];

    for (const chain of CHAINS) {
      it(`should propagate HSM errors from ${chain.name} signing`, async () => {
        mockKs[chain.mockFn].mockRejectedValue(HSM_ERROR);
        const adapter = new HsmSigningAdapter({ hsmKeyStore: mockKs });

        await expect(
          adapter[chain.method](...chain.args),
        ).rejects.toThrow("HSM connection timeout");
      });
    }

    it("should propagate key creation errors", async () => {
      mockKs.createStellarKey.mockRejectedValue(
        new Error("Key limit exceeded"),
      );
      const adapter = new HsmSigningAdapter({ hsmKeyStore: mockKs });

      await expect(adapter.createKey("stellar")).rejects.toThrow(
        "Key limit exceeded",
      );
    });
  });

  // ── Key creation for all EVM chains ─────────────────────────

  describe("key creation — EVM chains share createEthereumKey", () => {
    const evmChains = [
      "ethereum",
      "polygon",
      "arbitrum",
      "optimism",
      "base",
      "avalanche",
      "onemoney",
    ];

    for (const chain of evmChains) {
      it(`should use createEthereumKey for ${chain}`, async () => {
        const adapter = new HsmSigningAdapter({ hsmKeyStore: mockKs });
        await adapter.createKey(chain);
        expect(mockKs.createEthereumKey).toHaveBeenCalledWith(
          expect.objectContaining({ blockchain: chain }),
        );
      });
    }
  });

  // ── Config-driven adapter construction ────────────────────────

  describe("config-driven construction", () => {
    it("should construct from app.config.js hsm settings", () => {
      // Simulate what the application would do
      const hsmConfig = {
        enabled: true,
        tier: "envelope",
        masterKekName: "refractor-master-kek",
      };

      const adapter = new HsmSigningAdapter({
        tier: hsmConfig.tier,
        hsmKeyStore: mockKs,
      });

      expect(adapter.tier).toBe("envelope");
    });

    it("should support custom dbName from config", () => {
      const adapter = new HsmSigningAdapter({
        dbName: "custom-refractor-db",
        hsmKeyStore: mockKs,
      });

      // Verify dbName flows into signing calls
      adapter.signStellarTransaction("key1", { xdr: "test" });
      expect(mockKs.signStellarTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ dbName: "custom-refractor-db" }),
      );
    });
  });

  // ── Attestation integration ───────────────────────────────────

  describe("attestation integration check", () => {
    const savedEnv = {};

    beforeEach(() => {
      savedEnv.NODE_ENV = process.env.NODE_ENV;
      savedEnv.REQUIRE_CVM_ATTESTATION = process.env.REQUIRE_CVM_ATTESTATION;
    });

    afterEach(() => {
      for (const [key, val] of Object.entries(savedEnv)) {
        if (val === undefined) delete process.env[key];
        else process.env[key] = val;
      }
    });

    it("should not require attestation in test environment", () => {
      process.env.NODE_ENV = "test";
      delete process.env.REQUIRE_CVM_ATTESTATION;

      expect(isCvmAttestationRequired()).toBe(false);

      // Adapter should construct fine without attestation
      const adapter = new HsmSigningAdapter({ hsmKeyStore: mockKs });
      expect(adapter).toBeDefined();
    });

    it("attestation status should reflect current env", () => {
      process.env.NODE_ENV = "test";
      const status = getAttestationStatus();
      expect(status.required).toBe(false);
      expect(status.nodeEnv).toBe("test");
    });
  });

  // ── Health check details ──────────────────────────────────────

  describe("healthCheck — detailed", () => {
    it("should include all expected fields on success", async () => {
      const adapter = new HsmSigningAdapter({ hsmKeyStore: mockKs });
      const health = await adapter.healthCheck();

      expect(health).toEqual(
        expect.objectContaining({
          status: "ok",
          tier: "envelope",
          hsm: "connected",
          kekAvailable: true,
        }),
      );
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("should handle slow health checks", async () => {
      mockKs.healthCheck.mockImplementation(
        () => new Promise((r) => setTimeout(() => r({ hsm: "slow" }), 50)),
      );
      const adapter = new HsmSigningAdapter({ hsmKeyStore: mockKs });
      const health = await adapter.healthCheck();

      expect(health.status).toBe("ok");
      expect(health.latencyMs).toBeGreaterThanOrEqual(40);
    });
  });

  // ── Edge cases ────────────────────────────────────────────────

  describe("edge cases", () => {
    it("should handle keyId with special characters", async () => {
      const adapter = new HsmSigningAdapter({ hsmKeyStore: mockKs });
      // Key IDs can contain hyphens, underscores, dots etc.
      await adapter.signStellarTransaction("key-with.special_chars-123", {
        xdr: "test",
      });
      expect(mockKs.signStellarTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          keyId: "key-with.special_chars-123",
        }),
      );
    });

    it("should reject non-string keyId types", async () => {
      const adapter = new HsmSigningAdapter({ hsmKeyStore: mockKs });

      await expect(
        adapter.signStellarTransaction(123, {}),
      ).rejects.toThrow(/keyId must be a non-empty string/);

      await expect(
        adapter.signStellarTransaction(undefined, {}),
      ).rejects.toThrow(/keyId must be a non-empty string/);

      await expect(
        adapter.signStellarTransaction({}, {}),
      ).rejects.toThrow(/keyId must be a non-empty string/);
    });

    it("sign() should be case-insensitive for blockchain names", async () => {
      const adapter = new HsmSigningAdapter({ hsmKeyStore: mockKs });
      await adapter.sign("STELLAR", "k1", { xdr: "test" });
      await adapter.sign("Ethereum", "k2", { to: "0x" });
      await adapter.sign("SOLANA", "k3", Buffer.from("msg"));

      expect(mockKs.signStellarTransaction).toHaveBeenCalled();
      expect(mockKs.signEthereumTransaction).toHaveBeenCalled();
      expect(mockKs.signSolanaTransaction).toHaveBeenCalled();
    });

    it("createKey should be case-insensitive", async () => {
      const adapter = new HsmSigningAdapter({ hsmKeyStore: mockKs });
      await adapter.createKey("STELLAR");
      expect(mockKs.createStellarKey).toHaveBeenCalled();
    });
  });
});
