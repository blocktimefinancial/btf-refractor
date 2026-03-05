import { TransactionBuilder, StrKey, Horizon } from "@stellar/stellar-sdk";
import { inspectTransactionSigners } from "@stellar-expert/tx-signers-inspector";
import config from "../app.config.json";
import { apiCall } from "./api";

const { networks, blockchains, defaultBlockchain } = config;

/**
 * Build a transaction URI from components
 * @param {string} blockchain - Blockchain identifier
 * @param {string} networkName - Network name
 * @param {string} payload - Encoded payload
 * @param {string} encoding - Payload encoding
 * @returns {string} Transaction URI
 */
export function buildTxUri(blockchain, networkName, payload, encoding) {
  return `tx:${blockchain}:${networkName};${encoding},${payload}`;
}

/**
 * Parse a transaction URI into components
 * @param {string} uri - Transaction URI
 * @returns {Object} Parsed components
 */
export function parseTxUri(uri) {
  if (!uri || !uri.startsWith("tx:")) {
    return null;
  }

  // Parse tx:<blockchain>[:<network>];<encoding>,<payload>
  const withoutPrefix = uri.slice(3); // Remove 'tx:'
  const [blockchainPart, rest] = withoutPrefix.split(";");
  if (!rest) return null;

  const [encoding, ...payloadParts] = rest.split(",");
  const payload = payloadParts.join(","); // Rejoin in case payload contains commas

  const blockchainParts = blockchainPart.split(":");
  const blockchain = blockchainParts[0];
  const networkName = blockchainParts[1] || getDefaultNetwork(blockchain);

  return { blockchain, networkName, payload, encoding };
}

/**
 * Get default network for a blockchain
 * @param {string} blockchain - Blockchain identifier
 * @returns {string} Default network name
 */
function getDefaultNetwork(blockchain) {
  const config = blockchains[blockchain];
  if (!config) return "mainnet";
  return config.networks[0] || "mainnet";
}

/**
 * Check if a blockchain supports signing in the UI
 * @param {string} blockchain - Blockchain identifier
 * @returns {boolean}
 */
export function isSigningSupported(blockchain) {
  const config = blockchains[blockchain];
  return config?.signingSupported === true;
}

/**
 * Get blockchain display name
 * @param {string} blockchain - Blockchain identifier
 * @returns {string}
 */
export function getBlockchainName(blockchain) {
  return blockchains[blockchain]?.name || blockchain;
}

/**
 * Validate transaction data for Stellar blockchain
 * @param {Object} data - Transaction data
 * @returns {Object} Validated data
 */
function validateStellarTx(data) {
  const networkParams = networks[data.networkName || data.network];
  if (!networkParams) throw new Error("Invalid network");

  const payload = data.payload || data.xdr;
  try {
    TransactionBuilder.fromXDR(payload, networkParams.passphrase);
  } catch (e) {
    throw new Error("Invalid transaction XDR");
  }
}

/**
 * Validate and prepare transaction data for submission
 * Supports both legacy format (network/xdr) and new format (blockchain/networkName/payload)
 * @param {Object} data - Transaction data
 * @returns {Object} Validated request data
 */
