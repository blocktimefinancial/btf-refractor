/**
 * 1Money Network Blockchain Handler
 *
 * Implements the BlockchainHandler interface for 1Money Network by extending
 * the EVM handler. 1Money uses the same elliptic curve cryptography (secp256k1)
 * and address format as Ethereum, but has its own broadcast-based protocol
 * with unique transaction types (Payment, Cancellation, Recovery).
 *
 * Key characteristics:
 * - secp256k1 key format (0x-prefixed addresses, identical to Ethereum)
 * - ECDSA signatures with v/r/s components
 * - RLP-encoded payment fields → keccak256 for transaction hashing
 * - JSON-encoded transaction payloads (not hex RLP like standard EVM)
 * - Chain ID: 1212101
 * - Checkpoint-based finality (not block-based)
 * - No gas token — fees paid in transferred stablecoin
 *
 * @see https://developer.1moneynetwork.com/
 * @module business-logic/handlers/onemoney-handler
 */

const { keccak256 } = require("@ethersproject/keccak256");
const { recoverAddress } = require("@ethersproject/transactions");
const {
  arrayify,
  hexlify,
  hexZeroPad,
  isHexString,
} = require("@ethersproject/bytes");
const { encode: rlpEncode } = require("@ethersproject/rlp");
const { BigNumber } = require("@ethersproject/bignumber");
const { EvmHandler } = require("./evm-handler");
const { standardError } = require("../std-error");
const {
  getBlockchainConfig,
  getNetworkConfig,
} = require("../blockchain-registry");
const logger = require("../../utils/logger").forComponent("onemoney-handler");

/**
 * 1Money transaction types
 */
const ONEMONEY_TX_TYPES = {
  PAYMENT: "payment",
  CANCELLATION: "cancellation",
  RECOVERY: "recovery",
  TOKEN_CREATE: "token_create",
};

class OneMoneyHandler extends EvmHandler {
  constructor() {
    super("onemoney");
    this.config = getBlockchainConfig("onemoney");
  }

  /**
   * Parse a 1Money transaction from JSON or hex-encoded payload.
   *
   * 1Money transactions are JSON objects containing payment fields and an
   * optional signature. The canonical fields for a payment are:
   *   { chain_id, nonce, recipient, token, value, recent_checkpoint }
   *
   * @param {string|Object} payload - JSON string, parsed object, or hex-encoded RLP
   * @param {string} encoding - 'json' (default for 1Money) or 'hex'
   * @param {string} networkName - The network name (mainnet, testnet)
   * @returns {Object} Parsed 1Money transaction object
   */
  parseTransaction(payload, encoding, networkName) {
    let parsedTx;

    if (encoding === "json" || encoding === "application/json") {
      // JSON-encoded 1Money transaction (primary format)
      try {
        parsedTx =
          typeof payload === "string" ? JSON.parse(payload) : { ...payload };
      } catch (e) {
        logger.warn("Failed to parse 1Money JSON transaction", {
          error: e.message,
        });
        throw standardError(400, "Invalid 1Money transaction JSON");
      }
    } else if (encoding === "hex") {
      // Hex-encoded payload (RLP-encoded payment message)
      // Parse using parent EVM handler for RLP decoding
      try {
        return super.parseTransaction(payload, encoding, networkName);
      } catch (e) {
        logger.warn("Failed to parse 1Money hex transaction", {
          error: e.message,
        });
        throw standardError(400, "Invalid 1Money hex transaction data");
      }
    } else {
      throw standardError(
        400,
        `1Money supports 'json' or 'hex' encoding, got: ${encoding}`,
      );
    }

    // Validate required payment fields
    this._validatePaymentFields(parsedTx);

    // Normalize field names (API uses snake_case, internal uses camelCase)
    const normalized = this._normalizeTransaction(parsedTx);

    // Validate chain ID against network config
    const networkConfig = this.getNetworkConfig(networkName);
    if (normalized.chainId && networkConfig?.chainId) {
      if (normalized.chainId !== networkConfig.chainId) {
        logger.warn("1Money chain ID mismatch", {
          txChainId: normalized.chainId,
          expectedChainId: networkConfig.chainId,
        });
        throw standardError(
          400,
          `Transaction chain_id (${normalized.chainId}) does not match network ${networkName} (${networkConfig.chainId})`,
        );
      }
    }

    // Store the raw JSON payload for serialization
    normalized._rawPayload =
      typeof payload === "string" ? payload : JSON.stringify(payload);
    normalized._txType = this._inferTransactionType(parsedTx);

    return normalized;
  }

