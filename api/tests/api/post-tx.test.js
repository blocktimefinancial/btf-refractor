/**
 * POST /tx Integration Tests
 *
 * Tests the full POST /tx flow through Express with:
 * - Validation middleware (Joi schema)
 * - Request adapter (normalizeRequest / isStellarRequest / toLegacyFormat)
 * - Signer lifecycle (construct → init → processNewSignatures → saveChanges)
 * - Response augmentation with blockchain metadata
 *
 * Dependencies are mocked at the module boundary so the route handler runs
 * its real logic while Signer internals and storage are faked.
 */

const express = require("express");
const request = require("supertest");

// ── Mock fns (must be declared before jest.mock calls) ───────────

const mockSignerInit = jest.fn();
const mockProcessNewSignatures = jest.fn();
const mockSaveChanges = jest.fn();
const mockToJSON = jest.fn();

const STELLAR_HASH =
  "89d6c423a51e030b392f0e7505e9f3b66be11cb1477aecda79a34e5ae61060e4";

// ── Module mocks ─────────────────────────────────────────────────

// Signer — mock the whole class so we don't need to wire up strategies/storage
jest.mock("../../business-logic/signer", () => {
  return jest.fn().mockImplementation(() => ({
    init: mockSignerInit,
    processNewSignatures: mockProcessNewSignatures,
    saveChanges: mockSaveChanges,
    toJSON: mockToJSON,
    accepted: [],
    rejected: [],
    status: "created",
    hash: STELLAR_HASH,
    txInfo: {
      hash: STELLAR_HASH,
      status: "pending",
      signatures: [],
    },
  }));
});

// Storage layer — in-memory stubs (imported by modules we don't mock)
jest.mock("../../storage/storage-layer", () => ({
  dataProvider: {
    findTransaction: jest.fn(),
    saveTransaction: jest.fn(),
  },
}));

// app.config — minimal for validation + rate limit
jest.mock("../../app.config", () => ({
  rateLimit: {
    general: { windowMs: 60000, max: 1000 },
    strict: { windowMs: 60000, max: 100 },
  },
  maxPayloadSize: "1mb",
  cors: { blacklist: [] },
}));

// CORS middleware — pass-through
jest.mock("../../middleware/cors", () => ({
  createCorsMiddleware: () => (_req, _res, next) => next(),
}));

