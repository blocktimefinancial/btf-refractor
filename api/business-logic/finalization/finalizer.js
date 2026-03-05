const EnhancedQueue = require("../queue/enhanced-queue"),
  storageLayer = require("../../storage/storage-layer"),
  { rehydrateTx } = require("../tx-loader"),
  { processCallback } = require("./callback-handler"),
  { submitTransaction } = require("./tx-submitter"),
  { isSubmissionSupported } = require("./tx-submitter"),
  { getUnixTimestamp } = require("../timestamp-utils");
const config = require("../../app.config");
const logger = require("../../utils/logger").forComponent("finalizer");

class Finalizer {
  constructor() {
    // Initialize enhanced queue with monitoring and adaptive concurrency
    this.finalizerQueue = new EnhancedQueue(this.processTxWrapper.bind(this), {
      concurrency: config.parallelTasks ?? 50,
      maxConcurrency: config.maxParallelTasks ?? 100,
      minConcurrency: config.minParallelTasks ?? 1,
      adaptiveConcurrency: config.adaptiveConcurrency ?? true,
      retryAttempts: config.retryAttempts ?? 3,
      retryDelay: config.retryDelay ?? 1000,
      metricsInterval: config.metricsInterval ?? 30000,
    });

    // Set up queue event listeners for monitoring
    this.setupQueueMonitoring();
  }

  finalizerQueue;

  targetQueueSize = config.targetQueueSize;

  tickerTimeout = config.tickerTimeout;

  processorTimerHandler = -1;

  /** @type {boolean} Set to true during stop() to prevent race conditions */
  stopping = false;

  /**
   * Set up monitoring for the enhanced queue
   */
  setupQueueMonitoring() {
    this.finalizerQueue.on("metrics", (metrics) => {
      logger.info("Queue metrics", {
        processed: metrics.processed,
        failed: metrics.failed,
        throughput: metrics.throughput.toFixed(2),
        queueLength: metrics.queueLength,
        concurrency: metrics.concurrency,
        successRate: (metrics.successRate * 100).toFixed(1) + "%",
        avgProcessingTime: metrics.avgProcessingTime.toFixed(0) + "ms",
      });
    });

    this.finalizerQueue.on(
      "concurrencyAdjusted",
      ({ oldConcurrency, newConcurrency, reason }) => {
        logger.info("Concurrency adjusted", {
          oldConcurrency,
          newConcurrency,
          reason,
        });
      },
    );

    this.finalizerQueue.on("taskFailed", ({ taskId, attempts, error }) => {
      logger.error("Transaction processing failed", {
        hash: taskId,
        attempts,
        error: error.message,
      });
    });

    this.finalizerQueue.on("taskRetry", ({ taskId, attempt, error }) => {
      logger.warn("Retrying transaction", {
        hash: taskId,
        attempt,
        error: error.message,
      });
    });
  }

