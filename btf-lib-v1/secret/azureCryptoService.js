/**
 * azureCryptoService stub — btf-lib-v1/secret/azureCryptoService
 *
 * Provides the expected interface for direct HSM signing (Tier 1).
 * All methods throw until the real library is linked.
 */

const NOT_CONFIGURED =
  "btf-lib-v1 stub: azureCryptoService is not configured. " +
  "Replace btf-lib-v1/ with the real library via npm link or git submodule.";

function notConfigured(method) {
  return async function () {
    throw new Error(`${NOT_CONFIGURED} (called: ${method})`);
  };
}

module.exports = {
  signStellarTransaction: notConfigured("signStellarTransaction"),
  signEvmTransaction: notConfigured("signEvmTransaction"),
  signAlgorandTransaction: notConfigured("signAlgorandTransaction"),
  signSolanaTransaction: notConfigured("signSolanaTransaction"),
};
