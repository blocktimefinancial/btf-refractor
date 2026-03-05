// Load environment variables first
require("dotenv").config();

// Load base configuration from JSON
const baseConfig = require("./app.config.json");

// Create enhanced configuration with environment variable support
const config = {
  ...baseConfig,

  // Override storage to use mongoose and MongoDB
  storage: process.env.STORAGE_TYPE || "mongoose",

  // Use environment variable for MongoDB connection
  db:
    process.env.MONGODB_URL ||
    baseConfig.db ||
    "mongodb://localhost:27017/refractor",

  // Request payload size limit
  maxPayloadSize:
    process.env.MAX_PAYLOAD_SIZE || baseConfig.maxPayloadSize || "1mb",

  // Graceful shutdown force-exit timeout (ms)
  gracefulShutdownTimeoutMs: process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS
    ? parseInt(process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS, 10)
    : baseConfig.gracefulShutdownTimeoutMs || 10000,

  // Update network configurations with environment variables
  networks: {
    public: {
      horizon:
        process.env.HORIZON_PUBLIC_URL || baseConfig.networks.public.horizon,
      network: "PUBLIC",
      passphrase: baseConfig.networks.public.passphrase,
    },
    testnet: {
      horizon:
        process.env.HORIZON_TESTNET_URL || baseConfig.networks.testnet.horizon,
      network: "TESTNET",
      passphrase: baseConfig.networks.testnet.passphrase,
    },
  },

  // Horizon min concurrency (always 1 unless overridden)
  horizonMinConcurrency: process.env.HORIZON_MIN_CONCURRENCY
    ? parseInt(process.env.HORIZON_MIN_CONCURRENCY, 10)
    : baseConfig.horizonMinConcurrency || 1,

  // Use environment variable for fee multiplier
  feeMultiplier: process.env.FEE_MULTIPLIER
    ? parseInt(process.env.FEE_MULTIPLIER, 10)
    : baseConfig.feeMultiplier || 1, // Default to 1 if not set

  // ── Rate Limiting ─────────────────────────────────────────────
  rateLimit: {
    general: {
      windowMs: process.env.RATE_LIMIT_WINDOW_MS
        ? parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10)
        : (baseConfig.rateLimit &&
            baseConfig.rateLimit.general &&
            baseConfig.rateLimit.general.windowMs) ||
          1000,
      max: process.env.RATE_LIMIT_MAX
        ? parseInt(process.env.RATE_LIMIT_MAX, 10)
        : (baseConfig.rateLimit &&
            baseConfig.rateLimit.general &&
            baseConfig.rateLimit.general.max) ||
          100,
    },
    strict: {
      windowMs: process.env.RATE_LIMIT_STRICT_WINDOW_MS
        ? parseInt(process.env.RATE_LIMIT_STRICT_WINDOW_MS, 10)
        : (baseConfig.rateLimit &&
            baseConfig.rateLimit.strict &&
            baseConfig.rateLimit.strict.windowMs) ||
          1000,
      max: process.env.RATE_LIMIT_STRICT_MAX
        ? parseInt(process.env.RATE_LIMIT_STRICT_MAX, 10)
        : (baseConfig.rateLimit &&
            baseConfig.rateLimit.strict &&
            baseConfig.rateLimit.strict.max) ||
          50,
    },
  },

  // ── CORS ──────────────────────────────────────────────────────
  cors: {
    maxAge: process.env.CORS_MAX_AGE
      ? parseInt(process.env.CORS_MAX_AGE, 10)
      : (baseConfig.cors && baseConfig.cors.maxAge) || 86400,
  },

  // ── MongoDB Connection Pool ───────────────────────────────────
  mongodb: {
    maxPoolSize: process.env.MONGODB_MAX_POOL_SIZE
      ? parseInt(process.env.MONGODB_MAX_POOL_SIZE, 10)
      : (baseConfig.mongodb && baseConfig.mongodb.maxPoolSize) || 10,
    minPoolSize: process.env.MONGODB_MIN_POOL_SIZE
      ? parseInt(process.env.MONGODB_MIN_POOL_SIZE, 10)
      : (baseConfig.mongodb && baseConfig.mongodb.minPoolSize) || 2,
    maxIdleTimeMs:
      (baseConfig.mongodb && baseConfig.mongodb.maxIdleTimeMs) || 30000,
    serverSelectionTimeoutMs:
      (baseConfig.mongodb && baseConfig.mongodb.serverSelectionTimeoutMs) ||
      5000,
    socketTimeoutMs:
      (baseConfig.mongodb && baseConfig.mongodb.socketTimeoutMs) || 45000,
    family: (baseConfig.mongodb && baseConfig.mongodb.family) || 4,
  },

  // ── Logging ───────────────────────────────────────────────────
  logging: {
    maxFileSize:
      (baseConfig.logging && baseConfig.logging.maxFileSize) ||
      10 * 1024 * 1024,
    maxFiles: (baseConfig.logging && baseConfig.logging.maxFiles) || 5,
  },

  // ── Circuit Breaker Defaults ──────────────────────────────────
  circuitBreaker: {
    horizon: {
      timeout:
        (baseConfig.circuitBreaker &&
          baseConfig.circuitBreaker.horizon &&
          baseConfig.circuitBreaker.horizon.timeout) ||
        10000,
      errorThresholdPercentage:
        (baseConfig.circuitBreaker &&
          baseConfig.circuitBreaker.horizon &&
          baseConfig.circuitBreaker.horizon.errorThresholdPercentage) ||
        50,
      resetTimeout:
        (baseConfig.circuitBreaker &&
          baseConfig.circuitBreaker.horizon &&
          baseConfig.circuitBreaker.horizon.resetTimeout) ||
        30000,
      volumeThreshold:
        (baseConfig.circuitBreaker &&
          baseConfig.circuitBreaker.horizon &&
          baseConfig.circuitBreaker.horizon.volumeThreshold) ||
        5,
    },
    evmRpc: {
      timeout:
        (baseConfig.circuitBreaker &&
          baseConfig.circuitBreaker.evmRpc &&
          baseConfig.circuitBreaker.evmRpc.timeout) ||
        15000,
      errorThresholdPercentage:
        (baseConfig.circuitBreaker &&
          baseConfig.circuitBreaker.evmRpc &&
          baseConfig.circuitBreaker.evmRpc.errorThresholdPercentage) ||
        50,
      resetTimeout:
        (baseConfig.circuitBreaker &&
          baseConfig.circuitBreaker.evmRpc &&
          baseConfig.circuitBreaker.evmRpc.resetTimeout) ||
        30000,
      volumeThreshold:
        (baseConfig.circuitBreaker &&
          baseConfig.circuitBreaker.evmRpc &&
          baseConfig.circuitBreaker.evmRpc.volumeThreshold) ||
        5,
    },
    hsm: {
      timeout:
        (baseConfig.circuitBreaker &&
          baseConfig.circuitBreaker.hsm &&
          baseConfig.circuitBreaker.hsm.timeout) ||
        5000,
      errorThresholdPercentage:
        (baseConfig.circuitBreaker &&
          baseConfig.circuitBreaker.hsm &&
          baseConfig.circuitBreaker.hsm.errorThresholdPercentage) ||
        30,
      resetTimeout:
        (baseConfig.circuitBreaker &&
          baseConfig.circuitBreaker.hsm &&
          baseConfig.circuitBreaker.hsm.resetTimeout) ||
        15000,
      volumeThreshold:
        (baseConfig.circuitBreaker &&
          baseConfig.circuitBreaker.hsm &&
          baseConfig.circuitBreaker.hsm.volumeThreshold) ||
        3,
    },
  },

  // ── Queue Tuning ──────────────────────────────────────────────
  queue: {
    maxProcessingTimeSamples:
      (baseConfig.queue && baseConfig.queue.maxProcessingTimeSamples) || 100,
    rateLimitBackoffMultiplier:
      (baseConfig.queue && baseConfig.queue.rateLimitBackoffMultiplier) || 3,
    rateLimitBackoffJitter:
      (baseConfig.queue && baseConfig.queue.rateLimitBackoffJitter) || 2000,
    rateLimitMaxDelay:
      (baseConfig.queue && baseConfig.queue.rateLimitMaxDelay) || 30000,
    rateLimitConcurrencyFactor:
      (baseConfig.queue && baseConfig.queue.rateLimitConcurrencyFactor) || 0.7,
    retryJitter: (baseConfig.queue && baseConfig.queue.retryJitter) || 1000,
    drainPollInterval:
      (baseConfig.queue && baseConfig.queue.drainPollInterval) || 100,
    adaptiveErrorRateThreshold:
      (baseConfig.queue && baseConfig.queue.adaptiveErrorRateThreshold) || 0.1,
    concurrencyReductionFactor:
      (baseConfig.queue && baseConfig.queue.concurrencyReductionFactor) || 0.8,
    bulkOps: {
      queueThreshold:
        (baseConfig.queue &&
          baseConfig.queue.bulkOps &&
          baseConfig.queue.bulkOps.queueThreshold) ||
        50,
      successThreshold:
        (baseConfig.queue &&
          baseConfig.queue.bulkOps &&
          baseConfig.queue.bulkOps.successThreshold) ||
        0.98,
      maxProcessingTime:
        (baseConfig.queue &&
          baseConfig.queue.bulkOps &&
          baseConfig.queue.bulkOps.maxProcessingTime) ||
        3000,
      concurrencyCap:
        (baseConfig.queue &&
          baseConfig.queue.bulkOps &&
          baseConfig.queue.bulkOps.concurrencyCap) ||
        0.7,
      slowThreshold:
        (baseConfig.queue &&
          baseConfig.queue.bulkOps &&
          baseConfig.queue.bulkOps.slowThreshold) ||
        8000,
      minSuccessRate:
        (baseConfig.queue &&
          baseConfig.queue.bulkOps &&
          baseConfig.queue.bulkOps.minSuccessRate) ||
        0.95,
    },
    normalOps: {
      scaleUpQueueFactor:
        (baseConfig.queue &&
          baseConfig.queue.normalOps &&
          baseConfig.queue.normalOps.scaleUpQueueFactor) ||
        2,
      successThreshold:
        (baseConfig.queue &&
          baseConfig.queue.normalOps &&
          baseConfig.queue.normalOps.successThreshold) ||
        0.98,
      maxProcessingTime:
        (baseConfig.queue &&
          baseConfig.queue.normalOps &&
          baseConfig.queue.normalOps.maxProcessingTime) ||
        4000,
      slowThreshold:
        (baseConfig.queue &&
          baseConfig.queue.normalOps &&
          baseConfig.queue.normalOps.slowThreshold) ||
        10000,
      minSuccessRate:
        (baseConfig.queue &&
          baseConfig.queue.normalOps &&
          baseConfig.queue.normalOps.minSuccessRate) ||
        0.9,
    },
    maxAdminConcurrency:
      (baseConfig.queue && baseConfig.queue.maxAdminConcurrency) || 100,
  },

  // ── Callback Retry ────────────────────────────────────────────
  callback: {
    retryMinShift:
      (baseConfig.callback && baseConfig.callback.retryMinShift) || 4,
    retryMaxShift:
      (baseConfig.callback && baseConfig.callback.retryMaxShift) || 12,
  },

  // ── Finalizer ─────────────────────────────────────────────────
  finalizer: {
    fastPollIntervalMs:
      (baseConfig.finalizer && baseConfig.finalizer.fastPollIntervalMs) || 500,
  },

  // ── PM2 Ecosystem Defaults ────────────────────────────────────
  pm2: {
    maxMemoryRestart:
      (baseConfig.pm2 && baseConfig.pm2.maxMemoryRestart) || "1G",
    minUptime: (baseConfig.pm2 && baseConfig.pm2.minUptime) || "10s",
    maxRestarts: (baseConfig.pm2 && baseConfig.pm2.maxRestarts) || 15,
    restartDelay: (baseConfig.pm2 && baseConfig.pm2.restartDelay) || 4000,
    killTimeout: (baseConfig.pm2 && baseConfig.pm2.killTimeout) || 5000,
    listenTimeout: (baseConfig.pm2 && baseConfig.pm2.listenTimeout) || 10000,
    uvThreadpoolSize: (baseConfig.pm2 && baseConfig.pm2.uvThreadpoolSize) || 16,
  },

  // ── HSM / Confidential Computing Configuration ────────────────
  hsm: {
    enabled: process.env.HSM_SIGNING_ENABLED === "true",
    tier: process.env.HSM_SIGNING_TIER || "envelope",
    masterKekName: process.env.HSM_MASTER_KEK_NAME || "",
    kekVersion: process.env.HSM_KEK_VERSION || "",
    wrapAlgorithm: process.env.HSM_WRAP_ALGORITHM || "RSA-OAEP-256",
    hsmUrl: process.env.AZURE_MANAGED_HSM_URL || "",
    // Per-blockchain server key IDs for Tier 1 (finalization) signing
    serverKeys: {
      stellar: process.env.HSM_SERVER_KEY_STELLAR || "",
      solana: process.env.HSM_SERVER_KEY_SOLANA || "",
      algorand: process.env.HSM_SERVER_KEY_ALGORAND || "",
      ethereum: process.env.HSM_SERVER_KEY_ETHEREUM || "",
    },
  },

  confidentialComputing: {
    enabled: process.env.USE_CONFIDENTIAL_COMPUTING === "true",
    requireAttestation:
      process.env.REQUIRE_CVM_ATTESTATION !== undefined
        ? process.env.REQUIRE_CVM_ATTESTATION === "true"
        : process.env.NODE_ENV === "production",
    attestationUrl: process.env.AZURE_ATTESTATION_URL || "",
  },

  redis: {
    url: process.env.REDIS_URL || "",
    enabled: !!process.env.REDIS_URL,
  },
};

// Log configuration details (without sensitive info)
console.log("Configuration loaded:");
console.log(`- Storage: ${config.storage}`);
console.log(
  `- Database: ${config.db.replace(/\/\/[^:]+:[^@]+@/, "//***:***@")}`,
); // Hide credentials
console.log(`- Public Horizon: ${config.networks.public.horizon}`);
console.log(`- Testnet Horizon: ${config.networks.testnet.horizon}`);
console.log(
  `- Admin API Key: ${
    process.env.ADMIN_API_KEY
      ? "configured"
      : "NOT SET (admin endpoints disabled)"
  }`,
);

module.exports = config;
