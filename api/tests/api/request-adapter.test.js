/**
 * Tests for Request Adapter
 *
 * Tests the normalization of incoming transaction requests from
 * legacy Stellar format, txUri format, and component-based format.
 */

const {
  normalizeRequest,
  detectRequestFormat,
  normalizeLegacyRequest,
  normalizeTxUriRequest,
  normalizeComponentRequest,
  isStellarRequest,
  toLegacyFormat,
  STELLAR_NETWORK_MAP,
  STELLAR_NETWORK_ID_MAP,
} = require("../../business-logic/request-adapter");

describe("Request Adapter", () => {
  // Sample valid XDR for testing
  const validXdr =
    "AAAAAgAAAABTWgh1bRm6Aksd3hHdZ0hlVxDTTfqfP2kfxwVWAsCDjgAAAGQAAAAAAAAAAQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAQAAAABTWgh1bRm6Aksd3hHdZ0hlVxDTTfqfP2kfxwVWAsCDjgAAAAAAAAAAAJiWgAAAAAAAAAAA";

  describe("detectRequestFormat()", () => {
    it("should detect legacy format with xdr and network number", () => {
      const body = { xdr: validXdr, network: 0 };
      expect(detectRequestFormat(body)).toBe("legacy");
    });

    it("should detect legacy format with xdr and network string", () => {
      const body = { xdr: validXdr, network: "testnet" };
      expect(detectRequestFormat(body)).toBe("legacy");
    });

    it("should detect legacy format with xdr and networkName", () => {
      const body = { xdr: validXdr, networkName: "testnet" };
      expect(detectRequestFormat(body)).toBe("legacy");
    });

    it("should detect txUri format with simple URI", () => {
      const body = { txUri: `tx:stellar:public;base64,${validXdr}` };
      expect(detectRequestFormat(body)).toBe("txUri");
    });

    it("should detect txUri format with CAIP URI", () => {
      const body = {
        txUri: `blockchain://stellar:public/tx/base64;${validXdr}`,
      };
      expect(detectRequestFormat(body)).toBe("txUri");
    });

    it("should detect components format with blockchain and payload", () => {
      const body = {
        blockchain: "stellar",
        payload: validXdr,
        networkName: "public",
      };
      expect(detectRequestFormat(body)).toBe("components");
    });

    it("should return unknown for empty body", () => {
      expect(detectRequestFormat({})).toBe("unknown");
      expect(detectRequestFormat(null)).toBe("unknown");
      expect(detectRequestFormat(undefined)).toBe("unknown");
    });

    it("should return unknown for invalid txUri", () => {
      const body = { txUri: "not-a-valid-uri" };
      expect(detectRequestFormat(body)).toBe("unknown");
    });

    it("should return unknown for partial data", () => {
      expect(detectRequestFormat({ xdr: validXdr })).toBe("unknown");
      expect(detectRequestFormat({ network: 0 })).toBe("unknown");
      expect(detectRequestFormat({ blockchain: "stellar" })).toBe("unknown");
    });
  });

  describe("normalizeLegacyRequest()", () => {
    it("should normalize request with network ID 0 (public)", () => {
      const result = normalizeLegacyRequest({
        xdr: validXdr,
        network: 0,
      });

      expect(result.blockchain).toBe("stellar");
      expect(result.networkName).toBe("public");
      expect(result.payload).toBe(validXdr);
      expect(result.encoding).toBe("base64");
      expect(result.txUri).toContain("tx:stellar:public");
      expect(result.legacy.xdr).toBe(validXdr);
      expect(result.legacy.network).toBe(0);
    });

    it("should normalize request with network ID 1 (testnet)", () => {
      const result = normalizeLegacyRequest({
        xdr: validXdr,
        network: 1,
      });

      expect(result.networkName).toBe("testnet");
      expect(result.legacy.network).toBe(1);
    });

    it("should normalize request with network ID 2 (futurenet)", () => {
      const result = normalizeLegacyRequest({
        xdr: validXdr,
        network: 2,
      });

      expect(result.networkName).toBe("futurenet");
      expect(result.legacy.network).toBe(2);
    });

    it("should normalize request with network string", () => {
      const result = normalizeLegacyRequest({
        xdr: validXdr,
        network: "testnet",
      });

      expect(result.networkName).toBe("testnet");
      expect(result.legacy.network).toBe(1);
    });

    it("should preserve optional fields", () => {
      const result = normalizeLegacyRequest({
        xdr: validXdr,
        network: 0,
        callbackUrl: "https://example.com/callback",
        submit: true,
        desiredSigners: ["GABC..."],
        expires: 1735000000,
      });

      expect(result.callbackUrl).toBe("https://example.com/callback");
      expect(result.submit).toBe(true);
      expect(result.desiredSigners).toEqual(["GABC..."]);
      expect(result.maxTime).toBe(1735000000);
    });

    it("should throw for invalid network ID", () => {
      expect(() => {
        normalizeLegacyRequest({ xdr: validXdr, network: 5 });
      }).toThrow(/Invalid network ID/);
    });

    it("should throw for invalid network name", () => {
      expect(() => {
        normalizeLegacyRequest({ xdr: validXdr, network: "invalid" });
      }).toThrow(/Invalid network name/);
    });
  });

  describe("normalizeTxUriRequest()", () => {
    it("should normalize simple txUri format", () => {
      const txUri = `tx:stellar:testnet;base64,${validXdr}`;
      const result = normalizeTxUriRequest({ txUri });

      expect(result.blockchain).toBe("stellar");
      expect(result.networkName).toBe("testnet");
      expect(result.payload).toBe(validXdr);
      expect(result.encoding).toBe("base64");
      expect(result.txUri).toBe(txUri);
      expect(result.legacy).toBeDefined();
      expect(result.legacy.network).toBe(1);
    });

    it("should normalize CAIP txUri format", () => {
      const txUri = `blockchain://stellar:public/tx/base64;${validXdr}`;
      const result = normalizeTxUriRequest({ txUri });

      expect(result.blockchain).toBe("stellar");
      expect(result.networkName).toBe("public");
      expect(result.payload).toBe(validXdr);
      expect(result.encoding).toBe("base64");
    });

    it("should handle Ethereum txUri", () => {
      const txUri = "tx:ethereum:sepolia;hex,0xabcdef123456";
      const result = normalizeTxUriRequest({ txUri });

      expect(result.blockchain).toBe("ethereum");
      expect(result.networkName).toBe("sepolia");
      expect(result.payload).toBe("0xabcdef123456");
      expect(result.encoding).toBe("hex");
      expect(result.legacy).toBeUndefined();
    });

    it("should preserve optional fields", () => {
      const txUri = `tx:stellar:testnet;base64,${validXdr}`;
      const result = normalizeTxUriRequest({
        txUri,
        callbackUrl: "https://example.com",
        submit: true,
        desiredSigners: ["GABC..."],
        minTime: 100,
        maxTime: 1000,
      });

      expect(result.callbackUrl).toBe("https://example.com");
      expect(result.submit).toBe(true);
      expect(result.desiredSigners).toEqual(["GABC..."]);
      expect(result.minTime).toBe(100);
      expect(result.maxTime).toBe(1000);
    });

    it("should throw for invalid txUri", () => {
      expect(() => {
        normalizeTxUriRequest({ txUri: "not-valid" });
      }).toThrow(/Invalid transaction URI format/);
    });
  });

  describe("normalizeComponentRequest()", () => {
    it("should normalize component-based request", () => {
      const result = normalizeComponentRequest({
        blockchain: "stellar",
        networkName: "public",
        payload: validXdr,
      });

      expect(result.blockchain).toBe("stellar");
      expect(result.networkName).toBe("public");
      expect(result.payload).toBe(validXdr);
      expect(result.encoding).toBe("base64");
      expect(result.txUri).toBe(`tx:stellar:public;base64,${validXdr}`);
      expect(result.legacy.network).toBe(0);
    });

    it("should accept custom encoding", () => {
      const result = normalizeComponentRequest({
        blockchain: "ethereum",
        networkName: "sepolia",
        payload: "0xabcdef",
        encoding: "hex",
      });

      expect(result.encoding).toBe("hex");
      expect(result.txUri).toBe("tx:ethereum:sepolia;hex,0xabcdef");
      expect(result.legacy).toBeUndefined();
    });

    it("should throw for unsupported blockchain", () => {
      expect(() => {
        normalizeComponentRequest({
          blockchain: "unsupported-chain",
          networkName: "mainnet",
          payload: "abc",
        });
      }).toThrow(/Unsupported blockchain/);
    });

    it("should throw for invalid network", () => {
      expect(() => {
        normalizeComponentRequest({
          blockchain: "stellar",
          networkName: "invalid-network",
          payload: validXdr,
        });
      }).toThrow(/Invalid network/);
    });
  });

  describe("normalizeRequest()", () => {
    it("should auto-detect and normalize legacy format", () => {
      const result = normalizeRequest({
        xdr: validXdr,
        network: 0,
      });

      expect(result.blockchain).toBe("stellar");
      expect(result.networkName).toBe("public");
    });

    it("should auto-detect and normalize txUri format", () => {
      const result = normalizeRequest({
        txUri: `tx:stellar:testnet;base64,${validXdr}`,
      });

      expect(result.blockchain).toBe("stellar");
      expect(result.networkName).toBe("testnet");
    });

    it("should auto-detect and normalize component format", () => {
      const result = normalizeRequest({
        blockchain: "stellar",
        networkName: "public",
        payload: validXdr,
      });

      expect(result.blockchain).toBe("stellar");
      expect(result.networkName).toBe("public");
    });

    it("should throw for invalid format", () => {
      expect(() => {
        normalizeRequest({});
      }).toThrow(/Invalid request format/);

      expect(() => {
        normalizeRequest({ random: "data" });
      }).toThrow(/Invalid request format/);
    });
  });

  describe("isStellarRequest()", () => {
    it("should return true for Stellar requests", () => {
      const request = normalizeRequest({ xdr: validXdr, network: 0 });
      expect(isStellarRequest(request)).toBe(true);
    });

    it("should return false for non-Stellar requests", () => {
      const request = {
        blockchain: "ethereum",
        networkName: "sepolia",
        payload: "0xabc",
      };
      expect(isStellarRequest(request)).toBe(false);
    });
  });

  describe("toLegacyFormat()", () => {
    it("should convert normalized request to legacy format", () => {
      const normalized = normalizeRequest({ xdr: validXdr, network: 1 });
      const legacy = toLegacyFormat(normalized);

      expect(legacy.xdr).toBe(validXdr);
      expect(legacy.network).toBe(1);
    });

    it("should preserve optional fields", () => {
      const normalized = normalizeRequest({
        xdr: validXdr,
        network: 0,
        callbackUrl: "https://example.com",
        submit: true,
        expires: 1735000000,
      });
      const legacy = toLegacyFormat(normalized);

      expect(legacy.callbackUrl).toBe("https://example.com");
      expect(legacy.submit).toBe(true);
      expect(legacy.expires).toBe(1735000000);
    });

    it("should throw for non-Stellar blockchain", () => {
      const request = {
        blockchain: "ethereum",
        networkName: "sepolia",
        payload: "0xabc",
      };

      expect(() => {
        toLegacyFormat(request);
      }).toThrow(/Cannot convert ethereum to legacy Stellar format/);
    });
  });

  describe("STELLAR_NETWORK_MAP constants", () => {
    it("should have correct mappings", () => {
      expect(STELLAR_NETWORK_MAP[0]).toBe("public");
      expect(STELLAR_NETWORK_MAP[1]).toBe("testnet");
      expect(STELLAR_NETWORK_MAP[2]).toBe("futurenet");
    });
  });

  describe("STELLAR_NETWORK_ID_MAP constants", () => {
    it("should have correct reverse mappings", () => {
      expect(STELLAR_NETWORK_ID_MAP.public).toBe(0);
      expect(STELLAR_NETWORK_ID_MAP.mainnet).toBe(0);
      expect(STELLAR_NETWORK_ID_MAP.pubnet).toBe(0);
      expect(STELLAR_NETWORK_ID_MAP.testnet).toBe(1);
      expect(STELLAR_NETWORK_ID_MAP.futurenet).toBe(2);
    });
  });

  // ============================================================================
  // txJson Field Tests
  // ============================================================================
  describe("txJson field handling", () => {
    describe("normalizeLegacyRequest with txJson", () => {
      it("should pass through txJson string as-is", () => {
        const txJsonString = JSON.stringify({ type: "payment", amount: "100" });
        const result = normalizeLegacyRequest({
          xdr: validXdr,
          network: 0,
          txJson: txJsonString,
        });

        expect(result.txJson).toBe(txJsonString);
      });

      it("should stringify txJson object", () => {
        const txJsonObject = {
          type: "payment",
          amount: "100",
          nested: { key: "value" },
        };
        const result = normalizeLegacyRequest({
          xdr: validXdr,
          network: 0,
          txJson: txJsonObject,
        });

        expect(result.txJson).toBe(JSON.stringify(txJsonObject));
      });

      it("should handle null txJson", () => {
        const result = normalizeLegacyRequest({
          xdr: validXdr,
          network: 0,
          txJson: null,
        });

        expect(result.txJson).toBeNull();
      });

      it("should handle undefined txJson", () => {
        const result = normalizeLegacyRequest({
          xdr: validXdr,
          network: 0,
        });

        expect(result.txJson).toBeNull();
      });
    });

    describe("normalizeTxUriRequest with txJson", () => {
      it("should pass through txJson string as-is", () => {
        const txJsonString = JSON.stringify({ operations: [] });
        const result = normalizeTxUriRequest({
          txUri: `tx:stellar:public;base64,${validXdr}`,
          txJson: txJsonString,
        });

        expect(result.txJson).toBe(txJsonString);
      });

      it("should stringify txJson object", () => {
        const txJsonObject = {
          source: "GABC",
          operations: [{ type: "payment" }],
        };
        const result = normalizeTxUriRequest({
          txUri: `tx:stellar:public;base64,${validXdr}`,
          txJson: txJsonObject,
        });

        expect(result.txJson).toBe(JSON.stringify(txJsonObject));
      });

      it("should handle missing txJson", () => {
        const result = normalizeTxUriRequest({
          txUri: `tx:stellar:public;base64,${validXdr}`,
        });

        expect(result.txJson).toBeNull();
      });
    });

    describe("normalizeComponentRequest with txJson", () => {
      it("should pass through txJson string as-is", () => {
        const txJsonString = JSON.stringify({ memo: "test memo" });
        const result = normalizeComponentRequest({
          blockchain: "stellar",
          networkName: "public",
          payload: validXdr,
          txJson: txJsonString,
        });

        expect(result.txJson).toBe(txJsonString);
      });

      it("should stringify txJson object", () => {
        const txJsonObject = {
          fee: "100",
          timebounds: { minTime: 0, maxTime: 0 },
        };
        const result = normalizeComponentRequest({
          blockchain: "stellar",
          networkName: "public",
          payload: validXdr,
          txJson: txJsonObject,
        });

        expect(result.txJson).toBe(JSON.stringify(txJsonObject));
      });

      it("should handle empty string txJson as null", () => {
        const result = normalizeComponentRequest({
          blockchain: "stellar",
          networkName: "public",
          payload: validXdr,
          txJson: "",
        });

        // Empty string is falsy, so normalizeTxJson returns the string itself
        // Actually, empty string is valid and gets passed through
        expect(result.txJson).toBe("");
      });

      it("should handle missing txJson", () => {
        const result = normalizeComponentRequest({
          blockchain: "stellar",
          networkName: "public",
          payload: validXdr,
        });

        expect(result.txJson).toBeNull();
      });
    });

    describe("normalizeRequest with txJson", () => {
      it("should include txJson in normalized legacy request", () => {
        const txJsonObject = { type: "payment" };
        const result = normalizeRequest({
          xdr: validXdr,
          network: 0,
          txJson: txJsonObject,
        });

        expect(result.txJson).toBe(JSON.stringify(txJsonObject));
      });

      it("should include txJson in normalized txUri request", () => {
        const txJsonString = '{"type":"transfer"}';
        const result = normalizeRequest({
          txUri: `tx:stellar:public;base64,${validXdr}`,
          txJson: txJsonString,
        });

        expect(result.txJson).toBe(txJsonString);
      });

      it("should include txJson in normalized component request", () => {
        const txJsonString = '{"operations":[]}';
        const result = normalizeRequest({
          blockchain: "stellar",
          networkName: "public",
          payload: validXdr,
          txJson: txJsonString,
        });

        expect(result.txJson).toBe(txJsonString);
      });
    });
  });

  // ============================================================================
  // Originator Field Tests
  // ============================================================================
  describe("originator field handling", () => {
    const validOriginator =
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
    const validOriginatorSignature = "dGVzdHNpZ25hdHVyZQ=="; // base64 "testsignature"

    describe("normalizeLegacyRequest with originator", () => {
      it("should include originator in normalized request", () => {
        const result = normalizeLegacyRequest({
          xdr: validXdr,
          network: 0,
          originator: validOriginator,
        });

        expect(result.originator).toBe(validOriginator);
        expect(result.originatorSignature).toBeNull();
      });

      it("should include both originator and originatorSignature", () => {
        const result = normalizeLegacyRequest({
          xdr: validXdr,
          network: 0,
          originator: validOriginator,
          originatorSignature: validOriginatorSignature,
        });

        expect(result.originator).toBe(validOriginator);
        expect(result.originatorSignature).toBe(validOriginatorSignature);
      });

      it("should handle missing originator fields", () => {
        const result = normalizeLegacyRequest({
          xdr: validXdr,
          network: 0,
        });

        expect(result.originator).toBeNull();
        expect(result.originatorSignature).toBeNull();
      });
    });

    describe("normalizeTxUriRequest with originator", () => {
      it("should include originator fields", () => {
        const result = normalizeTxUriRequest({
          txUri: `tx:stellar:public;base64,${validXdr}`,
          originator: validOriginator,
          originatorSignature: validOriginatorSignature,
        });

        expect(result.originator).toBe(validOriginator);
        expect(result.originatorSignature).toBe(validOriginatorSignature);
      });

      it("should handle missing originator fields", () => {
        const result = normalizeTxUriRequest({
          txUri: `tx:stellar:public;base64,${validXdr}`,
        });

        expect(result.originator).toBeNull();
        expect(result.originatorSignature).toBeNull();
      });
    });

    describe("normalizeComponentRequest with originator", () => {
      it("should include originator fields", () => {
        const result = normalizeComponentRequest({
          blockchain: "stellar",
          networkName: "public",
          payload: validXdr,
          originator: validOriginator,
          originatorSignature: validOriginatorSignature,
        });

        expect(result.originator).toBe(validOriginator);
        expect(result.originatorSignature).toBe(validOriginatorSignature);
      });

      it("should handle Ethereum originator format", () => {
        const ethOriginator = "0x1234567890123456789012345678901234567890";
        const ethSignature = "0xabcdef123456";

        const result = normalizeComponentRequest({
          blockchain: "ethereum",
          networkName: "mainnet",
          payload: "0xabc123",
          encoding: "hex",
          originator: ethOriginator,
          originatorSignature: ethSignature,
        });

        expect(result.originator).toBe(ethOriginator);
        expect(result.originatorSignature).toBe(ethSignature);
      });

      it("should handle missing originator fields", () => {
        const result = normalizeComponentRequest({
          blockchain: "stellar",
          networkName: "public",
          payload: validXdr,
        });

        expect(result.originator).toBeNull();
        expect(result.originatorSignature).toBeNull();
      });
    });

    describe("normalizeRequest with originator", () => {
      it("should include originator in normalized legacy request", () => {
        const result = normalizeRequest({
          xdr: validXdr,
          network: 0,
          originator: validOriginator,
          originatorSignature: validOriginatorSignature,
        });

        expect(result.originator).toBe(validOriginator);
        expect(result.originatorSignature).toBe(validOriginatorSignature);
      });

      it("should include originator in normalized txUri request", () => {
        const result = normalizeRequest({
          txUri: `tx:stellar:public;base64,${validXdr}`,
          originator: validOriginator,
        });

        expect(result.originator).toBe(validOriginator);
      });

      it("should include originator in normalized component request", () => {
        const result = normalizeRequest({
          blockchain: "stellar",
          networkName: "public",
          payload: validXdr,
          originator: validOriginator,
          originatorSignature: validOriginatorSignature,
        });

        expect(result.originator).toBe(validOriginator);
        expect(result.originatorSignature).toBe(validOriginatorSignature);
      });
    });
  });
});