// Request-ID middleware — pass-through that attaches a noop logger
jest.mock("../../middleware/request-id", () => ({
  requestIdMiddleware: () => (_req, _res, next) => next(),
  getRequestLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

// Finalizer — stubbed
jest.mock("../../business-logic/finalization/finalizer", () => ({
  triggerImmediateCheck: jest.fn(),
  resetProcessingStatus: jest.fn(),
  start: jest.fn(),
}));

// blockchain-registry — support stellar for isStellarRequest path
jest.mock("../../business-logic/blockchain-registry", () => ({
  getSupportedBlockchains: () => [
    "stellar",
    "ethereum",
    "polygon",
    "arbitrum",
    "optimism",
    "base",
    "avalanche",
    "algorand",
    "solana",
    "onemoney",
  ],
  isValidBlockchain: (b) => ["stellar", "ethereum"].includes(b),
  isValidNetwork: () => true,
  getBlockchainConfig: () => ({
    name: "stellar",
    addressPattern: /^G[A-Z2-7]{55}$/,
  }),
}));

// Now require modules after mocking
const Signer = require("../../business-logic/signer");
const registerRoutes = require("../../api/api-routes");
const ValidationMiddleware = require("../../middleware/validation");

// ── Test app factory ─────────────────────────────────────────────

function createApp() {
  const app = express();
  app.use(express.json());
  registerRoutes(app);
  app.use(ValidationMiddleware.errorHandler());
  return app;
}

// ── Sample payloads ──────────────────────────────────────────────

const VALID_XDR =
  "AAAAAgAAAABTWgh1bRm6Aksd3hHdZ0hlVxDTTfqfP2kfxwVWAsCDjgAAAGQAAAAAAAAAAQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAQAAAABTWgh1bRm6Aksd3hHdZ0hlVxDTTfqfP2kfxwVWAsCDjgAAAAAAAAAAAJiWgAAAAAAAAAAA";

// ══════════════════════════════════════════════════════════════════
//  Tests
// ══════════════════════════════════════════════════════════════════

describe("POST /tx", () => {
  let app;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Default: Signer mocks return sensible values
    mockSignerInit.mockResolvedValue(undefined);
    mockProcessNewSignatures.mockReturnValue(undefined);
    mockSaveChanges.mockResolvedValue(undefined);
    mockToJSON.mockReturnValue({
      hash: STELLAR_HASH,
      status: "pending",
      signatures: [],
      xdr: VALID_XDR,
      network: 1,
      changes: { accepted: [], rejected: [] },
    });
  });

  // ================================================================
  // Validation
  // ================================================================
  describe("validation", () => {
    it("should reject empty body", async () => {
      const res = await request(app).post("/tx").send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation failed");
    });

    it("should reject body with only unknown fields", async () => {
      const res = await request(app)
        .post("/tx")
        .send({ foo: "bar", baz: 123 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation failed");
    });

    it("should reject invalid XDR (empty string)", async () => {
      const res = await request(app)
        .post("/tx")
        .send({ xdr: "", network: 1 });

      expect(res.status).toBe(400);
    });

    it("should reject invalid network value", async () => {
      const res = await request(app)
        .post("/tx")
        .send({ xdr: VALID_XDR, network: 99 });

      expect(res.status).toBe(400);
    });

    it("should accept valid legacy Stellar payload", async () => {
      const res = await request(app)
        .post("/tx")
        .send({ xdr: VALID_XDR, network: 1 });

      // Should not be a validation error — could be 200 or 501 depending on Signer's state
      expect(res.status).not.toBe(400);
    });

    it("should accept network as string name", async () => {
      const res = await request(app)
        .post("/tx")
        .send({ xdr: VALID_XDR, network: "testnet" });

      expect(res.status).not.toBe(400);
    });
  });

  // ================================================================
  // Successful transaction submission (legacy Stellar format)
  // ================================================================
  describe("successful legacy submission", () => {
    it("should return 200 with transaction data", async () => {
      const res = await request(app)
        .post("/tx")
        .send({ xdr: VALID_XDR, network: 1 });

      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();
      // Should have blockchain-agnostic metadata
      expect(res.body.blockchain).toBe("stellar");
      expect(res.body.networkName).toBeDefined();
    });

    it("should return hash in response", async () => {
      const res = await request(app)
        .post("/tx")
        .send({ xdr: VALID_XDR, network: 1 });

      expect(res.status).toBe(200);
      expect(res.body.hash).toBeDefined();
      expect(res.body.hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should call Signer lifecycle methods", async () => {
      await request(app).post("/tx").send({ xdr: VALID_XDR, network: 1 });

      expect(Signer).toHaveBeenCalledTimes(1);
      expect(mockSignerInit).toHaveBeenCalledTimes(1);
      expect(mockProcessNewSignatures).toHaveBeenCalledTimes(1);
      expect(mockSaveChanges).toHaveBeenCalledTimes(1);
    });

    it("should include changes (accepted/rejected) in response", async () => {
      const res = await request(app)
        .post("/tx")
        .send({ xdr: VALID_XDR, network: 1 });

      expect(res.status).toBe(200);
      expect(res.body.changes).toBeDefined();
      expect(Array.isArray(res.body.changes.accepted)).toBe(true);
      expect(Array.isArray(res.body.changes.rejected)).toBe(true);
    });

    it("should handle submission with optional fields", async () => {
      const res = await request(app).post("/tx").send({
        xdr: VALID_XDR,
        network: 1,
        submit: true,
        callbackUrl: "https://example.com/callback",
        desiredSigners: [],
        minTime: 0,
        maxTime: null,
      });

      expect(res.status).toBe(200);
    });
  });

  // ================================================================
  // Existing transaction (re-submission / update)
  // ================================================================
  describe("re-submission of existing transaction", () => {
    it("should return 200 for re-submitted tx with signatures", async () => {
      // Signer returns an "updated" response with accepted signatures
      mockToJSON.mockReturnValue({
        hash: STELLAR_HASH,
        status: "ready",
        signatures: [
          {
            key: "GBJVUCDVNUM3UASLDXPBDXLHJBSVOEGTJX5J6P3JD7DQKVQCYCBY5PP2",
            signature: "dGVzdHNpZw==",
          },
        ],
        xdr: VALID_XDR,
        network: 1,
        changes: {
          accepted: [
            "GBJVUCDVNUM3UASLDXPBDXLHJBSVOEGTJX5J6P3JD7DQKVQCYCBY5PP2",
          ],
          rejected: [],
        },
      });

      const res = await request(app).post("/tx").send({
        xdr: VALID_XDR,
        network: 1,
        signatures: [
          {
            key: "GBJVUCDVNUM3UASLDXPBDXLHJBSVOEGTJX5J6P3JD7DQKVQCYCBY5PP2",
            signature: "dGVzdHNpZw==",
          },
        ],
      });

      expect(res.status).toBe(200);
      expect(res.body.hash).toBeDefined();
      expect(res.body.changes.accepted).toHaveLength(1);
    });
  });

  // ================================================================
  // Non-Stellar blockchain → 501
  // ================================================================
  describe("non-Stellar blockchain", () => {
    it("should return 501 for blockchain-agnostic format", async () => {
      const res = await request(app).post("/tx").send({
        blockchain: "ethereum",
        networkName: "sepolia",
        payload: "0xdeadbeef",
        encoding: "hex",
      });

      expect(res.status).toBe(501);
      expect(res.body.error).toMatch(/not yet fully implemented/i);
    });
  });

  // ================================================================
  // Content-Type handling
  // ================================================================
  describe("content-type handling", () => {
    it("should reject non-JSON content type", async () => {
      const res = await request(app)
        .post("/tx")
        .set("Content-Type", "text/plain")
        .send("not json");

      // Express json parser will fail or body will be empty
      expect([400, 422, 500]).toContain(res.status);
    });
  });

  // ================================================================
  // OPTIONS pre-flight
  // ================================================================
  describe("CORS pre-flight", () => {
    it("should respond to OPTIONS /tx", async () => {
      const res = await request(app).options("/tx");

      // Router registers OPTIONS handler that returns method name
      expect(res.status).toBe(200);
    });
  });
});
