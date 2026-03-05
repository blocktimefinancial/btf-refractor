/**
 * App Config Tests — HSM & Confidential Computing Sections
 *
 * Validates that app.config.js correctly reads HSM, confidential computing,
 * and Redis configuration from environment variables with proper defaults.
 */

describe("app.config.js — HSM config", () => {
  const savedEnv = {};
  const ENV_KEYS = [
    "HSM_SIGNING_ENABLED",
    "HSM_SIGNING_TIER",
    "HSM_MASTER_KEK_NAME",
    "HSM_KEK_VERSION",
    "HSM_WRAP_ALGORITHM",
    "AZURE_MANAGED_HSM_URL",
    "HSM_SERVER_KEY_STELLAR",
    "HSM_SERVER_KEY_SOLANA",
    "HSM_SERVER_KEY_ALGORAND",
    "HSM_SERVER_KEY_ETHEREUM",
    "USE_CONFIDENTIAL_COMPUTING",
    "REQUIRE_CVM_ATTESTATION",
    "AZURE_ATTESTATION_URL",
    "REDIS_URL",
    "NODE_ENV",
  ];

  beforeEach(() => {
    // Save current env
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
    }
    // Clear HSM vars so we test defaults
    for (const key of ENV_KEYS) {
      if (key !== "NODE_ENV") delete process.env[key];
    }
    // Clear require cache so config is re-evaluated
    jest.resetModules();
  });

  afterEach(() => {
    // Restore env
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
    jest.resetModules();
  });

  function loadConfig() {
    return require("../../app.config");
  }

  // ── HSM Defaults ──────────────────────────────────────────────

  describe("hsm section — defaults", () => {
    it("should default hsm.enabled to false", () => {
      const config = loadConfig();
      expect(config.hsm.enabled).toBe(false);
    });

    it("should default hsm.tier to 'envelope'", () => {
      const config = loadConfig();
      expect(config.hsm.tier).toBe("envelope");
    });

    it("should default hsm.wrapAlgorithm to 'RSA-OAEP-256'", () => {
      const config = loadConfig();
      expect(config.hsm.wrapAlgorithm).toBe("RSA-OAEP-256");
    });

    it("should default server key IDs to empty strings", () => {
      const config = loadConfig();
      expect(config.hsm.serverKeys.stellar).toBe("");
      expect(config.hsm.serverKeys.solana).toBe("");
      expect(config.hsm.serverKeys.algorand).toBe("");
      expect(config.hsm.serverKeys.ethereum).toBe("");
    });
  });

  // ── HSM Env Overrides ────────────────────────────────────────

  describe("hsm section — env var overrides", () => {
    it("should enable HSM when HSM_SIGNING_ENABLED=true", () => {
      process.env.HSM_SIGNING_ENABLED = "true";
      const config = loadConfig();
      expect(config.hsm.enabled).toBe(true);
    });

    it("should set tier from HSM_SIGNING_TIER", () => {
      process.env.HSM_SIGNING_TIER = "direct";
      const config = loadConfig();
      expect(config.hsm.tier).toBe("direct");
    });

    it("should read HSM master KEK name", () => {
      process.env.HSM_MASTER_KEK_NAME = "refractor-master-kek";
      const config = loadConfig();
      expect(config.hsm.masterKekName).toBe("refractor-master-kek");
    });

    it("should read HSM URL", () => {
      process.env.AZURE_MANAGED_HSM_URL =
        "https://refractor-hsm.managedhsm.azure.net";
      const config = loadConfig();
      expect(config.hsm.hsmUrl).toBe(
        "https://refractor-hsm.managedhsm.azure.net",
      );
    });

    it("should read server key IDs", () => {
      process.env.HSM_SERVER_KEY_STELLAR = "key-stellar-001";
      process.env.HSM_SERVER_KEY_SOLANA = "key-sol-001";
      process.env.HSM_SERVER_KEY_ALGORAND = "key-algo-001";
      process.env.HSM_SERVER_KEY_ETHEREUM = "key-eth-001";

      const config = loadConfig();
      expect(config.hsm.serverKeys.stellar).toBe("key-stellar-001");
      expect(config.hsm.serverKeys.solana).toBe("key-sol-001");
      expect(config.hsm.serverKeys.algorand).toBe("key-algo-001");
      expect(config.hsm.serverKeys.ethereum).toBe("key-eth-001");
    });

    it("should read wrap algorithm override", () => {
      process.env.HSM_WRAP_ALGORITHM = "AES-KW-256";
      const config = loadConfig();
      expect(config.hsm.wrapAlgorithm).toBe("AES-KW-256");
    });
  });

  // ── Confidential Computing ────────────────────────────────────

  describe("confidentialComputing section", () => {
    it("should default to disabled", () => {
      const config = loadConfig();
      expect(config.confidentialComputing.enabled).toBe(false);
    });

    it("should enable when USE_CONFIDENTIAL_COMPUTING=true", () => {
      process.env.USE_CONFIDENTIAL_COMPUTING = "true";
      const config = loadConfig();
      expect(config.confidentialComputing.enabled).toBe(true);
    });

    it("should default attestation URL to empty", () => {
      const config = loadConfig();
      expect(config.confidentialComputing.attestationUrl).toBe("");
    });

    it("should read AZURE_ATTESTATION_URL", () => {
      process.env.AZURE_ATTESTATION_URL = "https://shared.eus.attest.azure.net";
      const config = loadConfig();
      expect(config.confidentialComputing.attestationUrl).toBe(
        "https://shared.eus.attest.azure.net",
      );
    });

    it("should derive requireAttestation from NODE_ENV=production", () => {
      process.env.NODE_ENV = "production";
      delete process.env.REQUIRE_CVM_ATTESTATION;
      const config = loadConfig();
      expect(config.confidentialComputing.requireAttestation).toBe(true);
    });

    it("should not require attestation in development", () => {
      process.env.NODE_ENV = "development";
      delete process.env.REQUIRE_CVM_ATTESTATION;
      const config = loadConfig();
      expect(config.confidentialComputing.requireAttestation).toBe(false);
    });

    it("should respect explicit REQUIRE_CVM_ATTESTATION=false in production", () => {
      process.env.NODE_ENV = "production";
      process.env.REQUIRE_CVM_ATTESTATION = "false";
      const config = loadConfig();
      expect(config.confidentialComputing.requireAttestation).toBe(false);
    });

    it("should respect explicit REQUIRE_CVM_ATTESTATION=true in development", () => {
      process.env.NODE_ENV = "development";
      process.env.REQUIRE_CVM_ATTESTATION = "true";
      const config = loadConfig();
      expect(config.confidentialComputing.requireAttestation).toBe(true);
    });
  });

  // ── Redis ─────────────────────────────────────────────────────

  describe("redis section", () => {
    it("should default to disabled when REDIS_URL not set", () => {
      const config = loadConfig();
      expect(config.redis.enabled).toBe(false);
      expect(config.redis.url).toBe("");
    });

    it("should enable when REDIS_URL is set", () => {
      process.env.REDIS_URL = "redis://localhost:6379";
      const config = loadConfig();
      expect(config.redis.enabled).toBe(true);
      expect(config.redis.url).toBe("redis://localhost:6379");
    });
  });

  // ── Existing config preserved ─────────────────────────────────

  describe("backward compatibility", () => {
    it("should still have base config properties", () => {
      const config = loadConfig();
      expect(config.port).toBeDefined();
      expect(config.storage).toBeDefined();
      expect(config.networks).toBeDefined();
      expect(config.feeMultiplier).toBeDefined();
    });
  });
});
