const {
  parseTxParams,
  parseBlockchainAgnosticParams,
  sliceTx,
} = require("../../business-logic/tx-params-parser");
const { TransactionBuilder, Keypair, Networks, Operation, Account, Asset } = require("@stellar/stellar-sdk");

// Helper: build a minimal Stellar transaction for testing
function buildTestTx({ network = "testnet" } = {}) {
  const passphrase =
    network === "public"
      ? Networks.PUBLIC
      : Networks.TESTNET;
  const source = Keypair.random();
  const account = new Account(source.publicKey(), "100");

  const builder = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: passphrase,
  })
    .addOperation(
      Operation.payment({
        destination: source.publicKey(),
        asset: Asset.native(),
        amount: "10",
      })
    )
    .setTimeout(300);

  return builder.build();
}

describe("tx-params-parser", () => {
  // ─── parseTxParams ───────────────────────────────────────────
  describe("parseTxParams", () => {
    it("parses basic transaction with network", () => {
      const tx = buildTestTx({ network: "testnet" });
      const result = parseTxParams(tx, { network: "testnet" });

      expect(result.network).toBe(1);
      expect(result.xdr).toBeDefined();
      expect(result.signatures).toEqual([]);
      expect(result.blockchain).toBe("stellar");
      expect(result.networkName).toBeDefined();
      expect(result.encoding).toBe("base64");
    });

    it("parses public network", () => {
      const tx = buildTestTx({ network: "public" });
      const result = parseTxParams(tx, { network: "public" });

      expect(result.network).toBe(0);
    });

    it("accepts valid callback URL", () => {
      const tx = buildTestTx();
      const result = parseTxParams(tx, {
        network: "testnet",
        callbackUrl: "https://example.com/callback",
      });

      expect(result.callbackUrl).toBe("https://example.com/callback");
    });

    it("rejects invalid callback URL", () => {
      const tx = buildTestTx();
      expect(() =>
        parseTxParams(tx, {
          network: "testnet",
          callbackUrl: "not-a-url",
        })
      ).toThrow(/Invalid URL/);
    });

    it("rejects callback URL targeting private IP (SSRF)", () => {
      const tx = buildTestTx();
      // IP literals don't match the URL regex, so this throws as invalid URL
      expect(() =>
        parseTxParams(tx, {
          network: "testnet",
          callbackUrl: "http://10.0.0.1/callback",
        })
      ).toThrow();
    });

    it("sets submit flag when true", () => {
      const tx = buildTestTx();
      const result = parseTxParams(tx, {
        network: "testnet",
        submit: true,
      });

      expect(result.submit).toBe(true);
    });

    it("does not set submit when false", () => {
      const tx = buildTestTx();
      const result = parseTxParams(tx, {
        network: "testnet",
        submit: false,
      });

      expect(result.submit).toBeFalsy();
    });

    it("validates desiredSigners are valid Stellar public keys", () => {
      const tx = buildTestTx();
      expect(() =>
        parseTxParams(tx, {
          network: "testnet",
          desiredSigners: ["invalid-key"],
        })
      ).toThrow(/not a valid Stellar public key/);
    });

    it("accepts valid desiredSigners", () => {
      const tx = buildTestTx();
      const key = Keypair.random().publicKey();
      const result = parseTxParams(tx, {
        network: "testnet",
        desiredSigners: [key],
      });

      expect(result.desiredSigners).toEqual([key]);
    });

    it("rejects non-array desiredSigners", () => {
      const tx = buildTestTx();
      expect(() =>
        parseTxParams(tx, {
          network: "testnet",
          desiredSigners: "not-an-array",
        })
      ).toThrow(/Expected an array/);
    });

    it("rejects expires that is too large", () => {
      const tx = buildTestTx();
      expect(() =>
        parseTxParams(tx, {
          network: "testnet",
          expires: 2147483648,
        })
      ).toThrow(/not a valid UNIX date/);
    });

    it("rejects expires in the past", () => {
      const tx = buildTestTx();
      expect(() =>
        parseTxParams(tx, {
          network: "testnet",
          expires: 1000, // definitely in the past
        })
      ).toThrow(/already passed/);
    });

    it("stores txJson as string", () => {
      const tx = buildTestTx();
      const result = parseTxParams(tx, {
        network: "testnet",
        txJson: { fee: "100" },
      });

      expect(result.txJson).toBe('{"fee":"100"}');
    });

    it("stores txJson string as-is", () => {
      const tx = buildTestTx();
      const result = parseTxParams(tx, {
        network: "testnet",
        txJson: '{"fee":"100"}',
      });

      expect(result.txJson).toBe('{"fee":"100"}');
    });

    it("stores originator and originatorSignature", () => {
      const tx = buildTestTx();
      const key = Keypair.random().publicKey();
      const result = parseTxParams(tx, {
        network: "testnet",
        originator: key,
        originatorSignature: "sig123",
      });

      expect(result.originator).toBe(key);
      expect(result.originatorSignature).toBe("sig123");
    });
  });

  // ─── parseBlockchainAgnosticParams ───────────────────────────
  describe("parseBlockchainAgnosticParams", () => {
    it("parses stellar blockchain-agnostic params", () => {
      const result = parseBlockchainAgnosticParams({
        blockchain: "stellar",
        networkName: "testnet",
        payload: "AAAA",
        encoding: "base64",
      });

      expect(result.blockchain).toBe("stellar");
      expect(result.networkName).toBe("testnet");
      expect(result.payload).toBe("AAAA");
      expect(result.encoding).toBe("base64");
    });

    it("throws for unsupported blockchain", () => {
      expect(() =>
        parseBlockchainAgnosticParams({
          blockchain: "unsupported-chain",
          networkName: "mainnet",
          payload: "data",
          encoding: "hex",
        })
      ).toThrow(/Unsupported blockchain/);
    });

    it("throws for invalid network", () => {
      expect(() =>
        parseBlockchainAgnosticParams({
          blockchain: "stellar",
          networkName: "nonexistent",
          payload: "data",
          encoding: "base64",
        })
      ).toThrow(/Invalid network/);
    });

    it("accepts valid callback URL", () => {
      const result = parseBlockchainAgnosticParams({
        blockchain: "stellar",
        networkName: "testnet",
        payload: "AAAA",
        encoding: "base64",
        callbackUrl: "https://example.com/webhook",
      });

      expect(result.callbackUrl).toBe("https://example.com/webhook");
    });

    it("rejects invalid callback URL (SSRF)", () => {
      expect(() =>
        parseBlockchainAgnosticParams({
          blockchain: "stellar",
          networkName: "testnet",
          payload: "AAAA",
          encoding: "base64",
          callbackUrl: "not-a-url",
        })
      ).toThrow(/Invalid URL/);
    });

    it("sets submit flag", () => {
      const result = parseBlockchainAgnosticParams({
        blockchain: "stellar",
        networkName: "testnet",
        payload: "AAAA",
        encoding: "base64",
        submit: true,
      });

      expect(result.submit).toBe(true);
    });

    it("handles maxTime validation", () => {
      expect(() =>
        parseBlockchainAgnosticParams({
          blockchain: "stellar",
          networkName: "testnet",
          payload: "AAAA",
          encoding: "base64",
          maxTime: 1000, // past
        })
      ).toThrow(/already passed/);
    });

    it("includes txJson, originator, originatorSignature", () => {
      const result = parseBlockchainAgnosticParams({
        blockchain: "stellar",
        networkName: "testnet",
        payload: "AAAA",
        encoding: "base64",
        txJson: '{"data":"test"}',
        originator: "originator-addr",
        originatorSignature: "sig",
      });

      expect(result.txJson).toBe('{"data":"test"}');
      expect(result.originator).toBe("originator-addr");
      expect(result.originatorSignature).toBe("sig");
    });

    it("handles legacy stellar fields", () => {
      const result = parseBlockchainAgnosticParams({
        blockchain: "stellar",
        networkName: "testnet",
        payload: "AAAA",
        encoding: "base64",
        legacy: { network: 1, xdr: "legacy-xdr" },
      });

      expect(result.network).toBe(1);
      expect(result.xdr).toBe("legacy-xdr");
    });
  });

  // ─── sliceTx ─────────────────────────────────────────────────
  describe("sliceTx", () => {
    it("extracts signatures and clears them from the transaction", () => {
      const tx = buildTestTx();
      const kp = Keypair.random();
      tx.sign(kp);

      expect(tx.signatures.length).toBe(1);

      const { tx: sliced, signatures } = sliceTx(tx);
      expect(signatures.length).toBe(1);
      expect(sliced.signatures.length).toBe(0);
    });

    it("returns empty signatures for unsigned transaction", () => {
      const tx = buildTestTx();
      const { signatures } = sliceTx(tx);
      expect(signatures.length).toBe(0);
    });
  });
});
