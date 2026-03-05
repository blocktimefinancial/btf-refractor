/**
 * EVM Blockchain Handler
 *
 * Implements the BlockchainHandler interface for Ethereum and EVM-compatible chains.
 * Handles EVM-specific transaction parsing, signing, and verification.
 *
 * Supports:
 * - Ethereum (mainnet, sepolia, goerli, holesky)
 * - Polygon (mainnet, amoy)
 * - Arbitrum (mainnet, sepolia)
 * - Optimism (mainnet, sepolia)
 * - Base (mainnet, sepolia)
 * - Avalanche C-Chain (mainnet, fuji)
 *
 * @module business-logic/handlers/evm-handler
 */

const { keccak256 } = require("@ethersproject/keccak256");
const { recoverAddress } = require("@ethersproject/transactions");
const { arrayify, hexlify } = require("@ethersproject/bytes");
const {
  parse: parseTransaction,
  serialize: serializeTransaction,
} = require("@ethersproject/transactions");
const { computeAddress } = require("@ethersproject/transactions");
const BlockchainHandler = require("./blockchain-handler");
const { standardError } = require("../std-error");
const {
  getBlockchainConfig,
  getNetworkConfig,
} = require("../blockchain-registry");
const logger = require("../../utils/logger").forComponent("evm-handler");

/**
 * List of EVM-compatible blockchain identifiers
 */
const EVM_BLOCKCHAINS = [
  "ethereum",
  "polygon",
  "arbitrum",
  "optimism",
  "base",
  "avalanche",
  "onemoney",
];

/**
 * Check if a blockchain is EVM-compatible
 * @param {string} blockchain - Blockchain identifier
 * @returns {boolean} True if EVM-compatible
 */
function isEvmBlockchain(blockchain) {
  return EVM_BLOCKCHAINS.includes(blockchain.toLowerCase());
}

class EvmHandler extends BlockchainHandler {
  /**
   * @param {string} blockchain - The specific EVM blockchain (ethereum, polygon, etc.)
   */
  constructor(blockchain = "ethereum") {
    super(blockchain);
    this.config = getBlockchainConfig(blockchain);
    if (!this.config) {
      throw new Error(`Unknown EVM blockchain: ${blockchain}`);
    }
  }

  /**
   * Parse an EVM transaction from hex-encoded RLP
   * @param {string} payload - The hex-encoded transaction (with or without 0x prefix)
   * @param {string} encoding - The encoding format (only hex supported for EVM)
   * @param {string} networkName - The network name
   * @returns {Object} Parsed EVM transaction object
   */
  parseTransaction(payload, encoding, networkName) {
    if (encoding !== "hex") {
      throw standardError(
        400,
        `EVM chains only support hex encoding, got: ${encoding}`,
      );
    }

    // Normalize hex string
    const normalizedPayload = payload.startsWith("0x")
      ? payload
      : `0x${payload}`;

    let parsedTx;
    try {
      parsedTx = parseTransaction(normalizedPayload);
    } catch (e) {
      logger.warn("Failed to parse EVM transaction", { error: e.message });
      throw standardError(400, "Invalid EVM transaction data");
    }

    // Validate chain ID if present
    const networkConfig = this.getNetworkConfig(networkName);
    if (parsedTx.chainId && networkConfig?.chainId) {
      if (parsedTx.chainId !== networkConfig.chainId) {
        logger.warn("Chain ID mismatch", {
          txChainId: parsedTx.chainId,
          expectedChainId: networkConfig.chainId,
        });
        throw standardError(
          400,
          `Transaction chain ID (${parsedTx.chainId}) does not match network ${networkName} (${networkConfig.chainId})`,
        );
      }
    }

    // Store raw payload for serialization
    parsedTx._rawPayload = normalizedPayload;

    return parsedTx;
  }

