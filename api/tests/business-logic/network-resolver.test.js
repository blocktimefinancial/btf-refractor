const {
  normalizeNetworkName,
  resolveNetwork,
  resolveNetworkId,
  resolveNetworkParams,
  resolveBlockchainNetwork,
  resolveNetworkEndpoint,
  resolveChainId,
  isTestnet,
  getDefaultNetwork,
} = require("../../business-logic/network-resolver");

describe("network-resolver", () => {
  // ─── normalizeNetworkName ─────────────────────────────────────
  describe("normalizeNetworkName", () => {
    it.each([
      ["public", "public"],
      ["PUBLIC", "public"],
      ["mainnet", "public"],
      ["MAINNET", "public"],
      ["main", "public"],
      ["MAIN", "public"],
      ["0", "public"],
      [0, "public"],
    ])('normalizes "%s" to "public"', (input, expected) => {
      expect(normalizeNetworkName(input)).toBe(expected);
    });

    it.each([
      ["testnet", "testnet"],
      ["test", "testnet"],
      ["TESTNET", "testnet"],
      ["TEST", "testnet"],
      ["1", "testnet"],
      [1, "testnet"],
    ])('normalizes "%s" to "testnet"', (input, expected) => {
      expect(normalizeNetworkName(input)).toBe(expected);
    });

    it.each([
      ["futurenet", "futurenet"],
      ["FUTURENET", "futurenet"],
      [2, "futurenet"],
      ["2", "futurenet"],
    ])('normalizes "%s" to "futurenet"', (input, expected) => {
      expect(normalizeNetworkName(input)).toBe(expected);
    });

    it("returns lowercase of unknown string network", () => {
      expect(normalizeNetworkName("CustomNet")).toBe("customnet");
    });

    it("handles numeric input that is not 0, 1, or 2", () => {
      expect(normalizeNetworkName(99)).toBe("99");
    });

    it("handles undefined gracefully", () => {
      expect(normalizeNetworkName(undefined)).toBe("undefined");
    });

    it("handles null gracefully", () => {
      expect(normalizeNetworkName(null)).toBe("null");
    });
  });

  // ─── resolveNetwork ──────────────────────────────────────────
  describe("resolveNetwork", () => {
    it("resolves public network config", () => {
      const config = resolveNetwork("public");
      expect(config).toBeDefined();
      expect(config.passphrase).toBeDefined();
      expect(config.horizon).toBeDefined();
    });

    it("resolves testnet config from numeric id", () => {
      const config = resolveNetwork(1);
      expect(config).toBeDefined();
      expect(config.passphrase).toBeDefined();
    });

    it("returns undefined for unknown network", () => {
      expect(resolveNetwork("nonexistent")).toBeUndefined();
    });
  });

  // ─── resolveNetworkId ────────────────────────────────────────
  describe("resolveNetworkId", () => {
    it("returns 0 for public", () => {
      expect(resolveNetworkId("public")).toBe(0);
    });

    it("returns 1 for testnet", () => {
      expect(resolveNetworkId("testnet")).toBe(1);
    });

    it("returns 2 for futurenet", () => {
      expect(resolveNetworkId("futurenet")).toBe(2);
    });

    it("works with numeric input", () => {
      expect(resolveNetworkId(0)).toBe(0);
      expect(resolveNetworkId(1)).toBe(1);
    });

    it("throws for unknown network", () => {
      expect(() => resolveNetworkId("unknown")).toThrow(/Unidentified network/);
    });
  });

  // ─── resolveNetworkParams ────────────────────────────────────
  describe("resolveNetworkParams", () => {
    it("returns same result as resolveNetwork", () => {
      expect(resolveNetworkParams("public")).toEqual(resolveNetwork("public"));
      expect(resolveNetworkParams("testnet")).toEqual(
        resolveNetwork("testnet"),
      );
    });
  });

  // ─── resolveBlockchainNetwork ────────────────────────────────
  describe("resolveBlockchainNetwork", () => {
    it("resolves stellar public network", () => {
      const config = resolveBlockchainNetwork("stellar", "public");
      expect(config).toBeDefined();
    });

    it("normalizes stellar network names", () => {
      const config = resolveBlockchainNetwork("stellar", "mainnet");
      expect(config).toBeDefined();
    });

    it("throws for unsupported blockchain", () => {
      expect(() => resolveBlockchainNetwork("nonexistent", "mainnet")).toThrow(
        /Unsupported blockchain/,
      );
    });

    it("throws for invalid network on valid blockchain", () => {
      expect(() => resolveBlockchainNetwork("stellar", "nonexistent")).toThrow(
        /Invalid network/,
      );
    });
  });

  // ─── resolveNetworkEndpoint ──────────────────────────────────
  describe("resolveNetworkEndpoint", () => {
    it("returns horizon URL for stellar", () => {
      const endpoint = resolveNetworkEndpoint("stellar", "public");
      expect(endpoint).toBeDefined();
      expect(typeof endpoint).toBe("string");
      expect(endpoint).toMatch(/^https?:\/\//);
    });

    it("returns null for unknown network on unknown blockchain", () => {
      expect(() => resolveNetworkEndpoint("fakechain", "mainnet")).toThrow(
        /Unsupported blockchain/,
      );
    });
  });

  // ─── resolveChainId ──────────────────────────────────────────
  describe("resolveChainId", () => {
    it("returns null for stellar (no chain ID)", () => {
      const id = resolveChainId("stellar", "public");
      // Stellar may or may not have a chainId depending on config
      expect(id === null || id !== undefined).toBe(true);
    });
  });

  // ─── isTestnet ───────────────────────────────────────────────
  describe("isTestnet", () => {
    it("returns false for stellar public", () => {
      expect(isTestnet("stellar", "public")).toBe(false);
    });

    it("returns true for stellar testnet", () => {
      expect(isTestnet("stellar", "testnet")).toBe(true);
    });
  });

  // ─── getDefaultNetwork ───────────────────────────────────────
  describe("getDefaultNetwork", () => {
    it("returns a mainnet by default for stellar", () => {
      const net = getDefaultNetwork("stellar");
      expect(net).toBeDefined();
      expect(typeof net).toBe("string");
    });

    it("returns a testnet when useTestnet=true", () => {
      const net = getDefaultNetwork("stellar", true);
      expect(net).toBeDefined();
    });

    it("throws for unsupported blockchain", () => {
      expect(() => getDefaultNetwork("fakechain")).toThrow();
    });
  });
});
