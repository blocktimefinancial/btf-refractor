const { Horizon, TransactionBuilder } = require("@stellar/stellar-sdk"),
  EnhancedQueue = require("../queue/enhanced-queue"),
  { resolveNetwork } = require("../network-resolver");
const config = require("../../app.config");
const logger = require("../../utils/logger").forComponent("horizon");
const { getBreaker } = require("../../utils/circuit-breaker");

const servers = {};

// Circuit breaker for Horizon submissions
const horizonBreaker = getBreaker("horizon");

/**
 * @param {TxModel} txInfo
 * @return {Promise}
 */
let submitTransactionWorker = function (txInfo) {
  const normalizedKey = String(txInfo.network);
  let horizon = servers[normalizedKey];
  const network = resolveNetwork(txInfo.network);
  if (!horizon) {
    servers[normalizedKey] = horizon = new Horizon.Server(network.horizon);
  }
  return horizon.submitTransaction(
    TransactionBuilder.fromXDR(txInfo.xdr, network.passphrase),
    { skipMemoRequiredCheck: true },
  );
};

// Wrapper function that calls through the circuit breaker
const submitTransactionWrapper = (txInfo) =>
  horizonBreaker.fire(() => submitTransactionWorker(txInfo));

// Enhanced queue for Horizon submissions with retry logic and monitoring
const horizonQueue = new EnhancedQueue(submitTransactionWrapper, {
  concurrency: config.horizonConcurrency ?? 10,
  maxConcurrency: config.maxHorizonConcurrency ?? 20,
  minConcurrency: config.horizonMinConcurrency ?? 1,
  adaptiveConcurrency: config.adaptiveHorizonConcurrency ?? true,
  retryAttempts: config.horizonRetryAttempts ?? 5,
  retryDelay: config.horizonRetryDelay ?? 2000,
  metricsInterval: config.metricsInterval ?? 30000,
});

// Set up monitoring for horizon queue
horizonQueue.on("metrics", (metrics) => {
  logger.info("Queue metrics", {
    processed: metrics.processed,
    failed: metrics.failed,
    retries: metrics.retries,
    throughput: metrics.throughput.toFixed(2),
    queueLength: metrics.queueLength,
    running: metrics.running,
    concurrency: metrics.concurrency,
    successRate: (metrics.successRate * 100).toFixed(1) + "%",
    utilization: (metrics.utilization * 100).toFixed(1) + "%",
    avgProcessingTime: metrics.avgProcessingTime?.toFixed(0) + "ms",
  });
});

horizonQueue.on("taskFailed", ({ taskId, attempts, error }) => {
  const errorInfo = {
    taskId,
    attempts,
    errorType: error.name || "UnknownError",
    message: error.message,
  };

  if (error.status) {
    errorInfo.httpStatus = error.status;
  }

  if (error.status === 429) {
    logger.warn("Horizon rate limit failure", errorInfo);
  } else {
    logger.error("Horizon submission failure", errorInfo);
  }
});

horizonQueue.on("taskRetry", ({ taskId, attempt, error }) => {
  if (error.status === 429) {
    logger.warn("Retrying rate-limited task", { taskId, attempt });
  } else {
    logger.warn("Retrying failed task", {
      taskId,
      attempt,
      error: error.message,
    });
  }
});

horizonQueue.on(
  "concurrencyAdjusted",
  ({ oldConcurrency, newConcurrency, reason }) => {
    logger.info("Concurrency adjusted", {
      oldConcurrency,
      newConcurrency,
      reason,
    });
  },
);

function setSubmitTransactionCallback(callback) {
  submitTransactionWorker = callback;
}

/**
 * Submit a prepared transaction to Horizon.
 * @param {TxModel} txInfo
 * @return {Promise<TxModel>}
 */
async function submitTransaction(txInfo) {
  try {
    const result = await horizonQueue.push(txInfo);
    txInfo.result = result;
    return txInfo;
  } catch (error) {
    // Enhanced error handling that preserves original error details
    let enhancedError;

    if (error.response && error.response.status) {
      // Preserve the original error structure for Horizon-specific errors
      enhancedError = new Error(
        `Horizon submission failed: ${error.message || "Unknown error"}`,
      );
      enhancedError.name = "HorizonSubmissionError";
      enhancedError.status = error.response.status;
      enhancedError.originalError = error;

      // Preserve important Horizon error details
      if (error.response.data) {
        enhancedError.data = error.response.data;
        if (error.response.data.extras) {
          enhancedError.result_codes = error.response.data.extras.result_codes;
          enhancedError.operation_codes =
            error.response.data.extras.operation_codes;
        }
        if (error.response.data.detail) {
          enhancedError.detail = error.response.data.detail;
        }
      }

      // Special logging for rate limit errors
      if (error.response.status === 429) {
        logger.warn("Rate limit encountered", {
          hash: txInfo.hash,
          status: enhancedError.status,
          detail: enhancedError.detail,
          retryAfter: error.response.headers?.["retry-after"],
        });
      } else {
        logger.error("Horizon submission error", {
          hash: txInfo.hash,
          status: enhancedError.status,
          detail: enhancedError.detail,
          result_codes: enhancedError.result_codes,
          operation_codes: enhancedError.operation_codes,
        });
      }
    } else {
      // Handle network errors and other non-HTTP errors
      enhancedError = new Error(
        `Transaction submission failed: ${error.message || error.toString()}`,
      );
      enhancedError.name = "TransactionSubmissionError";
      enhancedError.originalError = error;

      // Preserve error codes for network issues
      if (error.code) {
        enhancedError.code = error.code;
      }

      logger.error("Non-HTTP submission error", {
        hash: txInfo.hash,
        message: enhancedError.message,
        code: enhancedError.code,
        originalError: error.message,
      });
    }

    throw enhancedError;
  }
}

module.exports = { submitTransaction, setSubmitTransactionCallback };
