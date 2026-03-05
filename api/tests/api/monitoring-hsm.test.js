/**
 * Monitoring Routes — HSM Health Tests
 *
 * Tests the HSM health additions to monitoring-routes.js:
 * - GET /monitoring/health (composite, now includes HSM)
 * - GET /monitoring/hsm/health (dedicated HSM endpoint)
 */

const express = require("express");
const request = require("supertest");

// ── Mock finalizer ───────────────────────────────────────────────
jest.mock("../../business-logic/finalization/finalizer", () => ({
  getQueueMetrics: jest.fn().mockReturnValue({ processed: 0, failed: 0 }),
  getQueueStatus: jest
    .fn()
    .mockReturnValue({ paused: false, concurrency: 5, size: 0 }),
  finalizerQueue: { pause: jest.fn(), resume: jest.fn() },
  setQueueConcurrency: jest.fn(),
}));

// ── Mock storage layer ───────────────────────────────────────────
jest.mock("../../storage/storage-layer", () => ({
  dataProvider: {
    checkHealth: jest.fn().mockResolvedValue({
      connected: true,
      latencyMs: 5,
    }),
    getTransactionStats: jest.fn().mockResolvedValue({}),
  },
}));

// ── Mock CORS middleware ─────────────────────────────────────────
jest.mock("../../middleware/cors", () => ({
  getBlacklist: jest.fn().mockReturnValue([]),
  addToBlacklist: jest.fn(),
  removeFromBlacklist: jest.fn(),
  reloadBlacklist: jest.fn(),
}));

// ── Mock request-id middleware ────────────────────────────────────
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

// ── Mock blockchain-registry ─────────────────────────────────────
jest.mock("../../business-logic/blockchain-registry", () => ({
  isValidBlockchain: jest.fn().mockReturnValue(true),
}));

// ── Mock HsmSigningAdapter ───────────────────────────────────────
const mockHealthCheck = jest.fn();

jest.mock("../../business-logic/hsm-signing-adapter", () => {
  const MockAdapter = jest.fn().mockImplementation(() => ({
    healthCheck: mockHealthCheck,
  }));
  MockAdapter.getSupportedBlockchains = jest.fn(() => [
    "stellar",
    "algorand",
    "solana",
    "ethereum",
  ]);
  return MockAdapter;
});

// ── Mock app config (mutable for testing) ────────────────────────
const mockConfig = { hsm: { enabled: false, tier: "envelope" } };
jest.mock("../../app.config", () => mockConfig);

// Set admin key
process.env.ADMIN_API_KEY = "test-admin-key-12345";

const monitoringRoutes = require("../../api/monitoring-routes");

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/monitoring", monitoringRoutes);
  return app;
}

const AUTH_HEADER = { "X-Admin-API-Key": "test-admin-key-12345" };

describe("Monitoring Routes — HSM Health", () => {
  let app;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset config to disabled by default
    mockConfig.hsm = { enabled: false, tier: "envelope" };
  });

  // ── Composite /health — HSM disabled ────────────────────────────

  describe("GET /monitoring/health (HSM disabled)", () => {
    it("should not include HSM section when HSM is disabled", async () => {
      const res = await request(app).get("/monitoring/health");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("healthy");
      expect(res.body.hsm).toBeUndefined();
    });

    it("should remain healthy when HSM is disabled", async () => {
      const res = await request(app).get("/monitoring/health");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("healthy");
    });
  });

  // ── Composite /health — HSM enabled ─────────────────────────────

  describe("GET /monitoring/health (HSM enabled)", () => {
    beforeEach(() => {
      mockConfig.hsm = { enabled: true, tier: "envelope" };
    });

    it("should include HSM health when HSM is enabled and healthy", async () => {
      mockHealthCheck.mockResolvedValue({
        status: "ok",
        tier: "envelope",
        latencyMs: 10,
      });

      const res = await request(app).get("/monitoring/health");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("healthy");
      expect(res.body.hsm).toBeDefined();
      expect(res.body.hsm.status).toBe("ok");
    });

    it("should report unhealthy when HSM is down", async () => {
      mockHealthCheck.mockResolvedValue({
        status: "error",
        error: "Connection refused",
      });

      const res = await request(app).get("/monitoring/health");

      expect(res.status).toBe(503);
      expect(res.body.status).toBe("unhealthy");
      expect(res.body.hsm).toBeDefined();
      expect(res.body.hsm.status).toBe("error");
    });

    it("should report unhealthy when HSM adapter throws", async () => {
      mockHealthCheck.mockRejectedValue(new Error("HSM timeout"));

      const res = await request(app).get("/monitoring/health");

      expect(res.status).toBe(503);
      expect(res.body.status).toBe("unhealthy");
      expect(res.body.hsm).toBeDefined();
      expect(res.body.hsm.status).toBe("error");
    });

    it("should include both queue and HSM in response", async () => {
      mockHealthCheck.mockResolvedValue({
        status: "ok",
        tier: "envelope",
        latencyMs: 5,
      });

      const res = await request(app).get("/monitoring/health");

      expect(res.body.queue).toBeDefined();
      expect(res.body.database).toBeDefined();
      expect(res.body.hsm).toBeDefined();
      expect(res.body.timestamp).toBeDefined();
    });
  });

  // ── Dedicated /hsm/health ───────────────────────────────────────

  describe("GET /monitoring/hsm/health", () => {
    it("should require admin auth", async () => {
      const res = await request(app).get("/monitoring/hsm/health");

      expect(res.status).toBe(401);
    });

    it("should return disabled status when HSM is not enabled", async () => {
      mockConfig.hsm = { enabled: false };

      const res = await request(app)
        .get("/monitoring/hsm/health")
        .set(AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("disabled");
      expect(res.body.message).toMatch(/not enabled/);
    });

    it("should return healthy HSM status", async () => {
      mockConfig.hsm = { enabled: true, tier: "envelope" };
      mockHealthCheck.mockResolvedValue({
        status: "ok",
        tier: "envelope",
        latencyMs: 8,
      });

      const res = await request(app)
        .get("/monitoring/hsm/health")
        .set(AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.hsmEnabled).toBe(true);
      expect(res.body.supportedBlockchains).toBeDefined();
      expect(res.body.timestamp).toBeDefined();
    });

    it("should return 503 when HSM is unhealthy", async () => {
      mockConfig.hsm = { enabled: true, tier: "envelope" };
      mockHealthCheck.mockResolvedValue({
        status: "error",
        error: "Connection refused",
      });

      const res = await request(app)
        .get("/monitoring/hsm/health")
        .set(AUTH_HEADER);

      expect(res.status).toBe(503);
      expect(res.body.status).toBe("error");
    });

    it("should return 503 when HSM adapter throws", async () => {
      mockConfig.hsm = { enabled: true, tier: "envelope" };
      mockHealthCheck.mockRejectedValue(new Error("HSM unreachable"));

      const res = await request(app)
        .get("/monitoring/hsm/health")
        .set(AUTH_HEADER);

      expect(res.status).toBe(503);
      expect(res.body.status).toBe("error");
      expect(res.body.error).toBe("HSM unreachable");
    });
  });
});
