/**
 * CORS Middleware with Blacklist Support
 *
 * Allows all origins except those on the blacklist.
 * Blacklist can be configured via:
 * - CORS_BLACKLIST environment variable (comma-separated origins)
 * - app.config.json corsBlacklist array
 */

const cors = require("cors");
const logger = require("../utils/logger").child({ component: "cors" });

// Load blacklist from environment or config
function loadBlacklist() {
  const envBlacklist = process.env.CORS_BLACKLIST;

  if (envBlacklist) {
    // Parse comma-separated list, trim whitespace, filter empty entries
    const origins = envBlacklist
      .split(",")
      .map((origin) => origin.trim().toLowerCase())
      .filter((origin) => origin.length > 0);

    logger.info("CORS blacklist loaded from environment", {
      count: origins.length,
    });
    return new Set(origins);
  }

  // Try loading from config file
  try {
    const config = require("../app.config.json");
    if (config.corsBlacklist && Array.isArray(config.corsBlacklist)) {
      const origins = config.corsBlacklist.map((o) => o.toLowerCase());
      logger.info("CORS blacklist loaded from config", {
        count: origins.length,
      });
      return new Set(origins);
    }
  } catch (err) {
    // Config file may not exist or have this field
  }

  logger.info("No CORS blacklist configured, allowing all origins");
  return new Set();
}

// Normalize origin for comparison
function normalizeOrigin(origin) {
  if (!origin) return null;

  try {
    // Handle full URLs by extracting origin
    const url = new URL(origin);
    return url.origin.toLowerCase();
  } catch {
    // If not a valid URL, use as-is (lowercase)
    return origin.toLowerCase();
  }
}

// Create blacklist set (loaded once at startup)
const blacklist = loadBlacklist();

/**
 * Check if an origin is blacklisted
 * @param {string} origin - The origin to check
 * @returns {boolean} - True if blacklisted
 */
function isBlacklisted(origin) {
  if (!origin) return false;

  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;

  // Check exact match
  if (blacklist.has(normalized)) {
    return true;
  }

  // Check if any blacklist entry is a suffix match (for subdomains)
  // e.g., blacklisting "evil.com" also blocks "sub.evil.com"
  for (const blocked of blacklist) {
    if (blocked.startsWith("*.")) {
      // Wildcard pattern: *.evil.com matches sub.evil.com
      const pattern = blocked.slice(2); // Remove *.
      try {
        const url = new URL(normalized);
        if (
          url.hostname.endsWith(pattern) ||
          url.hostname === pattern.slice(1)
        ) {
          return true;
        }
      } catch {
        // Not a valid URL
      }
    }
  }

  return false;
}

/**
 * CORS origin callback for blacklist-based filtering
 * @param {string} origin - Request origin
 * @param {function} callback - CORS callback
 */
function originCallback(origin, callback) {
  // Allow requests with no origin (same-origin, curl, server-to-server)
  if (!origin) {
    return callback(null, true);
  }

  if (isBlacklisted(origin)) {
    logger.warn("CORS request blocked by blacklist", { origin });
    return callback(new Error("Origin not allowed by CORS policy"), false);
  }

  // Allow all non-blacklisted origins
  callback(null, true);
}

/**
 * Default CORS options with blacklist support
 */
// Load maxAge from config (fallback to 24 hours)
let corsMaxAge = 86400;
try {
  const appConfig = require("../app.config");
  corsMaxAge = (appConfig.cors && appConfig.cors.maxAge) || 86400;
} catch {
  /* config not available during early init */
}

const corsOptions = {
  optionsSuccessStatus: 200,
  origin: originCallback,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Admin-API-Key",
    "X-Request-ID",
  ],
  exposedHeaders: ["X-Request-ID"],
  maxAge: corsMaxAge,
};

/**
 * Create CORS middleware with blacklist support
 * @param {object} [options] - Additional CORS options to merge
 * @returns {function} Express middleware
 */
function createCorsMiddleware(options = {}) {
  return cors({ ...corsOptions, ...options });
}

/**
 * Reload blacklist from environment/config
 * Useful for runtime updates without restart
 */
function reloadBlacklist() {
  const newBlacklist = loadBlacklist();
  blacklist.clear();
  for (const origin of newBlacklist) {
    blacklist.add(origin);
  }
  logger.info("CORS blacklist reloaded", { count: blacklist.size });
  return blacklist.size;
}

/**
 * Get current blacklist (for debugging/monitoring)
 * @returns {string[]} Array of blacklisted origins
 */
function getBlacklist() {
  return Array.from(blacklist);
}

/**
 * Add origin to blacklist at runtime
 * @param {string} origin - Origin to block
 */
function addToBlacklist(origin) {
  const normalized = normalizeOrigin(origin);
  if (normalized) {
    blacklist.add(normalized);
    logger.info("Origin added to CORS blacklist", { origin: normalized });
  }
}

/**
 * Remove origin from blacklist at runtime
 * @param {string} origin - Origin to unblock
 */
function removeFromBlacklist(origin) {
  const normalized = normalizeOrigin(origin);
  if (normalized && blacklist.delete(normalized)) {
    logger.info("Origin removed from CORS blacklist", { origin: normalized });
    return true;
  }
  return false;
}

module.exports = {
  createCorsMiddleware,
  corsOptions,
  isBlacklisted,
  reloadBlacklist,
  getBlacklist,
  addToBlacklist,
  removeFromBlacklist,
};
