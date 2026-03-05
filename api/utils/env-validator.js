/**
 * Environment Configuration Validator
 *
 * Validates required and optional environment variables at startup.
 * Fails fast if critical configuration is missing.
 */

const logger = require("./logger");

/**
 * Environment variable definitions
 */
const envConfig = {
  // Required in production
  required: {
    production: [
      {
        name: "MONGODB_URL",
        description: "MongoDB connection string",
        sensitive: true,
      },
      {
        name: "AZURE_MANAGED_HSM_URL",
        description:
          "Azure Managed HSM URL (e.g., https://refractor-hsm.managedhsm.azure.net)",
        sensitive: false,
      },
      {
        name: "HSM_MASTER_KEK_NAME",
        description:
          "HSM master Key Encryption Key name for envelope encryption",
        sensitive: false,
      },
    ],
  },

  // Recommended but not required
  recommended: [
    {
      name: "ADMIN_API_KEY",
      description: "Admin API key for protected endpoints",
      sensitive: true,
      warning: "Admin endpoints will be disabled without this",
    },
    {
      name: "LOG_LEVEL",
      description: "Logging level (error, warn, info, http, debug)",
      default: "info",
    },
  ],

  // Optional with defaults
  optional: [
    {
      name: "PORT",
      description: "Server port",
      default: "4010",
    },
    {
      name: "NODE_ENV",
      description: "Environment (development, production)",
      default: "development",
    },
    {
      name: "MODE",
      description: "Application mode",
      default: "production",
    },
    {
      name: "MAX_PAYLOAD_SIZE",
      description: "Maximum request payload size",
      default: "1mb",
    },
    {
      name: "STORAGE_TYPE",
      description: "Storage provider type",
      default: "mongoose",
    },
    {
      name: "CORS_BLACKLIST",
      description: "Comma-separated list of blocked origins",
      default: "",
    },
    {
      name: "LOG_FILE",
      description: "Log file path (production only)",
      default: "",
    },
    // ── HSM / Confidential Computing ────────────────────────────
    {
      name: "HSM_SIGNING_ENABLED",
      description: "Enable HSM-backed signing (true/false)",
      default: "false",
    },
    {
      name: "HSM_SIGNING_TIER",
      description: "HSM signing tier: 'direct' (Tier 1) or 'envelope' (Tier 2)",
      default: "envelope",
    },
    {
      name: "HSM_KEK_VERSION",
      description: "HSM master KEK version (for key rotation)",
      default: "",
    },
    {
      name: "HSM_WRAP_ALGORITHM",
      description: "Key wrap algorithm (e.g., RSA-OAEP-256, AES-KW-256)",
      default: "RSA-OAEP-256",
    },
    {
      name: "HSM_SERVER_KEY_STELLAR",
      description: "HSM key ID for Stellar finalization signing",
      default: "",
    },
    {
      name: "HSM_SERVER_KEY_SOLANA",
      description: "HSM key ID for Solana finalization signing",
      default: "",
    },
    {
      name: "HSM_SERVER_KEY_ALGORAND",
      description: "HSM key ID for Algorand finalization signing",
      default: "",
    },
    {
      name: "HSM_SERVER_KEY_ETHEREUM",
      description: "HSM key ID for EVM finalization signing",
      default: "",
    },
    {
      name: "REQUIRE_CVM_ATTESTATION",
      description:
        "Require CVM TEE attestation before HSM access (true/false). Defaults to true in production.",
      default: "",
    },
    {
      name: "USE_CONFIDENTIAL_COMPUTING",
      description: "Enable Azure Confidential Computing features (true/false)",
      default: "false",
    },
    {
      name: "AZURE_ATTESTATION_URL",
      description:
        "Azure Attestation Service URL (e.g., https://shared.eus.attest.azure.net)",
      default: "",
    },
    {
      name: "REDIS_URL",
      description:
        "Azure Managed Redis connection URL for key metadata caching",
      default: "",
      sensitive: true,
    },
  ],
};

/**
 * Validate environment configuration
 * @param {object} options - Validation options
 * @param {boolean} options.exitOnError - Exit process on validation failure (default: true in production)
 * @returns {object} Validation result with errors and warnings
 */
function validateEnvironment(options = {}) {
  const isProduction = process.env.NODE_ENV === "production";
  const exitOnError = options.exitOnError ?? isProduction;

  const result = {
    valid: true,
    errors: [],
    warnings: [],
    config: {},
  };

  // Check required variables for production
  if (isProduction) {
    for (const envVar of envConfig.required.production) {
      const value = process.env[envVar.name];
      if (!value) {
        result.valid = false;
        result.errors.push({
          variable: envVar.name,
          message: `Required environment variable ${envVar.name} is not set: ${envVar.description}`,
        });
      } else {
        result.config[envVar.name] = envVar.sensitive ? "[REDACTED]" : value;
      }
    }
  }

  // Check recommended variables
  for (const envVar of envConfig.recommended) {
    const value = process.env[envVar.name];
    if (!value) {
      result.warnings.push({
        variable: envVar.name,
        message:
          envVar.warning ||
          `Recommended variable ${envVar.name} is not set: ${envVar.description}`,
        default: envVar.default,
      });
      if (envVar.default) {
        result.config[envVar.name] = envVar.default;
      }
    } else {
      result.config[envVar.name] = envVar.sensitive ? "[REDACTED]" : value;
    }
  }

  // Log optional variables with their values/defaults
  for (const envVar of envConfig.optional) {
    const value = process.env[envVar.name] || envVar.default;
    result.config[envVar.name] = envVar.sensitive ? "[REDACTED]" : value;
  }

  // Log results
  if (result.errors.length > 0) {
    logger.error("Environment validation failed", {
      errors: result.errors.map((e) => e.message),
    });

    if (exitOnError) {
      // Dual-log: structured logger (already done above) + console for terminal visibility
      const msg = result.errors.map((e) => `   - ${e.variable}: ${e.message}`).join("\n");
      console.error(`\n❌ FATAL: Missing required environment variables:\n\n${msg}\n\nPlease set these variables and restart the application.\n`);
      process.exit(1);
    }
  }

  if (result.warnings.length > 0) {
    logger.warn("Environment configuration warnings", {
      warnings: result.warnings.map((w) => w.message),
    });
  }

  logger.info("Environment configuration validated", {
    environment: isProduction ? "production" : "development",
    configuredVariables: Object.keys(result.config).length,
    warnings: result.warnings.length,
  });

  return result;
}

/**
 * Get a summary of environment configuration (for debugging)
 * @returns {object} Configuration summary with sensitive values redacted
 */
function getConfigSummary() {
  const summary = {};

  const allVars = [
    ...envConfig.required.production,
    ...envConfig.recommended,
    ...envConfig.optional,
  ];

  for (const envVar of allVars) {
    const value = process.env[envVar.name];
    if (value) {
      summary[envVar.name] = envVar.sensitive ? "[REDACTED]" : value;
    } else if (envVar.default) {
      summary[envVar.name] = `${envVar.default} (default)`;
    } else {
      summary[envVar.name] = "(not set)";
    }
  }

  return summary;
}

module.exports = {
  validateEnvironment,
  getConfigSummary,
  envConfig,
};
