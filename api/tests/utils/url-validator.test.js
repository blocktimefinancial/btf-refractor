const {
  validateCallbackUrl,
  isPrivateIP,
  isPrivateIPv4,
  isPrivateIPv6,
  parseIPv4,
} = require("../../utils/url-validator");

describe("url-validator", () => {
  describe("parseIPv4", () => {
    it("parses 0.0.0.0", () => {
      expect(parseIPv4("0.0.0.0")).toBe(0);
    });
    it("parses 255.255.255.255", () => {
      expect(parseIPv4("255.255.255.255")).toBe(4294967295);
    });
    it("parses 10.0.0.1", () => {
      expect(parseIPv4("10.0.0.1")).toBe(167772161);
    });
  });

  describe("isPrivateIPv4", () => {
    it.each([
      "10.0.0.1",
      "10.255.255.255",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.0.1",
      "192.168.255.255",
      "127.0.0.1",
      "127.255.255.255",
      "169.254.169.254",
      "0.0.0.0",
      "100.64.0.1",
      "224.0.0.1",
    ])("returns true for private IP %s", (ip) => {
      expect(isPrivateIPv4(ip)).toBe(true);
    });

    it.each(["8.8.8.8", "1.1.1.1", "203.0.113.1", "100.63.255.255"])(
      "returns false for public IP %s",
      (ip) => {
        expect(isPrivateIPv4(ip)).toBe(false);
      },
    );
  });

  describe("isPrivateIPv6", () => {
    it.each(["::1", "fe80::1", "fc00::1", "fd12::abcd", "::ffff:127.0.0.1"])(
      "returns true for private IPv6 %s",
      (ip) => {
        expect(isPrivateIPv6(ip)).toBe(true);
      },
    );

    it.each(["2001:4860:4860::8888", "2607:f8b0:4004:800::200e"])(
      "returns false for public IPv6 %s",
      (ip) => {
        expect(isPrivateIPv6(ip)).toBe(false);
      },
    );
  });

  describe("isPrivateIP", () => {
    it("detects IPv4 private", () => {
      expect(isPrivateIP("10.0.0.1")).toBe(true);
    });
    it("detects IPv6 private", () => {
      expect(isPrivateIP("::1")).toBe(true);
    });
    it("allows public IPv4", () => {
      expect(isPrivateIP("8.8.8.8")).toBe(false);
    });
  });

  describe("validateCallbackUrl", () => {
    it("rejects invalid URL", async () => {
      const result = await validateCallbackUrl("not-a-url");
      expect(result.safe).toBe(false);
      expect(result.reason).toMatch(/Invalid URL/);
    });

    it("rejects non-http protocol", async () => {
      const result = await validateCallbackUrl("ftp://example.com/callback");
      expect(result.safe).toBe(false);
      expect(result.reason).toMatch(/Disallowed protocol/);
    });

    it("rejects file:// protocol", async () => {
      const result = await validateCallbackUrl("file:///etc/passwd");
      expect(result.safe).toBe(false);
      expect(result.reason).toMatch(/Disallowed protocol/);
    });

    it("rejects cloud metadata IP", async () => {
      const result = await validateCallbackUrl(
        "http://169.254.169.254/latest/meta-data/",
      );
      expect(result.safe).toBe(false);
      expect(result.reason).toMatch(/cloud metadata|private IP/);
    });

    it("rejects metadata.google.internal", async () => {
      const result = await validateCallbackUrl(
        "http://metadata.google.internal/computeMetadata/v1/",
      );
      expect(result.safe).toBe(false);
      expect(result.reason).toMatch(/cloud metadata/i);
    });

    it("rejects private IPv4 literal", async () => {
      const result = await validateCallbackUrl("http://10.0.0.1/callback");
      expect(result.safe).toBe(false);
      expect(result.reason).toMatch(/private IP/);
    });

    it("rejects loopback", async () => {
      const result = await validateCallbackUrl(
        "http://127.0.0.1:3000/callback",
      );
      expect(result.safe).toBe(false);
      expect(result.reason).toMatch(/private IP/);
    });

    it("allows valid public https URL", async () => {
      const result = await validateCallbackUrl(
        "https://example.com/webhook/callback",
      );
      expect(result.safe).toBe(true);
    });

    it("allows valid public http URL", async () => {
      const result = await validateCallbackUrl(
        "http://api.example.com/callback",
      );
      expect(result.safe).toBe(true);
    });

    it("allows public IP literal", async () => {
      const result = await validateCallbackUrl("https://8.8.8.8/callback");
      expect(result.safe).toBe(true);
    });
  });
});
