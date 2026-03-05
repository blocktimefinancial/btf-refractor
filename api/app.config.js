// Load environment variables first
require("dotenv").config();

// Load base configuration from JSON
const baseConfig = require("./app.config.json");

/**
 * Safely traverse a nested object by dot-delimited path.
 * Returns `defaultValue` when any segment is undefined/null.
 *
 * @param {Object} obj - Root object to traverse
 * @param {string} path - Dot-delimited path (e.g. "rateLimit.general.windowMs")
 * @param {*} defaultValue - Fallback when path is missing
 * @returns {*}
 */
function configGet(obj, path, defaultValue) {
  const segments = path.split(".");
  let current = obj;
  for (const seg of segments) {
    if (current == null || typeof current !== "object") return defaultValue;
    current = current[seg];
  }
  return current !== undefined && current !== null ? current : defaultValue;
}

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
        : configGet(baseConfig, "rateLimit.general.windowMs", 1000),
      max: process.env.RATE_LIMIT_MAX
        ? parseInt(process.env.RATE_LIMIT_MAX, 10)
        : configGet(baseConfig, "rateLimit.general.max", 100),
    },
    strict: {
      windowMs: process.env.RATE_LIMIT_STRICT_WINDOW_MS
        ? parseInt(process.env.RATE_LIMIT_STRICT_WINDOW_MS, 10)
        : configGet(baseConfig, "rateLimit.strict.windowMs", 1000),
      max: process.env.RATE_LIMIT_STRICT_MAX
        ? parseInt(process.env.RATE_LIMIT_STRICT_MAX, 10)
        : configGet(baseConfig, "rateLimit.strict.max", 50),
    },
  },

  // ── CORS ──────────────────────────────────────────────────────
  cors: {
    maxAge: process.env.CORS_MAX_AGE
      ? parseInt(process.env.CORS_MAX_AGE, 10)
      : configGet(baseConfig, "cors.maxAge", 86400),
  },

  // ── MongoDB Connection Pool ───────────────────────────────────
  mongodb: {
    maxPoolSize: process.env.MONGODB_MAX_POOL_SIZE
      ? parseInt(process.env.MONGODB_MAX_POOL_SIZE, 10)
      : configGet(baseConfig, "mongodb.maxPoolSize", 10),
    minPoolSize: process.env.MONGODB_MIN_POOL_SIZE
      ? parseInt(process.env.MONGODB_MIN_POOL_SIZE, 10)
      : configGet(baseConfig, "mongodb.minPoolSize", 2),
    maxIdleTimeMs: configGet(baseConfig, "mongodb.maxIdleTimeMs", 30000),
    serverSelectionTimeoutMs: configGet(
      baseConfig,
      "mongodb.serverSelectionTimeoutMs",
      5000,
    ),
    socketTimeoutMs: configGet(baseConfig, "mongodb.socketTimeoutMs", 45000),
    family: configGet(baseConfig, "mongodb.family", 4),
  },

  // ── Logging ───────────────────────────────────────────────────
  logging: {
    maxFileSize: configGet(baseConfig, "logging.maxFileSize", 10 * 1024 * 1024),
    maxFiles: configGet(baseConfig, "logging.maxFiles", 5),
  },

  // ── Circuit Breaker Defaults ──────────────────────────────────
  circuitBreaker: {
    horizon: {
      timeout: configGet(baseConfig, "circuitBreaker.horizon.timeout", 10000),
      errorThresholdPercentage: configGet(
        baseConfig,
        "circuitBreaker.horizon.errorThresholdPercentage",
        50,
      ),
      resetTimeout: configGet(
        baseConfig,
        "circuitBreaker.horizon.resetTimeout",
        30000,
      ),
      volumeThreshold: configGet(
        baseConfig,
        "circuitBreaker.horizon.volumeThreshold",
        5,
      ),
    },
    evmRpc: {
      timeout: configGet(baseConfig, "circuitBreaker.evmRpc.timeout", 15000),
      errorThresholdPercentage: configGet(
        baseConfig,
        "circuitBreaker.evmRpc.errorThresholdPercentage",
        50,
      ),
      resetTimeout: configGet(
        baseConfig,
        "circuitBreaker.evmRpc.resetTimeout",
        30000,
      ),
      volumeThreshold: configGet(
        baseConfig,
        "circuitBreaker.evmRpc.volumeThreshold",
        5,
      ),
    },
    hsm: {
      timeout: configGet(baseConfig, "circuitBreaker.hsm.timeout", 5000),
      errorThresholdPercentage: configGet(
        baseConfig,
        "circuitBreaker.hsm.errorThresholdPercentage",
        30,
      ),
      resetTimeout: configGet(
        baseConfig,
        "circuitBreaker.hsm.resetTimeout",
        15000,
      ),
      volumeThreshold: configGet(
        baseConfig,
        "circuitBreaker.hsm.volumeThreshold",
        3,
      ),
    },
  },

  // ── Queue Tuning ──────────────────────────────────────────────
  queue: {
    maxProcessingTimeSamples: configGet(
      baseConfig,
      "queue.maxProcessingTimeSamples",
      100,
    ),
    rateLimitBackoffMultiplier: configGet(
      baseConfig,
      "queue.rateLimitBackoffMultiplier",
      3,
    ),
    rateLimitBackoffJitter: configGet(
      baseConfig,
      "queue.rateLimitBackoffJitter",
      2000,
    ),
    rateLimitMaxDelay: configGet(baseConfig, "queue.rateLimitMaxDelay", 30000),
    rateLimitConcurrencyFactor: configGet(
      baseConfig,
      "queue.rateLimitConcurrencyFactor",
      0.7,
    ),
    retryJitter: configGet(baseConfig, "queue.retryJitter", 1000),
    drainPollInterval: configGet(baseConfig, "queue.drainPollInterval", 100),
    adaptiveErrorRateThreshold: configGet(
      baseConfig,
      "queue.adaptiveErrorRateThreshold",
      0.1,
    ),
    concurrencyReductionFactor: configGet(
      baseConfig,
      "queue.concurrencyReductionFactor",
      0.8,
    ),
    bulkOps: {
      queueThreshold: configGet(baseConfig, "queue.bulkOps.queueThreshold", 50),
      successThreshold: configGet(
        baseConfig,
        "queue.bulkOps.successThreshold",
        0.98,
      ),
      maxProcessingTime: configGet(
        baseConfig,
        "queue.bulkOps.maxProcessingTime",
        3000,
      ),
      concurrencyCap: configGet(
        baseConfig,
        "queue.bulkOps.concurrencyCap",
        0.7,
      ),
      slowThreshold: configGet(baseConfig, "queue.bulkOps.slowThreshold", 8000),
      minSuccessRate: configGet(
        baseConfig,
        "queue.bulkOps.minSuccessRate",
        0.95,
      ),
    },
    normalOps: {
      scaleUpQueueFactor: configGet(
        baseConfig,
        "queue.normalOps.scaleUpQueueFactor",
        2,
      ),
      successThreshold: configGet(
        baseConfig,
        "queue.normalOps.successThreshold",
        0.98,
      ),
      maxProcessingTime: configGet(
        baseConfig,
        "queue.normalOps.maxProcessingTime",
        4000,
      ),
      slowThreshold: configGet(
        baseConfig,
        "queue.normalOps.slowThreshold",
        10000,
      ),
      minSuccessRate: configGet(
        baseConfig,
        "queue.normalOps.minSuccessRate",
        0.9,
      ),
    },
    maxAdminConcurrency: configGet(
      baseConfig,
      "queue.maxAdminConcurrency",
      100,
    ),
  },

  // ── Callback Retry ────────────────────────────────────────────
  callback: {
    retryMinShift: configGet(baseConfig, "callback.retryMinShift", 4),
    retryMaxShift: configGet(baseConfig, "callback.retryMaxShift", 12),
  },

  // ── Finalizer ─────────────────────────────────────────────────
  finalizer: {
    fastPollIntervalMs: configGet(
      baseConfig,
      "finalizer.fastPollIntervalMs",
      500,
    ),
  },

  // ── PM2 Ecosystem Defaults ────────────────────────────────────
  pm2: {
    maxMemoryRestart: configGet(baseConfig, "pm2.maxMemoryRestart", "1G"),
    minUptime: configGet(baseConfig, "pm2.minUptime", "10s"),
    maxRestarts: configGet(baseConfig, "pm2.maxRestarts", 15),
    restartDelay: configGet(baseConfig, "pm2.restartDelay", 4000),
    killTimeout: configGet(baseConfig, "pm2.killTimeout", 5000),
    listenTimeout: configGet(baseConfig, "pm2.listenTimeout", 10000),
    uvThreadpoolSize: configGet(baseConfig, "pm2.uvThreadpoolSize", 16),
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
// Use logger if available; fallback to console for very early init
const _cfgLogger = (() => { try { return require("./utils/logger"); } catch { return console; } })();
_cfgLogger.info("Configuration loaded", {
  storage: config.storage,
  db: config.db.replace(/\/\/[^:]+:[^@]+@/, "//***:***@"),
  publicHorizon: config.networks.public.horizon,
  testnetHorizon: config.networks.testnet.horizon,
  adminApiKey: process.env.ADMIN_API_KEY ? "configured" : "NOT SET (admin endpoints disabled)",
});

// Export config as default, attach configGet as a utility
config.configGet = configGet;
module.exports = config;