  /**
   * Compute the transaction hash for a 1Money transaction.
   *
   * 1Money uses RLP encoding of payment fields → keccak256, matching
   * the Ethereum signing primitives. Field order for RLP encoding:
   *   [recentCheckpoint, chainId, nonce, recipient, value, token]
   *
   * @param {Object} transaction - The parsed 1Money transaction
   * @returns {{ hash: string, hashRaw: Buffer }} Transaction hash
   */
  computeHash(transaction) {
    // If this came from hex/RLP parsing (standard EVM path), use parent
    if (transaction._isEvmParsed) {
      return super.computeHash(transaction);
    }

    // RLP encode the payment fields in canonical order
    // This matches the Go SDK: rlp.EncodeToBytes(PaymentMessage{...})
    const rlpFields = [
      this._toRlpUint(transaction.recentCheckpoint || 0),
      this._toRlpUint(transaction.chainId),
      this._toRlpUint(transaction.nonce),
      transaction.recipient?.toLowerCase() ||
        "0x0000000000000000000000000000000000000000",
      this._toRlpBigNumber(transaction.value),
      transaction.token?.toLowerCase() ||
        "0x0000000000000000000000000000000000000000",
    ];

    const encoded = rlpEncode(rlpFields);
    const hash = keccak256(encoded);
    const hashBuffer = Buffer.from(arrayify(hash));

    return {
      hash: hash.slice(2), // Remove 0x prefix
      hashRaw: hashBuffer,
    };
  }

  /**
   * Extract signature from a 1Money transaction.
   * 1Money signatures use the same v/r/s format as Ethereum ECDSA.
   *
   * @param {Object} transaction - The parsed transaction
   * @returns {Array<Object>} Array containing the signature (or empty if unsigned)
   */
  extractSignatures(transaction) {
    // Check for signature in 1Money JSON format
    const sig = transaction.signature;
    if (sig && sig.r && sig.s && sig.v !== undefined) {
      // Recover the signer address from the signature
      let from = transaction.from;
      if (!from) {
        try {
          from = this._recoverSigner(transaction);
        } catch (e) {
          logger.debug("Could not recover signer from 1Money signature", {
            error: e.message,
          });
        }
      }

      return [
        {
          v: typeof sig.v === "string" ? parseInt(sig.v, 10) : sig.v,
          r: this._normalizeSigComponent(sig.r),
          s: this._normalizeSigComponent(sig.s),
          from: from?.toLowerCase() || null,
        },
      ];
    }

    // Fall back to EVM-style v/r/s on the transaction itself
    if (transaction.v && transaction.r && transaction.s) {
      return super.extractSignatures(transaction);
    }

    return [];
  }

  /**
   * Clear signatures from a 1Money transaction.
   * @param {Object} transaction - The parsed transaction
   * @returns {Object} Transaction with signatures cleared
   */
  clearSignatures(transaction) {
    const unsigned = { ...transaction };
    delete unsigned.signature;
    delete unsigned.v;
    delete unsigned.r;
    delete unsigned.s;
    delete unsigned.from;
    delete unsigned.hash;
    return unsigned;
  }

  /**
   * Verify a 1Money signature by recovering the signer address.
   * Uses secp256k1 ECDSA recovery (identical to Ethereum).
   *
   * @param {string} address - The expected signer address (0x...)
   * @param {Object} signature - The signature { v, r, s }
   * @param {Buffer|string} _message - Unused (hash is recomputed from tx)
   * @returns {boolean} True if signature is valid for the address
   */
  verifySignature(address, signature, _message) {
    try {
      const { v, r, s } = signature;
      // Compute the hash that was signed
      const hash =
        _message instanceof Buffer ? hexlify(_message) : `0x${_message}`;

      const recoveredAddress = recoverAddress(hash, { v, r, s });
      return recoveredAddress.toLowerCase() === address.toLowerCase();
    } catch (e) {
      logger.debug("1Money signature verification failed", {
        address,
        error: e.message,
      });
      return false;
    }
  }

