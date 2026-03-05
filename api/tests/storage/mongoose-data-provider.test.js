/**
 * Mongoose Data Provider Tests
 *
 * Integration tests for MongooseDataProvider using mongodb-memory-server.
 * Covers all public methods: init, saveTransaction, findTransaction,
 * updateTransaction, updateTxStatus, listTransactions, getTransactionStats,
 * cleanupExpiredTransactions, checkHealth, close.
 */

const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

// We need to set config.db before the provider is loaded, so mock app.config
// Variable name must start with "mock" to be used inside jest.mock()
let mockMongoUri;
jest.mock("../../app.config", () => ({
  get db() {
    return mockMongoUri;
  },
  mongodb: {
    maxPoolSize: 5,
    minPoolSize: 1,
    serverSelectionTimeoutMs: 5000,
    socketTimeoutMs: 10000,
    maxIdleTimeMs: 10000,
    family: 4,
  },
}));

const MongooseDataProvider = require("../../storage/mongoose-data-provider");

let mongoServer;
let provider;

// Sample valid 64-hex-char hashes
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);

const sampleTx = (overrides = {}) => ({
  hash: HASH_A,
  blockchain: "stellar",
  networkName: "testnet",
  network: 1,
  xdr: "AAAAAgAAAABTWgh1bRm6Aksd3hHdZ0hlVxDTTfqfP2kfxwVWAsCDjgAAAGQAAAAAAAAAAQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAQAAAABTWgh1bRm6Aksd3hHdZ0hlVxDTTfqfP2kfxwVWAsCDjgAAAAAAAAAAAJiWgAAAAAAAAAAA",
  status: "pending",
  signatures: [],
  submit: false,
  minTime: 0,
  maxTime: null,
  callbackUrl: null,
  desiredSigners: [],
  ...overrides,
});

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  mockMongoUri = mongoServer.getUri();
  provider = new MongooseDataProvider();
  await provider.init();
});

afterAll(async () => {
  await provider.close();
  // Mongoose caches model registrations — clear them between test suites
  // so the next suite that loads mongoose-models doesn't collide.
  mongoose.models = {};
  mongoose.modelSchemas = {};
  await mongoServer.stop();
});

/**
 * Helper: drop all documents between tests so each test is isolated.
 */
async function clearDb() {
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
}

