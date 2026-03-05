class DataProvider {
  async init() {}

  /**
   * Close database connections and release resources.
   * Subclasses should override if they hold open connections.
   * @returns {Promise<void>}
   */
  async close() {}

  /**
   * Store transaction.
   * @param {TxModel} txModel
   * @returns {Promise}
   */
  async saveTransaction(txModel) {
    throw new Error("Not implemented");
  }

  /**
   *
   * @param {String} hash
   * @return {Promise<TxModel>}
   */
  async findTransaction(hash) {
    throw new Error("Not implemented");
  }

  /**
   * Get transactions iterator filtered by
   * @param {Object} filter
   * @param {Object} [options]
   * @param {number} [options.limit] - Maximum number of results
   * @return {TxModelsCursor}
   */
  listTransactions(filter, options) {
    throw new Error("Not implemented");
  }

  /**
   *
   * @param {String} hash
   * @param {Object} update
   * @param {TxStatus} [expectedCurrentStatus]
   * @return {Promise<Boolean>}
   */
  async updateTransaction(hash, update, expectedCurrentStatus = undefined) {
    throw new Error("Not implemented");
  }

  /**
   *
   * @param {String} hash
   * @param {TxStatus} newStatus
   * @param {TxStatus} expectedCurrentStatus?
   * @param {Error|String} error?
   * @return {Promise<Boolean>}
   */
  async updateTxStatus(
    hash,
    newStatus,
    expectedCurrentStatus = undefined,
    error = null,
  ) {
    const update = {
      status: newStatus,
      updatedAt: new Date(),
    };
    if (error) {
      update.lastError = (error.message || error).toString();
    }
    return this.updateTransaction(hash, update, expectedCurrentStatus);
  }
}

module.exports = DataProvider;

/**
 * @callback TxModelsCursor
 * @async
 * @generator
 * @yields {TxModel}
 */
