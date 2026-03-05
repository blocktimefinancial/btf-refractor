/**
 * Authentication Middleware Tests
 *
 * Tests for admin API key authentication middleware.
 */

const { requireAdminAuth } = require("../../middleware/auth");

describe("Authentication Middleware", () => {
  let mockReq;
  let mockRes;
  let mockNext;
  let originalEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = process.env.ADMIN_API_KEY;

    // Reset mocks
    mockReq = {
      headers: {},
      ip: "127.0.0.1",
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
  });

  afterEach(() => {
    // Restore original environment
    if (originalEnv !== undefined) {
      process.env.ADMIN_API_KEY = originalEnv;
    } else {
      delete process.env.ADMIN_API_KEY;
    }
  });

  describe("requireAdminAuth()", () => {
    describe("when ADMIN_API_KEY is not configured", () => {
      beforeEach(() => {
        delete process.env.ADMIN_API_KEY;
      });

      it("should return 503 Service Unavailable", () => {
        const middleware = requireAdminAuth();
        middleware(mockReq, mockRes, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(503);
        expect(mockRes.json).toHaveBeenCalledWith({
          error: "Admin endpoints not configured",
          message:
            "ADMIN_API_KEY environment variable must be set to enable admin endpoints",
        });
        expect(mockNext).not.toHaveBeenCalled();
      });
    });

    describe("when ADMIN_API_KEY is configured", () => {
      const testApiKey = "test-api-key-12345";

      beforeEach(() => {
        process.env.ADMIN_API_KEY = testApiKey;
      });

      it("should return 401 when X-Admin-API-Key header is missing", () => {
        const middleware = requireAdminAuth();
        middleware(mockReq, mockRes, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(401);
        expect(mockRes.json).toHaveBeenCalledWith({
          error: "Authentication required",
          message: "Missing X-Admin-API-Key header",
        });
        expect(mockNext).not.toHaveBeenCalled();
      });

      it("should return 403 when API key is invalid", () => {
        mockReq.headers["x-admin-api-key"] = "wrong-key";

        const middleware = requireAdminAuth();
        middleware(mockReq, mockRes, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(403);
        expect(mockRes.json).toHaveBeenCalledWith({
          error: "Forbidden",
          message: "Invalid API key",
        });
        expect(mockNext).not.toHaveBeenCalled();
      });

      it("should call next() when API key is valid", () => {
        mockReq.headers["x-admin-api-key"] = testApiKey;

        const middleware = requireAdminAuth();
        middleware(mockReq, mockRes, mockNext);

        expect(mockRes.status).not.toHaveBeenCalled();
        expect(mockRes.json).not.toHaveBeenCalled();
        expect(mockNext).toHaveBeenCalledTimes(1);
      });

      it("should reject API key with different case", () => {
        mockReq.headers["x-admin-api-key"] = testApiKey.toUpperCase();

        const middleware = requireAdminAuth();
        middleware(mockReq, mockRes, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(403);
        expect(mockNext).not.toHaveBeenCalled();
      });

      it("should reject empty API key", () => {
        mockReq.headers["x-admin-api-key"] = "";

        const middleware = requireAdminAuth();
        middleware(mockReq, mockRes, mockNext);

        // Empty string is falsy, so it's treated as missing auth (401)
        expect(mockRes.status).toHaveBeenCalledWith(401);
        expect(mockNext).not.toHaveBeenCalled();
      });

      it("should reject API key with extra whitespace", () => {
        mockReq.headers["x-admin-api-key"] = ` ${testApiKey} `;

        const middleware = requireAdminAuth();
        middleware(mockReq, mockRes, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(403);
        expect(mockNext).not.toHaveBeenCalled();
      });
    });
  });

  describe("secureCompare", () => {
    // Import via internal access or test behavior through the middleware
    const crypto = require("crypto");

    it("should accept matching keys regardless of length", () => {
      // Short key
      process.env.ADMIN_API_KEY = "ab";
      mockReq.headers["x-admin-api-key"] = "ab";
      const mw1 = requireAdminAuth();
      mw1(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(1);

      // Long key
      mockNext.mockClear();
      mockRes.status.mockClear();
      const longKey = "a".repeat(256);
      process.env.ADMIN_API_KEY = longKey;
      mockReq.headers["x-admin-api-key"] = longKey;
      const mw2 = requireAdminAuth();
      mw2(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it("should reject keys of different lengths", () => {
      process.env.ADMIN_API_KEY = "short";
      mockReq.headers["x-admin-api-key"] = "much-longer-key";

      const middleware = requireAdminAuth();
      middleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it("should reject different keys of same length", () => {
      process.env.ADMIN_API_KEY = "aaaa";
      mockReq.headers["x-admin-api-key"] = "bbbb";

      const middleware = requireAdminAuth();
      middleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockNext).not.toHaveBeenCalled();
    });
  });
});