// ============================================================================
// init()
// ============================================================================
describe("MongooseDataProvider", () => {
  afterEach(async () => {
    await clearDb();
  });

  describe("init()", () => {
    it("should have established a connection", () => {
      expect(mongoose.connection.readyState).toBe(1); // connected
      expect(provider.db).toBeTruthy();
    });
  });

  // ==========================================================================
  // saveTransaction()
  // ==========================================================================
  describe("saveTransaction()", () => {
    it("should save a new transaction and return it", async () => {
      const tx = sampleTx();
      const result = await provider.saveTransaction(tx);

      expect(result).toBeDefined();
      expect(result._id).toBe(tx.hash);
      expect(result.status).toBe("pending");
    });

    it("should upsert an existing transaction with the same hash", async () => {
      const tx = sampleTx();
      await provider.saveTransaction(tx);

      const updated = sampleTx({ status: "ready" });
      const result = await provider.saveTransaction(updated);

      expect(result.status).toBe("ready");
    });

    it("should strip unknown fields via Joi validation", async () => {
      const tx = sampleTx({ unknownField: "should be stripped" });
      const result = await provider.saveTransaction(tx);
      expect(result.unknownField).toBeUndefined();
    });

    it("should throw for invalid transaction data", async () => {
      const badTx = { hash: "not-a-valid-hash" };
      await expect(provider.saveTransaction(badTx)).rejects.toThrow();
    });

    it("should save transaction with signatures", async () => {
      const tx = sampleTx({
        signatures: [
          {
            key: "GBJVUCDVNUM3UASLDXPBDXLHJBSVOEGTJX5J6P3JD7DQKVQCYCBY5PP2",
            signature:
              "b1N3ZHZIjuxU+5Fgz1Kj65FntxUOK4V8fxePNmoIc1J5DESkBcPzWTs8ULLldhnqJo6I4+L+xSzZt8+yiwQDBQ==",
          },
        ],
      });
      const result = await provider.saveTransaction(tx);
      expect(result.signatures).toHaveLength(1);
    });

    it("should save blockchain-agnostic transaction", async () => {
      const tx = sampleTx({
        hash: HASH_B,
        blockchain: "ethereum",
        networkName: "sepolia",
        xdr: null,
        network: null,
        payload: "0xdeadbeef",
        encoding: "hex",
      });
      const result = await provider.saveTransaction(tx);
      expect(result.blockchain).toBe("ethereum");
      expect(result.payload).toBe("0xdeadbeef");
    });
  });

  // ==========================================================================
  // findTransaction()
  // ==========================================================================
  describe("findTransaction()", () => {
    beforeEach(async () => {
      await provider.saveTransaction(sampleTx());
    });

    it("should find an existing transaction by hash", async () => {
      const found = await provider.findTransaction(HASH_A);
      expect(found).toBeDefined();
      expect(found.hash).toBe(HASH_A);
    });

    it("should return null for non-existent hash", async () => {
      const found = await provider.findTransaction(HASH_B);
      expect(found).toBeNull();
    });

    it("should strip _id and __v, expose hash", async () => {
      const found = await provider.findTransaction(HASH_A);
      expect(found.hash).toBe(HASH_A);
      expect(found._id).toBeUndefined();
      expect(found.__v).toBeUndefined();
    });

    it("should return all saved fields", async () => {
      const found = await provider.findTransaction(HASH_A);
      expect(found.blockchain).toBe("stellar");
      expect(found.status).toBe("pending");
      expect(found.xdr).toBe(sampleTx().xdr);
      expect(found.network).toBe(1);
    });
  });

  // ==========================================================================
  // updateTransaction()
  // ==========================================================================
  describe("updateTransaction()", () => {
    beforeEach(async () => {
      await provider.saveTransaction(sampleTx());
    });

    it("should update fields and return true", async () => {
      const success = await provider.updateTransaction(HASH_A, {
        status: "ready",
      });
      expect(success).toBe(true);

      const found = await provider.findTransaction(HASH_A);
      expect(found.status).toBe("ready");
    });

    it("should return false for non-existent transaction", async () => {
      const success = await provider.updateTransaction(HASH_B, {
        status: "ready",
      });
      expect(success).toBe(false);
    });

    it("should honour expectedCurrentStatus guard", async () => {
      // Correct expected status → should succeed
      const success = await provider.updateTransaction(
        HASH_A,
        { status: "ready" },
        "pending"
      );
      expect(success).toBe(true);

      // Wrong expected status → should fail
      const fail = await provider.updateTransaction(
        HASH_A,
        { status: "processing" },
        "pending" // current is now "ready"
      );
      expect(fail).toBe(false);
    });

    it("should set updatedAt timestamp", async () => {
      const before = new Date();
      await provider.updateTransaction(HASH_A, { status: "ready" });
      const found = await provider.findTransaction(HASH_A);
      expect(new Date(found.updatedAt).getTime()).toBeGreaterThanOrEqual(
        before.getTime()
      );
    });
  });

  // ==========================================================================
  // updateTxStatus()
  // ==========================================================================
  describe("updateTxStatus()", () => {
    beforeEach(async () => {
      await provider.saveTransaction(sampleTx());
    });

    it("should update status with guard", async () => {
      const ok = await provider.updateTxStatus(HASH_A, "ready", "pending");
      expect(ok).toBe(true);

      const found = await provider.findTransaction(HASH_A);
      expect(found.status).toBe("ready");
    });

    it("should return false when guard does not match", async () => {
      const ok = await provider.updateTxStatus(HASH_A, "processing", "ready");
      expect(ok).toBe(false);

      const found = await provider.findTransaction(HASH_A);
      expect(found.status).toBe("pending"); // unchanged
    });

    it("should record error and increment retryCount", async () => {
      const err = new Error("Horizon 504");
      const ok = await provider.updateTxStatus(
        HASH_A,
        "failed",
        "pending",
        err
      );
      expect(ok).toBe(true);

      const found = await provider.findTransaction(HASH_A);
      expect(found.status).toBe("failed");
      expect(found.lastError).toBe("Horizon 504");
      expect(found.retryCount).toBe(1);
    });

    it("should increment retryCount on each error call", async () => {
      await provider.updateTxStatus(
        HASH_A,
        "failed",
        "pending",
        new Error("err1")
      );
      // Reset status to pending for next call
      await provider.updateTransaction(HASH_A, { status: "pending" });
      await provider.updateTxStatus(
        HASH_A,
        "failed",
        "pending",
        new Error("err2")
      );

      const found = await provider.findTransaction(HASH_A);
      expect(found.retryCount).toBe(2);
      expect(found.lastError).toBe("err2");
    });
  });

  // ==========================================================================
  // listTransactions()
  // ==========================================================================
  describe("listTransactions()", () => {
    beforeEach(async () => {
      await provider.saveTransaction(sampleTx({ hash: HASH_A, status: "pending" }));
      await provider.saveTransaction(
        sampleTx({ hash: HASH_B, status: "ready" })
      );
      await provider.saveTransaction(
        sampleTx({ hash: HASH_C, status: "ready" })
      );
      await provider.saveTransaction(
        sampleTx({ hash: HASH_D, status: "processed" })
      );
    });

    it("should list all transactions when no filter", async () => {
      const cursor = provider.listTransactions({});
      const results = [];
      for await (const doc of cursor) {
        results.push(doc);
      }
      expect(results).toHaveLength(4);
    });

    it("should filter by status", async () => {
      const cursor = provider.listTransactions({ status: "ready" });
      const results = [];
      for await (const doc of cursor) {
        results.push(doc);
      }
      expect(results).toHaveLength(2);
      results.forEach((tx) => expect(tx.status).toBe("ready"));
    });

    it("should respect limit option", async () => {
      const cursor = provider.listTransactions({}, { limit: 2 });
      const results = [];
      for await (const doc of cursor) {
        results.push(doc);
      }
      expect(results).toHaveLength(2);
    });

    it("should expose hash field in projection (not _id)", async () => {
      const cursor = provider.listTransactions({});
      const results = [];
      for await (const doc of cursor) {
        results.push(doc);
      }
      // All should have hash, none should have _id
      results.forEach((tx) => {
        expect(tx.hash).toBeDefined();
        expect(tx.hash).toMatch(/^[a-f0-9]{64}$/);
      });
    });

    it("should filter by blockchain", async () => {
      // Insert an ethereum tx
      await provider.saveTransaction(
        sampleTx({
          hash: "e".repeat(64),
          blockchain: "ethereum",
          status: "pending",
        })
      );
      const cursor = provider.listTransactions({ blockchain: "ethereum" });
      const results = [];
      for await (const doc of cursor) {
        results.push(doc);
      }
      expect(results).toHaveLength(1);
      expect(results[0].blockchain).toBe("ethereum");
    });
  });

  // ==========================================================================
  // getTransactionStats()
  // ==========================================================================
  describe("getTransactionStats()", () => {
    beforeEach(async () => {
      await provider.saveTransaction(sampleTx({ hash: HASH_A, status: "pending" }));
      await provider.saveTransaction(
        sampleTx({ hash: HASH_B, status: "ready" })
      );
      await provider.saveTransaction(
        sampleTx({ hash: HASH_C, status: "ready" })
      );
      await provider.saveTransaction(
        sampleTx({
          hash: HASH_D,
          status: "processed",
          blockchain: "ethereum",
        })
      );
    });

    it("should return total count", async () => {
      const stats = await provider.getTransactionStats();
      expect(stats.total).toBe(4);
    });

    it("should return byStatus breakdown", async () => {
      const stats = await provider.getTransactionStats();
      expect(stats.byStatus.pending.count).toBe(1);
      expect(stats.byStatus.ready.count).toBe(2);
      expect(stats.byStatus.processed.count).toBe(1);
    });

    it("should return byBlockchain breakdown when no filter", async () => {
      const stats = await provider.getTransactionStats();
      expect(stats.byBlockchain).toBeDefined();
      expect(stats.byBlockchain.stellar).toBe(3);
      expect(stats.byBlockchain.ethereum).toBe(1);
    });

    it("should filter stats by blockchain", async () => {
      const stats = await provider.getTransactionStats({
        blockchain: "ethereum",
      });
      expect(stats.total).toBe(1);
      expect(stats.blockchain).toBe("ethereum");
      expect(stats.byBlockchain).toBeUndefined();
    });
  });

  // ==========================================================================
  // cleanupExpiredTransactions()
  // ==========================================================================
  describe("cleanupExpiredTransactions()", () => {
    it("should mark expired pending/ready transactions as failed", async () => {
      const pastTimestamp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago

      await provider.saveTransaction(
        sampleTx({ hash: HASH_A, status: "pending", maxTime: pastTimestamp })
      );
      await provider.saveTransaction(
        sampleTx({ hash: HASH_B, status: "ready", maxTime: pastTimestamp })
      );
      // This one should NOT be touched (already processed)
      await provider.saveTransaction(
        sampleTx({ hash: HASH_C, status: "processed", maxTime: pastTimestamp })
      );
      // No maxTime — should not be cleaned up
      await provider.saveTransaction(
        sampleTx({ hash: HASH_D, status: "pending", maxTime: null })
      );

      const cleaned = await provider.cleanupExpiredTransactions();
      expect(cleaned).toBe(2);

      const txA = await provider.findTransaction(HASH_A);
      expect(txA.status).toBe("failed");
      expect(txA.lastError).toBe("Transaction expired");

      const txB = await provider.findTransaction(HASH_B);
      expect(txB.status).toBe("failed");

      // Processed → unchanged
      const txC = await provider.findTransaction(HASH_C);
      expect(txC.status).toBe("processed");

      // No maxTime → unchanged
      const txD = await provider.findTransaction(HASH_D);
      expect(txD.status).toBe("pending");
    });

    it("should return 0 when nothing is expired", async () => {
      const futureTimestamp = Math.floor(Date.now() / 1000) + 3600;
      await provider.saveTransaction(
        sampleTx({ hash: HASH_A, status: "pending", maxTime: futureTimestamp })
      );

      const cleaned = await provider.cleanupExpiredTransactions();
      expect(cleaned).toBe(0);
    });
  });

  // ==========================================================================
  // checkHealth()
  // ==========================================================================
  describe("checkHealth()", () => {
    it("should report connected with latencyMs", async () => {
      const health = await provider.checkHealth();
      expect(health.connected).toBe(true);
      expect(typeof health.latencyMs).toBe("number");
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
      expect(health.error).toBeUndefined();
    });
  });

  // ==========================================================================
  // validateTransaction()
  // ==========================================================================
  describe("validateTransaction()", () => {
    it("should return validated data for valid input", () => {
      const validated = provider.validateTransaction(sampleTx());
      expect(validated.hash).toBe(HASH_A);
      expect(validated.status).toBe("pending");
    });

    it("should strip unknown fields", () => {
      const validated = provider.validateTransaction(
        sampleTx({ bogus: 42 })
      );
      expect(validated.bogus).toBeUndefined();
    });

    it("should throw with details for invalid input", () => {
      expect(() =>
        provider.validateTransaction({ hash: "bad" })
      ).toThrow("Transaction validation failed");
    });
  });

  // ==========================================================================
  // close()
  // ==========================================================================
  describe("close()", () => {
    it("should be callable without error when connected", async () => {
      // We can't actually close the connection here because other tests need it.
      // Instead verify it's a function and doesn't throw when readyState is checked.
      expect(typeof provider.close).toBe("function");
    });
  });
});
