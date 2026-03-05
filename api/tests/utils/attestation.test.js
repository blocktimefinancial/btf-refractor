/**
 * CVM Attestation Tests
 *
 * Validates:
 * 1. isCvmAttestationRequired() — env var priority logic
 * 2. verifyTeeAndGetToken() — bypass vs. enforcement paths
 * 3. getAttestationStatus() — health check info
 * 4. Error handling for missing Azure SDK, missing URL, SNP failures
 */

const {
  isCvmAttestationRequired,
  verifyTeeAndGetToken,
  getAttestationStatus,
} = require("../../utils/attestation");

describe("utils/attestation", () => {
  // Save and restore env vars
  const savedEnv = {};

  beforeEach(() => {
    savedEnv.NODE_ENV = process.env.NODE_ENV;
    savedEnv.REQUIRE_CVM_ATTESTATION = process.env.REQUIRE_CVM_ATTESTATION;
    savedEnv.AZURE_ATTESTATION_URL = process.env.AZURE_ATTESTATION_URL;
  });

  afterEach(() => {
    // Restore saved values; delete if they were undefined
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  // ── isCvmAttestationRequired ──────────────────────────────────

  describe("isCvmAttestationRequired", () => {
    it('should return true when REQUIRE_CVM_ATTESTATION="true"', () => {
      process.env.REQUIRE_CVM_ATTESTATION = "true";
      expect(isCvmAttestationRequired()).toBe(true);
    });

    it('should return false when REQUIRE_CVM_ATTESTATION="false"', () => {
      process.env.REQUIRE_CVM_ATTESTATION = "false";
      expect(isCvmAttestationRequired()).toBe(false);
    });

    it("should override NODE_ENV when explicit var is set", () => {
      process.env.NODE_ENV = "production";
      process.env.REQUIRE_CVM_ATTESTATION = "false";
      expect(isCvmAttestationRequired()).toBe(false);
    });

    it('should require attestation when NODE_ENV="production" (no explicit var)', () => {
      delete process.env.REQUIRE_CVM_ATTESTATION;
      process.env.NODE_ENV = "production";
      expect(isCvmAttestationRequired()).toBe(true);
    });

    it('should require attestation when NODE_ENV="prod"', () => {
      delete process.env.REQUIRE_CVM_ATTESTATION;
      process.env.NODE_ENV = "prod";
      expect(isCvmAttestationRequired()).toBe(true);
    });

    it('should not require attestation when NODE_ENV="development"', () => {
      delete process.env.REQUIRE_CVM_ATTESTATION;
      process.env.NODE_ENV = "development";
      expect(isCvmAttestationRequired()).toBe(false);
    });

    it('should not require attestation when NODE_ENV="test"', () => {
      delete process.env.REQUIRE_CVM_ATTESTATION;
      process.env.NODE_ENV = "test";
      expect(isCvmAttestationRequired()).toBe(false);
    });

    it('should not require attestation when NODE_ENV="staging"', () => {
      delete process.env.REQUIRE_CVM_ATTESTATION;
      process.env.NODE_ENV = "staging";
      expect(isCvmAttestationRequired()).toBe(false);
    });

    it("should not require attestation when NODE_ENV is unset", () => {
      delete process.env.REQUIRE_CVM_ATTESTATION;
      delete process.env.NODE_ENV;
      expect(isCvmAttestationRequired()).toBe(false);
    });

    it('should treat REQUIRE_CVM_ATTESTATION="" as falsy (not "true")', () => {
      process.env.REQUIRE_CVM_ATTESTATION = "";
      // empty string !== "true", so falls through to NODE_ENV check
      // but wait — empty string is !== undefined, so it will use the explicit check
      // "" !== "true" → returns false
      expect(isCvmAttestationRequired()).toBe(false);
    });
  });

  // ── verifyTeeAndGetToken — bypass path ────────────────────────

  describe("verifyTeeAndGetToken — bypass", () => {
    beforeEach(() => {
      process.env.NODE_ENV = "test";
      delete process.env.REQUIRE_CVM_ATTESTATION;
    });

    it("should return bypassed result when attestation not required", async () => {
      const result = await verifyTeeAndGetToken();

      expect(result.attested).toBe(false);
      expect(result.token).toBeNull();
      expect(result.bypassed).toBe(true);
    });

    it("should return bypassed result in development", async () => {
      process.env.NODE_ENV = "development";
      const result = await verifyTeeAndGetToken();

      expect(result.bypassed).toBe(true);
      expect(result.attested).toBe(false);
    });

    it("should bypass when explicitly disabled even in production", async () => {
      process.env.NODE_ENV = "production";
      process.env.REQUIRE_CVM_ATTESTATION = "false";
      const result = await verifyTeeAndGetToken();

      expect(result.bypassed).toBe(true);
    });
  });

  // ── verifyTeeAndGetToken — enforcement path ───────────────────

  describe("verifyTeeAndGetToken — enforcement", () => {
    beforeEach(() => {
      process.env.REQUIRE_CVM_ATTESTATION = "true";
    });

    it("should throw when AZURE_ATTESTATION_URL is missing", async () => {
      delete process.env.AZURE_ATTESTATION_URL;

      await expect(verifyTeeAndGetToken()).rejects.toThrow(
        /AZURE_ATTESTATION_URL.*required/,
      );
    });

    it("should throw when Azure SDK is not installed and no client provided", async () => {
      process.env.AZURE_ATTESTATION_URL = "https://test.attest.azure.net";

      // Don't provide an attestationClient override — it will try to load
      // @azure/attestation which isn't installed
      await expect(verifyTeeAndGetToken()).rejects.toThrow(
        /Azure SDK packages.*not installed/,
      );
    });

    it("should use injected attestation client and SNP report function", async () => {
      process.env.AZURE_ATTESTATION_URL = "https://test.attest.azure.net";

      const mockToken = { exp: Date.now() + 3600000, jwt: "mock-jwt-token" };
      const mockClient = {
        attestSevSnpVm: jest.fn().mockResolvedValue({ token: mockToken }),
      };
      const mockSnpReport = jest
        .fn()
        .mockResolvedValue(Buffer.from("fake-snp-report"));

      const result = await verifyTeeAndGetToken({
        attestationClient: mockClient,
        getSnpReportFn: mockSnpReport,
      });

      expect(result.attested).toBe(true);
      expect(result.token).toEqual(mockToken);
      expect(result.bypassed).toBe(false);
      expect(mockSnpReport).toHaveBeenCalled();
      expect(mockClient.attestSevSnpVm).toHaveBeenCalledWith(
        expect.objectContaining({
          report: expect.any(Buffer),
        }),
      );
    });

    it("should propagate errors from SNP report reader", async () => {
      process.env.AZURE_ATTESTATION_URL = "https://test.attest.azure.net";

      const mockClient = { attestSevSnpVm: jest.fn() };
      const failingSnpReport = jest
        .fn()
        .mockRejectedValue(new Error("ENOENT: no such device"));

      await expect(
        verifyTeeAndGetToken({
          attestationClient: mockClient,
          getSnpReportFn: failingSnpReport,
        }),
      ).rejects.toThrow(/ENOENT/);
    });

    it("should propagate errors from Azure attestation service", async () => {
      process.env.AZURE_ATTESTATION_URL = "https://test.attest.azure.net";

      const mockClient = {
        attestSevSnpVm: jest
          .fn()
          .mockRejectedValue(new Error("Attestation policy violation")),
      };
      const mockSnpReport = jest
        .fn()
        .mockResolvedValue(Buffer.from("fake-snp"));

      await expect(
        verifyTeeAndGetToken({
          attestationClient: mockClient,
          getSnpReportFn: mockSnpReport,
        }),
      ).rejects.toThrow(/Attestation policy violation/);
    });
  });

  // ── getAttestationStatus ──────────────────────────────────────

  describe("getAttestationStatus", () => {
    it("should return status for test environment", () => {
      process.env.NODE_ENV = "test";
      delete process.env.REQUIRE_CVM_ATTESTATION;
      delete process.env.AZURE_ATTESTATION_URL;

      const status = getAttestationStatus();
      expect(status.required).toBe(false);
      expect(status.nodeEnv).toBe("test");
      expect(status.attestationUrl).toBeNull();
      expect(status.explicitOverride).toBe("unset");
    });

    it("should return status for production with URL", () => {
      process.env.NODE_ENV = "production";
      delete process.env.REQUIRE_CVM_ATTESTATION;
      process.env.AZURE_ATTESTATION_URL = "https://prod.attest.azure.net";

      const status = getAttestationStatus();
      expect(status.required).toBe(true);
      expect(status.nodeEnv).toBe("production");
      expect(status.attestationUrl).toBe("https://prod.attest.azure.net");
    });

    it("should reflect explicit override", () => {
      process.env.REQUIRE_CVM_ATTESTATION = "false";
      process.env.NODE_ENV = "production";

      const status = getAttestationStatus();
      expect(status.required).toBe(false);
      expect(status.explicitOverride).toBe("false");
    });
  });
});
