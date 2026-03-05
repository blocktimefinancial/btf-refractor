/**
 * Integration Tests — Full HTTP request lifecycle
 *
 * Uses supertest to exercise the Express app end-to-end with an in-memory
 * data provider. No real database or network connections needed.
 */

const request = require("supertest");

let app;

beforeAll(async () => {
  const { buildApp } = require("./app-builder");
  app = await buildApp();
});

// ── Root / service info ────────────────────────────────────────────

describe("GET /", () => {
  it("returns service info with version and name", async () => {
    const res = await request(app).get("/").expect(200);

    expect(res.body).toHaveProperty("service");
    expect(res.body).toHaveProperty("version");
    expect(res.body).toHaveProperty("started");
    expect(typeof res.body.service).toBe("string");
    expect(typeof res.body.version).toBe("string");
  });
});

// ── GET /tx/:hash ──────────────────────────────────────────────────

describe("GET /tx/:hash", () => {
  it("returns 404 for a non-existent transaction", async () => {
    const fakeHash =
      "0000000000000000000000000000000000000000000000000000000000000000";
    const res = await request(app).get(`/tx/${fakeHash}`).expect(404);

    expect(res.body).toHaveProperty("error");
    expect(res.body.status).toBe(404);
  });

  it("returns 400 for an invalid hash format", async () => {
    const res = await request(app).get("/tx/not-a-valid-hash").expect(400);

    expect(res.body).toHaveProperty("error");
  });
});

// ── POST /tx ──────────────────────────────────────────────────────

describe("POST /tx", () => {
  it("returns 400 for an empty body", async () => {
    const res = await request(app)
      .post("/tx")
      .send({})
      .set("Content-Type", "application/json")
      .expect(400);

    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 for missing required fields", async () => {
    const res = await request(app)
      .post("/tx")
      .send({ submit: true })
      .set("Content-Type", "application/json")
      .expect(400);

    expect(res.body).toHaveProperty("error");
  });

  it("rejects non-Stellar blockchains with 501", async () => {
    const res = await request(app)
      .post("/tx")
      .send({
        blockchain: "ethereum",
        networkName: "mainnet",
        payload: "0xdeadbeef",
        encoding: "hex",
      })
      .set("Content-Type", "application/json")
      .expect(501);

    expect(res.body.error).toMatch(/not yet fully implemented/i);
  });
});

// ── Monitoring health check ────────────────────────────────────────

describe("GET /monitoring/health", () => {
  it("returns health status (may be degraded without finalizer)", async () => {
    const res = await request(app).get("/monitoring/health");

    // 200 (healthy) or 503 (degraded/unhealthy — no finalizer running in test env)
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty("status");
    expect(["ok", "degraded", "unhealthy"]).toContain(res.body.status);
  });
});

// ── Error handling ─────────────────────────────────────────────────

describe("Error handling", () => {
  it("returns 413 for oversized payloads", async () => {
    // Send a payload much larger than 1mb limit
    const largePayload = "x".repeat(2 * 1024 * 1024);
    const res = await request(app)
      .post("/tx")
      .send({ xdr: largePayload, network: 1 })
      .set("Content-Type", "application/json");

    // Could be 413 (entity too large) or 400 (depends on body-parser behavior)
    expect([400, 413]).toContain(res.status);
  });
});
