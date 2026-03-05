/**
 * Tests for Algorand Handler
 *
 * Tests the Algorand-specific blockchain handler implementation:
 * - Transaction parsing (base64/hex/json)
 * - Hash computation (SHA-512/256 with "TX" prefix)
 * - Signature extraction and verification (ed25519)
 * - Base32 encode/decode and address checksum validation
 * - Network name normalization
 * - Transaction parameter parsing
 */

const crypto = require("crypto");

// The handler is exported as a singleton instance
const algorandHandler = require("../../business-logic/handlers/algorand-handler");

// ── Helpers ──────────────────────────────────────────────────────────
/**
 * Build a minimal valid msgpack-style raw transaction buffer.
 * The handler's _simpleMsgpackDecode returns { _rawMsgpack, _isPacked: true }.
 */
function buildRawTxnBytes(content = "test-payload") {
  return Buffer.from(content, "utf-8");
}

/**
 * Create a fake parsed transaction with raw bytes for hashing/serialization.
 */
function makeParsedTx(overrides = {}) {
  const rawBytes = buildRawTxnBytes("algorand-tx-payload");
  return {
    _rawMsgpack: rawBytes,
    _isPacked: true,
    _networkName: "testnet",
    _originalEncoding: "base64",
    _rawBytes: rawBytes,
    ...overrides,
  };
}

/**
 * Generate a valid Algorand address (58-char base32, with correct checksum).
 */
function generateAlgorandAddress() {
  const publicKey = crypto.randomBytes(32);
  const checksum = crypto
    .createHash("sha512-256")
    .update(publicKey)
    .digest()
    .slice(-4);
  const addrBytes = Buffer.concat([publicKey, checksum]);
  return algorandHandler._base32Encode(addrBytes);
}

