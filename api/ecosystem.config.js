/**
 * PM2 Ecosystem Configuration for Refractor API
 *
 * Configures PM2 cluster mode for Azure Confidential VM deployment.
 * See AZURE_CVM_DEPLOYMENT_PLAN.md §E for design rationale.
 *
 * Usage:
 *   pm2 start ecosystem.config.js --env production
 *   pm2 reload ecosystem.config.js --env production   # zero-downtime reload
 *   pm2 stop refractor-api
 *
 * @see https://pm2.keymetrics.io/docs/usage/application-declaration/
 */

module.exports = {
  apps: [
    {
      // ── Application ─────────────────────────────────────────────
      name: "refractor-api",
      script: "api.js",
      cwd: __dirname, // Ensures correct working directory

      // ── Cluster Mode ────────────────────────────────────────────
      instances: "max", // One worker per vCPU (DCasv5 = up to 96)
      exec_mode: "cluster",

      // ── Memory Management ───────────────────────────────────────
      max_memory_restart: "1G", // Restart worker if it exceeds 1 GB

      // ── Logging ─────────────────────────────────────────────────
      log_date_format: "YYYY-MM-DD HH:mm:ss.SSS Z",
      error_file: "/var/log/refractor/pm2-error.log",
      out_file: "/var/log/refractor/pm2-out.log",
      merge_logs: true, // Combine all cluster worker logs

      // ── Stability ───────────────────────────────────────────────
      min_uptime: "10s", // Consider started after 10s without crash
      max_restarts: 15, // Max restarts within restart_delay window
      restart_delay: 4000, // Wait 4s between restarts
      autorestart: true,
      watch: false, // Do NOT watch files in production

      // ── Graceful Shutdown ───────────────────────────────────────
      kill_timeout: 5000, // Wait 5s for graceful shutdown
      listen_timeout: 10000, // Wait 10s for app ready signal
      shutdown_with_message: true,

      // ── Environment — Development ───────────────────────────────
      env: {
        NODE_ENV: "development",
        PORT: 4010,
      },

      // ── Environment — Production ────────────────────────────────
      env_production: {
        NODE_ENV: "production",
        PORT: 4010,
        UV_THREADPOOL_SIZE: 16, // Increase for crypto operations

        // HSM defaults (override via .env or deployment config)
        HSM_SIGNING_ENABLED: "true",
        HSM_SIGNING_TIER: "envelope",
        USE_CONFIDENTIAL_COMPUTING: "true",
      },

      // ── Environment — Staging ───────────────────────────────────
      env_staging: {
        NODE_ENV: "staging",
        PORT: 4010,
        HSM_SIGNING_ENABLED: "false",
        USE_CONFIDENTIAL_COMPUTING: "false",
      },
    },
  ],
};
