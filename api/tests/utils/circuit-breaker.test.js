/**
 * Circuit Breaker Tests
 *
 * Tests the circuit breaker pattern implementation for protecting
 * external service calls (HSM, Horizon, EVM RPC).
 */

const {
  CircuitBreaker,
  getBreaker,
  getAllMetrics,
  resetAll,
  _clearRegistry,
  STATE,
} = require("../../utils/circuit-breaker");

describe("CircuitBreaker", () => {
  afterEach(() => {
    _clearRegistry();
  });

  // ── Basic operation ─────────────────────────────────────────────

  describe("basic operation", () => {
    it("should start in CLOSED state", () => {
      const cb = new CircuitBreaker("test");
      expect(cb.state).toBe(STATE.CLOSED);
      expect(cb.isClosed).toBe(true);
      expect(cb.isOpen).toBe(false);
    });

    it("should pass through successful calls", async () => {
      const cb = new CircuitBreaker("test");
      const fn = jest.fn().mockResolvedValue("ok");

      const result = await cb.fire(fn, "arg1", "arg2");

      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalledWith("arg1", "arg2");
    });

    it("should propagate errors from wrapped function", async () => {
      const cb = new CircuitBreaker("test");
      const fn = jest.fn().mockRejectedValue(new Error("fail"));

      await expect(cb.fire(fn)).rejects.toThrow("fail");
    });

    it("should track success and failure metrics", async () => {
      const cb = new CircuitBreaker("test", { volumeThreshold: 100 });
      const ok = jest.fn().mockResolvedValue("ok");
      const fail = jest.fn().mockRejectedValue(new Error("err"));

      await cb.fire(ok);
      await cb.fire(ok);
      await expect(cb.fire(fail)).rejects.toThrow();

      const metrics = cb.getMetrics();
      expect(metrics.successes).toBe(2);
      expect(metrics.failures).toBe(1);
      expect(metrics.totalCalls).toBe(3);
    });
  });

  // ── Opening (tripping) ─────────────────────────────────────────

  describe("tripping to OPEN", () => {
    it("should open when error rate exceeds threshold", async () => {
      const cb = new CircuitBreaker("test", {
        errorThresholdPercentage: 50,
        volumeThreshold: 4,
      });
      const fail = jest.fn().mockRejectedValue(new Error("err"));
      const ok = jest.fn().mockResolvedValue("ok");

      await cb.fire(ok); // 1 success
      await expect(cb.fire(fail)).rejects.toThrow(); // 1 fail (25%)
      await expect(cb.fire(fail)).rejects.toThrow(); // 2 fails (50%)
      await expect(cb.fire(fail)).rejects.toThrow(); // 3 fails (75%) → trips

      expect(cb.state).toBe(STATE.OPEN);
    });

    it("should not open below volume threshold", async () => {
      const cb = new CircuitBreaker("test", {
        errorThresholdPercentage: 50,
        volumeThreshold: 10,
      });
      const fail = jest.fn().mockRejectedValue(new Error("err"));

      // Only 3 calls, below threshold of 10
      await expect(cb.fire(fail)).rejects.toThrow();
      await expect(cb.fire(fail)).rejects.toThrow();
      await expect(cb.fire(fail)).rejects.toThrow();

      // Still closed despite 100% error rate (volume too low)
      expect(cb.state).toBe(STATE.CLOSED);
    });

    it("should reject calls immediately when OPEN", async () => {
      const cb = new CircuitBreaker("test", {
        resetTimeout: 60000, // Large timeout
        errorThresholdPercentage: 50,
        volumeThreshold: 2,
      });
      const fail = jest.fn().mockRejectedValue(new Error("err"));

      // Trip the breaker
      await expect(cb.fire(fail)).rejects.toThrow();
      await expect(cb.fire(fail)).rejects.toThrow();

      expect(cb.state).toBe(STATE.OPEN);

      // Next call should be immediately rejected
      const fn = jest.fn().mockResolvedValue("ok");
      await expect(cb.fire(fn)).rejects.toThrow(/OPEN.*rejected/);
      expect(fn).not.toHaveBeenCalled(); // Function was never invoked
    });

    it("should set ECIRCUITOPEN error code on rejection", async () => {
      const cb = new CircuitBreaker("test", {
        resetTimeout: 60000,
        volumeThreshold: 1,
        errorThresholdPercentage: 1,
      });
      const fail = jest.fn().mockRejectedValue(new Error("err"));
      await expect(cb.fire(fail)).rejects.toThrow();

      try {
        await cb.fire(jest.fn());
      } catch (err) {
        expect(err.code).toBe("ECIRCUITOPEN");
        expect(err.breakerName).toBe("test");
      }
    });
  });

  // ── Half-open & recovery ────────────────────────────────────────

  describe("half-open recovery", () => {
    it("should transition to HALF_OPEN after reset timeout", async () => {
      const cb = new CircuitBreaker("test", {
        resetTimeout: 50, // 50ms for testing
        volumeThreshold: 1,
        errorThresholdPercentage: 1,
      });
      const fail = jest.fn().mockRejectedValue(new Error("err"));

      // Trip the breaker
      await expect(cb.fire(fail)).rejects.toThrow();
      expect(cb.state).toBe(STATE.OPEN);

      // Wait for reset timeout
      await new Promise((r) => setTimeout(r, 60));

      // Next call should go through (half-open probe)
      const ok = jest.fn().mockResolvedValue("recovered");
      const result = await cb.fire(ok);

      expect(result).toBe("recovered");
      expect(cb.state).toBe(STATE.CLOSED);
    });

    it("should reopen if half-open probe fails", async () => {
      const cb = new CircuitBreaker("test", {
        resetTimeout: 50,
        volumeThreshold: 1,
        errorThresholdPercentage: 1,
      });
      const fail = jest.fn().mockRejectedValue(new Error("err"));

      // Trip
      await expect(cb.fire(fail)).rejects.toThrow();
      expect(cb.state).toBe(STATE.OPEN);

      // Wait for reset timeout
      await new Promise((r) => setTimeout(r, 60));

      // Probe fails → reopens
      await expect(cb.fire(fail)).rejects.toThrow();
      expect(cb.state).toBe(STATE.OPEN);
    });
  });

  // ── Timeout ─────────────────────────────────────────────────────

  describe("timeout", () => {
    it("should reject calls that exceed timeout", async () => {
      const cb = new CircuitBreaker("test", { timeout: 50 });
      const slow = () => new Promise((r) => setTimeout(r, 200));

      await expect(cb.fire(slow)).rejects.toThrow(/timed out/);
    });

    it("should set ECIRCUITTIMEOUT error code", async () => {
      const cb = new CircuitBreaker("test", { timeout: 50 });
      const slow = () => new Promise((r) => setTimeout(r, 200));

      try {
        await cb.fire(slow);
      } catch (err) {
        expect(err.code).toBe("ECIRCUITTIMEOUT");
      }
    });
  });

  // ── Manual controls ─────────────────────────────────────────────

  describe("manual controls", () => {
    it("should reset breaker to CLOSED", async () => {
      const cb = new CircuitBreaker("test", {
        volumeThreshold: 1,
        errorThresholdPercentage: 1,
      });
      const fail = jest.fn().mockRejectedValue(new Error("err"));
      await expect(cb.fire(fail)).rejects.toThrow();

      cb.reset();

      expect(cb.state).toBe(STATE.CLOSED);
      expect(cb.getMetrics().failures).toBe(0);
    });

    it("should manually trip breaker to OPEN", () => {
      const cb = new CircuitBreaker("test", { resetTimeout: 60000 });

      cb.trip();

      expect(cb.state).toBe(STATE.OPEN);
    });
  });

  // ── Default presets ─────────────────────────────────────────────

  describe("default presets", () => {
    it("should use Horizon defaults for 'horizon' breaker", () => {
      const cb = new CircuitBreaker("horizon");
      expect(cb.timeout).toBe(10000);
      expect(cb.errorThresholdPercentage).toBe(50);
      expect(cb.resetTimeout).toBe(30000);
      expect(cb.volumeThreshold).toBe(5);
    });

    it("should use EVM RPC defaults for 'evmRpc' breaker", () => {
      const cb = new CircuitBreaker("evmRpc");
      expect(cb.timeout).toBe(15000);
    });

    it("should use HSM defaults (tighter threshold) for 'hsm' breaker", () => {
      const cb = new CircuitBreaker("hsm");
      expect(cb.timeout).toBe(5000);
      expect(cb.errorThresholdPercentage).toBe(30);
      expect(cb.resetTimeout).toBe(15000);
      expect(cb.volumeThreshold).toBe(3);
    });

    it("should allow overriding defaults", () => {
      const cb = new CircuitBreaker("hsm", { timeout: 8000 });
      expect(cb.timeout).toBe(8000);
      // non-overridden defaults still apply
      expect(cb.errorThresholdPercentage).toBe(30);
    });
  });

  // ── Singleton Registry ──────────────────────────────────────────

  describe("singleton registry", () => {
    it("should return the same breaker for the same name", () => {
      const b1 = getBreaker("horizon");
      const b2 = getBreaker("horizon");
      expect(b1).toBe(b2);
    });

    it("should return different breakers for different names", () => {
      const b1 = getBreaker("horizon");
      const b2 = getBreaker("hsm");
      expect(b1).not.toBe(b2);
    });

    it("should report all metrics", async () => {
      const b1 = getBreaker("horizon");
      const b2 = getBreaker("hsm");
      await b1.fire(jest.fn().mockResolvedValue("ok"));

      const metrics = getAllMetrics();
      expect(metrics.horizon).toBeDefined();
      expect(metrics.hsm).toBeDefined();
      expect(metrics.horizon.successes).toBe(1);
    });

    it("should reset all breakers", async () => {
      const b1 = getBreaker("horizon");
      await b1.fire(jest.fn().mockResolvedValue("ok"));
      expect(b1.getMetrics().totalCalls).toBe(1);

      resetAll();

      expect(b1.getMetrics().totalCalls).toBe(0);
    });
  });
});
