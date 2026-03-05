/**
 * Key Management Routes Tests
 *
 * Tests the /keys/* API endpoints for HSM key management:
 * - POST /keys (create key)
 * - GET /keys/health (HSM health check)
 * - GET /keys/:keyId (key metadata)
 * - POST /keys/:keyId/sign (sign with key)
 * - POST /keys/:keyId/rotate (rotate key)
 * - DELETE /keys/:keyId (disable key)
 *
 * All routes require admin authentication.
 */

const express = require("express");
const request = require("supertest");

// ── Mock HsmSigningAdapter ───────────────────────────────────────
const mockCreateKey = jest.fn();
const mockSignMethod = jest.fn();
const mockHealthCheck = jest.fn();
const mockGetKeyMetadata = jest.fn();
const mockRotateKey = jest.fn();
const mockDisableKey = jest.fn();

jest.mock("../../business-logic/hsm-signing-adapter", () => {
  const MockAdapter = jest.fn().mockImplementation(() => ({
    createKey: mockCreateKey,
    sign: mockSignMethod,
    healthCheck: mockHealthCheck,
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
      "arbitrum",
      "optimism",
      "base",
      "avalanche",
    ].includes(chain.toLowerCase()),
  );
  MockAdapter.getSupportedBlockchains = jest.fn(() => [
    "stellar",
    "algorand",
    "solana",
    "ethereum",
    "onemoney",
    "polygon",
    "arbitrum",
    "optimism",
    "base",
    "avalanche",
  ]);
  return MockAdapter;
});

// ── Mock app config ──────────────────────────────────────────────
jest.mock("../../app.config", () => ({
  hsm: {
    enabled: true,
    tier: "envelope",
  },
}));

// Set env for admin auth
process.env.ADMIN_API_KEY = "test-admin-key-12345";

const keyRoutes = require("../../api/key-routes");

// ── Build test Express app ───────────────────────────────────────
function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/keys", keyRoutes);
  return app;
}

const AUTH_HEADER = { "X-Admin-API-Key": "test-admin-key-12345" };

// ══════════════════════════════════════════════════════════════════
//  Tests
// ══════════════════════════════════════════════════════════════════

