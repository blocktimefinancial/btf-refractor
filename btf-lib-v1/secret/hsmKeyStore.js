/**
 * hsmKeyStore stub — btf-lib-v1/secret/hsmKeyStore
 *
 * Provides the expected interface so require() resolves, but every
 * method throws an error indicating that the real library must be
 * configured. Unit tests inject mocks via HsmSigningAdapter's
 * constructor; this stub only exists so the lazy loader doesn't
 * return null in integration environments before final setup.
 *
 * Replace this file with the real hsmKeyStore module:
 *   npm link btf-lib-v1   OR   git submodule update
 */

const NOT_CONFIGURED =
  "btf-lib-v1 stub: hsmKeyStore is not configured. " +
  "Replace btf-lib-v1/ with the real library via npm link or git submodule.";

function notConfigured(method) {
  return async function () {
    throw new Error(`${NOT_CONFIGURED} (called: ${method})`);
  };
}

module.exports = {
  // Stellar (ed25519)
  signStellarTransaction: notConfigured("signStellarTransaction"),
  createStellarKey: notConfigured("createStellarKey"),

  // Algorand (ed25519)
  signAlgorandTransaction: notConfigured("signAlgorandTransaction"),
  signAlgorandData: notConfigured("signAlgorandData"),
  createAlgorandKey: notConfigured("createAlgorandKey"),

  // Solana (ed25519)
  signSolanaTransaction: notConfigured("signSolanaTransaction"),
  createSolanaKey: notConfigured("createSolanaKey"),

  // EVM / secp256k1 (Ethereum, Polygon, Arbitrum, Optimism, Base, Avalanche, 1Money)
  signEthereumTransaction: notConfigured("signEthereumTransaction"),
  createEthereumKey: notConfigured("createEthereumKey"),

  // Health
  healthCheck: notConfigured("healthCheck"),
};
