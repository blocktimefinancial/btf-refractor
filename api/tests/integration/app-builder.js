/**
 * Express App Builder (for testing)
 *
 * Creates a fully configured Express app with all middleware and routes
 * but WITHOUT starting an HTTP server or connecting to a real database.
 * Uses the in-memory data provider by default.
 *
 * @module tests/integration/app-builder
 */

const express = require("express");
const bodyParser = require("body-parser");

/**
 * Build a configured Express app suitable for supertest.
 *
 * @param {Object} [options]
 * @param {string} [options.storage='inmemory'] - Storage provider type
 * @returns {Promise<express.Application>}
 */
async function buildApp(options = {}) {
  const storageLayer = require("../../storage/storage-layer");

  // Initialize storage (default: inmemory for speed)
  await storageLayer.initDataProvider(options.storage || "inmemory");

  const app = express();
  app.disable("x-powered-by");

  // Body parsing
  app.use(bodyParser.json({ limit: "1mb" }));
  app.use(bodyParser.urlencoded({ extended: false, limit: "1mb" }));

  // Request ID middleware
  const { requestIdMiddleware } = require("../../middleware/request-id");
  app.use(requestIdMiddleware());

  // Register routes
  require("../../api/api-routes")(app);

  // Error handler (same as production)
  app.use((err, req, res, next) => {
    if (err.type === "entity.too.large") {
      return res.status(413).json({ error: "Payload too large" });
    }
    if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
      return res.status(400).json({ error: "Invalid JSON" });
    }
    res.status(500).end();
  });

  return app;
}

module.exports = { buildApp };