  /**
   * Compute the transaction hash
   * @param {Object} transaction - The parsed EVM transaction
   * @returns {{ hash: string, hashRaw: Buffer }} Transaction hash
   */
  computeHash(transaction) {
    // For unsigned transactions, we hash the serialized transaction
    // For signed transactions, the hash includes the signature
    let serialized;

    if (transaction.v && transaction.r && transaction.s) {
      // Signed transaction - use raw payload or serialize
      serialized =
        transaction._rawPayload ||
        serializeTransaction(transaction, {
          r: transaction.r,
          s: transaction.s,
          v: transaction.v,
        });
    } else {
      // Unsigned transaction - serialize without signature
      serialized = serializeTransaction({
        to: transaction.to,
        nonce: transaction.nonce,
        gasLimit: transaction.gasLimit,
        gasPrice: transaction.gasPrice,
        maxFeePerGas: transaction.maxFeePerGas,
        maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
        data: transaction.data,
        value: transaction.value,
        chainId: transaction.chainId,
        type: transaction.type,
        accessList: transaction.accessList,
      });
    }

    const hash = keccak256(serialized);
    const hashBuffer = Buffer.from(arrayify(hash));

    return {
      hash: hash.slice(2), // Remove 0x prefix for consistency
      hashRaw: hashBuffer,
    };
  }

  /**
   * Extract signature from an EVM transaction
   * @param {Object} transaction - The parsed EVM transaction
   * @returns {Array<Object>} Array containing the signature (or empty if unsigned)
   */
  extractSignatures(transaction) {
    if (!transaction.v || !transaction.r || !transaction.s) {
      return [];
    }

    return [
      {
        v: transaction.v,
        r: transaction.r,
        s: transaction.s,
        from: transaction.from,
      },
    ];
  }

  /**
   * Clear signatures from a transaction
   * @param {Object} transaction - The parsed EVM transaction
   * @returns {Object} Transaction with signatures cleared
   */
  clearSignatures(transaction) {
    const unsigned = { ...transaction };
    delete unsigned.v;
    delete unsigned.r;
    delete unsigned.s;
    delete unsigned.from;
    delete unsigned.hash;
    return unsigned;
  }

  /**
   * Verify a signature against an EVM address
   * Note: EVM uses address-based verification, not public key
   * @param {string} address - The Ethereum address (0x...)
   * @param {Object} signature - The signature object with v, r, s
   * @param {string} serializedUnsignedTx - The serialized unsigned transaction
   * @returns {boolean} True if signature is valid
   */
  verifySignature(address, signature, serializedUnsignedTx) {
    try {
      const { v, r, s } = signature;

      // Reconstruct the signed transaction to recover the signer
      const signedTx = serializeTransaction(
        parseTransaction(serializedUnsignedTx),
        { v, r, s },
      );

      // Recover the address from the signature
      const recoveredAddress = recoverAddress(keccak256(serializedUnsignedTx), {
        v,
        r,
        s,
      });

      return recoveredAddress.toLowerCase() === address.toLowerCase();
    } catch (e) {
      logger.debug("EVM signature verification failed", {
        address,
        error: e.message,
      });
      return false;
    }
  }

  /**
   * Verify signature using signed transaction data
   * @param {Object} signedTx - The signed transaction with v, r, s
   * @param {string} expectedAddress - Expected signer address
   * @returns {boolean} True if the recovered signer matches
   */
  verifySignedTransaction(signedTx, expectedAddress) {
    try {
      if (!signedTx.v || !signedTx.r || !signedTx.s) {
        return false;
      }

      // Transaction.from is populated by ethers when parsing a signed tx
      if (signedTx.from) {
        return signedTx.from.toLowerCase() === expectedAddress.toLowerCase();
      }

      return false;
    } catch (e) {
      logger.debug("EVM signed transaction verification failed", {
        expectedAddress,
        error: e.message,
      });
      return false;
    }
  }

  /**
   * Add a signature to an EVM transaction
   * Note: EVM transactions can only have one signature (the sender)
   * @param {Object} transaction - The parsed transaction
   * @param {string} address - The signer's address
   * @param {Object} signature - The signature object with v, r, s
   * @returns {Object} Transaction with signature added
   */
  addSignature(transaction, address, signature) {
    const { v, r, s } = signature;

    return {
      ...transaction,
      v,
      r,
      s,
      from: address,
    };
  }

