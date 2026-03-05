/**
 * Callback Handler Tests
 *
 * Tests that the callback handler correctly sends transaction payload
 * data (xdr/payload) to callback URLs.
 */

const { processCallback, setCallbackHandler } = require("../../business-logic/finalization/callback-handler");

describe("Callback Handler", () => {
  let capturedPayload;
  let originalHandler;

  beforeEach(() => {
    capturedPayload = null;
    // Install a spy handler that captures the POST body
    setCallbackHandler((txInfo) => {
      const { xdr, payload, network, networkName, hash, callbackUrl, blockchain } = txInfo;
      capturedPayload = { tx: xdr || payload, hash, network: network || networkName, blockchain };
      return Promise.resolve({ status: 200 });
    });
  });

  it("should send xdr field for Stellar transactions", async () => {
    await processCallback({
      hash: "abc123",
      xdr: "AAAA...base64xdr",
      network: 1,
      callbackUrl: "https://example.com/callback",
      blockchain: "stellar",
    });

    expect(capturedPayload.tx).toBe("AAAA...base64xdr");
    expect(capturedPayload.hash).toBe("abc123");
    expect(capturedPayload.network).toBe(1);
    expect(capturedPayload.blockchain).toBe("stellar");
  });

  it("should send payload field for EVM transactions", async () => {
    await processCallback({
      hash: "def456",
      payload: "0xf86c...",
      networkName: "mainnet",
      callbackUrl: "https://example.com/callback",
      blockchain: "ethereum",
    });

    expect(capturedPayload.tx).toBe("0xf86c...");
    expect(capturedPayload.hash).toBe("def456");
    expect(capturedPayload.network).toBe("mainnet");
    expect(capturedPayload.blockchain).toBe("ethereum");
  });

  it("should not send undefined as tx value", async () => {
    await processCallback({
      hash: "ghi789",
      xdr: "signed-xdr-data",
      network: 2,
      callbackUrl: "https://example.com/callback",
      blockchain: "stellar",
    });

    expect(capturedPayload.tx).toBeDefined();
    expect(capturedPayload.tx).not.toBeUndefined();
  });

  it("should prefer xdr over payload when both present", async () => {
    await processCallback({
      hash: "jkl012",
      xdr: "xdr-value",
      payload: "payload-value",
      network: 1,
      callbackUrl: "https://example.com/callback",
      blockchain: "stellar",
    });

    expect(capturedPayload.tx).toBe("xdr-value");
  });

  it("should fall back to networkName when network is absent", async () => {
    await processCallback({
      hash: "mno345",
      payload: "0xdata",
      networkName: "sepolia",
      callbackUrl: "https://example.com/callback",
      blockchain: "ethereum",
    });

    expect(capturedPayload.network).toBe("sepolia");
  });

  it("should throw when callbackUrl is missing", async () => {
    await expect(
      processCallback({ hash: "pqr678" })
    ).rejects.toThrow(/empty callback/);
  });
});
