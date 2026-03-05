/**
 * BTF Standard Logger Module
 * Centralized logging using Winston with structured log levels
 *
 * Log Levels (from highest to lowest priority):
 * - error: Error events that might still allow the application to continue
 * - warn: Warning events that may indicate a problem
 * - info: Informational messages highlighting application progress
 * - http: HTTP request logging
 * - debug: Detailed debug information for development
 */

const winston = require("winston");

// Determine environment
const isProduction = process.env.NODE_ENV === "production";
const isDevelopment =
  process.env.MODE === "development" || process.env.NODE_ENV === "development";

// Log level from environment or default based on mode
const logLevel = process.env.LOG_LEVEL || (isDevelopment ? "debug" : "info");

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
  winston.format.errors({ stack: true }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ level, message, timestamp, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    return `[${timestamp}] ${level}: ${message}${metaStr}`;
  }),
);

// JSON format for production/file logging
const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

// Create transports array
const transports = [
  // Console transport - always enabled
  new winston.transports.Console({
    format: isProduction ? jsonFormat : consoleFormat,
  }),
];

// Load logging config (safe — no circular deps since logger is leaf)
let logMaxFileSize = 10 * 1024 * 1024;
let logMaxFiles = 5;
try {
  const baseConfig = require("../app.config.json");
  if (baseConfig.logging) {
    logMaxFileSize = baseConfig.logging.maxFileSize || logMaxFileSize;
    logMaxFiles = baseConfig.logging.maxFiles || logMaxFiles;
  }
} catch {
  /* config not available */
}

// Add file transport in production
if (isProduction && process.env.LOG_FILE) {
  transports.push(
    new winston.transports.File({
      filename: process.env.LOG_FILE,
      format: jsonFormat,
      maxsize: logMaxFileSize,
      maxFiles: logMaxFiles,
      tailable: true,
    }),
  );

  // Separate error log file
  transports.push(
    new winston.transports.File({
      filename: process.env.LOG_FILE.replace(".log", "-error.log"),
      level: "error",
      format: jsonFormat,
      maxsize: logMaxFileSize,
      maxFiles: logMaxFiles,
      tailable: true,
    }),
  );
}

// Create the logger instance
const logger = winston.createLogger({
  level: logLevel,
  defaultMeta: { service: "refractor-api" },
  transports,
  // Don't exit on uncaught exceptions - let the app handle them
  exitOnError: false,
});

/**
 * Create a child logger with additional context
 * @param {Object} meta - Additional metadata to include in all logs
 * @returns {Logger} Child logger instance
 */
logger.child = function (meta) {
  return winston.createLogger({
    level: this.level,
    defaultMeta: { ...this.defaultMeta, ...meta },
    transports: this.transports,
    exitOnError: false,
  });
};

/**
 * Create a request-scoped logger
 * @param {string} requestId - Request ID for tracing
 * @param {string} [component] - Component name
 * @returns {Logger} Scoped logger
 */
logger.forRequest = function (requestId, component) {
  const meta = { requestId };
  if (component) meta.component = component;
  return this.child(meta);
};

/**
 * Create a component-scoped logger
 * @param {string} component - Component name (e.g., 'finalizer', 'horizon')
 * @returns {Logger} Component logger
 */
logger.forComponent = function (component) {
  return this.child({ component });
};

// Log startup info
logger.info("Logger initialized", {
  level: logLevel,
  environment: isProduction
    ? "production"
    : isDevelopment
      ? "development"
      : "default",
});

module.exports = logger;
