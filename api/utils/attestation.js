/**
 * CVM Attestation Module
 *
 * Provides SEV-SNP attestation verification for Azure Confidential VMs.
 * In non-production environments, attestation is bypassed unless
 * REQUIRE_CVM_ATTESTATION=true is explicitly set.
 *
 * Dependencies (@azure/attestation, @azure/identity) are lazily loaded
 * so the module can be required in environments where they aren't installed.
 *
 * @module utils/attestation
 */

const logger = require("./logger").forComponent("attestation");

// ── Lazy Azure SDK loaders ──────────────────────────────────────────

function loadAttestationClient() {
  try {
    return require("@azure/attestation").AttestationClient;
  } catch {
    return null;
  }
}

function loadDefaultAzureCredential() {
  try {
    return require("@azure/identity").DefaultAzureCredential;
  } catch {
    return null;
  }
}

// ── SNP Report Reader ───────────────────────────────────────────────

/**
 * Read the SEV-SNP hardware attestation report.
 * On a real CVM this reads from /dev/sev-guest; in non-CVM
 * environments this will throw.
 *
 * @returns {Promise<Buffer>} Raw SNP report bytes
 * @throws {Error} If not running on a CVM or /dev/sev-guest unavailable
 */
async function getSnpReport() {
  const fs = require("fs").promises;

  try {
    // The SEV-SNP guest driver exposes attestation reports via /dev/sev-guest
    // or via the vTPM on newer kernels. Try the direct device first.
    const report = await fs.readFile("/dev/sev-guest");
    return report;
  } catch (err) {
    throw new Error(
      `Failed to read SEV-SNP report from /dev/sev-guest: ${err.message}. ` +
        "Ensure this is running on an Azure DCasv5 Confidential VM with SEV-SNP support.",
    );
  }
}

// ═════════════════════════════════════════════════════════════════════
//  Public API
// ═════════════════════════════════════════════════════════════════════

/**
 * Determine whether CVM attestation is required.
 *
 * Priority:
 *  1. Explicit env var  REQUIRE_CVM_ATTESTATION=true|false
 *  2. Inferred from NODE_ENV — only "production" and "prod" require it
 *
 * @returns {boolean}
 */
function isCvmAttestationRequired() {
  const explicit = process.env.REQUIRE_CVM_ATTESTATION;
  if (explicit !== undefined) {
    return explicit === "true";
  }
  const env = (process.env.NODE_ENV || "").toLowerCase();
  return env === "production" || env === "prod";
}

/**
 * Verify the gateway is running inside a genuine Azure Confidential VM
 * by performing SEV-SNP attestation. In non-production environments the
 * check is bypassed unless REQUIRE_CVM_ATTESTATION=true is set.
 *
 * @param {Object} [options] - Override options (for testing)
 * @param {Function} [options.getSnpReportFn] - Override SNP report reader
 * @param {Object} [options.attestationClient] - Override Azure AttestationClient
 * @returns {Promise<Object>} { attested: boolean, token: string|null, bypassed: boolean }
 * @throws {Error} If attestation is required but fails
 */
async function verifyTeeAndGetToken(options = {}) {
  // ── Check whether attestation is required ──────────────────────────
  if (!isCvmAttestationRequired()) {
    const env = process.env.NODE_ENV || "development";
    logger.warn(
      `CVM attestation bypassed — REQUIRE_CVM_ATTESTATION is not enabled (NODE_ENV=${env}). ` +
        "HSM operations will proceed without TEE verification.",
    );
    logger.warn("SECURITY: CVM attestation bypassed", {
      nodeEnv: env,
      requireCvmAttestation: process.env.REQUIRE_CVM_ATTESTATION ?? "unset",
      reason: "non-production environment or explicitly disabled",
    });
    return {
      attested: false,
      token: null,
      bypassed: true,
    };
  }

  // ── Production: full SEV-SNP attestation ───────────────────────────
  logger.info("Performing CVM SEV-SNP attestation...");

  const attestationUrl = process.env.AZURE_ATTESTATION_URL;
  if (!attestationUrl) {
    throw new Error(
      "AZURE_ATTESTATION_URL environment variable is required when CVM attestation is enabled.",
    );
  }

  // Resolve client (injected or lazy-loaded)
  let client = options.attestationClient;
  if (!client) {
    const AttestationClient = loadAttestationClient();
    const DefaultAzureCredential = loadDefaultAzureCredential();

    if (!AttestationClient || !DefaultAzureCredential) {
      throw new Error(
        "Azure SDK packages (@azure/attestation, @azure/identity) are required " +
          "for CVM attestation but are not installed. Run: " +
          "npm install @azure/attestation @azure/identity",
      );
    }

    client = new AttestationClient(
      attestationUrl,
      new DefaultAzureCredential(),
    );
  }

  // Read SNP report (injected or real hardware)
  const readSnpReport = options.getSnpReportFn || getSnpReport;
  const snpReport = await readSnpReport();

  // Attest with Azure
  const result = await client.attestSevSnpVm({
    report: snpReport,
    runtimeData: {
      appVersion: process.env.npm_package_version || "unknown",
      nodeEnv: process.env.NODE_ENV,
    },
  });

  logger.info("CVM attestation succeeded", {
    attestationUrl,
    tokenExpiry: result.token?.exp,
  });

  return {
    attested: true,
    token: result.token,
    bypassed: false,
  };
}

/**
 * Get the current attestation status for health checks.
 *
 * @returns {Object} { required: boolean, nodeEnv: string }
 */
function getAttestationStatus() {
  return {
    required: isCvmAttestationRequired(),
    nodeEnv: process.env.NODE_ENV || "development",
    attestationUrl: process.env.AZURE_ATTESTATION_URL || null,
    explicitOverride: process.env.REQUIRE_CVM_ATTESTATION ?? "unset",
  };
}

module.exports = {
  isCvmAttestationRequired,
  verifyTeeAndGetToken,
  getAttestationStatus,
  // Exported for testing
  _getSnpReport: getSnpReport,
};
