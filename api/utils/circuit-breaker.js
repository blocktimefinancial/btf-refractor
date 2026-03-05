/**
 * Circuit Breaker — Protects external service calls
 *
 * Implements the circuit breaker pattern for HSM, Stellar Horizon,
 * and EVM RPC calls.  When a wrapped function fails repeatedly the
 * breaker "opens" and immediately rejects further calls for a cool-down
 * period, preventing cascade failures.
 *
 * States: CLOSED → OPEN → HALF_OPEN → CLOSED
 *
 * Each named breaker is a singleton (created once, reused).
 *
 * @module utils/circuit-breaker
 */

const logger = require("./logger").forComponent("circuit-breaker");

// ── States ────────────────────────────────────────────────────────
const STATE = Object.freeze({
  CLOSED: "CLOSED",
  OPEN: "OPEN",
  HALF_OPEN: "HALF_OPEN",
});

// ── Default options per breaker type ─────────────────────────────
const DEFAULTS = {
  horizon: {
    timeout: 10000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    volumeThreshold: 5,
  },
  evmRpc: {
    timeout: 15000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    volumeThreshold: 5,
  },
  hsm: {
    timeout: 5000,
    errorThresholdPercentage: 30,
    resetTimeout: 15000,
    volumeThreshold: 3,
  },
};

class CircuitBreaker {
  /**
   * @param {string} name - Identifier for logging / metrics
   * @param {Object} [options]
   * @param {number} [options.timeout=10000] - Max ms for a single call
   * @param {number} [options.errorThresholdPercentage=50] - % failures to open
   * @param {number} [options.resetTimeout=30000] - ms to wait before half-open
   * @param {number} [options.volumeThreshold=5] - Min calls before tripping
   */
  constructor(name, options = {}) {
    const defaults = DEFAULTS[name] || DEFAULTS.horizon;
    this.name = name;
    this.timeout = options.timeout ?? defaults.timeout;
    this.errorThresholdPercentage =
      options.errorThresholdPercentage ?? defaults.errorThresholdPercentage;
    this.resetTimeout = options.resetTimeout ?? defaults.resetTimeout;
    this.volumeThreshold = options.volumeThreshold ?? defaults.volumeThreshold;

    this._state = STATE.CLOSED;
    this._failures = 0;
    this._successes = 0;
    this._totalCalls = 0;
    this._lastFailureTime = 0;
    this._resetTimer = null;
  }

  /** Current breaker state */
  get state() {
    return this._state;
  }

  /** Whether the breaker is accepting calls */
  get isClosed() {
    return this._state === STATE.CLOSED;
  }

  get isOpen() {
    return this._state === STATE.OPEN;
  }

  get isHalfOpen() {
    return this._state === STATE.HALF_OPEN;
  }

  /**
   * Execute a function through the breaker.
   *
   * @param {Function} fn - Async function to protect
   * @param {...any} args - Arguments forwarded to fn
   * @returns {Promise<any>} Result from fn
   */
  async fire(fn, ...args) {
    // If open, check if reset timeout has elapsed → half-open
    if (this._state === STATE.OPEN) {
      if (Date.now() - this._lastFailureTime >= this.resetTimeout) {
        this._transitionTo(STATE.HALF_OPEN);
      } else {
        const err = new Error(
          `Circuit breaker '${this.name}' is OPEN — call rejected`,
        );
        err.code = "ECIRCUITOPEN";
        err.breakerName = this.name;
        throw err;
      }
    }

    // Execute with timeout
    this._totalCalls++;

    try {
      const result = await this._withTimeout(fn, args);
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure();
      throw err;
    }
  }

  /**
   * Forcefully close the breaker (e.g., after a manual health check).
   */
  reset() {
    this._failures = 0;
    this._successes = 0;
    this._totalCalls = 0;
    this._transitionTo(STATE.CLOSED);
  }

  /**
   * Forcefully open the breaker (e.g., during maintenance).
   */
  trip() {
    this._transitionTo(STATE.OPEN);
    this._lastFailureTime = Date.now();
  }

  /** Breaker metrics snapshot */
  getMetrics() {
    return {
      name: this.name,
      state: this._state,
      failures: this._failures,
      successes: this._successes,
      totalCalls: this._totalCalls,
      errorRate:
        this._totalCalls > 0
          ? ((this._failures / this._totalCalls) * 100).toFixed(1) + "%"
          : "0%",
    };
  }

  // ── Private ─────────────────────────────────────────────────────

  _onSuccess() {
    this._successes++;

    if (this._state === STATE.HALF_OPEN) {
      // Successful probe → close breaker
      this._failures = 0;
      this._transitionTo(STATE.CLOSED);
    }
  }

  _onFailure() {
    this._failures++;
    this._lastFailureTime = Date.now();

    if (this._state === STATE.HALF_OPEN) {
      // Failed probe → reopen
      this._transitionTo(STATE.OPEN);
      return;
    }

    // Check if we should trip
    if (this._totalCalls >= this.volumeThreshold) {
      const errorRate = (this._failures / this._totalCalls) * 100;
      if (errorRate >= this.errorThresholdPercentage) {
        this._transitionTo(STATE.OPEN);
      }
    }
  }

  _transitionTo(newState) {
    if (this._state === newState) return;

    const oldState = this._state;
    this._state = newState;

    logger.info(`Circuit breaker '${this.name}': ${oldState} → ${newState}`, {
      breaker: this.name,
      from: oldState,
      to: newState,
      metrics: this.getMetrics(),
    });
  }

  async _withTimeout(fn, args) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const err = new Error(
          `Circuit breaker '${this.name}': call timed out after ${this.timeout}ms`,
        );
        err.code = "ECIRCUITTIMEOUT";
        err.breakerName = this.name;
        reject(err);
      }, this.timeout);

      Promise.resolve(fn(...args))
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }
}

// ── Singleton Registry ──────────────────────────────────────────
const breakers = {};

/**
 * Get or create a named circuit breaker.
 *
 * @param {string} name - 'horizon', 'evmRpc', 'hsm', or custom
 * @param {Object} [options] - Override defaults
 * @returns {CircuitBreaker}
 */
function getBreaker(name, options) {
  if (!breakers[name]) {
    breakers[name] = new CircuitBreaker(name, options);
  }
  return breakers[name];
}

/**
 * Get metrics for all registered breakers.
 * @returns {Object<string, Object>}
 */
function getAllMetrics() {
  const metrics = {};
  for (const [name, breaker] of Object.entries(breakers)) {
    metrics[name] = breaker.getMetrics();
  }
  return metrics;
}

/**
 * Reset all breakers (useful in tests or after manual recovery).
 */
function resetAll() {
  for (const breaker of Object.values(breakers)) {
    breaker.reset();
  }
}

/**
 * Clear the singleton registry (for testing).
 */
function _clearRegistry() {
  for (const key of Object.keys(breakers)) {
    delete breakers[key];
  }
}

module.exports = {
  CircuitBreaker,
  getBreaker,
  getAllMetrics,
  resetAll,
  _clearRegistry,
  STATE,
};
