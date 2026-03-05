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
  // Use environment variable for fee multiplier
  feeMultiplier: process.env.FEE_MULTIPLIER
    ? parseInt(process.env.FEE_MULTIPLIER, 10)
    : baseConfig.feeMultiplier || 1, // Default to 1 if not set

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
