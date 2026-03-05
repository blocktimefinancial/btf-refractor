/**
 * Signer.signWithHsm() Tests
 *
 * Tests the HSM signing integration in the Signer class.
 * Each blockchain path (Stellar, Algorand, Solana, EVM) is tested
 * with mocked HsmSigningAdapter to verify correct routing and
 * signature processing.
 */

// ── Mocks ────────────────────────────────────────────────────────────

// Mock storage layer
jest.mock("../../storage/storage-layer", () => ({
  dataProvider: {
    findTransaction: jest.fn().mockResolvedValue(null),
    saveTransaction: jest.fn().mockResolvedValue(true),
  },
}));

// Mock account info provider
jest.mock("../../business-logic/account-info-provider", () => ({
  loadTxSourceAccountsInfo: jest.fn().mockResolvedValue({}),
}));

// Mock tx-signers-inspector
jest.mock("@stellar-expert/tx-signers-inspector", () => ({
  inspectTransactionSigners: jest.fn().mockResolvedValue({
    getAllPotentialSigners: () => [],
    checkFeasibility: () => false,
  }),
}));

// Mock network resolver
jest.mock("../../business-logic/network-resolver", () => ({
  resolveNetwork: jest.fn().mockReturnValue("testnet"),
  resolveNetworkParams: jest.fn().mockReturnValue({
    horizon: "https://horizon-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
  }),
}));

// Mock finalizer
jest.mock("../../business-logic/finalization/finalizer", () => ({
  triggerImmediateCheck: jest.fn(),
}));

// Mock tx-loader
jest.mock("../../business-logic/tx-loader", () => ({
  rehydrateTx: jest.fn((tx) => tx),
}));

// Mock originator-verifier
jest.mock("../../business-logic/originator-verifier", () => ({
  validateOriginator: jest.fn(),
  checkOriginatorStatus: jest.fn().mockReturnValue({
    hasOriginator: false,
    isVerified: false,
  }),
}));

// ── HsmSigningAdapter mock ────────────────────────────────────────
const mockSignStellar = jest.fn();
const mockSignAlgorand = jest.fn();
const mockSignSolana = jest.fn();
const mockSignEvm = jest.fn();

jest.mock("../../business-logic/hsm-signing-adapter", () => {
  return jest.fn().mockImplementation(() => ({
    signStellarTransaction: mockSignStellar,
    signAlgorandTransaction: mockSignAlgorand,
    signSolanaTransaction: mockSignSolana,
    signEvmTransaction: mockSignEvm,
  }));
});

const HsmSigningAdapter = require("../../business-logic/hsm-signing-adapter");

// ── Blockchain handler mocks ─────────────────────────────────────
const mockStellarHandler = {
  config: { name: "stellar", defaultEncoding: "base64" },
  parseTransaction: jest.fn(),
  parseTransactionParams: jest.fn(),
  computeHash: jest.fn(),
  extractSignatures: jest.fn().mockReturnValue([]),
  getPotentialSigners: jest.fn().mockResolvedValue([]),
  matchSignatureToSigner: jest.fn(),
};

const mockAlgorandHandler = {
  config: { name: "algorand", defaultEncoding: "base64" },
  parseTransaction: jest.fn(),
  parseTransactionParams: jest.fn(),
  computeHash: jest.fn(),
  extractSignatures: jest.fn().mockReturnValue([]),
  getPotentialSigners: jest.fn().mockResolvedValue([]),
  matchSignatureToSigner: jest.fn(),
};

const mockSolanaHandler = {
  config: { name: "solana", defaultEncoding: "base64" },
  parseTransaction: jest.fn(),
  parseTransactionParams: jest.fn(),
  computeHash: jest.fn(),
  extractSignatures: jest.fn().mockReturnValue([]),
  getPotentialSigners: jest.fn().mockResolvedValue([]),
  matchSignatureToSigner: jest.fn(),
};

