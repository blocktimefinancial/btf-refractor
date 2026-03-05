/**
 * Ecosystem Config Tests
 *
 * Validates the PM2 ecosystem configuration structure.
 * These are structural tests — they don't start PM2, they verify
 * the config object has the correct shape and values.
 */

const path = require("path");

describe("ecosystem.config.js", () => {
  let config;

  beforeAll(() => {
    config = require("../../ecosystem.config");
  });

  // ── Structure ─────────────────────────────────────────────────

  describe("structure", () => {
    it("should export an object with apps array", () => {
      expect(config).toBeDefined();
      expect(Array.isArray(config.apps)).toBe(true);
      expect(config.apps.length).toBeGreaterThan(0);
    });

    it("should define the refractor-api app", () => {
      const app = config.apps[0];
      expect(app.name).toBe("refractor-api");
    });
  });

  // ── App Configuration ─────────────────────────────────────────

  describe("app configuration", () => {
    let app;

    beforeAll(() => {
      app = config.apps[0];
    });

    it("should use api.js as the script", () => {
      expect(app.script).toBe("api.js");
    });

    it("should set cwd to the directory containing ecosystem.config", () => {
      // cwd uses __dirname which should be the api/ directory
      expect(app.cwd).toBeDefined();
      expect(typeof app.cwd).toBe("string");
    });

    it("should use cluster exec_mode with max instances", () => {
      expect(app.exec_mode).toBe("cluster");
      expect(app.instances).toBe("max");
    });

    it("should set max_memory_restart to 1G", () => {
      expect(app.max_memory_restart).toBe("1G");
    });

    it("should merge cluster logs", () => {
      expect(app.merge_logs).toBe(true);
    });

    it("should not watch files (production safety)", () => {
      expect(app.watch).toBe(false);
    });

    it("should have autorestart enabled", () => {
      expect(app.autorestart).toBe(true);
    });

    it("should configure graceful shutdown timeouts", () => {
      expect(app.kill_timeout).toBeGreaterThan(0);
      expect(app.listen_timeout).toBeGreaterThan(0);
    });

    it("should have restart limits", () => {
      expect(app.max_restarts).toBeGreaterThan(0);
      expect(app.restart_delay).toBeGreaterThan(0);
      expect(app.min_uptime).toBeDefined();
    });
  });

  // ── Environment Configs ───────────────────────────────────────

  describe("environment configurations", () => {
    let app;

    beforeAll(() => {
      app = config.apps[0];
    });

    it("should have development env defaults", () => {
      expect(app.env).toBeDefined();
      expect(app.env.NODE_ENV).toBe("development");
      expect(app.env.PORT).toBe(4010);
    });

    it("should have production env with HSM enabled", () => {
      expect(app.env_production).toBeDefined();
      expect(app.env_production.NODE_ENV).toBe("production");
      expect(app.env_production.HSM_SIGNING_ENABLED).toBe("true");
      expect(app.env_production.USE_CONFIDENTIAL_COMPUTING).toBe("true");
    });

    it("should set UV_THREADPOOL_SIZE for crypto ops in production", () => {
      expect(app.env_production.UV_THREADPOOL_SIZE).toBe(16);
    });

    it("should have staging env with HSM disabled", () => {
      expect(app.env_staging).toBeDefined();
      expect(app.env_staging.NODE_ENV).toBe("staging");
      expect(app.env_staging.HSM_SIGNING_ENABLED).toBe("false");
    });

    it("should set HSM tier to envelope in production", () => {
      expect(app.env_production.HSM_SIGNING_TIER).toBe("envelope");
    });
  });

  // ── Log Configuration ─────────────────────────────────────────

  describe("log configuration", () => {
    let app;

    beforeAll(() => {
      app = config.apps[0];
    });

    it("should have log date format", () => {
      expect(app.log_date_format).toBeDefined();
      expect(app.log_date_format).toContain("YYYY");
    });

    it("should configure log file paths", () => {
      expect(app.error_file).toContain("pm2-error");
      expect(app.out_file).toContain("pm2-out");
    });
  });
});