  /**
   * Serialize a 1Money transaction back to its encoded form.
   * @param {Object} transaction - The transaction to serialize
   * @param {string} encoding - 'json' (default) or 'hex'
   * @returns {string} Encoded transaction
   */
  serializeTransaction(transaction, encoding = "json") {
    if (encoding === "json" || encoding === "application/json") {
      // Reconstruct the JSON payload
      const output = {
        chain_id: transaction.chainId,
        nonce: transaction.nonce,
        recipient: transaction.recipient,
        token: transaction.token,
        value: String(transaction.value),
      };

      if (transaction.recentCheckpoint !== undefined) {
        output.recent_checkpoint = transaction.recentCheckpoint;
      }

      // Include signature if present
      if (transaction.signature) {
        output.signature = transaction.signature;
      } else if (transaction.v && transaction.r && transaction.s) {
        output.signature = {
          v: String(transaction.v),
          r: transaction.r,
          s: transaction.s,
        };
      }

      return JSON.stringify(output);
    }

    if (encoding === "hex") {
      return super.serializeTransaction(transaction, encoding);
    }

    throw standardError(400, `1Money supports 'json' or 'hex' encoding`);
  }

  /**
   * Get potential signers for a 1Money transaction.
   * 1Money uses single-signer model (the sender), same as EVM.
   *
   * @param {Object} transaction - The parsed transaction
   * @param {string} networkName - The network name
   * @returns {Promise<Array<string>>} List of potential signer addresses
   */
  async getPotentialSigners(transaction, networkName) {
    const signers = [];

    // If transaction has a 'from' or sender field
    if (transaction.from) {
      signers.push(transaction.from.toLowerCase());
    }

    // Try to recover from signature if present
    if (signers.length === 0 && transaction.signature) {
      try {
        const recovered = this._recoverSigner(transaction);
        if (recovered) {
          signers.push(recovered.toLowerCase());
        }
      } catch (e) {
        // Signature recovery failed, signers list remains empty
      }
    }

    return signers;
  }

