/**
 * Phase 2 Integration Tests
 *
 * End-to-end tests for the Phase 2 HSM integration layer:
 * 1. Signer.signWithHsm → processSignature → saveChanges flow
 * 2. Key management API routes with mocked HSM
 * 3. Monitoring health endpoints with HSM
 * 4. Circuit breaker integration with HSM adapter
 */

const express = require("express");
const request = require("supertest");

// ══════════════════════════════════════════════════════════════════
//  Mocks
// ══════════════════════════════════════════════════════════════════

// ── Storage layer ────────────────────────────────────────────────
const mockSaveTransaction = jest.fn().mockResolvedValue(true);
const mockFindTransaction = jest.fn().mockResolvedValue(null);

jest.mock("../../storage/storage-layer", () => ({
  dataProvider: {
    findTransaction: mockFindTransaction,
    saveTransaction: mockSaveTransaction,
    checkHealth: jest.fn().mockResolvedValue({ connected: true, latencyMs: 3 }),
    getTransactionStats: jest.fn().mockResolvedValue({}),
  },
}));

// ── Account info provider ────────────────────────────────────────
jest.mock("../../business-logic/account-info-provider", () => ({
  loadTxSourceAccountsInfo: jest.fn().mockResolvedValue({}),
}));

// ── tx-signers-inspector ─────────────────────────────────────────
jest.mock("@stellar-expert/tx-signers-inspector", () => ({
  inspectTransactionSigners: jest.fn().mockResolvedValue({
    getAllPotentialSigners: () => ["GALICE", "GBOB"],
    checkFeasibility: (keys) => keys.length > 0,
  }),
}));

// ── Network resolver ─────────────────────────────────────────────
jest.mock("../../business-logic/network-resolver", () => ({
  resolveNetwork: jest.fn().mockReturnValue("testnet"),
  resolveNetworkParams: jest.fn().mockReturnValue({
    horizon: "https://horizon-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
  }),
}));

// ── Finalizer ────────────────────────────────────────────────────
jest.mock("../../business-logic/finalization/finalizer", () => ({
  triggerImmediateCheck: jest.fn(),
  getQueueMetrics: jest.fn().mockReturnValue({ processed: 10, failed: 0 }),
  getQueueStatus: jest
    .fn()
    .mockReturnValue({ paused: false, concurrency: 5, size: 0 }),
  finalizerQueue: { pause: jest.fn(), resume: jest.fn() },
}));

// ── tx-loader ────────────────────────────────────────────────────
jest.mock("../../business-logic/tx-loader", () => ({
  rehydrateTx: jest.fn((tx) => tx),
  loadRehydrateTx: jest.fn(),
}));

// ── originator-verifier ──────────────────────────────────────────
jest.mock("../../business-logic/originator-verifier", () => ({
  validateOriginator: jest.fn(),
  checkOriginatorStatus: jest.fn().mockReturnValue({
    hasOriginator: false,
    isVerified: false,
  }),
}));

// ── Mock handlers ────────────────────────────────────────────────
const mockAlgorandHandler = {
  config: { name: "algorand", defaultEncoding: "base64" },
  parseTransaction: jest.fn().mockReturnValue({}),
  parseTransactionParams: jest.fn().mockReturnValue({
    hash: "algo-hash-123",
    blockchain: "algorand",
    signatures: [],
    networkName: "testnet",
    status: "pending",
  }),
  computeHash: jest.fn().mockReturnValue({
    hash: "algo-hash-123",
    hashRaw: Buffer.alloc(32),
  }),
  extractSignatures: jest.fn().mockReturnValue([]),
  getPotentialSigners: jest.fn().mockResolvedValue(["ALGO_SIGNER_A"]),
  matchSignatureToSigner: jest.fn().mockReturnValue({ key: "ALGO_SIGNER_A" }),
};

const mockEvmHandler = {
  config: { name: "ethereum", defaultEncoding: "hex" },
  parseTransaction: jest.fn().mockReturnValue({ from: "0xsender" }),
  parseTransactionParams: jest.fn().mockReturnValue({
    hash: "evm-hash-456",
    blockchain: "ethereum",
    signatures: [],
    networkName: "mainnet",
    status: "pending",
  }),
  computeHash: jest.fn().mockReturnValue({
    hash: "evm-hash-456",
    hashRaw: Buffer.alloc(32),
  }),
  extractSignatures: jest.fn().mockReturnValue([]),
  getPotentialSigners: jest.fn().mockResolvedValue(["0xsender"]),
  verifySignedTransaction: jest.fn().mockReturnValue(true),
};