  /**
   * Serialize an EVM transaction back to hex
   * @param {Object} transaction - The transaction to serialize
   * @param {string} encoding - The encoding format (only hex)
   * @returns {string} Hex-encoded transaction
   */
  serializeTransaction(transaction, encoding = "hex") {
    if (encoding !== "hex") {
      throw standardError(400, `EVM only supports hex encoding`);
    }

    let serialized;
    if (transaction.v && transaction.r && transaction.s) {
      // Signed transaction
      serialized = serializeTransaction(transaction, {
        v: transaction.v,
        r: transaction.r,
        s: transaction.s,
      });
    } else {
      // Unsigned transaction
      serialized = serializeTransaction({
        to: transaction.to,
        nonce: transaction.nonce,
        gasLimit: transaction.gasLimit,
        gasPrice: transaction.gasPrice,
        maxFeePerGas: transaction.maxFeePerGas,
        maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
        data: transaction.data,
        value: transaction.value,
        chainId: transaction.chainId,
        type: transaction.type,
        accessList: transaction.accessList,
      });
    }

    // Return without 0x prefix for consistency
    return serialized.startsWith("0x") ? serialized.slice(2) : serialized;
  }

  /**
   * Get potential signers for an EVM transaction
   * For EVM, this is simply the 'from' address if present
   * @param {Object} transaction - The parsed transaction
   * @param {string} networkName - The network name
   * @returns {Promise<Array<string>>} List of potential signer addresses
   */
  async getPotentialSigners(transaction, networkName) {
    const signers = [];

    // If transaction has a 'from' field, that's the expected signer
    if (transaction.from) {
      signers.push(transaction.from.toLowerCase());
    }

    // For contract interactions, the sender is always the signer
    // EVM doesn't have multi-sig at the protocol level (only via contracts)
    return signers;
  }

  /**
   * Check if all required signatures are present
   * EVM transactions require exactly one signature (the sender)
   * @param {Object} transaction - The parsed transaction
   * @param {Array<string>} signerKeys - The addresses that have signed
   * @returns {Promise<boolean>} True if transaction is fully signed
   */
  async isFullySigned(transaction, signerKeys) {
    // EVM transactions need exactly one signature
    if (!transaction.v || !transaction.r || !transaction.s) {
      return false;
    }

    // If we have v, r, s then the transaction is signed
    return true;
  }

  /**
   * Match a signature to find the corresponding signer
   * For EVM, we recover the address from the signature
   * @param {Object} signedTx - The signed transaction
   * @param {Array<string>} potentialSigners - List of potential signer addresses
   * @returns {{ key: string|null, signature: Object }} Match result
   */
  matchSignatureToSigner(signedTx, potentialSigners) {
    if (!signedTx.v || !signedTx.r || !signedTx.s) {
      return { key: null, signature: null };
    }

    const signature = {
      v: signedTx.v,
      r: signedTx.r,
      s: signedTx.s,
    };

    // The 'from' address is recovered when parsing a signed transaction
    const recoveredAddress = signedTx.from?.toLowerCase();

    if (recoveredAddress) {
      // Check if recovered address is in potential signers
      const matchedKey = potentialSigners.find(
        (addr) => addr.toLowerCase() === recoveredAddress,
      );

      return {
        key: matchedKey || recoveredAddress,
        signature: {
          v: signedTx.v,
          r: signedTx.r,
          s: signedTx.s,
        },
      };
    }

    return { key: null, signature };
  }

  /**
   * Get network configuration for this EVM chain
   * @param {string} networkName - The network name
   * @returns {Object} Network configuration
   */
  getNetworkConfig(networkName) {
    const normalizedNetwork = this.normalizeNetworkName(networkName);
    return getNetworkConfig(this.blockchain, normalizedNetwork);
  }

  /**
   * Get chain ID for a network
   * @param {string} networkName - The network name
   * @returns {number|null} Chain ID or null if not found
   */
  getChainId(networkName) {
    const config = this.getNetworkConfig(networkName);
    return config?.chainId || null;
  }

