/**
 * btf-lib-v1 Dependency Stub Tests
 *
 * Validates that:
 * 1. All btf-lib-v1 sub-modules are require()-able (lazy loading works)
 * 2. Stub methods throw informative "not configured" errors
 * 3. The HsmSigningAdapter's lazy loaders resolve (not null)
 * 4. Logging stubs return usable logger objects
 */

describe("btf-lib-v1 stubs", () => {
  // ── Module Resolution ─────────────────────────────────────────

  describe("module resolution", () => {
    it("should resolve btf-lib-v1 root module", () => {
      const btfLib = require("../../../btf-lib-v1");
      expect(btfLib.isStub).toBe(true);
      expect(btfLib.version).toBe("0.0.1-stub");
    });

    it("should resolve secret/hsmKeyStore", () => {
      const hsmKeyStore = require("../../../btf-lib-v1/secret/hsmKeyStore");
      expect(hsmKeyStore).toBeDefined();
      expect(typeof hsmKeyStore.signStellarTransaction).toBe("function");
      expect(typeof hsmKeyStore.signAlgorandTransaction).toBe("function");
      expect(typeof hsmKeyStore.signSolanaTransaction).toBe("function");
      expect(typeof hsmKeyStore.signEthereumTransaction).toBe("function");
      expect(typeof hsmKeyStore.createStellarKey).toBe("function");
      expect(typeof hsmKeyStore.createEthereumKey).toBe("function");
      expect(typeof hsmKeyStore.createSolanaKey).toBe("function");
      expect(typeof hsmKeyStore.createAlgorandKey).toBe("function");
      expect(typeof hsmKeyStore.healthCheck).toBe("function");
    });

    it("should resolve secret/azureCryptoService", () => {
      const azureCrypto = require("../../../btf-lib-v1/secret/azureCryptoService");
      expect(azureCrypto).toBeDefined();
      expect(typeof azureCrypto.signStellarTransaction).toBe("function");
    });

    it("should resolve secret/envelopeEncryption", () => {
      const envelope = require("../../../btf-lib-v1/secret/envelopeEncryption");
      expect(envelope).toBeDefined();
      expect(typeof envelope.wrapKey).toBe("function");
      expect(typeof envelope.unwrapKey).toBe("function");
    });

    it("should resolve logging/logging", () => {
      const logging = require("../../../btf-lib-v1/logging/logging");
      expect(logging).toBeDefined();
      expect(typeof logging.createLogger).toBe("function");
      expect(logging.defaultLogger).toBeDefined();
    });

    it("should resolve logging/azureIntegration", () => {
      const azure = require("../../../btf-lib-v1/logging/azureIntegration");
      expect(azure).toBeDefined();
      expect(typeof azure.createAzureTransport).toBe("function");
      expect(typeof azure.initializeAppInsights).toBe("function");
    });
  });

  // ── Stub Behavior ─────────────────────────────────────────────

  describe("stub error behavior", () => {
    it("hsmKeyStore methods should throw 'not configured'", async () => {
      const ks = require("../../../btf-lib-v1/secret/hsmKeyStore");
      await expect(ks.signStellarTransaction({})).rejects.toThrow(
        /not configured/,
      );
      await expect(ks.createStellarKey({})).rejects.toThrow(/not configured/);
      await expect(ks.healthCheck()).rejects.toThrow(/not configured/);
    });

    it("azureCryptoService methods should throw 'not configured'", async () => {
      const ac = require("../../../btf-lib-v1/secret/azureCryptoService");
      await expect(ac.signStellarTransaction({})).rejects.toThrow(
        /not configured/,
      );
    });

    it("envelopeEncryption methods should throw 'not configured'", async () => {
      const ee = require("../../../btf-lib-v1/secret/envelopeEncryption");
      await expect(ee.wrapKey()).rejects.toThrow(/not configured/);
      await expect(ee.unwrapKey()).rejects.toThrow(/not configured/);
    });

    it("stub errors should include the method name", async () => {
      const ks = require("../../../btf-lib-v1/secret/hsmKeyStore");
      await expect(ks.signStellarTransaction({})).rejects.toThrow(
        /signStellarTransaction/,
      );
    });
  });

  // ── Logging Stubs ─────────────────────────────────────────────

  describe("logging stubs", () => {
    it("createLogger should return a logger with all standard methods", () => {
      const { createLogger } = require("../../../btf-lib-v1/logging/logging");
      const log = createLogger({ component: "test" });

      expect(typeof log.info).toBe("function");
      expect(typeof log.warn).toBe("function");
      expect(typeof log.error).toBe("function");
      expect(typeof log.debug).toBe("function");
      expect(typeof log.child).toBe("function");
      expect(typeof log.forComponent).toBe("function");
      expect(typeof log.forRequest).toBe("function");

      // Should not throw
      log.info("test message");
      log.error("error message", { key: "value" });
    });

    it("child() should return a new logger", () => {
      const { createLogger } = require("../../../btf-lib-v1/logging/logging");
      const parent = createLogger({ component: "parent" });
      const child = parent.child({ requestId: "123" });

      expect(child).toBeDefined();
      expect(typeof child.info).toBe("function");
    });
  });

  // ── HsmSigningAdapter lazy loader integration ──────────────────

  describe("HsmSigningAdapter lazy loader integration", () => {
    it("should construct with lazy-loaded stubs (no DI overrides needed)", () => {
      // The adapter's loadHsmKeyStore() does:
      //   require("../../btf-lib-v1/secret/hsmKeyStore")
      // This is relative to api/business-logic/hsm-signing-adapter.js
      // → resolves to /home/lj/src/refractor/btf-lib-v1/secret/hsmKeyStore.js
      //
      // With stubs in place, the require should succeed and the
      // adapter should construct without needing injected mocks.
      const HsmSigningAdapter = require("../../business-logic/hsm-signing-adapter");

      // Envelope tier — needs hsmKeyStore, which now resolves from stubs
      const adapter = new HsmSigningAdapter();
      expect(adapter.tier).toBe("envelope");
    });

    it("stub-backed adapter should throw informative errors when signing", async () => {
      const HsmSigningAdapter = require("../../business-logic/hsm-signing-adapter");
      const adapter = new HsmSigningAdapter();

      // Signing should fail with the stub's informative error
      await expect(
        adapter.signStellarTransaction("key_001", { xdr: "test" }),
      ).rejects.toThrow(/not configured/);
    });
  });
});