  async scheduleTransactionsBatch() {
    if (this.stopping) return;
    let foundCount = 0;
    try {
      const now = getUnixTimestamp();
      logger.debug("Querying for ready transactions", {
        currentTime: now,
        filter: "status=ready, minTime<=now",
      });

      //get transactions ready to be submitted
      const cursor = await storageLayer.dataProvider.listTransactions(
        { status: "ready", minTime: { $lte: now } },
        { limit: this.targetQueueSize },
      );

      for await (let txInfo of cursor) {
        foundCount++;
        logger.debug("Found ready transaction", {
          hash: txInfo.hash,
          minTime: txInfo.minTime,
          status: txInfo.status,
        });

        if (this.processorTimerHandler === 0) {
          //pipeline stop executed
          logger.debug("Processor stopped, halting batch processing");
          return;
        }
        logger.debug("Pushing transaction to queue", { hash: txInfo.hash });
        this.finalizerQueue.push(txInfo);
        //the queue length should not exceed the max queue size
        if (this.finalizerQueue.length() >= this.targetQueueSize) {
          logger.debug("Queue size limit reached", {
            limit: this.targetQueueSize,
          });
          break;
        }
      }
      logger.debug("Batch complete", { foundCount });
    } catch (e) {
      logger.error("Error in batch scheduling", {
        error: e.message,
        stack: e.stack,
      });
    }

    // If we found transactions and hit the queue size limit, schedule next batch sooner
    // Also check if there might be more transactions waiting
    let nextTimeout;
    if (foundCount >= this.targetQueueSize) {
      // We hit the queue limit, check again quickly for remaining transactions
      const finalizerConfig = require("../../app.config").finalizer || {};
      nextTimeout = finalizerConfig.fastPollIntervalMs || 500;
    } else if (foundCount > 0) {
      // Found some transactions but not many, check again at normal interval
      nextTimeout = this.tickerTimeout;
    } else {
      // No transactions found, use normal interval
      nextTimeout = this.tickerTimeout;
    }

    // Don't schedule next batch if stop() was called during this execution
    if (this.stopping) return;

    logger.debug("Scheduling next batch", {
      nextTimeout,
      foundCount,
      queueLimit: this.targetQueueSize,
    });

    this.processorTimerHandler = setTimeout(
      () => this.scheduleTransactionsBatch(),
      nextTimeout,
    );
  }

  setQueueConcurrency(concurrency) {
    this.finalizerQueue.setConcurrency(concurrency);
  }

  /**
   * Get queue metrics for monitoring
   */
  getQueueMetrics() {
    return this.finalizerQueue.getMetrics();
  }

  /**
   * Get queue status
   */
  getQueueStatus() {
    return this.finalizerQueue.status();
  }

  /**
   * Process fully signed tx
   * @param {TxModel} txInfo
   * @returns {Promise} - Enhanced queue expects promises, not callbacks
   */
  async processTx(txInfo) {
    const blockchain = txInfo.blockchain || "stellar";
    const networkName = txInfo.networkName || txInfo.network;

    logger.debug("Processing transaction", {
      hash: txInfo.hash,
      status: txInfo.status,
      blockchain,
      network: networkName,
    });

    if (txInfo.status !== "ready") {
      logger.debug("Skipping transaction - not ready", {
        hash: txInfo.hash,
        status: txInfo.status,
      });
      return;
    }

    try {
      //lock tx
      logger.debug("Attempting to lock transaction", { hash: txInfo.hash });
      if (
        !(await storageLayer.dataProvider.updateTxStatus(
          txInfo.hash,
          "processing",
          "ready",
        ))
      ) {
        logger.debug("Failed to obtain lock", { hash: txInfo.hash });
        return; //failed to obtain a lock - some other thread is currently processing this transaction
      }
      logger.debug("Transaction locked", { hash: txInfo.hash });
    } catch (e) {
      logger.error("Error locking transaction", {
        hash: txInfo.hash,
        error: e.message,
      });
      return; //invalid current state
    }

    try {
      if (txInfo.maxTime && txInfo.maxTime < getUnixTimestamp()) {
        logger.warn("Transaction expired", { hash: txInfo.hash });
        throw new Error(`Transaction has already expired`);
      }

      logger.debug("Rehydrating transaction", { hash: txInfo.hash });
      const txInfoFull = rehydrateTx(txInfo);
      const update = { status: "processed" };

      logger.debug("Transaction options", {
        hash: txInfo.hash,
        hasCallback: !!txInfo.callbackUrl,
        submit: !!txInfo.submit,
      });

      if (txInfo.callbackUrl) {
        logger.debug("Processing callback", { hash: txInfo.hash });
        await processCallback(txInfoFull);
        logger.debug("Callback complete", { hash: txInfo.hash });
      }

      if (txInfo.submit) {
        // Check if submission is supported for this blockchain
        if (!isSubmissionSupported(blockchain)) {
          logger.warn("Submission not supported for blockchain", {
            hash: txInfo.hash,
            blockchain,
          });
          throw new Error(
            `Transaction submission not supported for blockchain: ${blockchain}`,
          );
        }

        logger.debug("Submitting transaction", {
          hash: txInfo.hash,
          blockchain,
        });
        await submitTransaction(txInfoFull);
        update.submitted = getUnixTimestamp();
        logger.info("Transaction submitted", {
          hash: txInfo.hash,
          blockchain,
        });
      }

      logger.debug("Updating status to processed", { hash: txInfo.hash });
      if (
        !(await storageLayer.dataProvider.updateTransaction(
          txInfo.hash,
          update,
          "processing",
        ))
      ) {
        logger.error("Failed to update status to processed", {
          hash: txInfo.hash,
        });
        throw new Error(`State conflict after callback execution`);
      }
      logger.info("Transaction processed successfully", { hash: txInfo.hash });
    } catch (e) {
      logger.error("Transaction processing failed", {
        hash: txInfo.hash,
        error: e.message,
        resultCodes: e.result_codes || null,
      });

      // Enhanced error information capture
      const errorInfo = {
        message: e.message + (e.result_codes ? " " + JSON.stringify(e.result_codes) : "") || e.toString(),
        stack: e.stack,
        timestamp: new Date().toISOString(),
        hash: txInfo.hash,
      };

      logger.debug("Updating status to failed", errorInfo);

      await storageLayer.dataProvider.updateTxStatus(
        txInfo.hash,
        "failed",
        "processing",
        e,
      );
      throw e; // Re-throw for enhanced queue to handle
    }
  }