  /**
   * Normalize network name to canonical form
   * @param {string} networkName - The network name
   * @returns {string} Normalized network name
   */
  normalizeNetworkName(networkName) {
    if (!networkName) return "mainnet";
    return String(networkName).toLowerCase();
  }

  /**
   * Validate an EVM address format
   * @param {string} address - The address to validate
   * @returns {boolean} True if valid EVM address
   */
  isValidPublicKey(address) {
    if (!address || typeof address !== "string") {
      return false;
    }

    // Must be 0x followed by 40 hex characters
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  }

  /**
   * Parse transaction parameters for storage
   * @param {Object} transaction - The EVM transaction
   * @param {Object} request - The original request
   * @returns {Object} Parsed parameters
   */
  parseTransactionParams(transaction, request) {
    const { callbackUrl, submit, desiredSigners, expires = 0 } = request;
    const now = Math.floor(Date.now() / 1000);

    const payload = this.serializeTransaction(transaction);

    const params = {
      blockchain: this.blockchain,
      networkName: this.normalizeNetworkName(request.networkName),
      payload: payload,
      encoding: "hex",
      signatures: [],
    };

    // Add chain-specific data
    const networkConfig = this.getNetworkConfig(request.networkName);
    if (networkConfig?.chainId) {
      params.chainId = networkConfig.chainId;
    }

    // Parse callback URL
    if (callbackUrl) {
      if (
        !/^http(s)?:\/\/[-a-zA-Z0-9_+.]{2,256}\.[a-z]{2,4}\b(\/[-a-zA-Z0-9@:%_+.~#?&/=]*)?$/m.test(
          callbackUrl,
        )
      ) {
        throw standardError(
          400,
          'Invalid URL supplied in "callbackUrl" parameter.',
        );
      }
      params.callbackUrl = callbackUrl;
    }

    // Parse desired signers (EVM addresses)
    if (desiredSigners?.length) {
      if (!Array.isArray(desiredSigners)) {
        throw standardError(
          400,
          'Invalid "desiredSigners" parameter. Expected an array of EVM addresses.',
        );
      }
      for (const addr of desiredSigners) {
        if (!this.isValidPublicKey(addr)) {
          throw standardError(
            400,
            `Invalid "desiredSigners" parameter. Address ${addr} is not a valid EVM address.`,
          );
        }
      }
      params.desiredSigners = desiredSigners.map((a) => a.toLowerCase());
    }

    // For EVM, we might use nonce expiration or rely on external expiration
    // Set maxTime from request expires parameter
    if (expires) {
      if (expires > 2147483647 || expires < 0) {
        throw standardError(
          400,
          `Invalid "expires" parameter. ${expires} is not a valid UNIX date.`,
        );
      }
      if (expires < now) {
        throw standardError(
          400,
          `Invalid "expires" parameter. ${expires} date has already passed.`,
        );
      }
      params.maxTime = expires;
    }

    // Submit flag
    if (submit === true) {
      params.submit = true;
    }

    // Extract from address if present
    if (transaction.from) {
      params.from = transaction.from.toLowerCase();
    }

    return params;
  }

  /**
   * Get transaction type name
   * @param {Object} transaction - The EVM transaction
   * @returns {string} Transaction type description
   */
  getTransactionType(transaction) {
    switch (transaction.type) {
      case 0:
        return "Legacy";
      case 1:
        return "EIP-2930 (Access List)";
      case 2:
        return "EIP-1559 (Dynamic Fee)";
      default:
        return "Unknown";
    }
  }
}

/**
 * Factory function to create EVM handler for a specific blockchain
 * @param {string} blockchain - The blockchain identifier
 * @returns {EvmHandler} Handler instance
 */
function createEvmHandler(blockchain) {
  return new EvmHandler(blockchain);
}

// Export class and factory
module.exports = {
  EvmHandler,
  createEvmHandler,
  isEvmBlockchain,
  EVM_BLOCKCHAINS,
};
