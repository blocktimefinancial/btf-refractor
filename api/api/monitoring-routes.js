const express = require("express");
const finalizer = require("../business-logic/finalization/finalizer");
const storageLayer = require("../storage/storage-layer");
const { requireAdminAuth } = require("../middleware/auth");
const { getRequestLogger } = require("../middleware/request-id");
const {
  getBlacklist,
  addToBlacklist,
  removeFromBlacklist,
  reloadBlacklist,
} = require("../middleware/cors");
const logger = require("../utils/logger").forComponent("monitoring");
const { isValidBlockchain } = require("../business-logic/blockchain-registry");
const config = require("../app.config");

const router = express.Router();

// Helper to get request-scoped logger or fallback to component logger
const getLogger = (req) => {
  const reqLogger = getRequestLogger(req);
  // Add component context to request logger
  return reqLogger.child
    ? reqLogger.child({ component: "monitoring" })
    : logger;
};

/**
 * Check HSM health if HSM is enabled.
 * Returns { checked, healthy, details } — checked=false when HSM is disabled.
 * @returns {Promise<Object>}
 */
async function checkHsmHealth() {
  if (!config.hsm?.enabled) {
    return { checked: false, healthy: true, details: null };
  }

  try {
    const HsmSigningAdapter = require("../business-logic/hsm-signing-adapter");
    const adapter = new HsmSigningAdapter({
      tier: config.hsm.tier || "envelope",
    });
    const result = await adapter.healthCheck();
    return {
      checked: true,
      healthy: result.status === "ok",
      details: result,
    };
  } catch (err) {
    return {
      checked: true,
      healthy: false,
      details: { status: "error", error: err.message },
    };
  }
}

// Apply admin authentication to all write operations (POST routes)
// Read-only endpoints (GET) remain publicly accessible for monitoring tools

/**
 * Get queue metrics and status
 * @query {string} [blockchain] - Filter stats by blockchain (optional)
 */
