/**
 * Key Management API Routes
 *
 * Provides endpoints for HSM-managed key lifecycle operations:
 * - Create a key for a specific blockchain
 * - Get key metadata (public key, status)
 * - Sign data with an HSM-managed key
 * - Rotate a key
 * - Disable (delete) a key
 * - HSM health check
 *
 * All routes require admin authentication via X-Admin-API-Key header.
 *
 * @module api/key-routes
 */

const express = require("express");
const { requireAdminAuth } = require("../middleware/auth");
const HsmSigningAdapter = require("../business-logic/hsm-signing-adapter");
const config = require("../app.config");
const logger = require("../utils/logger").forComponent("key-routes");

const router = express.Router();

// ── All key management routes require admin auth ─────────────────
router.use(requireAdminAuth());

// ── Helper: create adapter from config ───────────────────────────
function createAdapter(tierOverride) {
  const tier = tierOverride || config.hsm?.tier || "envelope";
  return new HsmSigningAdapter({ tier });
}

// ══════════════════════════════════════════════════════════════════
//  POST /keys — Create a new HSM-managed key
// ══════════════════════════════════════════════════════════════════

/**
 * Create a new HSM-managed key for a blockchain.
 *
 * @body {string} blockchain - Target blockchain (stellar, ethereum, algorand, solana, etc.)
 * @body {Object} [options] - Additional key creation options
 * @returns {{ keyId: string, publicKey: string, blockchain: string }}
 */