  /**
   * Wrapper method to bridge the gap between FastQ callback style and async/await
   */
  processTxWrapper(txInfo) {
    logger.debug("Processing transaction wrapper", {
      hasDoc: !!txInfo._doc,
      hasToJSON: !!txInfo.toJSON,
    });

    // Extract the actual transaction data from Mongoose document
    let actualTxInfo;
    if (txInfo._doc) {
      // This is a Mongoose document, extract the _doc property
      actualTxInfo = { ...txInfo._doc };
    } else if (txInfo.toJSON) {
      // This is a Mongoose document with toJSON method
      actualTxInfo = txInfo.toJSON();
    } else {
      // This is already a plain object
      actualTxInfo = txInfo;
    }

    logger.debug("Extracted transaction data", {
      hash: actualTxInfo.hash || actualTxInfo._id,
    });

    return this.processTx(actualTxInfo);
  }

  /**
   * Trigger an immediate check for ready transactions (used when new transactions become ready)
   */
  triggerImmediateCheck() {
    // Only trigger if we're not already at capacity and not currently stopping
    if (
      this.processorTimerHandler !== 0 &&
      this.finalizerQueue.length() < this.targetQueueSize
    ) {
      logger.debug("Immediate check triggered", {
        queueLength: this.finalizerQueue.length(),
      });
      clearTimeout(this.processorTimerHandler);
      setImmediate(() => this.scheduleTransactionsBatch());
    }
  }

  start() {
    logger.info("Finalizer started");
    this.scheduleTransactionsBatch().catch((e) =>
      logger.error("Batch scheduling error", { error: e.message }),
    );
  }

  async stop() {
    this.stopping = true;
    clearTimeout(this.processorTimerHandler);
    this.processorTimerHandler = 0;
    //clear the pending queue and wait for completion
    logger.info("Stopping finalizer, waiting for tasks to complete");
    await this.finalizerQueue.kill();
    logger.info("Finalizer stopped");
  }

  async resetProcessingStatus() {
    logger.info("Resetting processing status for stale transactions");
    const cursor = await storageLayer.dataProvider.listTransactions({
      status: "processing",
    });
    let count = 0;
    for await (let txInfo of cursor) {
      await storageLayer.dataProvider.updateTxStatus(
        txInfo.hash,
        "ready",
        "processing",
      );
      count++;
    }
    if (count > 0) {
      logger.info("Reset stale transactions", { count });
    }
  }
}

const finalizer = new Finalizer();

module.exports = finalizer;