router.get("/metrics", async (req, res) => {
  try {
    const { blockchain } = req.query;

    // Validate blockchain filter if provided
    if (blockchain && !isValidBlockchain(blockchain)) {
      return res.status(400).json({
        error: `Invalid blockchain: ${blockchain}`,
        timestamp: new Date().toISOString(),
      });
    }

    const finalizerMetrics = finalizer.getQueueMetrics();
    const finalizerStatus = finalizer.getQueueStatus();

    // Get database statistics if using Mongoose
    let dbStats = null;
    if (storageLayer.dataProvider.getTransactionStats) {
      // Pass blockchain filter if provided
      dbStats = await storageLayer.dataProvider.getTransactionStats(
        blockchain ? { blockchain } : undefined,
      );
    }

    res.json({
      finalizer: {
        metrics: finalizerMetrics,
        status: finalizerStatus,
      },
      database: dbStats,
      ...(blockchain && { blockchain }),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    getLogger(req).error("Error getting metrics", { error: error.message });
    res.status(500).json({ error: "Failed to get metrics" });
  }
});

/**
 * Get health check status
 */
router.get("/health", async (req, res) => {
  try {
    const status = finalizer.getQueueStatus();

    // Check actual database connectivity
    let dbHealth = {
      connected: false,
      latencyMs: 0,
      error: "No data provider",
    };
    if (
      storageLayer.dataProvider &&
      typeof storageLayer.dataProvider.checkHealth === "function"
    ) {
      dbHealth = await storageLayer.dataProvider.checkHealth();
    }

    // Check HSM health (only when HSM is enabled)
    const hsmHealth = await checkHsmHealth();

    const isHealthy =
      !status.paused &&
      status.concurrency > 0 &&
      dbHealth.connected &&
      (!hsmHealth.checked || hsmHealth.healthy);

    const response = {
      status: isHealthy ? "healthy" : "unhealthy",
      queue: status,
      database: {
        connected: dbHealth.connected,
        latencyMs: dbHealth.latencyMs,
        ...(dbHealth.error && { error: dbHealth.error }),
      },
      timestamp: new Date().toISOString(),
    };

    // Include HSM health when HSM is enabled
    if (hsmHealth.checked) {
      response.hsm = hsmHealth.details;
    }

    res.status(isHealthy ? 200 : 503).json(response);
  } catch (error) {
    getLogger(req).error("Health check error", { error: error.message });
    res.status(503).json({
      status: "unhealthy",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * Dedicated HSM health check endpoint
 * Provides detailed HSM connectivity status independent of composite health.
 */
router.get("/hsm/health", requireAdminAuth(), async (req, res) => {
  try {
    if (!config.hsm?.enabled) {
      return res.json({
        status: "disabled",
        message: "HSM is not enabled in configuration",
        timestamp: new Date().toISOString(),
      });
    }

    const HsmSigningAdapter = require("../business-logic/hsm-signing-adapter");
    const adapter = new HsmSigningAdapter({
      tier: config.hsm.tier || "envelope",
    });
    const health = await adapter.healthCheck();

    const statusCode = health.status === "ok" ? 200 : 503;
    res.status(statusCode).json({
      ...health,
      hsmEnabled: true,
      supportedBlockchains: HsmSigningAdapter.getSupportedBlockchains(),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    getLogger(req).error("HSM health check failed", { error: err.message });
    res.status(503).json({
      status: "error",
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * Pause queue processing
 * @security Requires admin API key
 */
router.post("/queue/pause", requireAdminAuth(), (req, res) => {
  try {
    finalizer.finalizerQueue.pause();
    res.json({ message: "Queue paused", status: finalizer.getQueueStatus() });
  } catch (error) {
    res.status(500).json({ error: "Failed to pause queue" });
  }
});

/**
 * Resume queue processing
 * @security Requires admin API key
 */
router.post("/queue/resume", requireAdminAuth(), (req, res) => {
  try {
    finalizer.finalizerQueue.resume();
    res.json({ message: "Queue resumed", status: finalizer.getQueueStatus() });
  } catch (error) {
    res.status(500).json({ error: "Failed to resume queue" });
  }
});

/**
 * Adjust queue concurrency
 * @security Requires admin API key
 */
router.post("/queue/concurrency", requireAdminAuth(), (req, res) => {
  try {
    const { concurrency } = req.body;

    if (!concurrency || concurrency < 1 || concurrency > 100) {
      return res
        .status(400)
        .json({ error: "Invalid concurrency value (1-100)" });
    }

    finalizer.setQueueConcurrency(parseInt(concurrency));
    res.json({
      message: "Concurrency updated",
      concurrency: parseInt(concurrency),
      status: finalizer.getQueueStatus(),
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to update concurrency" });
  }
});

/**
 * Clean up expired transactions
 * @security Requires admin API key
 */
router.post("/cleanup/expired", requireAdminAuth(), async (req, res) => {
  try {
    if (!storageLayer.dataProvider.cleanupExpiredTransactions) {
      return res
        .status(501)
        .json({ error: "Cleanup not supported by current data provider" });
    }

    const cleanedCount =
      await storageLayer.dataProvider.cleanupExpiredTransactions();
    res.json({
      message: "Cleanup completed",
      cleanedTransactions: cleanedCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    getLogger(req).error("Cleanup error", { error: error.message });
    res.status(500).json({ error: "Cleanup failed" });
  }
});

// =============================================================================
// CORS Blacklist Management
// =============================================================================

/**
 * Get current CORS blacklist
 * @security Requires admin API key
 */
router.get("/cors/blacklist", requireAdminAuth(), (req, res) => {
  try {
    const blacklist = getBlacklist();
    res.json({
      blacklist,
      count: blacklist.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    getLogger(req).error("Failed to get CORS blacklist", {
      error: error.message,
    });
    res.status(500).json({ error: "Failed to get blacklist" });
  }
});

/**
 * Add origin to CORS blacklist
 * @security Requires admin API key
 * @body {origin: string} - Origin to block
 */
router.post("/cors/blacklist", requireAdminAuth(), (req, res) => {
  try {
    const { origin } = req.body;

    if (!origin || typeof origin !== "string") {
      return res.status(400).json({ error: "Origin is required" });
    }

    addToBlacklist(origin);

    res.json({
      message: "Origin added to blacklist",
      origin,
      blacklist: getBlacklist(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    getLogger(req).error("Failed to add to CORS blacklist", {
      error: error.message,
    });
    res.status(500).json({ error: "Failed to add to blacklist" });
  }
});

/**
 * Remove origin from CORS blacklist
 * @security Requires admin API key
 * @body {origin: string} - Origin to unblock
 */
router.delete("/cors/blacklist", requireAdminAuth(), (req, res) => {
  try {
    const { origin } = req.body;

    if (!origin || typeof origin !== "string") {
      return res.status(400).json({ error: "Origin is required" });
    }

    const removed = removeFromBlacklist(origin);

    if (!removed) {
      return res.status(404).json({ error: "Origin not found in blacklist" });
    }

    res.json({
      message: "Origin removed from blacklist",
      origin,
      blacklist: getBlacklist(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    getLogger(req).error("Failed to remove from CORS blacklist", {
      error: error.message,
    });
    res.status(500).json({ error: "Failed to remove from blacklist" });
  }
});

/**
 * Reload CORS blacklist from environment/config
 * @security Requires admin API key
 */
router.post("/cors/blacklist/reload", requireAdminAuth(), (req, res) => {
  try {
    const count = reloadBlacklist();

    res.json({
      message: "Blacklist reloaded from configuration",
      count,
      blacklist: getBlacklist(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    getLogger(req).error("Failed to reload CORS blacklist", {
      error: error.message,
    });
    res.status(500).json({ error: "Failed to reload blacklist" });
  }
});

module.exports = router;
