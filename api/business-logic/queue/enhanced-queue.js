const createQueue = require("fastq");
const EventEmitter = require("events");
const logger = require("../../utils/logger").forComponent("queue");
const config = require("../../app.config");
const queueConfig = config.queue;

/**
 * Enhanced FastQ wrapper with monitoring, metrics, and adaptive concurrency
 */
class EnhancedQueue extends EventEmitter {
  constructor(worker, options = {}) {
    super();

    this.options = {
      concurrency: options.concurrency ?? 10,
      maxConcurrency: options.maxConcurrency ?? 100,
      minConcurrency: options.minConcurrency ?? 1,
      retryAttempts: options.retryAttempts ?? 3,
      retryDelay: options.retryDelay ?? 1000,
      adaptiveConcurrency: options.adaptiveConcurrency ?? false,
      metricsInterval: options.metricsInterval ?? 30000, // 30 seconds
      ...options,
    };

    this.stats = {
      processed: 0,
      failed: 0,
      retries: 0,
      avgProcessingTime: 0,
      totalProcessingTime: 0,
      currentLoad: 0,
      peakLoad: 0,
      startTime: Date.now(),
    };

    this.processingTimes = [];
    this.maxProcessingTimesSamples =
      queueConfig.maxProcessingTimeSamples || 100;

    // Create the underlying fastq queue
    this.queue = createQueue(
      this.createWorkerWrapper(worker),
      this.options.concurrency,
    );

    // Set up monitoring
    this.setupMonitoring();

    // Set up adaptive concurrency if enabled
    if (this.options.adaptiveConcurrency) {
      this.setupAdaptiveConcurrency();
    }
  }