const mockEvmHandler = {
  config: { name: "ethereum", defaultEncoding: "hex" },
  parseTransaction: jest.fn(),
  parseTransactionParams: jest.fn(),
  computeHash: jest.fn(),
  extractSignatures: jest.fn().mockReturnValue([]),
  getPotentialSigners: jest.fn().mockResolvedValue([]),
  verifySignedTransaction: jest.fn().mockReturnValue(true),
};

// Mock handler factory
jest.mock("../../business-logic/handlers/handler-factory", () => ({
  getHandler: jest.fn((blockchain) => {
    switch (blockchain) {
      case "stellar":
        return mockStellarHandler;
      case "algorand":
        return mockAlgorandHandler;
      case "solana":
        return mockSolanaHandler;
      case "ethereum":
      case "polygon":
      case "onemoney":
        return mockEvmHandler;
      default:
        throw new Error(`No handler for ${blockchain}`);
    }
  }),
  hasHandler: jest.fn(() => true),
}));

// Mock evm-handler's isEvmBlockchain
jest.mock("../../business-logic/handlers/evm-handler", () => ({
  isEvmBlockchain: jest.fn(
    (chain) =>
      [
        "ethereum",
        "polygon",
        "arbitrum",
        "optimism",
        "base",
        "avalanche",
        "onemoney",
      ].includes(chain) || false,
  ),
  EVM_BLOCKCHAINS: [
    "ethereum",
    "polygon",
    "arbitrum",
    "optimism",
    "base",
    "avalanche",
    "onemoney",
  ],
}));

// Mock tx-params-parser
jest.mock("../../business-logic/tx-params-parser", () => ({
  sliceTx: jest.fn(),
  parseTxParams: jest.fn(),
  parseBlockchainAgnosticParams: jest.fn(),
}));

// Mock signature-hint-utils
jest.mock("../../business-logic/signature-hint-utils", () => ({
  hintMatchesKey: jest.fn(),
  hintToMask: jest.fn().mockReturnValue("****"),
}));

const Signer = require("../../business-logic/signer");

// ── Helper: create a Signer with pre-set internal state ──────────
function createMockSigner(blockchain, overrides = {}) {
  // Set up handler mocks so constructor succeeds
  const handler =
    {
      stellar: mockStellarHandler,
      algorand: mockAlgorandHandler,
      solana: mockSolanaHandler,
      ethereum: mockEvmHandler,
      polygon: mockEvmHandler,
      onemoney: mockEvmHandler,
    }[blockchain] || mockEvmHandler;

  const mockTx = overrides.tx || { hash: () => Buffer.alloc(32) };
  const mockHash = overrides.hash || "abc123def456";
  const mockHashRaw = overrides.hashRaw || Buffer.alloc(32);

  handler.parseTransaction.mockReturnValue(mockTx);
  handler.computeHash.mockReturnValue({
    hash: mockHash,
    hashRaw: mockHashRaw,
  });
  handler.parseTransactionParams.mockReturnValue({
    hash: mockHash,
    blockchain,
    signatures: [],
    network: overrides.network || "testnet",
    networkName: overrides.networkName || "testnet",
    ...overrides.txInfoExtra,
  });

  // For Stellar, sliceTx needs to return tx + signatures
  if (blockchain === "stellar") {
    const { sliceTx } = require("../../business-logic/tx-params-parser");
    sliceTx.mockReturnValue({
      tx: mockTx,
      signatures: [],
    });
    handler.parseTransactionParams.mockReturnValue({
      hash: mockHash,
      blockchain: "stellar",
      signatures: [],
      network: "Test SDF Network ; September 2015",
      ...overrides.txInfoExtra,
    });
  }

  const request = {
    blockchain,
    payload: "mock-payload",
    networkName: overrides.networkName || "testnet",
    ...(blockchain === "stellar"
      ? { xdr: "mock-xdr", network: "testnet" }
      : {}),
  };

  const signer = new Signer(request);

  // Override internal state for testing signWithHsm
  signer.hash = mockHash;
  signer.hashRaw = mockHashRaw;
  signer.tx = mockTx;
  signer.txInfo = {
    hash: mockHash,
    blockchain,
    signatures: overrides.existingSignatures || [],
    network: overrides.network || "testnet",
    networkName: overrides.networkName || "testnet",
    status: "pending",
    ...overrides.txInfoExtra,
  };
  signer.accepted = [];
  signer.rejected = [];
  signer.potentialSigners = overrides.potentialSigners || [];
  signer.status = overrides.status || "created";

  return signer;
}

