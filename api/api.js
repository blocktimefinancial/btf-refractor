(async function () {
  process.env.TZ = "Etc/UTC";

  const logger = require("./utils/logger");
  const { validateEnvironment } = require("./utils/env-validator");

  // Validate environment configuration before starting
  validateEnvironment();

  logger.info("Starting Refractor API");

  const http = require("http"),
    express = require("express"),
    helmet = require("helmet"),
    bodyParser = require("body-parser"),
    config = require("./app.config"),
    { port, trustProxy } = config,
    { requestIdMiddleware } = require("./middleware/request-id"),
    finalizer = require("./business-logic/finalization/finalizer");

  //setup connectors
  logger.info("Initializing storage provider");
  await require("./storage/storage-layer").initDataProvider();
  logger.info("Storage provider initialized");
  await finalizer.resetProcessingStatus();
  logger.info("Rollback pending actions complete");

  //start background workers
  finalizer.start();

  //init http app
  const app = express();
  app.disable("x-powered-by");
  if (trustProxy) {
    app.set("trust proxy", trustProxy);
  }

  // Security headers via helmet
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false, // Disable for API compatibility
      crossOriginResourcePolicy: { policy: "cross-origin" }, // Allow cross-origin API access
    }),
  );

  // Request ID middleware - must be early to ensure all requests have an ID
  app.use(requestIdMiddleware());

  if (process.env.MODE === "development") {
    const morgan = require("morgan");
    app.use(morgan("dev"));
  }

  // Request payload size limits to prevent large payload attacks
  const payloadLimit = config.maxPayloadSize || "1mb";
  app.use(bodyParser.json({ limit: payloadLimit }));
  app.use(bodyParser.urlencoded({ extended: false, limit: payloadLimit }));

  // error handler
  app.use((err, req, res, next) => {
    const reqLogger = req.logger || logger;

    // Handle payload too large errors
    if (err.type === "entity.too.large") {
      reqLogger.warn("Request payload too large", {
        ip: req.ip,
        path: req.path,
        limit: payloadLimit,
      });
      return res.status(413).json({ error: "Payload too large" });
    }
    // Handle JSON parse errors
    if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
      reqLogger.warn("Invalid JSON in request body", {
        ip: req.ip,
        path: req.path,
      });
      return res.status(400).json({ error: "Invalid JSON" });
    }
    if (err)
      reqLogger.error("Unhandled error", {
        error: err.message,
        stack: err.stack,
      });
    res.status(500).end();
  });

  // Track if we're already shutting down to prevent multiple calls
  let isShuttingDown = false;

  /**
   * Gracefully shutdown the server and finalize running tasks
   * @param {number} exitCode - Exit code (0 for success, non-zero for error)
   */
  async function gracefulExit(exitCode = 0) {
    // Prevent multiple shutdown attempts
    if (isShuttingDown) {
      logger.warn("Shutdown already in progress, ignoring duplicate signal");
      return;
    }
    isShuttingDown = true;

    logger.info("Initiating graceful shutdown", { exitCode });

    // Force exit after timeout (safety net)
    const FORCE_EXIT_TIMEOUT = config.gracefulShutdownTimeoutMs || 10000;
    const forceExitTimer = setTimeout(() => {
      logger.error("Graceful shutdown timed out, forcing exit");
      process.exit(-1);
    }, FORCE_EXIT_TIMEOUT);

    // Don't let the timer keep the process alive
    forceExitTimer.unref();

    try {
      // Stop accepting new connections
      if (server && server.listening) {
        await new Promise((resolve, reject) => {
          server.close((err) => {
            if (err) {
              logger.warn("Error closing HTTP server", { error: err.message });
              reject(err);
            } else {
              logger.info("HTTP server closed");
              resolve();
            }
          });
        });
      }

      // Stop the finalizer queue (allow in-flight tasks to complete)
      logger.info("Stopping finalizer queue");
      finalizer.stop();

      // Close database connections
      const storageLayer = require("./storage/storage-layer");
      if (storageLayer.dataProvider && storageLayer.dataProvider.close) {
        await storageLayer.dataProvider.close();
        logger.info("Database connection closed");
      }

      logger.info("Graceful shutdown completed");
      clearTimeout(forceExitTimer);
      process.exit(exitCode);
    } catch (error) {
      logger.error("Error during graceful shutdown", { error: error.message });
      clearTimeout(forceExitTimer);
      process.exit(1);
    }
  }

  process.on("uncaughtException", async (err) => {
    logger.error("Fatal uncaught exception", {
      error: err.message,
      stack: err.stack,
    });
    await gracefulExit(1);
  });

  process.on("unhandledRejection", async (reason, promise) => {
    logger.error("Fatal unhandled promise rejection", {
      reason: reason?.stack || reason?.message || reason,
    });
    await gracefulExit(1);
  });

  process.on("message", (msg) => msg === "shutdown" && gracefulExit()); // handle messages from pm2
  process.on("SIGINT", () => gracefulExit());
  process.on("SIGTERM", () => gracefulExit());

  //register API routes
  require("./api/api-routes")(app);
  logger.info("API routes initialized");

  const serverPort = parseInt(process.env.PORT || port || "3000");
  app.set("port", serverPort);

  const server = http.createServer(app);

  server.on("listening", () =>
    logger.info("Refractor API server started", {
      port: server.address().port,
    }),
  );
  server.listen(serverPort);
})();
