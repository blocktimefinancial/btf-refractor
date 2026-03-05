/**
 * Tests for Solana Handler
 *
 * Tests the Solana-specific blockchain handler implementation:
 * - Transaction parsing (base64/base58/hex/json)
 * - Wire-format deserialization (compact-u16 length prefixes)
 * - Hash computation (SHA-256 of message bytes)
 * - Signature extraction and verification (ed25519)
 * - Base58 encode/decode
 * - Network name normalization
 * - Transaction parameter parsing
 */

const crypto = require("crypto");

// The handler is exported as a singleton instance
const solanaHandler = require("../../business-logic/handlers/solana-handler");

// ── Constants ────────────────────────────────────────────────────────
const SOLANA_SIG_BYTES = 64;
const SOLANA_KEY_BYTES = 32;

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Write a compact-u16 value (1-3 bytes, Solana encoding).
 */
function writeCompactU16(value) {
  const bytes = [];
  let remaining = value;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let byte = remaining & 0x7f;
    remaining >>= 7;
    if (remaining > 0) byte |= 0x80;
    bytes.push(byte);
    if (remaining === 0) break;
  }
  return Buffer.from(bytes);
}

/**
 * Build a minimal valid Solana wire-format transaction.
 *
 * Wire format:
 *   [compact-u16 numSigs] [sigs × 64B]
 *   [header 3B] [compact-u16 numKeys] [keys × 32B]
 *   [blockhash 32B] [compact-u16 numIxs] [instructions...]
 */
function buildMinimalTx({
  numRequired = 1,
  numReadonlySigned = 0,
  numReadonlyUnsigned = 0,
  keys = null,
  sigs = null,
  blockhash = null,
  instructions = [],
} = {}) {
  const parts = [];

  // Generate default keys
  const accountKeys = keys || [crypto.randomBytes(SOLANA_KEY_BYTES)]; // fee payer
  const numKeys = accountKeys.length;

  // Signatures (defaults to one all-zero slot)
  const signatures = sigs || [Buffer.alloc(SOLANA_SIG_BYTES, 0)];
  parts.push(writeCompactU16(signatures.length));
  for (const sig of signatures) {
    const padded = Buffer.alloc(SOLANA_SIG_BYTES, 0);
    sig.copy(padded, 0, 0, Math.min(sig.length, SOLANA_SIG_BYTES));
    parts.push(padded);
  }

  // Message header
  parts.push(
    Buffer.from([numRequired, numReadonlySigned, numReadonlyUnsigned]),
  );

  // Account keys
  parts.push(writeCompactU16(numKeys));
  for (const key of accountKeys) {
    parts.push(Buffer.isBuffer(key) ? key : Buffer.from(key));
  }

  // Recent blockhash
  parts.push(blockhash || crypto.randomBytes(32));

  // Instructions
  parts.push(writeCompactU16(instructions.length));
  for (const ix of instructions) {
    parts.push(Buffer.from([ix.programIdIndex || 0]));
    const accIdxs = ix.accountIndices || [];
    parts.push(writeCompactU16(accIdxs.length));
    parts.push(Buffer.from(accIdxs));
    const data = ix.data || Buffer.alloc(0);
    parts.push(writeCompactU16(data.length));
    parts.push(data);
  }

  return Buffer.concat(parts);
}

/**
 * Build a parsed transaction object (as returned by _deserializeTransaction).
 */
function makeParsedTx(overrides = {}) {
  const feePayer = crypto.randomBytes(SOLANA_KEY_BYTES);
  const blockhash = crypto.randomBytes(32);
  const rawBytes = buildMinimalTx({ keys: [feePayer], blockhash });

  // Compute message offset: skip compact-u16(1) + 1*64 sig bytes
  const messageOffset = 1 + SOLANA_SIG_BYTES;
  const messageBytes = rawBytes.slice(messageOffset);

  return {
    signatures: [Buffer.alloc(SOLANA_SIG_BYTES, 0)],
    message: {
      header: {
        numRequiredSignatures: 1,
        numReadonlySigned: 0,
        numReadonlyUnsigned: 0,
      },
      accountKeys: [feePayer],
      recentBlockhash: blockhash,
      instructions: [],
    },
    _messageBytes: messageBytes,
    _rawBytes: rawBytes,
    _networkName: "devnet",
    _originalEncoding: "base64",
    ...overrides,
  };
}

/**
 * Generate a valid base58-encoded Solana address (32-byte ed25519 pubkey).
 */