router.post("/", async (req, res) => {
  try {
    const { blockchain, options = {} } = req.body;

    if (!blockchain || typeof blockchain !== "string") {
      return res.status(400).json({
        error: "Validation failed",
        message: "blockchain is required and must be a string",
      });
    }

    if (!HsmSigningAdapter.isSupported(blockchain)) {
      return res.status(400).json({
        error: "Unsupported blockchain",
        message: `HSM key management is not supported for blockchain: ${blockchain}`,
        supportedBlockchains: HsmSigningAdapter.getSupportedBlockchains(),
      });
    }

    logger.info("Creating HSM-managed key", { blockchain });

    const adapter = createAdapter(options.tier);
    const result = await adapter.createKey(blockchain, options);

    res.status(201).json({
      ...result,
      blockchain: blockchain.toLowerCase(),
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("Failed to create HSM key", {
      error: err.message,
      blockchain: req.body?.blockchain,
    });
    res.status(500).json({
      error: "Key creation failed",
      message: err.message,
    });
  }
});

// ══════════════════════════════════════════════════════════════════
//  GET /keys/health — HSM health check
// ══════════════════════════════════════════════════════════════════

/**
 * Check HSM connectivity and health.
 * Placed before :keyId routes to avoid matching "health" as a keyId.
 *
 * @returns {{ status: string, tier: string, latencyMs: number }}
 */
router.get("/health", async (req, res) => {
  try {
    const adapter = createAdapter();
    const health = await adapter.healthCheck();

    const statusCode = health.status === "ok" ? 200 : 503;
    res.status(statusCode).json({
      ...health,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("HSM health check failed", { error: err.message });
    res.status(503).json({
      status: "error",
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// ══════════════════════════════════════════════════════════════════
//  GET /keys/:keyId — Get key metadata
// ══════════════════════════════════════════════════════════════════

/**
 * Retrieve metadata for an HSM-managed key.
 *
 * @param {string} keyId - The key identifier
 * @returns {{ keyId: string, publicKey: string, status: string }}
 */
router.get("/:keyId", async (req, res) => {
  try {
    const { keyId } = req.params;

    if (!keyId || typeof keyId !== "string") {
      return res.status(400).json({
        error: "Validation failed",
        message: "keyId parameter is required",
      });
    }

    const adapter = createAdapter();
    const metadata = await adapter.getKeyMetadata(keyId);

    if (!metadata) {
      return res.status(404).json({
        error: "Key not found",
        message: `No key found with id: ${keyId}`,
      });
    }

    res.json({
      keyId,
      ...metadata,
      retrievedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("Failed to get key metadata", {
      error: err.message,
      keyId: req.params.keyId,
    });
    res.status(500).json({
      error: "Failed to retrieve key metadata",
      message: err.message,
    });
  }
});

// ══════════════════════════════════════════════════════════════════
//  POST /keys/:keyId/sign — Sign with an HSM-managed key
// ══════════════════════════════════════════════════════════════════

/**
 * Sign data using an HSM-managed key.
 *
 * @param {string} keyId - The key identifier
 * @body {string} blockchain - Target blockchain for signing
 * @body {Object|string} payload - Transaction or data to sign
 * @returns {{ signature: string, keyId: string, blockchain: string }}
 */
router.post("/:keyId/sign", async (req, res) => {
  try {
    const { keyId } = req.params;
    const { blockchain, payload } = req.body;

    if (!keyId || typeof keyId !== "string") {
      return res.status(400).json({
        error: "Validation failed",
        message: "keyId parameter is required",
      });
    }

    if (!blockchain || typeof blockchain !== "string") {
      return res.status(400).json({
        error: "Validation failed",
        message: "blockchain is required in request body",
      });
    }

    if (!payload) {
      return res.status(400).json({
        error: "Validation failed",
        message: "payload is required in request body",
      });
    }

    if (!HsmSigningAdapter.isSupported(blockchain)) {
      return res.status(400).json({
        error: "Unsupported blockchain",
        message: `HSM signing is not supported for blockchain: ${blockchain}`,
      });
    }

    logger.info("Signing with HSM key", { keyId, blockchain });

    const adapter = createAdapter(); // Always use server-configured tier
    const result = await adapter.sign(blockchain, keyId, payload);

    res.json({
      keyId,
      blockchain: blockchain.toLowerCase(),
      result,
      signedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("HSM signing failed", {
      error: err.message,
      keyId: req.params.keyId,
      blockchain: req.body?.blockchain,
    });
    res.status(500).json({
      error: "Signing failed",
      message: err.message,
    });
  }
});

// ══════════════════════════════════════════════════════════════════
//  POST /keys/:keyId/rotate — Rotate an HSM-managed key
// ══════════════════════════════════════════════════════════════════

/**
 * Rotate an HSM-managed key (create new key, mark old as retired).
 *
 * @param {string} keyId - The key identifier to rotate
 * @body {Object} [options] - Rotation options
 * @returns {{ oldKeyId: string, newKeyId: string, publicKey: string }}
 */
router.post("/:keyId/rotate", async (req, res) => {
  try {
    const { keyId } = req.params;
    const { options = {} } = req.body;

    if (!keyId || typeof keyId !== "string") {
      return res.status(400).json({
        error: "Validation failed",
        message: "keyId parameter is required",
      });
    }

    logger.info("Rotating HSM key", { keyId });

    const adapter = createAdapter();
    const result = await adapter.rotateKey(keyId, options);

    res.json({
      oldKeyId: keyId,
      ...result,
      rotatedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("HSM key rotation failed", {
      error: err.message,
      keyId: req.params.keyId,
    });
    res.status(500).json({
      error: "Key rotation failed",
      message: err.message,
    });
  }
});

// ══════════════════════════════════════════════════════════════════
//  DELETE /keys/:keyId — Disable an HSM-managed key
// ══════════════════════════════════════════════════════════════════

/**
 * Disable (soft-delete) an HSM-managed key.
 *
 * @param {string} keyId - The key identifier to disable
 * @returns {{ keyId: string, status: 'disabled' }}
 */
router.delete("/:keyId", async (req, res) => {
  try {
    const { keyId } = req.params;

    if (!keyId || typeof keyId !== "string") {
      return res.status(400).json({
        error: "Validation failed",
        message: "keyId parameter is required",
      });
    }

    logger.info("Disabling HSM key", { keyId });

    const adapter = createAdapter();
    await adapter.disableKey(keyId);

    res.json({
      keyId,
      status: "disabled",
      disabledAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("HSM key disable failed", {
      error: err.message,
      keyId: req.params.keyId,
    });
    res.status(500).json({
      error: "Key disable failed",
      message: err.message,
    });
  }
});

module.exports = router;
