/**
 * Transaction Model
 *
 * Represents a multi-signature transaction that can be stored, signed, and submitted.
 * Supports multiple blockchains through the blockchain-agnostic fields.
 */
class TxModel {
  // ============================================================================
  // Core Identification
  // ============================================================================

  /**
   * Transaction hash (SHA-256 or blockchain-specific).
   * @type {String}
   */
  hash;

  // ============================================================================
  // Blockchain-Agnostic Fields (new)
  // ============================================================================

  /**
   * Blockchain identifier (e.g., 'stellar', 'ethereum', 'solana').
   * Defaults to 'stellar' for backward compatibility.
   * @type {String}
   */
  blockchain = "stellar";

  /**
   * Network name (e.g., 'public', 'testnet', 'mainnet', 'sepolia').
   * @type {String|null}
   */
  networkName = null;

  /**
   * Full transaction URI in tx: or blockchain:// format.
   * @type {String|null}
   */
  txUri = null;

  /**
   * Encoded transaction payload (format depends on blockchain).
   * @type {String|null}
   */
  payload = null;

  /**
   * Payload encoding format (base64, hex, base58, msgpack, base32).
   * @type {String}
   */
  encoding = "base64";

  /**
   * JSON representation of the transaction for human readability.
   * Can be a JSON string or an object (will be stringified for storage).
   * @type {String|Object|null}
   */
  txJson = null;

  // ============================================================================
  // Originator (Transaction Creator Attestation)
  // ============================================================================

  /**
   * Public key or address of the transaction originator.
   * Format depends on blockchain (e.g., G... for Stellar, 0x... for EVM).
   * The originator signs the transaction hash to prove authorship.
   * @type {String|null}
   */
  originator = null;

  /**
   * Signature of the transaction hash by the originator.
   * Allows signers to verify that the transaction was created by a trusted party.
   * @type {String|null}
   */
  originatorSignature = null;

  // ============================================================================
  // Legacy Stellar Fields (kept for backward compatibility)
  // ============================================================================

  /**
   * Legacy: Network identifier (0=pubnet, 1=testnet, 2=futurenet).
   * Only used for Stellar transactions.
   * @type {Number|null}
   */
  network = null;

  /**
   * Legacy: Transaction XDR without signatures (base64-encoded).
   * Only used for Stellar transactions.
   * @type {String|null}
   */
  xdr = null;

  // ============================================================================
  // Signatures
  // ============================================================================

  /**
   * Applied transaction signatures.
   * @type {TxSignature[]}
   */
  signatures = [];

  // ============================================================================
  // Submission Options
  // ============================================================================

  /**
   * Submit transaction to the network once signed.
   * @type {Boolean}
   */
  submit = false;

  /**
   * Callback URL where the transaction will be sent once signed/submitted.
   * @type {String|null}
   */
  callbackUrl = null;

  // ============================================================================
  // Signer Management
  // ============================================================================

  /**
   * List of signers requested by the transaction author.
   * Format depends on blockchain (e.g., G... for Stellar, 0x... for Ethereum).
   * @type {String[]}
   */
  desiredSigners = [];

  // ============================================================================
  // Timing
  // ============================================================================

  /**
   * Point in time when a transaction becomes valid (UNIX timestamp).
   * Populated from transaction timebounds.
   * @type {Number}
   */
  minTime = 0;

  /**
   * Transaction expiration date (UNIX timestamp).
   * @type {Number|null}
   */
  maxTime = null;

  // ============================================================================
  // Status Tracking
  // ============================================================================

  /**
   * Current transaction status.
   * @type {TxStatus}
   */
  status = "pending";

  /**
   * Submitted transaction timestamp (UNIX timestamp).
   * Set when the transaction is submitted to the network.
   * @type {Number|null}
   */
  submitted = null;

  /**
   * Number of processing retry attempts.
   * @type {Number}
   */
  retryCount = 0;

  /**
   * Last error message if processing failed.
   * @type {String|null}
   */
  lastError = null;

  // ============================================================================
  // Timestamps
  // ============================================================================

  /**
   * Record creation timestamp.
   * @type {Date}
   */
  createdAt = null;

  /**
   * Record last update timestamp.
   * @type {Date}
   */
  updatedAt = null;

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Check if this is a legacy Stellar transaction.
   * @returns {Boolean}
   */
  isLegacyStellar() {
    return this.xdr !== null && this.network !== null;
  }

  /**
   * Get the effective payload (xdr for legacy, payload for new).
   * @returns {String|null}
   */
  getPayload() {
    return this.payload || this.xdr;
  }

  /**
   * Get the effective network name.
   * @returns {String|null}
   */
  getNetworkName() {
    if (this.networkName) return this.networkName;
    if (this.network !== null) {
      const networkMap = { 0: "public", 1: "testnet", 2: "futurenet" };
      return networkMap[this.network] || null;
    }
    return null;
  }
}

module.exports = TxModel;

/**
 * @typedef {'pending'|'ready'|'processing'|'processed'|'failed'} TxStatus
 */

/**
 * @typedef {Object} TxSignature
 * @property {String} key - Public key or address
 * @property {String} signature - Encoded signature
 */