function generateSolanaAddress() {
  return solanaHandler._base58Encode(crypto.randomBytes(SOLANA_KEY_BYTES));
}

// ═════════════════════════════════════════════════════════════════════
describe("Solana Handler", () => {
  // ── Constructor & Identity ──────────────────────────────────────
  describe("constructor", () => {
    it("should have blockchain set to solana", () => {
      expect(solanaHandler.blockchain).toBe("solana");
    });

    it("should have config loaded from blockchain registry", () => {
      expect(solanaHandler.config).toBeDefined();
      expect(solanaHandler.config.name).toBe("Solana");
    });
  });

  // ── compact-u16 encode/decode ─────────────────────────────────
  describe("_readCompactU16 / _writeCompactU16", () => {
    it.each([0, 1, 127, 128, 255, 256, 16383, 16384, 65535])(
      "should roundtrip value %i",
      (value) => {
        const encoded = solanaHandler._writeCompactU16(value);
        const { value: decoded, bytesRead } = solanaHandler._readCompactU16(
          encoded,
          0,
        );
        expect(decoded).toBe(value);
        expect(bytesRead).toBe(encoded.length);
      },
    );

    it("should use 1 byte for values <= 127", () => {
      expect(solanaHandler._writeCompactU16(0).length).toBe(1);
      expect(solanaHandler._writeCompactU16(127).length).toBe(1);
    });

    it("should use 2 bytes for values 128–16383", () => {
      expect(solanaHandler._writeCompactU16(128).length).toBe(2);
      expect(solanaHandler._writeCompactU16(16383).length).toBe(2);
    });

    it("should use 3 bytes for values >= 16384", () => {
      expect(solanaHandler._writeCompactU16(16384).length).toBe(3);
      expect(solanaHandler._writeCompactU16(65535).length).toBe(3);
    });

    it("should read at correct offset", () => {
      const buf = Buffer.concat([
        Buffer.from([0xff, 0xff]), // junk prefix
        solanaHandler._writeCompactU16(42),
      ]);
      const { value } = solanaHandler._readCompactU16(buf, 2);
      expect(value).toBe(42);
    });

    it("should throw for truncated buffer", () => {
      expect(() => solanaHandler._readCompactU16(Buffer.alloc(0), 0)).toThrow(
        /Unexpected end/,
      );
    });
  });

  // ── base58 encode/decode ───────────────────────────────────────
  describe("_base58Encode / _base58Decode", () => {
    it("should roundtrip random 32-byte public keys", () => {
      for (let i = 0; i < 5; i++) {
        const data = crypto.randomBytes(SOLANA_KEY_BYTES);
        const encoded = solanaHandler._base58Encode(data);
        const decoded = solanaHandler._base58Decode(encoded);
        expect(decoded).toEqual(data);
      }
    });

    it("should handle leading zero bytes", () => {
      const data = Buffer.concat([Buffer.alloc(3, 0), crypto.randomBytes(10)]);
      const encoded = solanaHandler._base58Encode(data);
      expect(encoded.startsWith("111")).toBe(true); // leading '1' represents 0x00
      const decoded = solanaHandler._base58Decode(encoded);
      expect(decoded).toEqual(data);
    });

    it("should encode empty buffer to empty string", () => {
      expect(solanaHandler._base58Encode(Buffer.alloc(0))).toBe("");
    });

    it("should decode empty string to empty buffer", () => {
      expect(solanaHandler._base58Decode("").length).toBe(0);
    });

    it("should only produce valid base58 characters", () => {
      const encoded = solanaHandler._base58Encode(crypto.randomBytes(32));
      expect(/^[1-9A-HJ-NP-Za-km-z]+$/.test(encoded)).toBe(true);
    });

    it("should throw for invalid base58 character", () => {
      expect(() => solanaHandler._base58Decode("0OIl")).toThrow(
        /Invalid base58/,
      );
    });
  });

  // ── parseTransaction ───────────────────────────────────────────
  describe("parseTransaction()", () => {
    it("should parse base64-encoded transaction", () => {
      const raw = buildMinimalTx();
      const tx = solanaHandler.parseTransaction(
        raw.toString("base64"),
        "base64",
        "devnet",
      );
      expect(tx._networkName).toBe("devnet");
      expect(tx._originalEncoding).toBe("base64");
      expect(tx.message.header.numRequiredSignatures).toBe(1);
    });

    it("should parse hex-encoded transaction", () => {
      const raw = buildMinimalTx();
      const tx = solanaHandler.parseTransaction(
        raw.toString("hex"),
        "hex",
        "mainnet",
      );
      expect(tx._networkName).toBe("mainnet");
      expect(tx._originalEncoding).toBe("hex");
    });

    it("should parse base58-encoded transaction", () => {
      const raw = buildMinimalTx();
      const encoded = solanaHandler._base58Encode(raw);
      const tx = solanaHandler.parseTransaction(encoded, "base58", "testnet");
      expect(tx._networkName).toBe("testnet");
      expect(tx._originalEncoding).toBe("base58");
    });

    it("should parse JSON-encoded transaction", () => {
      const tx = solanaHandler.parseTransaction(
        JSON.stringify({
          feePayer: "11111111111111111111111111111111",
          instructions: [],
        }),
        "json",
        "devnet",
      );
      expect(tx.feePayer).toBe("11111111111111111111111111111111");
      expect(tx._networkName).toBe("devnet");
      expect(tx._originalEncoding).toBe("json");
    });

    it("should parse JSON object directly", () => {
      const tx = solanaHandler.parseTransaction(
        { feePayer: "test", instructions: [] },
        "json",
        "mainnet",
      );
      expect(tx.feePayer).toBe("test");
    });

    it("should throw 400 for unsupported encoding", () => {
      expect(() =>
        solanaHandler.parseTransaction("data", "xml", "devnet"),
      ).toThrow(/supports base64/);
    });

    it("should default to base64 when encoding is null", () => {
      const raw = buildMinimalTx();
      const tx = solanaHandler.parseTransaction(
        raw.toString("base64"),
        null,
        "devnet",
      );
      expect(tx._originalEncoding).toBe("base64");
    });

    it("should normalize network name", () => {
      const raw = buildMinimalTx();
      const tx = solanaHandler.parseTransaction(
        raw.toString("base64"),
        "base64",
        "MAINNET",
      );
      expect(tx._networkName).toBe("mainnet");
    });
  });

  // ── _deserializeTransaction ────────────────────────────────────
  describe("_deserializeTransaction()", () => {
    it("should deserialize a minimal valid transaction", () => {
      const key = crypto.randomBytes(SOLANA_KEY_BYTES);
      const raw = buildMinimalTx({ keys: [key] });
      const tx = solanaHandler._deserializeTransaction(raw);

      expect(tx.signatures).toHaveLength(1);
      expect(tx.message.header.numRequiredSignatures).toBe(1);
      expect(tx.message.accountKeys).toHaveLength(1);
      expect(tx.message.accountKeys[0]).toEqual(key);
      expect(tx.message.recentBlockhash.length).toBe(32);
      expect(tx._messageBytes).toBeInstanceOf(Buffer);
    });

    it("should deserialize multi-key transaction with instruction", () => {
      const keys = [
        crypto.randomBytes(SOLANA_KEY_BYTES), // fee payer
        crypto.randomBytes(SOLANA_KEY_BYTES), // program
      ];
      const raw = buildMinimalTx({
        keys,
        numRequired: 1,
        instructions: [
          {
            programIdIndex: 1,
            accountIndices: [0],
            data: Buffer.from([2, 0, 0, 0, 64, 66, 15, 0, 0, 0, 0, 0]), // transfer
          },
        ],
      });
      const tx = solanaHandler._deserializeTransaction(raw);
      expect(tx.message.accountKeys).toHaveLength(2);
      expect(tx.message.instructions).toHaveLength(1);
      expect(tx.message.instructions[0].programIdIndex).toBe(1);
      expect(tx.message.instructions[0].data.length).toBe(12);
    });

    it("should throw for empty buffer", () => {
      expect(() =>
        solanaHandler._deserializeTransaction(Buffer.alloc(0)),
      ).toThrow(/Empty/);
    });

    it("should throw for null buffer", () => {
      expect(() => solanaHandler._deserializeTransaction(null)).toThrow();
    });

    it("should throw for oversized buffer", () => {
      const oversized = Buffer.alloc(1300);
      expect(() =>
        solanaHandler._deserializeTransaction(oversized),
      ).toThrow(/exceeds max size/);
    });

    it("should reserve _rawBytes on result", () => {
      const raw = buildMinimalTx();
      const tx = solanaHandler._deserializeTransaction(raw);
      expect(tx._rawBytes).toEqual(raw);
    });
  });

  // ── computeHash ────────────────────────────────────────────────
  describe("computeHash()", () => {
    it("should compute SHA-256 of message bytes", () => {
      const tx = makeParsedTx();
      const { hash, hashRaw, _signingPayload } =
        solanaHandler.computeHash(tx);

      const expected = crypto
        .createHash("sha256")
        .update(tx._messageBytes)
        .digest();

      expect(hash).toBe(expected.toString("hex"));
      expect(hashRaw).toEqual(expected);
      expect(_signingPayload).toEqual(tx._messageBytes);
    });

    it("should produce 32-byte hash", () => {
      const { hashRaw } = solanaHandler.computeHash(makeParsedTx());
      expect(hashRaw.length).toBe(32);
    });

    it("should extract message from _rawBytes when _messageBytes absent", () => {
      const tx = makeParsedTx();
      delete tx._messageBytes;
      const { hash } = solanaHandler.computeHash(tx);
      expect(hash).toBeTruthy();
      expect(hash.length).toBe(64);
    });

    it("should throw when no message or raw bytes available", () => {
      expect(() =>
        solanaHandler.computeHash({ feePayer: "test" }),
      ).toThrow(/Cannot compute hash/);
    });
  });

  // ── extractSignatures ──────────────────────────────────────────
  describe("extractSignatures()", () => {
    it("should extract non-zero signatures", () => {
      const sig = crypto.randomBytes(SOLANA_SIG_BYTES);
      const key = crypto.randomBytes(SOLANA_KEY_BYTES);
      const tx = makeParsedTx({
        signatures: [sig],
        message: {
          header: { numRequiredSignatures: 1 },
          accountKeys: [key],
          recentBlockhash: crypto.randomBytes(32),
          instructions: [],
        },
      });

      const sigs = solanaHandler.extractSignatures(tx);
      expect(sigs).toHaveLength(1);
      expect(sigs[0].type).toBe("fee-payer");
      expect(sigs[0].index).toBe(0);
      expect(sigs[0].signature).toBe(sig.toString("base64"));
    });

    it("should label second signer as 'signer'", () => {
      const sigs = [
        crypto.randomBytes(SOLANA_SIG_BYTES),
        crypto.randomBytes(SOLANA_SIG_BYTES),
      ];
      const keys = [
        crypto.randomBytes(SOLANA_KEY_BYTES),
        crypto.randomBytes(SOLANA_KEY_BYTES),
      ];
      const tx = makeParsedTx({
        signatures: sigs,
        message: {
          header: { numRequiredSignatures: 2 },
          accountKeys: keys,
          recentBlockhash: crypto.randomBytes(32),
          instructions: [],
        },
      });

      const extracted = solanaHandler.extractSignatures(tx);
      expect(extracted).toHaveLength(2);
      expect(extracted[0].type).toBe("fee-payer");
      expect(extracted[1].type).toBe("signer");
    });

    it("should skip all-zero signatures", () => {
      const tx = makeParsedTx({
        signatures: [Buffer.alloc(SOLANA_SIG_BYTES, 0)],
      });
      const sigs = solanaHandler.extractSignatures(tx);
      expect(sigs).toHaveLength(0);
    });

    it("should return empty array when no signatures", () => {
      const tx = makeParsedTx({ signatures: [] });
      expect(solanaHandler.extractSignatures(tx)).toEqual([]);
    });
  });

  // ── clearSignatures ────────────────────────────────────────────
  describe("clearSignatures()", () => {
    it("should set all signatures to 64-byte zeros", () => {
      const tx = makeParsedTx({
        signatures: [
          crypto.randomBytes(SOLANA_SIG_BYTES),
          crypto.randomBytes(SOLANA_SIG_BYTES),
        ],
      });
      solanaHandler.clearSignatures(tx);
      for (const sig of tx.signatures) {
        expect(sig.every((b) => b === 0)).toBe(true);
        expect(sig.length).toBe(SOLANA_SIG_BYTES);
      }
    });

    it("should handle missing signatures array gracefully", () => {
      const tx = {};
      expect(() => solanaHandler.clearSignatures(tx)).not.toThrow();
    });
  });

  // ── verifySignature ────────────────────────────────────────────
  describe("verifySignature()", () => {
    let pubKeyBytes, address, privateKey;

    beforeEach(() => {
      const kp = crypto.generateKeyPairSync("ed25519");
      privateKey = kp.privateKey;
      const pubKeyDer = kp.publicKey.export({ type: "spki", format: "der" });
      pubKeyBytes = pubKeyDer.slice(12); // strip DER prefix
      address = solanaHandler._base58Encode(pubKeyBytes);
    });

    it("should verify a valid ed25519 signature (base58 key)", () => {
      const message = crypto.randomBytes(128);
      const sig = crypto.sign(null, message, privateKey);
      expect(solanaHandler.verifySignature(address, sig, message)).toBe(true);
    });

    it("should verify with hex public key", () => {
      const message = crypto.randomBytes(64);
      const sig = crypto.sign(null, message, privateKey);
      expect(
        solanaHandler.verifySignature(
          pubKeyBytes.toString("hex"),
          sig,
          message,
        ),
      ).toBe(true);
    });

    it("should verify with base64 public key (44 chars)", () => {
      const message = crypto.randomBytes(64);
      const sig = crypto.sign(null, message, privateKey);
      const b64Key = pubKeyBytes.toString("base64");
      expect(solanaHandler.verifySignature(b64Key, sig, message)).toBe(true);
    });

    it("should verify with Buffer public key", () => {
      const message = crypto.randomBytes(64);
      const sig = crypto.sign(null, message, privateKey);
      expect(solanaHandler.verifySignature(pubKeyBytes, sig, message)).toBe(
        true,
      );
    });

    it("should reject invalid signature", () => {
      const message = crypto.randomBytes(64);
      const badSig = crypto.randomBytes(SOLANA_SIG_BYTES);
      expect(solanaHandler.verifySignature(address, badSig, message)).toBe(
        false,
      );
    });

    it("should reject wrong-length public key", () => {
      expect(
        solanaHandler.verifySignature(
          crypto.randomBytes(16).toString("hex"),
          crypto.randomBytes(SOLANA_SIG_BYTES),
          crypto.randomBytes(32),
        ),
      ).toBe(false);
    });

    it("should accept base64-encoded string signature", () => {
      const message = crypto.randomBytes(64);
      const sig = crypto.sign(null, message, privateKey);
      expect(
        solanaHandler.verifySignature(address, sig.toString("base64"), message),
      ).toBe(true);
    });
  });

  // ── addSignature ───────────────────────────────────────────────
  describe("addSignature()", () => {
    it("should add signature at the correct positional slot", () => {
      const key = crypto.randomBytes(SOLANA_KEY_BYTES);
      const tx = makeParsedTx({
        signatures: [Buffer.alloc(SOLANA_SIG_BYTES, 0)],
        message: {
          header: { numRequiredSignatures: 1 },
          accountKeys: [key],
          recentBlockhash: crypto.randomBytes(32),
          instructions: [],
        },
      });

      const sig = crypto.randomBytes(SOLANA_SIG_BYTES).toString("base64");
      const result = solanaHandler.addSignature(
        tx,
        solanaHandler._base58Encode(key),
        sig,
      );
      expect(result.signatures[0]).toEqual(Buffer.from(sig, "base64"));
    });

    it("should append signature when signer not found in keys", () => {
      const tx = makeParsedTx({
        signatures: [],
        message: {
          header: { numRequiredSignatures: 1 },
          accountKeys: [],
          recentBlockhash: crypto.randomBytes(32),
          instructions: [],
        },
      });

      const sig = crypto.randomBytes(SOLANA_SIG_BYTES).toString("base64");
      solanaHandler.addSignature(tx, generateSolanaAddress(), sig);
      expect(tx.signatures).toHaveLength(1);
    });

    it("should expand signatures array to reach signer index", () => {
      const key0 = crypto.randomBytes(SOLANA_KEY_BYTES);
      const key1 = crypto.randomBytes(SOLANA_KEY_BYTES);
      const tx = makeParsedTx({
        signatures: [],
        message: {
          header: { numRequiredSignatures: 2 },
          accountKeys: [key0, key1],
          recentBlockhash: crypto.randomBytes(32),
          instructions: [],
        },
      });

      const sig = crypto.randomBytes(SOLANA_SIG_BYTES).toString("base64");
      solanaHandler.addSignature(
        tx,
        solanaHandler._base58Encode(key1),
        sig,
      );
      expect(tx.signatures).toHaveLength(2);
      // Index 0 should be zero-filled
      expect(tx.signatures[0].every((b) => b === 0)).toBe(true);
      // Index 1 should be our signature
      expect(tx.signatures[1]).toEqual(Buffer.from(sig, "base64"));
    });
  });

  // ── serializeTransaction ──────────────────────────────────────
  describe("serializeTransaction()", () => {
    it("should serialize to base64 (default)", () => {
      const tx = makeParsedTx();
      const result = solanaHandler.serializeTransaction(tx);
      expect(Buffer.from(result, "base64").toString("base64")).toBe(result);
    });

    it("should serialize to hex", () => {
      const tx = makeParsedTx();
      const result = solanaHandler.serializeTransaction(tx, "hex");
      expect(/^[0-9a-f]+$/i.test(result)).toBe(true);
    });

    it("should serialize to base58", () => {
      const tx = makeParsedTx();
      const result = solanaHandler.serializeTransaction(tx, "base58");
      expect(/^[1-9A-HJ-NP-Za-km-z]+$/.test(result)).toBe(true);
    });

    it("should roundtrip base64 serialize → parse", () => {
      const raw = buildMinimalTx();
      const tx = solanaHandler.parseTransaction(
        raw.toString("base64"),
        "base64",
        "devnet",
      );
      const serialized = solanaHandler.serializeTransaction(tx, "base64");
      expect(serialized).toBe(raw.toString("base64"));
    });

    it("should throw for unsupported encoding", () => {
      expect(() =>
        solanaHandler.serializeTransaction(makeParsedTx(), "xml"),
      ).toThrow(/supports base64/);
    });

    it("should fall back to _serializeFromFields when _rawBytes absent", () => {
      const tx = makeParsedTx();
      delete tx._rawBytes;
      // Should not throw; rebuilds from fields
      const result = solanaHandler.serializeTransaction(tx, "base64");
      expect(result).toBeTruthy();
    });
  });

  // ── getPotentialSigners ────────────────────────────────────────
  describe("getPotentialSigners()", () => {
    it("should return first N account keys per header", async () => {
      const keys = [
        crypto.randomBytes(SOLANA_KEY_BYTES),
        crypto.randomBytes(SOLANA_KEY_BYTES),
        crypto.randomBytes(SOLANA_KEY_BYTES),
      ];
      const tx = makeParsedTx({
        message: {
          header: {
            numRequiredSignatures: 2,
            numReadonlySigned: 0,
            numReadonlyUnsigned: 1,
          },
          accountKeys: keys,
          recentBlockhash: crypto.randomBytes(32),
          instructions: [],
        },
      });

      const signers = await solanaHandler.getPotentialSigners(tx, "devnet");
      expect(signers).toHaveLength(2);
      expect(signers[0]).toBe(solanaHandler._base58Encode(keys[0]));
      expect(signers[1]).toBe(solanaHandler._base58Encode(keys[1]));
    });

    it("should return feePayer for JSON transactions without header", async () => {
      const tx = { feePayer: "SomeAddress111111111111111111111" };
      const signers = await solanaHandler.getPotentialSigners(tx, "devnet");
      expect(signers).toContain("SomeAddress111111111111111111111");
    });

    it("should return empty for transaction with no header/keys", async () => {
      const signers = await solanaHandler.getPotentialSigners({}, "devnet");
      expect(signers).toEqual([]);
    });
  });

  // ── isFullySigned ──────────────────────────────────────────────
  describe("isFullySigned()", () => {
    it("should return true when enough signers", async () => {
      const tx = makeParsedTx({
        message: {
          header: { numRequiredSignatures: 2 },
          accountKeys: [],
          recentBlockhash: crypto.randomBytes(32),
          instructions: [],
        },
      });
      expect(await solanaHandler.isFullySigned(tx, ["a", "b"])).toBe(true);
    });

    it("should return false when not enough signers", async () => {
      const tx = makeParsedTx({
        message: {
          header: { numRequiredSignatures: 3 },
          accountKeys: [],
          recentBlockhash: crypto.randomBytes(32),
          instructions: [],
        },
      });
      expect(await solanaHandler.isFullySigned(tx, ["a", "b"])).toBe(false);
    });

    it("should default to 1 required when no header", async () => {
      expect(await solanaHandler.isFullySigned({}, ["a"])).toBe(true);
      expect(await solanaHandler.isFullySigned({}, [])).toBe(false);
    });
  });

  // ── normalizeNetworkName ───────────────────────────────────────
  describe("normalizeNetworkName()", () => {
    it.each([
      ["mainnet", "mainnet"],
      ["main", "mainnet"],
      ["mainnet-beta", "mainnet"],
      ["devnet", "devnet"],
      ["dev", "devnet"],
      ["testnet", "testnet"],
      ["test", "testnet"],
      [null, "mainnet"],
      [undefined, "mainnet"],
    ])('should normalize "%s" to "%s"', (input, expected) => {
      expect(solanaHandler.normalizeNetworkName(input)).toBe(expected);
    });

    it("should pass through unknown network names lowercase", () => {
      expect(solanaHandler.normalizeNetworkName("localnet")).toBe("localnet");
    });
  });

  // ── isValidPublicKey ───────────────────────────────────────────
  describe("isValidPublicKey()", () => {
    it("should accept valid 32-byte base58 address", () => {
      const addr = generateSolanaAddress();
      expect(solanaHandler.isValidPublicKey(addr)).toBe(true);
    });

    it("should accept the system program address", () => {
      expect(
        solanaHandler.isValidPublicKey(
          "11111111111111111111111111111111",
        ),
      ).toBe(true);
    });

    it("should reject null/undefined/empty", () => {
      expect(solanaHandler.isValidPublicKey(null)).toBe(false);
      expect(solanaHandler.isValidPublicKey(undefined)).toBe(false);
      expect(solanaHandler.isValidPublicKey("")).toBe(false);
    });

    it("should reject too-short address", () => {
      expect(solanaHandler.isValidPublicKey("abc")).toBe(false);
    });

    it("should reject too-long address", () => {
      // 50 valid base58 characters
      expect(
        solanaHandler.isValidPublicKey("1".repeat(50)),
      ).toBe(false);
    });

    it("should reject addresses with invalid base58 characters", () => {
      expect(solanaHandler.isValidPublicKey("0OIl" + "1".repeat(40))).toBe(
        false,
      );
    });

    it("should reject non-string input", () => {
      expect(solanaHandler.isValidPublicKey(12345)).toBe(false);
      expect(solanaHandler.isValidPublicKey({})).toBe(false);
    });
  });

  // ── getNetworkConfig / getRpcUrl ──────────────────────────────
  describe("getNetworkConfig()", () => {
    it("should return config for mainnet", () => {
      const config = solanaHandler.getNetworkConfig("mainnet");
      expect(config).toBeDefined();
    });

    it("should return config for devnet", () => {
      const config = solanaHandler.getNetworkConfig("devnet");
      expect(config).toBeDefined();
      expect(config.isTestnet).toBe(true);
    });
  });

  describe("getRpcUrl()", () => {
    it("should return default mainnet URL", () => {
      const url = solanaHandler.getRpcUrl("mainnet");
      expect(url).toContain("mainnet");
    });

    it("should return default devnet URL", () => {
      const url = solanaHandler.getRpcUrl("devnet");
      expect(url).toContain("devnet");
    });

    it("should prefer environment variable when set", () => {
      const original = process.env.SOLANA_DEVNET_RPC_URL;
      process.env.SOLANA_DEVNET_RPC_URL = "https://custom.example.com";
      try {
        expect(solanaHandler.getRpcUrl("devnet")).toBe(
          "https://custom.example.com",
        );
      } finally {
        if (original !== undefined) {
          process.env.SOLANA_DEVNET_RPC_URL = original;
        } else {
          delete process.env.SOLANA_DEVNET_RPC_URL;
        }
      }
    });
  });

  // ── parseTransactionParams ────────────────────────────────────
  describe("parseTransactionParams()", () => {
    it("should produce required fields", () => {
      const tx = makeParsedTx();
      const params = solanaHandler.parseTransactionParams(tx, {
        networkName: "devnet",
      });
      expect(params.blockchain).toBe("solana");
      expect(params.networkName).toBe("devnet");
      expect(params.encoding).toBe("base64");
      expect(params.payload).toBeTruthy();
      expect(params.signatures).toEqual([]);
    });

    it("should extract fee payer from first account key", () => {
      const key = crypto.randomBytes(SOLANA_KEY_BYTES);
      const tx = makeParsedTx({
        message: {
          header: { numRequiredSignatures: 1 },
          accountKeys: [key],
          recentBlockhash: crypto.randomBytes(32),
          instructions: [],
        },
      });
      const params = solanaHandler.parseTransactionParams(tx, {
        networkName: "devnet",
      });
      expect(params.feePayer).toBe(solanaHandler._base58Encode(key));
      expect(params.source).toBe(params.feePayer);
    });

    it("should extract recent blockhash", () => {
      const bh = crypto.randomBytes(32);
      const tx = makeParsedTx({
        message: {
          header: { numRequiredSignatures: 1 },
          accountKeys: [crypto.randomBytes(SOLANA_KEY_BYTES)],
          recentBlockhash: bh,
          instructions: [],
        },
      });
      const params = solanaHandler.parseTransactionParams(tx, {
        networkName: "devnet",
      });
      expect(params.recentBlockhash).toBe(solanaHandler._base58Encode(bh));
    });

    it("should set submit flag", () => {
      const tx = makeParsedTx();
      const params = solanaHandler.parseTransactionParams(tx, {
        networkName: "devnet",
        submit: true,
      });
      expect(params.submit).toBe(true);
    });

    it("should set maxTime from expires", () => {
      const tx = makeParsedTx();
      const futureTime = Math.floor(Date.now() / 1000) + 3600;
      const params = solanaHandler.parseTransactionParams(tx, {
        networkName: "devnet",
        expires: futureTime,
      });
      expect(params.maxTime).toBe(futureTime);
    });

    it("should reject expired timestamp", () => {
      const tx = makeParsedTx();
      expect(() =>
        solanaHandler.parseTransactionParams(tx, {
          networkName: "devnet",
          expires: 1000,
        }),
      ).toThrow(/already passed/);
    });

    it("should reject out-of-range expires", () => {
      const tx = makeParsedTx();
      expect(() =>
        solanaHandler.parseTransactionParams(tx, {
          networkName: "devnet",
          expires: -1,
        }),
      ).toThrow(/not a valid UNIX date/);
    });

    it("should validate desiredSigners", () => {
      const tx = makeParsedTx();
      expect(() =>
        solanaHandler.parseTransactionParams(tx, {
          networkName: "devnet",
          desiredSigners: ["not-a-valid-address"],
        }),
      ).toThrow(/not a valid Solana address/);
    });

    it("should accept valid desiredSigners", () => {
      const tx = makeParsedTx();
      const addr = generateSolanaAddress();
      const params = solanaHandler.parseTransactionParams(tx, {
        networkName: "devnet",
        desiredSigners: [addr],
      });
      expect(params.desiredSigners).toEqual([addr]);
    });

    it("should include callback URL when valid", () => {
      const tx = makeParsedTx();
      const params = solanaHandler.parseTransactionParams(tx, {
        networkName: "devnet",
        callbackUrl: "https://example.com/hook",
      });
      expect(params.callbackUrl).toBe("https://example.com/hook");
    });

    it("should extract program names from instructions", () => {
      const systemProgram = Buffer.alloc(SOLANA_KEY_BYTES, 0); // 111...1 = System Program
      const feePayer = crypto.randomBytes(SOLANA_KEY_BYTES);
      const tx = makeParsedTx({
        message: {
          header: { numRequiredSignatures: 1 },
          accountKeys: [feePayer, systemProgram],
          recentBlockhash: crypto.randomBytes(32),
          instructions: [
            { programIdIndex: 1, accountIndices: [0], data: Buffer.alloc(0) },
          ],
        },
      });
      const params = solanaHandler.parseTransactionParams(tx, {
        networkName: "devnet",
      });
      expect(params.programs).toBeDefined();
      expect(params.programs.length).toBe(1);
    });
  });

  // ── matchSignatureToSigner ────────────────────────────────────
  describe("matchSignatureToSigner()", () => {
    it("should match from positional signer when signature verifies", () => {
      const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
      const pubKeyDer = publicKey.export({ type: "spki", format: "der" });
      const pubKeyBytes = pubKeyDer.slice(12);
      const address = solanaHandler._base58Encode(pubKeyBytes);

      const message = crypto.randomBytes(128);
      const sig = crypto.sign(null, message, privateKey).toString("base64");

      const result = solanaHandler.matchSignatureToSigner(
        { from: address, signature: sig },
        [address],
        message,
      );
      expect(result.key).toBe(address);
    });

    it("should brute-force verify against potential signers", () => {
      const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
      const pubKeyDer = publicKey.export({ type: "spki", format: "der" });
      const pubKeyBytes = pubKeyDer.slice(12);
      const address = solanaHandler._base58Encode(pubKeyBytes);

      const message = crypto.randomBytes(128);
      const sig = crypto.sign(null, message, privateKey).toString("base64");

      // No `from` field — must brute-force
      const result = solanaHandler.matchSignatureToSigner(
        { signature: sig },
        [generateSolanaAddress(), address], // real signer is second
        message,
      );
      expect(result.key).toBe(address);
    });

    it("should return null key when no signer matches", () => {
      const result = solanaHandler.matchSignatureToSigner(
        {
          from: generateSolanaAddress(),
          signature: crypto.randomBytes(SOLANA_SIG_BYTES).toString("base64"),
        },
        [generateSolanaAddress()],
        crypto.randomBytes(64),
      );
      expect(result.key).toBeNull();
    });
  });
});