// ══════════════════════════════════════════════════════════════════
//  Tests
// ══════════════════════════════════════════════════════════════════

describe("Signer.signWithHsm()", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Input Validation ────────────────────────────────────────────

  describe("input validation", () => {
    it("should reject empty keyId", async () => {
      const signer = createMockSigner("algorand");
      await expect(signer.signWithHsm("")).rejects.toThrow(
        "keyId must be a non-empty string",
      );
    });

    it("should reject null keyId", async () => {
      const signer = createMockSigner("algorand");
      await expect(signer.signWithHsm(null)).rejects.toThrow(
        "keyId must be a non-empty string",
      );
    });

    it("should reject undefined keyId", async () => {
      const signer = createMockSigner("algorand");
      await expect(signer.signWithHsm(undefined)).rejects.toThrow(
        "keyId must be a non-empty string",
      );
    });

    it("should reject numeric keyId", async () => {
      const signer = createMockSigner("algorand");
      await expect(signer.signWithHsm(123)).rejects.toThrow(
        "keyId must be a non-empty string",
      );
    });
  });

  // ── HsmSigningAdapter instantiation ─────────────────────────────

  describe("adapter instantiation", () => {
    it("should create adapter with default envelope tier", async () => {
      const signer = createMockSigner("algorand");
      mockSignAlgorand.mockResolvedValue(null);

      await signer.signWithHsm("key-1");

      expect(HsmSigningAdapter).toHaveBeenCalledWith({ tier: "envelope" });
    });

    it("should pass custom tier option to adapter", async () => {
      const signer = createMockSigner("algorand");
      mockSignAlgorand.mockResolvedValue(null);

      await signer.signWithHsm("key-1", { tier: "direct" });

      expect(HsmSigningAdapter).toHaveBeenCalledWith({ tier: "direct" });
    });
  });

  // ── Stellar HSM Signing ─────────────────────────────────────────

  describe("Stellar signing path", () => {
    it("should call signStellarTransaction with keyId and tx", async () => {
      const mockTx = { hash: () => Buffer.alloc(32) };
      const signer = createMockSigner("stellar", { tx: mockTx });

      // Mock: signed XDR returns a transaction with one new signature
      const mockSignedXdr = "signed-xdr-base64";
      const mockNewSig = {
        signature: () => Buffer.from("new-sig-bytes"),
        hint: () => Buffer.from([0, 0, 0, 1]),
        _attributes: {
          hint: Buffer.from([0, 0, 0, 1]),
          signature: Buffer.from("new-sig-bytes"),
        },
      };
      const mockSignedTx = {
        signatures: [mockNewSig],
      };

      mockSignStellar.mockResolvedValue(mockSignedXdr);

      // Mock TransactionBuilder.fromXDR
      const { TransactionBuilder } = require("@stellar/stellar-sdk");
      const originalFromXDR = TransactionBuilder.fromXDR;
      TransactionBuilder.fromXDR = jest.fn().mockReturnValue(mockSignedTx);

      // Mock hint matching for the new signature
      const {
        hintMatchesKey,
      } = require("../../business-logic/signature-hint-utils");
      hintMatchesKey.mockReturnValue(true);

      // Set up a potential signer
      signer.potentialSigners = ["GABCDEF"];

      // Mock Keypair.fromPublicKey for verification
      const { Keypair } = require("@stellar/stellar-sdk");
      const originalFromPublicKey = Keypair.fromPublicKey;
      Keypair.fromPublicKey = jest.fn().mockReturnValue({
        verify: jest.fn().mockReturnValue(true),
      });

      try {
        await signer.signWithHsm("stellar-key-1");

        expect(mockSignStellar).toHaveBeenCalledWith("stellar-key-1", mockTx);
        // After fix: fromXDR is called with the resolved passphrase, not the raw network ID
        const {
          resolveNetworkParams,
        } = require("../../business-logic/network-resolver");
        const { passphrase } = resolveNetworkParams(signer.txInfo.network);
        expect(TransactionBuilder.fromXDR).toHaveBeenCalledWith(
          mockSignedXdr,
          passphrase,
        );
        expect(signer.accepted.length).toBe(1);
      } finally {
        TransactionBuilder.fromXDR = originalFromXDR;
        Keypair.fromPublicKey = originalFromPublicKey;
      }
    });

    it("should skip duplicate Stellar signatures", async () => {
      const mockTx = { hash: () => Buffer.alloc(32) };
      const existingSig = Buffer.from("existing-sig");
      const signer = createMockSigner("stellar", {
        tx: mockTx,
        existingSignatures: [
          { key: "GABCDEF", signature: existingSig.toString("base64") },
        ],
      });

      const mockNewSig = {
        signature: () => existingSig, // Same as existing
        hint: () => Buffer.from([0, 0, 0, 1]),
        _attributes: {
          hint: Buffer.from([0, 0, 0, 1]),
          signature: existingSig,
        },
      };
      const mockSignedTx = { signatures: [mockNewSig] };

      mockSignStellar.mockResolvedValue("signed-xdr");

      const { TransactionBuilder } = require("@stellar/stellar-sdk");
      const originalFromXDR = TransactionBuilder.fromXDR;
      TransactionBuilder.fromXDR = jest.fn().mockReturnValue(mockSignedTx);

      try {
        await signer.signWithHsm("stellar-key-1");

        // The signature already exists, so filter removes it before processSignature
        // This means no new signatures should be processed
        expect(signer.accepted.length).toBe(0);
      } finally {
        TransactionBuilder.fromXDR = originalFromXDR;
      }
    });
  });

  // ── Algorand HSM Signing ────────────────────────────────────────

  describe("Algorand signing path", () => {
    it("should call signAlgorandTransaction with keyId and tx", async () => {
      const mockTx = {};
      const signer = createMockSigner("algorand", { tx: mockTx });
      signer.potentialSigners = ["ALGO_ADDR_ABC"];

      mockSignAlgorand.mockResolvedValue({
        signedTxn: new Uint8Array([1, 2, 3, 4]),
        txId: "txid-123",
        address: "ALGO_ADDR_ABC",
      });

      // Mock matchSignatureToSigner to return a match
      mockAlgorandHandler.matchSignatureToSigner.mockReturnValue({
        key: "ALGO_ADDR_ABC",
      });

      await signer.signWithHsm("algo-key-1");

      expect(mockSignAlgorand).toHaveBeenCalledWith("algo-key-1", mockTx);
      expect(signer.accepted.length).toBe(1);
      expect(signer.accepted[0].key).toBe("ALGO_ADDR_ABC");
    });

    it("should use address from result for sigObj.from", async () => {
      const signer = createMockSigner("algorand");
      signer.potentialSigners = ["ALGO_ADDR_XYZ"];

      mockSignAlgorand.mockResolvedValue({
        signedTxn: new Uint8Array([5, 6, 7]),
        txId: "txid-456",
        address: "ALGO_ADDR_XYZ",
      });

      mockAlgorandHandler.matchSignatureToSigner.mockReturnValue({
        key: "ALGO_ADDR_XYZ",
      });

      await signer.signWithHsm("algo-key-2");

      expect(signer.accepted.length).toBe(1);
      expect(signer.accepted[0].key).toBe("ALGO_ADDR_XYZ");
    });

    it("should fall back to txId when address is missing", async () => {
      const signer = createMockSigner("algorand");

      mockSignAlgorand.mockResolvedValue({
        signedTxn: new Uint8Array([8, 9]),
        txId: "fallback-txid",
      });

      // matchSignatureToSigner returns the from field when no match
      mockAlgorandHandler.matchSignatureToSigner.mockReturnValue({
        key: null,
      });

      await signer.signWithHsm("algo-key-3");

      // Signature was rejected (no key match)
      expect(signer.rejected.length).toBe(1);
    });

    it("should do nothing when result has no signedTxn", async () => {
      const signer = createMockSigner("algorand");
      mockSignAlgorand.mockResolvedValue({ txId: "incomplete" });

      await signer.signWithHsm("algo-key-4");

      expect(signer.accepted.length).toBe(0);
      expect(signer.rejected.length).toBe(0);
    });

    it("should do nothing when result is null", async () => {
      const signer = createMockSigner("algorand");
      mockSignAlgorand.mockResolvedValue(null);

      await signer.signWithHsm("algo-key-5");

      expect(signer.accepted.length).toBe(0);
      expect(signer.rejected.length).toBe(0);
    });
  });

  // ── Solana HSM Signing ──────────────────────────────────────────

  describe("Solana signing path", () => {
    it("should call signSolanaTransaction with keyId and messageBytes", async () => {
      const messageBytes = Buffer.from("solana-message-bytes");
      const signer = createMockSigner("solana", {
        txInfoExtra: { messageBytes },
      });
      signer.potentialSigners = ["SolPubKey123"];

      mockSignSolana.mockResolvedValue({
        signature: Buffer.from("solana-sig-64-bytes".padEnd(64, "0")),
        publicKey: "SolPubKey123",
      });

      mockSolanaHandler.matchSignatureToSigner.mockReturnValue({
        key: "SolPubKey123",
      });

      await signer.signWithHsm("sol-key-1");

      expect(mockSignSolana).toHaveBeenCalledWith("sol-key-1", messageBytes);
      expect(signer.accepted.length).toBe(1);
      expect(signer.accepted[0].key).toBe("SolPubKey123");
    });

    it("should fall back to tx when messageBytes not in txInfo", async () => {
      const mockTx = Buffer.from("raw-solana-tx");
      const signer = createMockSigner("solana", { tx: mockTx });

      mockSignSolana.mockResolvedValue({
        signature: Buffer.from("sig"),
        publicKey: "SolPubKey456",
      });

      mockSolanaHandler.matchSignatureToSigner.mockReturnValue({
        key: "SolPubKey456",
      });

      await signer.signWithHsm("sol-key-2");

      // Should fall back to this.tx when messageBytes is not available
      expect(mockSignSolana).toHaveBeenCalledWith("sol-key-2", mockTx);
    });

    it("should handle string signature from HSM", async () => {
      const signer = createMockSigner("solana");
      signer.potentialSigners = ["SolKey789"];

      mockSignSolana.mockResolvedValue({
        signature: "base64-encoded-signature-string",
        publicKey: "SolKey789",
      });

      mockSolanaHandler.matchSignatureToSigner.mockReturnValue({
        key: "SolKey789",
      });

      await signer.signWithHsm("sol-key-3");

      expect(signer.accepted.length).toBe(1);
    });

    it("should do nothing when result has no signature", async () => {
      const signer = createMockSigner("solana");
      mockSignSolana.mockResolvedValue({ publicKey: "SolKey" });

      await signer.signWithHsm("sol-key-4");

      expect(signer.accepted.length).toBe(0);
    });

    it("should do nothing when result is null", async () => {
      const signer = createMockSigner("solana");
      mockSignSolana.mockResolvedValue(null);

      await signer.signWithHsm("sol-key-5");

      expect(signer.accepted.length).toBe(0);
    });
  });

  // ── EVM HSM Signing ─────────────────────────────────────────────

  describe("EVM signing path", () => {
    it("should call signEvmTransaction with keyId and tx for ethereum", async () => {
      const mockTx = { from: "0xabc", to: "0xdef" };
      const signer = createMockSigner("ethereum", { tx: mockTx });
      signer.potentialSigners = ["0xabc"];

      mockSignEvm.mockResolvedValue({
        v: 27,
        r: "0x1234",
        s: "0x5678",
        from: "0xabc",
      });

      await signer.signWithHsm("eth-key-1");

      expect(mockSignEvm).toHaveBeenCalledWith("eth-key-1", mockTx);
      expect(signer.accepted.length).toBe(1);
      expect(signer.accepted[0].key).toBe("0xabc");
    });

    it("should work for polygon (EVM-compatible)", async () => {
      const mockTx = { from: "0xpoly" };
      const signer = createMockSigner("polygon", { tx: mockTx });
      signer.potentialSigners = ["0xpoly"];

      mockSignEvm.mockResolvedValue({
        v: 28,
        r: "0xaaaa",
        s: "0xbbbb",
        from: "0xpoly",
      });

      await signer.signWithHsm("poly-key-1");

      expect(mockSignEvm).toHaveBeenCalledWith("poly-key-1", mockTx);
      expect(signer.accepted.length).toBe(1);
    });

    it("should work for onemoney (EVM-compatible)", async () => {
      const mockTx = { from: "0x1money" };
      const signer = createMockSigner("onemoney", { tx: mockTx });
      signer.potentialSigners = ["0x1money"];

      mockSignEvm.mockResolvedValue({
        v: 27,
        r: "0xcccc",
        s: "0xdddd",
        from: "0x1money",
      });

      await signer.signWithHsm("1money-key-1");

      expect(mockSignEvm).toHaveBeenCalledWith("1money-key-1", mockTx);
      expect(signer.accepted.length).toBe(1);
    });

    it("should do nothing when EVM result has no v field", async () => {
      const signer = createMockSigner("ethereum");
      mockSignEvm.mockResolvedValue({ r: "0x1234", s: "0x5678" });

      await signer.signWithHsm("eth-key-2");

      expect(signer.accepted.length).toBe(0);
    });

    it("should do nothing when EVM result is null", async () => {
      const signer = createMockSigner("ethereum");
      mockSignEvm.mockResolvedValue(null);

      await signer.signWithHsm("eth-key-3");

      expect(signer.accepted.length).toBe(0);
    });
  });

  // ── Status tracking ─────────────────────────────────────────────

  describe("status tracking", () => {
    it("should mark status as updated when new signatures accepted and status is unchanged", async () => {
      const signer = createMockSigner("algorand");
      signer.status = "unchanged";
      signer.potentialSigners = ["ALGO_SIGNER"];

      mockSignAlgorand.mockResolvedValue({
        signedTxn: new Uint8Array([1, 2, 3]),
        address: "ALGO_SIGNER",
      });

      mockAlgorandHandler.matchSignatureToSigner.mockReturnValue({
        key: "ALGO_SIGNER",
      });

      await signer.signWithHsm("key-status-1");

      // setStatus('updated') is called but Signer.setStatus guards against
      // overwriting 'created' or 'updated', so for 'unchanged' it should set to 'updated'
      expect(signer.status).toBe("updated");
    });

    it("should not change status when status is created", async () => {
      const signer = createMockSigner("algorand");
      signer.status = "created";
      signer.potentialSigners = ["ALGO_SIGNER"];

      mockSignAlgorand.mockResolvedValue({
        signedTxn: new Uint8Array([10, 20]),
        address: "ALGO_SIGNER",
      });

      mockAlgorandHandler.matchSignatureToSigner.mockReturnValue({
        key: "ALGO_SIGNER",
      });

      await signer.signWithHsm("key-status-2");

      // Status should remain 'created'
      expect(signer.status).toBe("created");
    });

    it("should not update status when no new signatures accepted", async () => {
      const signer = createMockSigner("algorand");
      signer.status = "unchanged";

      mockSignAlgorand.mockResolvedValue(null);

      await signer.signWithHsm("key-status-3");

      expect(signer.status).toBe("unchanged");
    });
  });

  // ── Error handling ──────────────────────────────────────────────

  describe("error handling", () => {
    it("should propagate HSM adapter errors", async () => {
      const signer = createMockSigner("algorand");
      mockSignAlgorand.mockRejectedValue(new Error("HSM connection timeout"));

      await expect(signer.signWithHsm("key-err-1")).rejects.toThrow(
        "HSM connection timeout",
      );
    });

    it("should propagate Stellar XDR parsing errors", async () => {
      const signer = createMockSigner("stellar");
      mockSignStellar.mockResolvedValue("invalid-xdr");

      const { TransactionBuilder } = require("@stellar/stellar-sdk");
      const originalFromXDR = TransactionBuilder.fromXDR;
      TransactionBuilder.fromXDR = jest.fn().mockImplementation(() => {
        throw new Error("Invalid XDR");
      });

      try {
        await expect(signer.signWithHsm("key-err-2")).rejects.toThrow(
          "Invalid XDR",
        );
      } finally {
        TransactionBuilder.fromXDR = originalFromXDR;
      }
    });

    it("should propagate EVM signing errors", async () => {
      const signer = createMockSigner("ethereum");
      mockSignEvm.mockRejectedValue(new Error("EVM signing failed"));

      await expect(signer.signWithHsm("key-err-3")).rejects.toThrow(
        "EVM signing failed",
      );
    });

    it("should propagate Solana signing errors", async () => {
      const signer = createMockSigner("solana");
      mockSignSolana.mockRejectedValue(new Error("Solana HSM error"));

      await expect(signer.signWithHsm("key-err-4")).rejects.toThrow(
        "Solana HSM error",
      );
    });
  });

  // ── Duplicate prevention ────────────────────────────────────────

  describe("duplicate signature prevention", () => {
    it("should not add duplicate EVM signatures", async () => {
      const signer = createMockSigner("ethereum");
      signer.potentialSigners = ["0xsigner"];
      signer.txInfo.signatures = [
        {
          key: "0xsigner",
          signature: JSON.stringify({ v: 27, r: "0xaa", s: "0xbb" }),
        },
      ];

      mockSignEvm.mockResolvedValue({
        v: 27,
        r: "0xaa",
        s: "0xbb",
        from: "0xsigner",
      });

      await signer.signWithHsm("eth-dup-key");

      // Should not duplicate
      expect(signer.txInfo.signatures.length).toBe(1);
      expect(signer.accepted.length).toBe(0);
    });

    it("should not add duplicate Algorand signatures", async () => {
      const sigBase64 = Buffer.from([1, 2, 3]).toString("base64");
      const signer = createMockSigner("algorand");
      signer.potentialSigners = ["ALGO_DUP"];
      signer.txInfo.signatures = [{ key: "ALGO_DUP", signature: sigBase64 }];

      mockSignAlgorand.mockResolvedValue({
        signedTxn: new Uint8Array([1, 2, 3]),
        address: "ALGO_DUP",
      });

      mockAlgorandHandler.matchSignatureToSigner.mockReturnValue({
        key: "ALGO_DUP",
      });

      await signer.signWithHsm("algo-dup-key");

      // Duplicate should be filtered
      expect(signer.txInfo.signatures.length).toBe(1);
      expect(signer.accepted.length).toBe(0);
    });
  });
});