  /**
   * Create a worker wrapper with retry logic and metrics collection
   */
  createWorkerWrapper(originalWorker) {
    return async (task, callback) => {
      const startTime = Date.now();
      const taskId =
        task.hash ||
        task.id ||
        `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      let attempt = 0;
      let lastError;

      const attemptTask = async () => {
        attempt++;

        try {
          this.emit("taskStart", { taskId, attempt, task });

          const result = await originalWorker(task);

          const processingTime = Date.now() - startTime;
          this.updateStats(processingTime, true);

          this.emit("taskComplete", {
            taskId,
            attempt,
            processingTime,
            result,
          });
          if (callback) {
            callback(null, result);
          }
        } catch (error) {
          logger.debug("Task error", { taskId, error: error.message });
          lastError = error;
          const processingTime = Date.now() - startTime;

          this.emit("taskError", { taskId, attempt, error, processingTime });

          if (attempt < this.options.retryAttempts && this.shouldRetry(error)) {
            logger.debug("Scheduling task retry", {
              taskId,
              attempt,
              maxAttempts: this.options.retryAttempts,
            });
            this.stats.retries++;
            this.emit("taskRetry", { taskId, attempt: attempt + 1, error });

            // Special handling for rate limit errors (429)
            let delay;
            if (error.status === 429) {
              // For rate limits, use longer delays with more backoff
              delay = Math.min(
                this.options.retryDelay *
                  Math.pow(
                    queueConfig.rateLimitBackoffMultiplier || 3,
                    attempt - 1,
                  ) +
                  Math.random() * (queueConfig.rateLimitBackoffJitter || 2000),
                queueConfig.rateLimitMaxDelay || 30000,
              );
              logger.warn("Rate limit detected, backing off", {
                taskId,
                delay,
              });

              // Temporarily reduce concurrency to ease pressure
              if (this.queue.concurrency > this.options.minConcurrency) {
                const newConcurrency = Math.max(
                  Math.floor(
                    this.queue.concurrency *
                      (queueConfig.rateLimitConcurrencyFactor || 0.7),
                  ),
                  this.options.minConcurrency,
                );
                logger.warn("Reducing concurrency due to rate limiting", {
                  oldConcurrency: this.queue.concurrency,
                  newConcurrency,
                });
                this.queue.concurrency = newConcurrency;
              }
            } else {
              // Standard exponential backoff with jitter for other errors
              delay =
                this.options.retryDelay * Math.pow(2, attempt - 1) +
                Math.random() * (queueConfig.retryJitter || 1000);
            }

            setTimeout(attemptTask, delay);
          } else {
            logger.error("Task failed permanently", {
              taskId,
              attempts: attempt,
              error: lastError.message || lastError.toString(),
            });
            this.updateStats(processingTime, false);
            this.emit("taskFailed", {
              taskId,
              attempts: attempt,
              error: lastError,
            });
            if (callback) {
              callback(lastError);
            }
          }
        }
      };

      attemptTask();
    };
  }

  /**
   * Determine if an error should trigger a retry
   */
  shouldRetry(error) {
    // Don't retry validation errors or permanent client errors (4xx except 429)
    if (error.name === "ValidationError") {
      return false;
    }

    // Handle HTTP status codes
    if (error.status) {
      // Always retry rate limit errors (429)
      if (error.status === 429) {
        return true;
      }

      // Don't retry other client errors (400-499 except 429)
      if (error.status >= 400 && error.status < 500) {
        return false;
      }

      // Retry server errors (5xx)
      if (error.status >= 500) {
        return true;
      }
    }

    // Retry network errors, timeouts, and connection issues
    if (
      error.code === "ECONNRESET" ||
      error.code === "ENOTFOUND" ||
      error.code === "ECONNREFUSED" ||
      error.code === "ETIMEDOUT" ||
      error.message?.includes("timeout") ||
      error.message?.includes("network") ||
      error.message?.includes("connection")
    ) {
      return true;
    }

    // Default to not retrying unknown errors
    return false;
  }

  /**
   * Update internal statistics
   */
  updateStats(processingTime, success) {
    if (success) {
      this.stats.processed++;
    } else {
      this.stats.failed++;
    }

    this.stats.totalProcessingTime += processingTime;
    this.processingTimes.push(processingTime);

    // Keep only recent processing times for rolling average
    if (this.processingTimes.length > this.maxProcessingTimesSamples) {
      this.processingTimes.shift();
    }

    // Calculate average processing time
    this.stats.avgProcessingTime =
      this.processingTimes.reduce((a, b) => a + b, 0) /
      this.processingTimes.length;

    // Update current load
    this.stats.currentLoad = this.queue.length() + this.queue.running();
    if (this.stats.currentLoad > this.stats.peakLoad) {
      this.stats.peakLoad = this.stats.currentLoad;
    }
  }

  /**
   * Set up monitoring and metrics emission
   */
  setupMonitoring() {
    this.metricsInterval = setInterval(() => {
      const metrics = this.getMetrics();
      this.emit("metrics", metrics);
    }, this.options.metricsInterval);
    // Don't prevent process exit if the queue is the only thing keeping it alive
    if (this.metricsInterval.unref) this.metricsInterval.unref();
  }

  /**
   * Set up adaptive concurrency based on queue performance
   */
  setupAdaptiveConcurrency() {
    this.adaptiveInterval = setInterval(() => {
      this.adjustConcurrency();
    }, this.options.metricsInterval);
    if (this.adaptiveInterval.unref) this.adaptiveInterval.unref();
  }

  /**
   * Adjust concurrency based on current performance metrics
   */
  adjustConcurrency() {
    const currentConcurrency = this.queue.concurrency;
    const queueLength = this.queue.length();
    const avgProcessingTime = this.stats.avgProcessingTime;
    const successRate =
      this.stats.processed / (this.stats.processed + this.stats.failed) || 1;
    const errorRate =
      this.stats.failed / (this.stats.processed + this.stats.failed) || 0;

    let newConcurrency = currentConcurrency;

    // If we're seeing high error rates, be more conservative
    if (errorRate > (queueConfig.adaptiveErrorRateThreshold || 0.1)) {
      newConcurrency = Math.max(
        Math.floor(
          currentConcurrency * (queueConfig.concurrencyReductionFactor || 0.8),
        ),
        this.options.minConcurrency,
      );
    }
    // During bulk operations (large queue), be more conservative with scaling
    else if (
      queueLength >
      ((queueConfig.bulkOps && queueConfig.bulkOps.queueThreshold) || 50)
    ) {
      const bulkOps = queueConfig.bulkOps;
      // Only increase concurrency if success rate is very high and processing is fast
      if (
        queueLength > currentConcurrency * 3 &&
        successRate > (bulkOps.successThreshold || 0.98) &&
        avgProcessingTime < (bulkOps.maxProcessingTime || 3000) &&
        currentConcurrency <
          this.options.maxConcurrency * (bulkOps.concurrencyCap || 0.7)
      ) {
        newConcurrency = Math.min(
          currentConcurrency + 1,
          Math.floor(
            this.options.maxConcurrency * (bulkOps.concurrencyCap || 0.7),
          ),
        );
      }
      // Decrease if processing is slow or error rate is elevated
      else if (
        avgProcessingTime > (bulkOps.slowThreshold || 8000) ||
        successRate < (bulkOps.minSuccessRate || 0.95)
      ) {
        newConcurrency = Math.max(
          currentConcurrency - 1,
          this.options.minConcurrency,
        );
      }
    }
    // Normal operations - original logic but more conservative
    else {
      const normalOps = queueConfig.normalOps;
      // Increase concurrency if queue is building up and success rate is excellent
      if (
        queueLength >
          currentConcurrency * (normalOps.scaleUpQueueFactor || 2) &&
        successRate > (normalOps.successThreshold || 0.98) &&
        avgProcessingTime < (normalOps.maxProcessingTime || 4000)
      ) {
        newConcurrency = Math.min(
          currentConcurrency + 1,
          this.options.maxConcurrency,
        );
      }
      // Decrease concurrency if processing is slow or error rate is elevated
      else if (
        avgProcessingTime > (normalOps.slowThreshold || 10000) ||
        successRate < (normalOps.minSuccessRate || 0.9)
      ) {
        newConcurrency = Math.max(
          currentConcurrency - 1,
          this.options.minConcurrency,
        );
      }
      // Decrease concurrency if queue is empty for extended period
      else if (
        queueLength === 0 &&
        this.queue.running() < currentConcurrency / 2
      ) {
        newConcurrency = Math.max(
          currentConcurrency - 1,
          this.options.minConcurrency,
        );
      }
    }

    if (newConcurrency !== currentConcurrency) {
      this.queue.concurrency = newConcurrency;
      this.emit("concurrencyAdjusted", {
        oldConcurrency: currentConcurrency,
        newConcurrency,
        reason: { queueLength, avgProcessingTime, successRate, errorRate },
      });
    }
  }

  /**
   * Get comprehensive metrics
   */
  getMetrics() {
    const runtime = Date.now() - this.stats.startTime;
    const throughput = this.stats.processed / (runtime / 1000) || 0;

    return {
      ...this.stats,
      runtime,
      throughput,
      queueLength: this.queue.length(),
      running: this.queue.running(),
      concurrency: this.queue.concurrency,
      successRate:
        this.stats.processed / (this.stats.processed + this.stats.failed) || 1,
      utilization: this.queue.running() / this.queue.concurrency,
    };
  }

  /**
   * Add task to queue with priority support
   */
  push(task, priority = 0, callback) {
    if (typeof priority === "function") {
      callback = priority;
      priority = 0;
    }

    // Add priority and timestamp to task
    const enhancedTask = {
      ...task,
      _priority: priority,
      _queuedAt: Date.now(),
    };

    if (callback) {
      this.queue.push(enhancedTask, callback);
    } else {
      return new Promise((resolve, reject) => {
        this.queue.push(enhancedTask, (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
    }
  }

  /**
   * Add high priority task
   */
  unshift(task, callback) {
    return this.queue.unshift(task, callback);
  }

  /**
   * Pause the queue
   */
  pause() {
    this.queue.pause();
    this.emit("paused");
  }

  /**
   * Resume the queue
   */
  resume() {
    this.queue.resume();
    this.emit("resumed");
  }

  /**
   * Get queue status
   */
  status() {
    return {
      length: this.queue.length(),
      running: this.queue.running(),
      concurrency: this.queue.concurrency,
      paused: this.queue.paused,
      idle: this.queue.idle(),
    };
  }

  /**
   * Drain the queue and stop processing
   */
  async kill() {
    return new Promise((resolve) => {
      this.queue.kill();

      // Clean up intervals
      if (this.metricsInterval) {
        clearInterval(this.metricsInterval);
      }
      if (this.adaptiveInterval) {
        clearInterval(this.adaptiveInterval);
      }

      this.emit("killed");
      resolve();
    });
  }

  /**
   * Wait for queue to become idle
   */
  async drain() {
    return new Promise((resolve) => {
      if (this.queue.idle()) {
        resolve();
      } else {
        const checkIdle = () => {
          if (this.queue.idle()) {
            resolve();
          } else {
            setTimeout(checkIdle, queueConfig.drainPollInterval || 100);
          }
        };
        checkIdle();
      }
    });
  }

  /**
   * Check if queue is idle
   */
  idle() {
    return this.queue.idle();
  }

  /**
   * Get queue length
   */
  length() {
    return this.queue.length();
  }

  /**
   * Get number of running tasks
   */
  running() {
    return this.queue.running();
  }

  /**
   * Set concurrency manually
   */
  setConcurrency(concurrency) {
    const oldConcurrency = this.queue.concurrency;
    this.queue.concurrency = Math.max(
      1,
      Math.min(concurrency, this.options.maxConcurrency),
    );

    if (oldConcurrency !== this.queue.concurrency) {
      this.emit("concurrencyChanged", {
        oldConcurrency,
        newConcurrency: this.queue.concurrency,
      });
    }
  }
}

module.exports = EnhancedQueue;