export async function validateNewTx(data) {
  // Determine format and normalize
  const isNewFormat = data.blockchain || data.txUri || data.payload;

  let res = {};

  if (isNewFormat) {
    // New blockchain-agnostic format
    const blockchain = data.blockchain || defaultBlockchain;
    const networkName = data.networkName || getDefaultNetwork(blockchain);
    const payload = data.payload || data.xdr;
    const encoding =
      data.encoding || blockchains[blockchain]?.defaultEncoding || "base64";

    // Validate blockchain
    if (!blockchains[blockchain]) {
      throw new Error(`Unsupported blockchain: ${blockchain}`);
    }

    // Build txUri if not provided
    const txUri =
      data.txUri || buildTxUri(blockchain, networkName, payload, encoding);

    res = {
      txUri,
      blockchain,
      networkName,
      payload,
      encoding,
    };

    // Blockchain-specific validation
    if (blockchain === "stellar") {
      validateStellarTx({ networkName, payload });
    }
    // Other blockchains: basic validation only (payload exists)
    else if (!payload) {
      throw new Error("Transaction payload is required");
    }
  } else {
    // Legacy Stellar format
    res = {
      network: data.network,
      xdr: data.xdr,
    };

    const networkParams = networks[data.network];
    if (!networkParams) throw new Error("Invalid network");

    try {
      TransactionBuilder.fromXDR(data.xdr, networkParams.passphrase);
    } catch (e) {
      throw new Error("Invalid transaction xdr");
    }
  }

  // Common fields
  if (data.submit === true) {
    res.submit = true;
  }

  if (data.callback) {
    if (
      !/^http(s)?:\/\/[-a-zA-Z0-9_+.]{2,256}\.[a-z]{2,4}\b(\/[-a-zA-Z0-9@:%_+.~#?&/=]*)?$/.test(
        data.callback
      )
    )
      throw new Error("Invalid callback URL");
    res.callbackUrl = data.callback;
  }

  if (data.expires) {
    let expires;
    if (data.expires.toString().match(/^\d+$/)) {
      expires = parseInt(data.expires, 10);
      if (expires < 0 || expires > 2147483648)
        throw new Error("Invalid expiration date - UNIX timestamp expected");
      res.expires = data.expires;
    } else {
      const ts = Date.parse(data.expires);
      if (isNaN(ts))
        throw new Error("Invalid expiration date - unknown data format");
      res.expires = (ts / 1000) >> 0;
    }
    if (res.expires < new Date().getTime() / 1000)
      throw new Error(
        "Invalid expiration date - only dates in the future allowed"
      );
  }

  if (data.desiredSigners?.length) {
    const nonEmptySigners = data.desiredSigners.filter((s) => !!s);
    // Only validate Stellar keys for Stellar blockchain
    const blockchain =
      data.blockchain || (data.network ? "stellar" : defaultBlockchain);
    if (blockchain === "stellar") {
      for (const signer of nonEmptySigners) {
        if (!StrKey.isValidEd25519PublicKey(signer))
          throw new Error("Invalid signer public key - " + signer);
      }
    }
    res.desiredSigners = nonEmptySigners;
  }

  // Originator attestation (optional)
  if (data.originator) {
    // Validate originator key format based on blockchain
    const blockchain =
      data.blockchain || (data.network ? "stellar" : defaultBlockchain);
    if (blockchain === "stellar" || blockchain === "onemoney") {
      if (!StrKey.isValidEd25519PublicKey(data.originator)) {
        throw new Error("Invalid originator public key");
      }
    } else if (
      [
        "ethereum",
        "polygon",
        "arbitrum",
        "optimism",
        "base",
        "avalanche",
      ].includes(blockchain)
    ) {
      if (!/^0x[a-fA-F0-9]{40}$/.test(data.originator)) {
        throw new Error("Invalid originator address");
      }
    }
    res.originator = data.originator;

    // Include signature if provided
    if (data.originatorSignature) {
      res.originatorSignature = data.originatorSignature;
    }
  }

  return res;
}

export async function apiSubmitTx(data) {
  //validate and prepare the data
  const parsedData = await validateNewTx(data);
  //submit to the server
  const txInfo = await apiCall("tx", parsedData, { method: "POST" });
  return await prepareTxInfo(txInfo);
}

export async function loadTx(txhash) {
  if (typeof txhash !== "string" || !/^[a-f0-9]{64}$/i.test(txhash))
    throw new Error(`Invalid transaction hash: ${txhash || "(empty)"}`);
  //load from the server
  let txInfo = await apiCall("tx/" + txhash);
  if (txInfo.status === "ready" || txInfo.status === "processed") {
    txInfo = await checkTxSubmitted(txInfo);
  }
  return await prepareTxInfo(txInfo);
}

/**
 * Check if a transaction has been submitted to the network (Stellar only)
 * @param {Object} txInfo - Transaction info
 * @returns {Object} Updated transaction info
 */
export async function checkTxSubmitted(txInfo) {
  // Only check Horizon for Stellar transactions
  const blockchain = txInfo.blockchain || "stellar";
  if (blockchain !== "stellar") {
    return txInfo;
  }

  try {
    const networkName = txInfo.networkName || txInfo.network;
    const networkConfig = networks[networkName];
    if (!networkConfig) {
      return txInfo;
    }
    const server = new Horizon.Server(networkConfig.horizon);
    const { created_at, successful } = await server
      .transactions()
      .transaction(txInfo.hash)
      .call();
    txInfo.submitted = new Date(created_at);
    txInfo.status = successful ? "processed" : "failed";
  } catch (e) {
    // Transaction not found on network, ignore
  }
  return txInfo;
}

/**
 * Prepare transaction info with signer schema (Stellar) or basic info (other chains)
 * @param {Object} txInfo - Raw transaction info from API
 * @returns {Object} Enhanced transaction info
 */
async function prepareTxInfo(txInfo) {
  // Normalize blockchain field
  txInfo.blockchain = txInfo.blockchain || "stellar";
  txInfo.networkName = txInfo.networkName || txInfo.network;

  // For Stellar, do full signer discovery
  if (txInfo.blockchain === "stellar") {
    const networkConfig = networks[txInfo.networkName || txInfo.network];
    if (!networkConfig) {
      throw new Error(
        `Unknown network: ${txInfo.networkName || txInfo.network}`
      );
    }
    const { passphrase, horizon } = networkConfig;
    const xdr = txInfo.payload || txInfo.xdr;
    const tx = TransactionBuilder.fromXDR(xdr, passphrase);

    // Discover signers and check whether it is fully signed
    const schema = await inspectTransactionSigners(tx, { horizon });
    txInfo.schema = schema;
    txInfo.readyToSubmit = schema.checkFeasibility(
      txInfo.signatures.map((sig) => sig.key)
    );
  } else {
    // For other blockchains, we don't have signer discovery yet
    txInfo.schema = null;
    txInfo.readyToSubmit = false; // Can't determine without chain-specific logic
  }

  return txInfo;
}