jest.mock("../../business-logic/handlers/handler-factory", () => ({
  getHandler: jest.fn((chain) => {
    if (chain === "algorand" || chain === "solana") return mockAlgorandHandler;
    if (["ethereum", "polygon", "onemoney", "arbitrum"].includes(chain))
      return mockEvmHandler;
    return mockAlgorandHandler; // fallback
  }),
  hasHandler: jest.fn(() => true),
}));

jest.mock("../../business-logic/handlers/evm-handler", () => ({
  isEvmBlockchain: jest.fn(
    (chain) =>
      [
        "ethereum",
        "polygon",
        "arbitrum",
        "optimism",
        "base",
        "avalanche",
        "onemoney",
      ].includes(chain) || false,
  ),
  EVM_BLOCKCHAINS: [
    "ethereum",
    "polygon",
    "arbitrum",
    "optimism",
    "base",
    "avalanche",
    "onemoney",
  ],
}));

jest.mock("../../business-logic/tx-params-parser", () => ({
  sliceTx: jest.fn().mockReturnValue({ tx: {}, signatures: [] }),
  parseTxParams: jest.fn().mockReturnValue({}),
  parseBlockchainAgnosticParams: jest.fn(),
}));

jest.mock("../../business-logic/signature-hint-utils", () => ({
  hintMatchesKey: jest.fn(),
  hintToMask: jest.fn().mockReturnValue("****"),
}));

// ── Mock HsmSigningAdapter ───────────────────────────────────────
const mockHsmSignStellar = jest.fn();
const mockHsmSignAlgorand = jest.fn();
const mockHsmSignSolana = jest.fn();
const mockHsmSignEvm = jest.fn();
const mockHsmCreateKey = jest.fn();
const mockHsmHealthCheck = jest.fn();
const mockHsmSign = jest.fn();
const mockGetKeyMetadata = jest.fn();
const mockRotateKey = jest.fn();
const mockDisableKey = jest.fn();

jest.mock("../../business-logic/hsm-signing-adapter", () => {
  const MockAdapter = jest.fn().mockImplementation(() => ({
    signStellarTransaction: mockHsmSignStellar,
    signAlgorandTransaction: mockHsmSignAlgorand,
    signSolanaTransaction: mockHsmSignSolana,
    signEvmTransaction: mockHsmSignEvm,
    createKey: mockHsmCreateKey,
    healthCheck: mockHsmHealthCheck,
    sign: mockHsmSign,
    _hsmKeyStore: {
      getKeyMetadata: mockGetKeyMetadata,
      rotateKey: mockRotateKey,
      disableKey: mockDisableKey,
    },
    dbName: "refractor",
  }));
  MockAdapter.isSupported = jest.fn((chain) =>
    [
      "stellar",
      "algorand",
      "solana",
      "ethereum",
      "onemoney",
      "polygon",
    ].includes(chain.toLowerCase()),
  );
  MockAdapter.getSupportedBlockchains = jest.fn(() => [
    "stellar",
    "algorand",
    "solana",
    "ethereum",
    "onemoney",
    "polygon",
  ]);
  return MockAdapter;
});

// ── Mock CORS ────────────────────────────────────────────────────
jest.mock("../../middleware/cors", () => ({
  getBlacklist: jest.fn().mockReturnValue([]),
  addToBlacklist: jest.fn(),
  removeFromBlacklist: jest.fn(),
  reloadBlacklist: jest.fn(),
}));

