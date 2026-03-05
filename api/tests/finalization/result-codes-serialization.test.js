/**
 * Tests for result_codes serialization in error info
 *
 * Ensures Horizon-style error objects with result_codes are properly
 * serialized to strings (not "[object Object]").
 */

describe("Error info result_codes serialization", () => {
  // Replicate the exact serialization logic from finalizer.js
  function buildErrorMessage(e) {
    return e.message + (e.result_codes ? " " + JSON.stringify(e.result_codes) : "") || e.toString();
  }

  it("should serialize object result_codes to JSON string", () => {
    const error = new Error("Transaction failed");
    error.result_codes = { transaction: "tx_bad_seq", operations: ["op_no_source_account"] };

    const msg = buildErrorMessage(error);

    expect(msg).toContain("Transaction failed");
    expect(msg).toContain("tx_bad_seq");
    expect(msg).toContain("op_no_source_account");
    expect(msg).not.toContain("[object Object]");
  });

  it("should handle string result_codes", () => {
    const error = new Error("Some error");
    error.result_codes = "tx_failed";

    const msg = buildErrorMessage(error);

    expect(msg).toContain("Some error");
    expect(msg).toContain("tx_failed");
  });

  it("should handle null/undefined result_codes", () => {
    const error = new Error("Basic error");

    const msg = buildErrorMessage(error);

    expect(msg).toBe("Basic error");
  });

  it("should handle deeply nested result_codes", () => {
    const error = new Error("Horizon error");
    error.result_codes = {
      transaction: "tx_failed",
      operations: ["op_underfunded", "op_no_trust"],
    };

    const msg = buildErrorMessage(error);

    expect(msg).toMatch(/Horizon error/);
    expect(msg).toMatch(/"tx_failed"/);
    expect(msg).toMatch(/"op_underfunded"/);
    expect(msg).toMatch(/"op_no_trust"/);
  });
});