describe("Key Management Routes", () => {
  let app;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Authentication ──────────────────────────────────────────────

  describe("authentication", () => {
    it("should reject requests without admin API key", async () => {
      const res = await request(app)
        .post("/keys")
        .send({ blockchain: "stellar" });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Authentication required");
    });

    it("should reject requests with invalid API key", async () => {
      const res = await request(app)
        .post("/keys")
        .set("X-Admin-API-Key", "wrong-key")
        .send({ blockchain: "stellar" });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Forbidden");
    });

    it("should accept requests with valid API key", async () => {
      mockCreateKey.mockResolvedValue({ keyId: "k1", publicKey: "pub1" });

      const res = await request(app)
        .post("/keys")
        .set(AUTH_HEADER)
        .send({ blockchain: "stellar" });

      expect(res.status).toBe(201);
    });
  });

  // ── POST /keys ──────────────────────────────────────────────────

  describe("POST /keys", () => {
    it("should create a key for a supported blockchain", async () => {
      mockCreateKey.mockResolvedValue({
        keyId: "key-123",
        publicKey: "GABCDEF",
      });

      const res = await request(app)
        .post("/keys")
        .set(AUTH_HEADER)
        .send({ blockchain: "stellar" });

      expect(res.status).toBe(201);
      expect(res.body.keyId).toBe("key-123");
      expect(res.body.publicKey).toBe("GABCDEF");
      expect(res.body.blockchain).toBe("stellar");
      expect(res.body.createdAt).toBeDefined();
      expect(mockCreateKey).toHaveBeenCalledWith("stellar", {});
    });

    it("should pass options to createKey", async () => {
      mockCreateKey.mockResolvedValue({ keyId: "key-456", publicKey: "0xabc" });

      const res = await request(app)
        .post("/keys")
        .set(AUTH_HEADER)
        .send({ blockchain: "ethereum", options: { label: "prod-signer" } });

      expect(res.status).toBe(201);
      expect(mockCreateKey).toHaveBeenCalledWith("ethereum", {
        label: "prod-signer",
      });
    });

    it("should reject missing blockchain", async () => {
      const res = await request(app).post("/keys").set(AUTH_HEADER).send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/blockchain is required/);
    });

    it("should reject unsupported blockchain", async () => {
      const res = await request(app)
        .post("/keys")
        .set(AUTH_HEADER)
        .send({ blockchain: "dogecoin" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Unsupported blockchain");
      expect(res.body.supportedBlockchains).toBeDefined();
    });

    it("should handle adapter errors gracefully", async () => {
      mockCreateKey.mockRejectedValue(new Error("HSM unavailable"));

      const res = await request(app)
        .post("/keys")
        .set(AUTH_HEADER)
        .send({ blockchain: "stellar" });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Key creation failed");
      expect(res.body.message).toBe("HSM unavailable");
    });
  });

  // ── GET /keys/health ────────────────────────────────────────────

  describe("GET /keys/health", () => {
    it("should return healthy status", async () => {
      mockHealthCheck.mockResolvedValue({
        status: "ok",
        tier: "envelope",
        latencyMs: 12,
      });

      const res = await request(app).get("/keys/health").set(AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.timestamp).toBeDefined();
    });

    it("should return 503 when HSM is unhealthy", async () => {
      mockHealthCheck.mockResolvedValue({
        status: "error",
        error: "Connection refused",
      });

      const res = await request(app).get("/keys/health").set(AUTH_HEADER);

      expect(res.status).toBe(503);
      expect(res.body.status).toBe("error");
    });

    it("should handle health check exceptions", async () => {
      mockHealthCheck.mockRejectedValue(new Error("HSM timeout"));

      const res = await request(app).get("/keys/health").set(AUTH_HEADER);

      expect(res.status).toBe(503);
      expect(res.body.status).toBe("error");
      expect(res.body.error).toBe("HSM timeout");
    });
  });

  // ── GET /keys/:keyId ────────────────────────────────────────────

  describe("GET /keys/:keyId", () => {
    it("should return key metadata", async () => {
      mockGetKeyMetadata.mockResolvedValue({
        publicKey: "GABCDEF",
        blockchain: "stellar",
        status: "active",
      });

      const res = await request(app).get("/keys/key-123").set(AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.keyId).toBe("key-123");
      expect(res.body.publicKey).toBe("GABCDEF");
      expect(res.body.retrievedAt).toBeDefined();
    });

    it("should return 404 for unknown key", async () => {
      mockGetKeyMetadata.mockResolvedValue(null);

      const res = await request(app).get("/keys/nonexistent").set(AUTH_HEADER);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Key not found");
    });

    it("should handle errors gracefully", async () => {
      mockGetKeyMetadata.mockRejectedValue(new Error("DB error"));

      const res = await request(app).get("/keys/key-err").set(AUTH_HEADER);

      expect(res.status).toBe(500);
      expect(res.body.message).toBe("DB error");
    });
  });

  // ── POST /keys/:keyId/sign ──────────────────────────────────────

  describe("POST /keys/:keyId/sign", () => {
    it("should sign data with the specified key", async () => {
      mockSignMethod.mockResolvedValue({
        signature: "sig-base64",
        publicKey: "GABCDEF",
      });

      const res = await request(app)
        .post("/keys/key-123/sign")
        .set(AUTH_HEADER)
        .send({
          blockchain: "stellar",
          payload: { xdr: "some-xdr-data" },
        });

      expect(res.status).toBe(200);
      expect(res.body.keyId).toBe("key-123");
      expect(res.body.blockchain).toBe("stellar");
      expect(res.body.result).toEqual({
        signature: "sig-base64",
        publicKey: "GABCDEF",
      });
      expect(res.body.signedAt).toBeDefined();
      expect(mockSignMethod).toHaveBeenCalledWith("stellar", "key-123", {
        xdr: "some-xdr-data",
      });
    });

    it("should reject missing blockchain", async () => {
      const res = await request(app)
        .post("/keys/key-123/sign")
        .set(AUTH_HEADER)
        .send({ payload: "data" });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/blockchain is required/);
    });

    it("should reject missing payload", async () => {
      const res = await request(app)
        .post("/keys/key-123/sign")
        .set(AUTH_HEADER)
        .send({ blockchain: "stellar" });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/payload is required/);
    });

    it("should reject unsupported blockchain", async () => {
      const res = await request(app)
        .post("/keys/key-123/sign")
        .set(AUTH_HEADER)
        .send({ blockchain: "dogecoin", payload: "data" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Unsupported blockchain");
    });

    it("should handle signing errors", async () => {
      mockSignMethod.mockRejectedValue(new Error("Signing failed"));

      const res = await request(app)
        .post("/keys/key-123/sign")
        .set(AUTH_HEADER)
        .send({ blockchain: "stellar", payload: "data" });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Signing failed");
    });
  });

  // ── POST /keys/:keyId/rotate ────────────────────────────────────

  describe("POST /keys/:keyId/rotate", () => {
    it("should rotate a key", async () => {
      mockRotateKey.mockResolvedValue({
        newKeyId: "key-456",
        publicKey: "NEW_PUB_KEY",
      });

      const res = await request(app)
        .post("/keys/key-123/rotate")
        .set(AUTH_HEADER)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.oldKeyId).toBe("key-123");
      expect(res.body.newKeyId).toBe("key-456");
      expect(res.body.rotatedAt).toBeDefined();
    });

    it("should pass rotation options", async () => {
      mockRotateKey.mockResolvedValue({
        newKeyId: "key-789",
        publicKey: "PUB",
      });

      const res = await request(app)
        .post("/keys/key-123/rotate")
        .set(AUTH_HEADER)
        .send({ options: { reason: "scheduled-rotation" } });

      expect(res.status).toBe(200);
      expect(mockRotateKey).toHaveBeenCalledWith(
        expect.objectContaining({
          keyId: "key-123",
          reason: "scheduled-rotation",
        }),
      );
    });

    it("should handle rotation errors", async () => {
      mockRotateKey.mockRejectedValue(new Error("Rotation failed"));

      const res = await request(app)
        .post("/keys/key-123/rotate")
        .set(AUTH_HEADER)
        .send({});

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Key rotation failed");
    });
  });

  // ── DELETE /keys/:keyId ─────────────────────────────────────────

  describe("DELETE /keys/:keyId", () => {
    it("should disable a key", async () => {
      mockDisableKey.mockResolvedValue(true);

      const res = await request(app).delete("/keys/key-123").set(AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.keyId).toBe("key-123");
      expect(res.body.status).toBe("disabled");
      expect(res.body.disabledAt).toBeDefined();
    });

    it("should handle disable errors", async () => {
      mockDisableKey.mockRejectedValue(new Error("Cannot disable active key"));

      const res = await request(app).delete("/keys/key-123").set(AUTH_HEADER);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Key disable failed");
    });
  });
});