  /**
   * Parse transaction parameters for storage in Refractor's database.
   * @param {Object} transaction - The parsed 1Money transaction
   * @param {Object} request - The original request
   * @returns {Object} Parsed parameters for storage
   */
  parseTransactionParams(transaction, request) {
    const { callbackUrl, submit, desiredSigners, expires = 0 } = request;
    const now = Math.floor(Date.now() / 1000);

    const payload =
      transaction._rawPayload || this.serializeTransaction(transaction, "json");

    const params = {
      blockchain: "onemoney",
      networkName: this.normalizeNetworkName(request.networkName),
      payload,
      encoding: "json",
      signatures: [],
    };

    // Add chain-specific metadata
    const networkConfig = this.getNetworkConfig(request.networkName);
    if (networkConfig?.chainId) {
      params.chainId = networkConfig.chainId;
    }

    if (transaction.nonce !== undefined) {
      params.nonce = transaction.nonce;
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

    // Parse desired signers (0x addresses)
    if (desiredSigners?.length) {
      if (!Array.isArray(desiredSigners)) {
        throw standardError(
          400,
          'Invalid "desiredSigners" parameter. Expected an array of 1Money addresses.',
        );
      }
      for (const addr of desiredSigners) {
        if (!this.isValidPublicKey(addr)) {
          throw standardError(
            400,
            `Invalid "desiredSigners" parameter. Address ${addr} is not a valid 1Money address.`,
          );
        }
      }
      params.desiredSigners = desiredSigners.map((a) => a.toLowerCase());
    }

    // Handle expiration
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
   * Get network configuration for 1Money.
   * @param {string} networkName - The network name
   * @returns {Object} Network configuration
   */
  getNetworkConfig(networkName) {
    const normalizedNetwork = this.normalizeNetworkName(networkName);
    return getNetworkConfig("onemoney", normalizedNetwork);
  }

  // ─── Private Helpers ───────────────────────────────────────────────

  /**
   * Validate required payment fields in a 1Money transaction.
   * @private
   */
  _validatePaymentFields(tx) {
    // At minimum, a payment needs: chain_id and nonce
    // recipient, token, value are needed for payments but not all tx types
    if (tx.chain_id === undefined && tx.chainId === undefined) {
      throw standardError(400, "1Money transaction missing 'chain_id'");
    }
    if (tx.nonce === undefined) {
      throw standardError(400, "1Money transaction missing 'nonce'");
    }
  }

  /**
   * Normalize a 1Money transaction from snake_case API format to internal format.
   * @private
   */
  _normalizeTransaction(tx) {
    return {
      chainId: tx.chain_id ?? tx.chainId,
      nonce: typeof tx.nonce === "string" ? parseInt(tx.nonce, 10) : tx.nonce,
      recipient: tx.recipient || tx.to,
      token: tx.token,
      value: tx.value?.toString() || "0",
      recentCheckpoint: tx.recent_checkpoint ?? tx.recentCheckpoint ?? 0,
      from: tx.from,
      signature: tx.signature || null,
      // Preserve any extra fields
      ...(tx.transaction_type && { transactionType: tx.transaction_type }),
    };
  }

  /**
   * Infer the 1Money transaction type from its fields.
   * @private
   */
  _inferTransactionType(tx) {
    if (tx.transaction_type) {
      return tx.transaction_type.toLowerCase();
    }
    if (tx.recipient || tx.to) {
      return ONEMONEY_TX_TYPES.PAYMENT;
    }
    return ONEMONEY_TX_TYPES.PAYMENT; // Default
  }

  /**
   * Recover the signer address from a signed 1Money transaction.
   * @private
   */
  _recoverSigner(transaction) {
    const sig = transaction.signature;
    if (!sig || !sig.r || !sig.s || sig.v === undefined) {
      return null;
    }

    // Compute the hash that was signed
    const { hash } = this.computeHash(transaction);
    const hashHex = hash.startsWith("0x") ? hash : `0x${hash}`;

    const v = typeof sig.v === "string" ? parseInt(sig.v, 10) : sig.v;
    // Standard EVM recovery: v should be 27 or 28; 1Money uses 0 or 1
    const normalizedV = v < 27 ? v + 27 : v;

    return recoverAddress(hashHex, {
      v: normalizedV,
      r: this._normalizeSigComponent(sig.r),
      s: this._normalizeSigComponent(sig.s),
    });
  }

  /**
   * Normalize a signature component (r or s) to hex format.
   * 1Money API returns r/s as decimal strings; ethers expects hex.
   * @private
   */
  _normalizeSigComponent(value) {
    if (!value) return "0x0";
    // Already hex
    if (typeof value === "string" && value.startsWith("0x")) {
      return value;
    }
    // Decimal string (1Money REST API format)
    try {
      return BigNumber.from(value).toHexString();
    } catch (e) {
      // Could be raw hex without prefix
      if (/^[a-fA-F0-9]+$/.test(value)) {
        return `0x${value}`;
      }
      throw new Error(`Invalid signature component: ${value}`);
    }
  }

  /**
   * Convert a uint value to RLP-compatible hex string.
   * @private
   */
  _toRlpUint(value) {
    if (value === 0 || value === "0") return "0x";
    const bn = BigNumber.from(value);
    // Strip leading zeros for canonical RLP encoding
    return bn.toHexString();
  }

  /**
   * Convert a BigNumber/string value to RLP-compatible hex.
   * @private
   */
  _toRlpBigNumber(value) {
    if (!value || value === "0") return "0x";
    const bn = BigNumber.from(value);
    return bn.toHexString();
  }
}

// Export singleton instance
module.exports = new OneMoneyHandler();