// ═════════════════════════════════════════════════════════════════════
describe("Algorand Handler", () => {
  // ── Constructor & Identity ──────────────────────────────────────
  describe("constructor", () => {
    it("should have blockchain set to algorand", () => {
      expect(algorandHandler.blockchain).toBe("algorand");
    });

    it("should have config loaded from blockchain registry", () => {
      expect(algorandHandler.config).toBeDefined();
      expect(algorandHandler.config.name).toBe("Algorand");
    });
  });

  // ── parseTransaction ───────────────────────────────────────────
  describe("parseTransaction()", () => {
    it("should parse base64-encoded transaction", () => {
      const raw = buildRawTxnBytes("algorand-pay");
      const payload = raw.toString("base64");
      const tx = algorandHandler.parseTransaction(payload, "base64", "testnet");
      expect(tx._isPacked).toBe(true);
      expect(tx._networkName).toBe("testnet");
      expect(tx._originalEncoding).toBe("base64");
    });

    it("should parse hex-encoded transaction", () => {
      const raw = buildRawTxnBytes("algorand-hex-pay");
      const payload = raw.toString("hex");
      const tx = algorandHandler.parseTransaction(payload, "hex", "mainnet");
      expect(tx._isPacked).toBe(true);
      expect(tx._networkName).toBe("mainnet");
      expect(tx._originalEncoding).toBe("hex");
    });

    it("should parse msgpack encoding (alias for base64)", () => {
      const raw = buildRawTxnBytes("algorand-msgpack");
      const payload = raw.toString("base64");
      const tx = algorandHandler.parseTransaction(
        payload,
        "msgpack",
        "testnet",
      );
      expect(tx._isPacked).toBe(true);
    });

    it("should parse JSON-encoded transaction", () => {
      const tx = algorandHandler.parseTransaction(
        JSON.stringify({ type: "pay", snd: "AAAA", rcv: "BBBB", amt: 1000 }),
        "json",
        "testnet",
      );
      expect(tx.type).toBe("pay");
      expect(tx._networkName).toBe("testnet");
      expect(tx._originalEncoding).toBe("json");
    });

    it("should parse JSON object directly (not string)", () => {
      const tx = algorandHandler.parseTransaction(
        { type: "pay", snd: "AAAA" },
        "json",
        "mainnet",
      );
      expect(tx.type).toBe("pay");
    });

    it("should throw 400 for unsupported encoding", () => {
      expect(() =>
        algorandHandler.parseTransaction("data", "xml", "testnet"),
      ).toThrow(/supports base64/);
    });

    it("should throw 400 for empty base64 payload", () => {
      const emptyPayload = Buffer.alloc(0).toString("base64");
      expect(() =>
        algorandHandler.parseTransaction(emptyPayload, "base64", "testnet"),
      ).toThrow();
    });

    it("should normalize network name on parsed transaction", () => {
      const raw = buildRawTxnBytes("test");
      const tx = algorandHandler.parseTransaction(
        raw.toString("base64"),
        "base64",
        "MAINNET",
      );
      expect(tx._networkName).toBe("mainnet");
    });
  });

  // ── computeHash ────────────────────────────────────────────────
  describe("computeHash()", () => {
    it("should compute SHA-512/256 hash with TX prefix", () => {
      const tx = makeParsedTx();
      const { hash, hashRaw } = algorandHandler.computeHash(tx);

      // Manually compute expected hash
      const txTag = Buffer.from("TX");
      const expected = crypto
        .createHash("sha512-256")
        .update(Buffer.concat([txTag, tx._rawMsgpack]))
        .digest();

      expect(hash).toBe(expected.toString("hex"));
      expect(hashRaw).toEqual(expected);
    });

    it("should produce 32-byte hash", () => {
      const tx = makeParsedTx();
      const { hashRaw } = algorandHandler.computeHash(tx);
      expect(hashRaw.length).toBe(32);
    });

    it("should use _rawBytes when _rawMsgpack is absent", () => {
      const raw = buildRawTxnBytes("fallback-bytes");
      const tx = { _rawBytes: raw };
      const { hash } = algorandHandler.computeHash(tx);
      expect(hash).toBeTruthy();
      expect(hash.length).toBe(64); // 32 bytes as hex
    });

    it("should throw for JSON-only transaction without raw bytes", () => {
      expect(() => algorandHandler.computeHash({ type: "pay" })).toThrow(
        /Cannot compute hash/,
      );
    });
  });

  // ── extractSignatures / clearSignatures ────────────────────────
  describe("extractSignatures()", () => {
    it("should extract single signature", () => {
      const sig = crypto.randomBytes(64);
      const tx = makeParsedTx({ _sig: sig, snd: "SENDER" });
      const sigs = algorandHandler.extractSignatures(tx);
      expect(sigs).toHaveLength(1);
      expect(sigs[0].type).toBe("single");
      expect(sigs[0].signature).toBe(sig.toString("base64"));
    });

    it("should extract multisig subsignatures", () => {
      const pk1 = crypto.randomBytes(32);
      const pk2 = crypto.randomBytes(32);
      const sig1 = crypto.randomBytes(64);
      const tx = makeParsedTx({
        _msig: {
          thr: 2,
          v: 1,
          subsig: [
            { pk: pk1, s: sig1 },
            { pk: pk2 }, // no signature yet
          ],
        },
      });
      const sigs = algorandHandler.extractSignatures(tx);
      expect(sigs).toHaveLength(1); // only signed subsig is returned
      expect(sigs[0].type).toBe("multisig");
      expect(sigs[0].threshold).toBe(2);
    });

    it("should extract logicsig indicator", () => {
      const tx = makeParsedTx({ _lsig: { l: Buffer.from("teal-code") } });
      const sigs = algorandHandler.extractSignatures(tx);
      expect(sigs).toHaveLength(1);
      expect(sigs[0].type).toBe("logicsig");
    });

    it("should return empty array for unsigned transaction", () => {
      const tx = makeParsedTx();
      const sigs = algorandHandler.extractSignatures(tx);
      expect(sigs).toHaveLength(0);
    });
  });

  describe("clearSignatures()", () => {
    it("should remove all signature fields", () => {
      const tx = makeParsedTx({
        _sig: crypto.randomBytes(64),
        _msig: { thr: 1, subsig: [] },
        _lsig: { l: Buffer.alloc(10) },
      });
      const cleared = algorandHandler.clearSignatures(tx);
      expect(cleared._sig).toBeUndefined();
      expect(cleared._msig).toBeUndefined();
      expect(cleared._lsig).toBeUndefined();
    });
  });

  // ── addSignature ───────────────────────────────────────────────
  describe("addSignature()", () => {
    it("should add single signature to unsigned transaction", () => {
      const tx = makeParsedTx();
      const sig = crypto.randomBytes(64).toString("base64");
      const result = algorandHandler.addSignature(tx, "SENDER_ADDR", sig);
      expect(result._sig).toBeInstanceOf(Buffer);
      expect(result._sig.length).toBe(64);
    });

    it("should add signature to existing multisig subsig slot", () => {
      const pk = crypto.randomBytes(32);
      const tx = makeParsedTx({
        _msig: { thr: 1, v: 1, subsig: [{ pk }] },
      });
      const sig = crypto.randomBytes(64).toString("base64");
      // Use hex public key (matching length 64 hex = 32 bytes)
      algorandHandler.addSignature(tx, pk.toString("hex"), sig);
      expect(tx._msig.subsig[0].s).toBeInstanceOf(Buffer);
    });
  });

  // ── serializeTransaction ──────────────────────────────────────
  describe("serializeTransaction()", () => {
    it("should serialize to base64 by default", () => {
      const tx = makeParsedTx();
      const result = algorandHandler.serializeTransaction(tx);
      // Should be valid base64
      expect(Buffer.from(result, "base64").toString("base64")).toBe(result);
    });

    it("should serialize to hex", () => {
      const tx = makeParsedTx();
      const result = algorandHandler.serializeTransaction(tx, "hex");
      expect(/^[0-9a-f]+$/i.test(result)).toBe(true);
    });

    it("should throw for unsupported encoding", () => {
      expect(() =>
        algorandHandler.serializeTransaction(makeParsedTx(), "xml"),
      ).toThrow(/supports base64/);
    });

    it("should throw when no raw bytes available", () => {
      expect(() =>
        algorandHandler.serializeTransaction({ type: "pay" }),
      ).toThrow(/Cannot serialize/);
    });
  });

  // ── getPotentialSigners ────────────────────────────────────────
  describe("getPotentialSigners()", () => {
    it("should return sender as potential signer", async () => {
      const addr = generateAlgorandAddress();
      const tx = makeParsedTx({ snd: addr });
      const signers = await algorandHandler.getPotentialSigners(tx, "testnet");
      expect(signers).toContain(addr);
    });

    it("should return multisig participants", async () => {
      const pk1 = crypto.randomBytes(32);
      const pk2 = crypto.randomBytes(32);
      const tx = makeParsedTx({
        _msig: { thr: 2, subsig: [{ pk: pk1 }, { pk: pk2 }] },
      });
      const signers = await algorandHandler.getPotentialSigners(tx, "mainnet");
      expect(signers.length).toBeGreaterThanOrEqual(2);
    });

    it("should return empty for transaction with no sender", async () => {
      const tx = makeParsedTx();
      const signers = await algorandHandler.getPotentialSigners(tx, "testnet");
      expect(signers).toEqual([]);
    });
  });

  // ── isFullySigned ──────────────────────────────────────────────
  describe("isFullySigned()", () => {
    it("should return true for single-sig with one signer", async () => {
      expect(await algorandHandler.isFullySigned({}, ["signer1"])).toBe(true);
    });

    it("should return false for single-sig with no signers", async () => {
      expect(await algorandHandler.isFullySigned({}, [])).toBe(false);
    });

    it("should respect multisig threshold", async () => {
      const tx = { _msig: { thr: 2 } };
      expect(await algorandHandler.isFullySigned(tx, ["a"])).toBe(false);
      expect(await algorandHandler.isFullySigned(tx, ["a", "b"])).toBe(true);
      expect(await algorandHandler.isFullySigned(tx, ["a", "b", "c"])).toBe(
        true,
      );
    });
  });

  // ── normalizeNetworkName ───────────────────────────────────────
  describe("normalizeNetworkName()", () => {
    it.each([
      ["mainnet", "mainnet"],
      ["main", "mainnet"],
      ["mainnet-v1.0", "mainnet"],
      ["testnet", "testnet"],
      ["test", "testnet"],
      ["testnet-v1.0", "testnet"],
      ["betanet", "betanet"],
      ["beta", "betanet"],
      ["betanet-v1.0", "betanet"],
      [null, "mainnet"],
      [undefined, "mainnet"],
    ])('should normalize "%s" to "%s"', (input, expected) => {
      expect(algorandHandler.normalizeNetworkName(input)).toBe(expected);
    });

    it("should pass through unknown network names lowercase", () => {
      expect(algorandHandler.normalizeNetworkName("custom")).toBe("custom");
    });
  });

  // ── isValidPublicKey (address validation) ──────────────────────
  describe("isValidPublicKey()", () => {
    it("should accept a valid Algorand address", () => {
      const addr = generateAlgorandAddress();
      expect(algorandHandler.isValidPublicKey(addr)).toBe(true);
    });

    it("should reject null/undefined/empty", () => {
      expect(algorandHandler.isValidPublicKey(null)).toBe(false);
      expect(algorandHandler.isValidPublicKey(undefined)).toBe(false);
      expect(algorandHandler.isValidPublicKey("")).toBe(false);
    });

    it("should reject too-short address", () => {
      expect(algorandHandler.isValidPublicKey("ABCDEF")).toBe(false);
    });

    it("should reject address with invalid base32 characters", () => {
      // Lowercase and digits 0/1/8/9 are invalid in base32
      const invalid = "a".repeat(58);
      expect(algorandHandler.isValidPublicKey(invalid)).toBe(false);
    });

    it("should reject address with bad checksum", () => {
      const addr = generateAlgorandAddress();
      // Corrupt the last character
      const corrupted =
        addr.slice(0, -1) + (addr.slice(-1) === "A" ? "B" : "A");
      expect(algorandHandler.isValidPublicKey(corrupted)).toBe(false);
    });
  });

  // ── Base32 encode/decode roundtrip ─────────────────────────────
  describe("base32 encode/decode", () => {
    it("should roundtrip arbitrary bytes", () => {
      const data = crypto.randomBytes(36);
      const encoded = algorandHandler._base32Encode(data);
      const decoded = algorandHandler._base32Decode(encoded);
      expect(decoded).toEqual(data);
    });

    it("should roundtrip a 32-byte public key + 4-byte checksum", () => {
      const pubkey = crypto.randomBytes(32);
      const checksum = crypto
        .createHash("sha512-256")
        .update(pubkey)
        .digest()
        .slice(-4);
      const combined = Buffer.concat([pubkey, checksum]);
      const encoded = algorandHandler._base32Encode(combined);
      const decoded = algorandHandler._base32Decode(encoded);
      expect(decoded).toEqual(combined);
    });

    it("should produce uppercase A-Z2-7 output", () => {
      const encoded = algorandHandler._base32Encode(crypto.randomBytes(32));
      expect(/^[A-Z2-7]+$/.test(encoded)).toBe(true);
    });
  });

  // ── Address <-> PublicKey roundtrip ─────────────────────────────
  describe("address / publicKey conversion", () => {
    it("should roundtrip publicKey -> address -> publicKey", () => {
      const pubkey = crypto.randomBytes(32);
      const address = algorandHandler._publicKeyToAddress(pubkey);
      const recovered = algorandHandler._addressToPublicKey(address);
      expect(recovered).toEqual(pubkey);
    });

    it("should produce 58-character address from 32-byte key", () => {
      const pubkey = crypto.randomBytes(32);
      const address = algorandHandler._publicKeyToAddress(pubkey);
      expect(address.length).toBe(58);
    });
  });

  // ── getNetworkConfig / getRpcUrl ───────────────────────────────
  describe("getNetworkConfig()", () => {
    it("should return config for mainnet", () => {
      const config = algorandHandler.getNetworkConfig("mainnet");
      expect(config).toBeDefined();
      expect(config.name).toBeTruthy();
    });

    it("should return config for testnet", () => {
      const config = algorandHandler.getNetworkConfig("testnet");
      expect(config).toBeDefined();
      expect(config.isTestnet).toBe(true);
    });
  });

  describe("getRpcUrl()", () => {
    it("should return default URL for testnet", () => {
      const url = algorandHandler.getRpcUrl("testnet");
      expect(url).toContain("algonode");
    });

    it("should return default URL for mainnet", () => {
      const url = algorandHandler.getRpcUrl("mainnet");
      expect(url).toContain("algonode");
    });

    it("should prefer environment variable when set", () => {
      const original = process.env.ALGORAND_TESTNET_RPC_URL;
      process.env.ALGORAND_TESTNET_RPC_URL = "https://custom-rpc.example.com";
      try {
        const url = algorandHandler.getRpcUrl("testnet");
        expect(url).toBe("https://custom-rpc.example.com");
      } finally {
        if (original !== undefined) {
          process.env.ALGORAND_TESTNET_RPC_URL = original;
        } else {
          delete process.env.ALGORAND_TESTNET_RPC_URL;
        }
      }
    });
  });

  // ── parseTransactionParams ─────────────────────────────────────
  describe("parseTransactionParams()", () => {
    it("should produce required fields", () => {
      const tx = makeParsedTx();
      const params = algorandHandler.parseTransactionParams(tx, {
        networkName: "testnet",
      });
      expect(params.blockchain).toBe("algorand");
      expect(params.networkName).toBe("testnet");
      expect(params.encoding).toBe("base64");
      expect(params.payload).toBeTruthy();
      expect(params.signatures).toEqual([]);
    });

    it("should include callback URL when valid", () => {
      const tx = makeParsedTx();
      const params = algorandHandler.parseTransactionParams(tx, {
        networkName: "testnet",
        callbackUrl: "https://example.com/callback",
      });
      expect(params.callbackUrl).toBe("https://example.com/callback");
    });

    it("should throw for invalid callback URL", () => {
      const tx = makeParsedTx();
      expect(() =>
        algorandHandler.parseTransactionParams(tx, {
          networkName: "testnet",
          callbackUrl: "not-a-url",
        }),
      ).toThrow(/Invalid URL/);
    });

    it("should set submit flag", () => {
      const tx = makeParsedTx();
      const params = algorandHandler.parseTransactionParams(tx, {
        networkName: "testnet",
        submit: true,
      });
      expect(params.submit).toBe(true);
    });

    it("should set maxTime from expires", () => {
      const tx = makeParsedTx();
      const futureTime = Math.floor(Date.now() / 1000) + 3600;
      const params = algorandHandler.parseTransactionParams(tx, {
        networkName: "testnet",
        expires: futureTime,
      });
      expect(params.maxTime).toBe(futureTime);
    });

    it("should reject expired timestamp", () => {
      const tx = makeParsedTx();
      expect(() =>
        algorandHandler.parseTransactionParams(tx, {
          networkName: "testnet",
          expires: 1000, // way in the past
        }),
      ).toThrow(/already passed/);
    });

    it("should reject invalid expires value", () => {
      const tx = makeParsedTx();
      expect(() =>
        algorandHandler.parseTransactionParams(tx, {
          networkName: "testnet",
          expires: -1,
        }),
      ).toThrow(/not a valid UNIX date/);
    });

    it("should validate desiredSigners addresses", () => {
      const tx = makeParsedTx();
      expect(() =>
        algorandHandler.parseTransactionParams(tx, {
          networkName: "testnet",
          desiredSigners: ["not-a-valid-algorand-address"],
        }),
      ).toThrow(/not a valid Algorand address/);
    });

    it("should accept valid desiredSigners", () => {
      const tx = makeParsedTx();
      const addr = generateAlgorandAddress();
      const params = algorandHandler.parseTransactionParams(tx, {
        networkName: "testnet",
        desiredSigners: [addr],
      });
      expect(params.desiredSigners).toEqual([addr]);
    });
  });

  // ── verifySignature (ed25519) ──────────────────────────────────
  describe("verifySignature()", () => {
    it("should verify a valid ed25519 signature", () => {
      // Generate an ed25519 keypair
      const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
      const pubKeyDer = publicKey.export({ type: "spki", format: "der" });
      // Ed25519 SPKI DER: 12-byte prefix + 32-byte key
      const pubKeyBytes = pubKeyDer.slice(12);

      const message = crypto.randomBytes(64);
      const signature = crypto.sign(null, message, privateKey);

      // Build Algorand address from public key
      const address = algorandHandler._publicKeyToAddress(pubKeyBytes);

      expect(algorandHandler.verifySignature(address, signature, message)).toBe(
        true,
      );
    });

    it("should reject invalid signature", () => {
      const { publicKey } = crypto.generateKeyPairSync("ed25519");
      const pubKeyDer = publicKey.export({ type: "spki", format: "der" });
      const pubKeyBytes = pubKeyDer.slice(12);
      const address = algorandHandler._publicKeyToAddress(pubKeyBytes);

      const message = crypto.randomBytes(64);
      const badSig = crypto.randomBytes(64);

      expect(algorandHandler.verifySignature(address, badSig, message)).toBe(
        false,
      );
    });

    it("should handle hex public key format", () => {
      const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
      const pubKeyDer = publicKey.export({ type: "spki", format: "der" });
      const pubKeyHex = pubKeyDer.slice(12).toString("hex");

      const message = crypto.randomBytes(64);
      const signature = crypto.sign(null, message, privateKey);

      expect(
        algorandHandler.verifySignature(pubKeyHex, signature, message),
      ).toBe(true);
    });

    it("should return false for unknown key format", () => {
      expect(
        algorandHandler.verifySignature(
          "short",
          crypto.randomBytes(64),
          crypto.randomBytes(32),
        ),
      ).toBe(false);
    });
  });

  // ── matchSignatureToSigner ─────────────────────────────────────
  describe("matchSignatureToSigner()", () => {
    it("should match when from matches a potential signer and sig verifies", () => {
      const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
      const pubKeyDer = publicKey.export({ type: "spki", format: "der" });
      const pubKeyBytes = pubKeyDer.slice(12);
      const address = algorandHandler._publicKeyToAddress(pubKeyBytes);

      const message = crypto.randomBytes(64);
      const sig = crypto.sign(null, message, privateKey).toString("base64");

      const result = algorandHandler.matchSignatureToSigner(
        { from: address, signature: sig },
        [address],
        message,
      );
      expect(result.key).toBe(address);
    });

    it("should return null key when signature does not verify", () => {
      const addr = generateAlgorandAddress();
      const result = algorandHandler.matchSignatureToSigner(
        { from: addr, signature: crypto.randomBytes(64).toString("base64") },
        [addr],
        crypto.randomBytes(64),
      );
      expect(result.key).toBeNull();
    });
  });
});
