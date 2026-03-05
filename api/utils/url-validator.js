/**
 * URL Validator — SSRF Protection
 *
 * Validates callback URLs to prevent Server-Side Request Forgery (SSRF).
 * Blocks requests to private/internal IP ranges, link-local addresses,
 * and cloud metadata endpoints.
 *
 * @module utils/url-validator
 */

const { URL } = require("url");
const dns = require("dns");
const { promisify } = require("util");

const dnsLookup = promisify(dns.lookup);

/**
 * Shared callback URL format regex.
 * Matches http(s)://hostname.tld/optional-path
 * @type {RegExp}
 */
const CALLBACK_URL_PATTERN =
  /^http(s)?:\/\/[-a-zA-Z0-9_+.]{2,256}\.[a-z]{2,4}\b(\/[-a-zA-Z0-9@:%_+.~#?&/=]*)?$/m;

/**
 * Check if a callback URL matches the expected format.
 * @param {string} url
 * @returns {boolean}
 */
function isValidCallbackUrl(url) {
  return CALLBACK_URL_PATTERN.test(url);
}

// ── Private/reserved IP ranges (RFC 1918, RFC 5737, RFC 6598, etc.) ───
const PRIVATE_RANGES = [
  // IPv4
  { start: parseIPv4("10.0.0.0"), end: parseIPv4("10.255.255.255") },
  { start: parseIPv4("172.16.0.0"), end: parseIPv4("172.31.255.255") },
  { start: parseIPv4("192.168.0.0"), end: parseIPv4("192.168.255.255") },
  { start: parseIPv4("127.0.0.0"), end: parseIPv4("127.255.255.255") },
  { start: parseIPv4("169.254.0.0"), end: parseIPv4("169.254.255.255") }, // link-local
  { start: parseIPv4("0.0.0.0"), end: parseIPv4("0.255.255.255") },
  { start: parseIPv4("100.64.0.0"), end: parseIPv4("100.127.255.255") }, // CGN (RFC 6598)
  { start: parseIPv4("192.0.0.0"), end: parseIPv4("192.0.0.255") }, // IETF protocol
  { start: parseIPv4("198.18.0.0"), end: parseIPv4("198.19.255.255") }, // benchmarking
  { start: parseIPv4("224.0.0.0"), end: parseIPv4("255.255.255.255") }, // multicast + reserved
];

// Cloud metadata endpoints (common across AWS, GCP, Azure)
const BLOCKED_HOSTNAMES = new Set([
  "metadata.google.internal",
  "metadata.google.internal.",
  "169.254.169.254", // AWS/GCP/Azure metadata
  "fd00:ec2::254", // AWS IPv6 metadata
]);

/**
 * Parse an IPv4 address to a 32-bit integer.
 * @param {string} ip
 * @returns {number}
 */
function parseIPv4(ip) {
  const parts = ip.split(".");
  return (
    ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
  );
}

/**
 * Check if an IPv4 address falls within private/reserved ranges.
 * @param {string} ip
 * @returns {boolean}
 */
function isPrivateIPv4(ip) {
  const addr = parseIPv4(ip);
  return PRIVATE_RANGES.some(
    (range) => addr >= range.start && addr <= range.end,
  );
}

/**
 * Check if an IPv6 address is private/link-local.
 * @param {string} ip
 * @returns {boolean}
 */
function isPrivateIPv6(ip) {
  const normalized = ip.toLowerCase();
  return (
    normalized === "::1" || // loopback
    normalized.startsWith("fe80") || // link-local
    normalized.startsWith("fc") || // unique local
    normalized.startsWith("fd") || // unique local
    normalized.startsWith("::ffff:127.") || // IPv4-mapped loopback
    normalized.startsWith("::ffff:10.") || // IPv4-mapped private
    normalized.startsWith("::ffff:192.168.") || // IPv4-mapped private
    normalized.startsWith("::ffff:172.") // IPv4-mapped private (partial)
  );
}

/**
 * Check if an IP address (v4 or v6) is private/reserved.
 * @param {string} ip
 * @returns {boolean}
 */
function isPrivateIP(ip) {
  if (ip.includes(":")) {
    return isPrivateIPv6(ip);
  }
  return isPrivateIPv4(ip);
}

/**
 * Validate a callback URL for SSRF safety.
 *
 * Checks:
 * 1. URL is well-formed (http/https only)
 * 2. Hostname is not a known cloud metadata endpoint
 * 3. Hostname does not resolve to a private/reserved IP
 *
 * @param {string} url - URL to validate
 * @param {Object} [options]
 * @param {boolean} [options.checkDns=false] - Resolve hostname and check IP (async)
 * @returns {Promise<{safe: boolean, reason?: string}>}
 */
async function validateCallbackUrl(url, { checkDns = false } = {}) {
  // Parse URL
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { safe: false, reason: "Invalid URL" };
  }

  // Only allow http(s)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { safe: false, reason: `Disallowed protocol: ${parsed.protocol}` };
  }

  // Block known metadata hostnames
  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { safe: false, reason: "Blocked hostname (cloud metadata)" };
  }

  // If the hostname is already an IP, check directly
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    if (isPrivateIPv4(hostname)) {
      return { safe: false, reason: "Callback to private IP not allowed" };
    }
  }

  // If the hostname is an IPv6 literal (in brackets in URLs, but parsed.hostname strips them)
  if (hostname.includes(":")) {
    if (isPrivateIPv6(hostname)) {
      return { safe: false, reason: "Callback to private IPv6 not allowed" };
    }
  }

  // Optional DNS resolution check
  if (checkDns && !hostname.match(/^\d{1,3}(\.\d{1,3}){3}$/)) {
    try {
      const { address, family } = await dnsLookup(hostname);
      if (isPrivateIP(address)) {
        return {
          safe: false,
          reason: `Hostname resolves to private IP: ${address}`,
        };
      }
    } catch {
      // DNS resolution failed — could be a temporary issue, allow
    }
  }

  return { safe: true };
}

module.exports = {
  CALLBACK_URL_PATTERN,
  isValidCallbackUrl,
  validateCallbackUrl,
  isPrivateIP,
  isPrivateIPv4,
  isPrivateIPv6,
  parseIPv4,
};