jest.mock("../../middleware/request-id", () => ({
  getRequestLogger: jest.fn().mockReturnValue({
    child: jest.fn().mockReturnValue({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
  }),
}));

jest.mock("../../business-logic/blockchain-registry", () => ({
  isValidBlockchain: jest.fn().mockReturnValue(true),
}));

// ── Config mock ──────────────────────────────────────────────────
const mockConfig = { hsm: { enabled: true, tier: "envelope" } };
jest.mock("../../app.config", () => mockConfig);

// Set admin key
process.env.ADMIN_API_KEY = "integration-test-key";

const Signer = require("../../business-logic/signer");
const keyRoutes = require("../../api/key-routes");
const monitoringRoutes = require("../../api/monitoring-routes");
const {
  CircuitBreaker,
  getBreaker,
  _clearRegistry,
} = require("../../utils/circuit-breaker");

const AUTH_HEADER = { "X-Admin-API-Key": "integration-test-key" };

// ══════════════════════════════════════════════════════════════════
//  Integration Test Suites
// ══════════════════════════════════════════════════════════════════

describe("Phase 2 Integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _clearRegistry();
    mockConfig.hsm = { enabled: true, tier: "envelope" };
  });

  // ── 1. Signer → HSM → processSignature → saveChanges ──────────

  describe("Signer HSM signing flow", () => {
    it("should sign Algorand tx with HSM, process signature, and save", async () => {
      const signer = new Signer({
        blockchain: "algorand",
        payload: "algo-tx-payload",
        networkName: "testnet",
      });

      // Set up signer state
      signer.potentialSigners = ["ALGO_SIGNER_A"];
      signer.txInfo.signatures = [];
      signer.status = "created";
      signer.schema = {
        checkFeasibility: (keys) => keys.length > 0,
        getAllPotentialSigners: () => ["ALGO_SIGNER_A"],
      };

      mockHsmSignAlgorand.mockResolvedValue({
        signedTxn: new Uint8Array([10, 20, 30]),
        address: "ALGO_SIGNER_A",
        txId: "algo-tx-id",
      });

      await signer.signWithHsm("algo-key-1");

      // Verify signature was processed and accepted
      expect(signer.accepted.length).toBe(1);
      expect(signer.accepted[0].key).toBe("ALGO_SIGNER_A");

      // Save changes
      await signer.saveChanges();
      expect(mockSaveTransaction).toHaveBeenCalledTimes(1);
    });

    it("should sign EVM tx with HSM and save changes", async () => {
      const signer = new Signer({
        blockchain: "ethereum",
        payload: "evm-tx-payload",
        networkName: "mainnet",
      });

      signer.potentialSigners = ["0xsender"];
      signer.txInfo.signatures = [];
      signer.status = "created";

      mockHsmSignEvm.mockResolvedValue({
        v: 27,
        r: "0xaabb",
        s: "0xccdd",
        from: "0xsender",
      });

      await signer.signWithHsm("eth-key-1");

      expect(signer.accepted.length).toBe(1);
      expect(signer.accepted[0].key).toBe("0xsender");

      await signer.saveChanges();
      expect(mockSaveTransaction).toHaveBeenCalled();
    });

    it("should reject signWithHsm with invalid keyId", async () => {
      const signer = new Signer({
        blockchain: "algorand",
        payload: "data",
        networkName: "testnet",
      });

      await expect(signer.signWithHsm("")).rejects.toThrow(
        /keyId must be a non-empty string/,
      );
    });
  });

  // ── 2. Key Management Routes Integration ───────────────────────

  describe("Key management route flow", () => {
    let app;

    beforeAll(() => {
      app = express();
      app.use(express.json());
      app.use("/keys", keyRoutes);
    });

    it("should create key → get metadata → sign → rotate → disable", async () => {
      // Step 1: Create key
      mockHsmCreateKey.mockResolvedValue({
        keyId: "new-key-1",
        publicKey: "GABCDEF",
      });

      let res = await request(app)
        .post("/keys")
        .set(AUTH_HEADER)
        .send({ blockchain: "stellar" });

      expect(res.status).toBe(201);
      expect(res.body.keyId).toBe("new-key-1");

      // Step 2: Get metadata
      mockGetKeyMetadata.mockResolvedValue({
        publicKey: "GABCDEF",
        status: "active",
        blockchain: "stellar",
      });

      res = await request(app).get("/keys/new-key-1").set(AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.publicKey).toBe("GABCDEF");

      // Step 3: Sign
      mockHsmSign.mockResolvedValue({ signature: "xdr-result" });

      res = await request(app)
        .post("/keys/new-key-1/sign")
        .set(AUTH_HEADER)
        .send({ blockchain: "stellar", payload: { xdr: "tx-xdr" } });

      expect(res.status).toBe(200);
      expect(res.body.result.signature).toBe("xdr-result");

      // Step 4: Rotate
      mockRotateKey.mockResolvedValue({
        newKeyId: "rotated-key-2",
        publicKey: "GNEWKEY",
      });

      res = await request(app)
        .post("/keys/new-key-1/rotate")
        .set(AUTH_HEADER)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.oldKeyId).toBe("new-key-1");
      expect(res.body.newKeyId).toBe("rotated-key-2");

      // Step 5: Disable old key
      mockDisableKey.mockResolvedValue(true);

      res = await request(app).delete("/keys/new-key-1").set(AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("disabled");
    });
  });

  // ── 3. Monitoring with HSM Health ──────────────────────────────

  describe("Monitoring HSM health integration", () => {
    let app;

    beforeAll(() => {
      app = express();
      app.use(express.json());
      app.use("/monitoring", monitoringRoutes);
    });

    it("should include HSM in composite health when enabled and healthy", async () => {
      mockHsmHealthCheck.mockResolvedValue({
        status: "ok",
        tier: "envelope",
        latencyMs: 5,
      });

      const res = await request(app).get("/monitoring/health");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("healthy");
      expect(res.body.hsm).toBeDefined();
      expect(res.body.hsm.status).toBe("ok");
      expect(res.body.queue).toBeDefined();
      expect(res.body.database).toBeDefined();
    });

    it("should mark system unhealthy when HSM is down", async () => {
      mockHsmHealthCheck.mockResolvedValue({
        status: "error",
        error: "HSM connection failed",
      });

      const res = await request(app).get("/monitoring/health");

      expect(res.status).toBe(503);
      expect(res.body.status).toBe("unhealthy");
    });

    it("should show dedicated HSM health with supported blockchains", async () => {
      mockHsmHealthCheck.mockResolvedValue({
        status: "ok",
        tier: "envelope",
        latencyMs: 3,
      });

      const res = await request(app)
        .get("/monitoring/hsm/health")
        .set(AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.hsmEnabled).toBe(true);
      expect(res.body.supportedBlockchains).toEqual(
        expect.arrayContaining(["stellar", "algorand", "solana"]),
      );
    });
  });

  // ── 4. Circuit Breaker + HSM Integration ───────────────────────

  describe("Circuit breaker with HSM calls", () => {
    it("should protect HSM calls with circuit breaker", async () => {
      const breaker = getBreaker("hsm");

      // Successful call through breaker
      mockHsmHealthCheck.mockResolvedValue({ status: "ok" });
      const result = await breaker.fire(async () => {
        const HsmSigningAdapter = require("../../business-logic/hsm-signing-adapter");
        const adapter = new HsmSigningAdapter();
        return adapter.healthCheck();
      });

      expect(result.status).toBe("ok");
      expect(breaker.isClosed).toBe(true);
    });

    it("should open circuit after repeated HSM failures", async () => {
      const breaker = new CircuitBreaker("hsm-integration-test", {
        volumeThreshold: 3,
        errorThresholdPercentage: 50,
        resetTimeout: 60000,
      });

      const failingCall = async () => {
        throw new Error("HSM timeout");
      };

      // 3 failures out of 3 = 100% → open
      await expect(breaker.fire(failingCall)).rejects.toThrow();
      await expect(breaker.fire(failingCall)).rejects.toThrow();
      await expect(breaker.fire(failingCall)).rejects.toThrow();

      expect(breaker.isOpen).toBe(true);

      // Subsequent calls immediately rejected
      await expect(breaker.fire(failingCall)).rejects.toThrow(/OPEN/);
    });

    it("should report breaker metrics alongside HSM health", async () => {
      const breaker = getBreaker("hsm");
      const ok = jest.fn().mockResolvedValue("ok");
      await breaker.fire(ok);

      const metrics = breaker.getMetrics();
      expect(metrics.name).toBe("hsm");
      expect(metrics.state).toBe("CLOSED");
      expect(metrics.successes).toBe(1);
    });
  });
});
