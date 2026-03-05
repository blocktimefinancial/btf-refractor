const mongoose = require("mongoose");
const { name: appname } = require("../package.json");
const config = require("../app.config");
const DataProvider = require("./data-provider");
const { TxModel } = require("../models/mongoose-models");
const { txModelSchema } = require("../schemas/tx-schema");
const Joi = require("joi");
const logger = require("../utils/logger").forComponent("mongoose");

class MongooseDataProvider extends DataProvider {
  async init() {
    const mongoConfig = config.mongodb || {};
    const options = {
      appName: appname,
      maxPoolSize: mongoConfig.maxPoolSize || 10,
      minPoolSize: mongoConfig.minPoolSize || 2,
      maxIdleTimeMS: mongoConfig.maxIdleTimeMs || 30000,
      serverSelectionTimeoutMS: mongoConfig.serverSelectionTimeoutMs || 5000,
      socketTimeoutMS: mongoConfig.socketTimeoutMs || 45000,
      family: mongoConfig.family || 4,
      retryWrites: true,
      retryReads: true,
      bufferCommands: false,
    };

    try {
      await mongoose.connect(config.db, options);
      logger.info("Connected to MongoDB", {
        database: mongoose.connection.name,
      });

      // Set up connection event handlers
      mongoose.connection.on("error", (err) => {
        logger.error("MongoDB connection error", { error: err.message });
      });

      mongoose.connection.on("disconnected", () => {
        logger.warn("MongoDB disconnected");
      });

      mongoose.connection.on("reconnected", () => {
        logger.info("MongoDB reconnected");
      });

      this.db = mongoose.connection.db;
    } catch (error) {
      logger.error("Failed to connect to MongoDB", { error: error.message });
      throw error;
    }
  }

  /**
   * @type {Db}
   */
  db = null;

  /**
   * Validate transaction data using Joi schema
   * @param {Object} txData
   * @returns {Object} Validated data
   */
  validateTransaction(txData) {
    const { error, value } = txModelSchema.validate(txData, {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      const validationError = new Error("Transaction validation failed");
      validationError.details = error.details;
      throw validationError;
    }

    return value;
  }

  /**
   * Store transaction using Mongoose model
   * @param {Object} txModelData
   * @returns {Promise}
   */
  async saveTransaction(txModelData) {
    try {
      // Validate input data
      const validatedData = this.validateTransaction(txModelData);

      // Set _id to the transaction hash
      validatedData._id = validatedData.hash;
      // Remove the separate hash field since _id serves as hash
      delete validatedData.hash;

      // Use upsert to handle existing transactions
      const result = await TxModel.findOneAndUpdate(
        { _id: validatedData._id },
        validatedData,
        {
          upsert: true,
          new: true,
          runValidators: true,
          setDefaultsOnInsert: true,
        },
      );

      return result;
    } catch (error) {
      if (error.name === "ValidationError") {
        const validationError = new Error("Transaction validation failed");
        validationError.details = Object.values(error.errors).map((err) => ({
          message: err.message,
          path: err.path,
          value: err.value,
        }));
        throw validationError;
      }
      throw error;
    }
  }

  /**
   * Find transaction by hash
   * @param {String} hash
   * @returns {Promise<Object|null>}
   */
  async findTransaction(hash) {
    try {
      const transaction = await TxModel.findById(hash).lean();

      if (!transaction) {
        return null;
      }

      // Set hash field from _id for backward compatibility
      transaction.hash = transaction._id;
      delete transaction._id;
      delete transaction.__v;

      return transaction;
    } catch (error) {
      console.error("Error finding transaction:", error);
      throw error;
    }
  }

  /**
   * Update transaction with optimistic concurrency control
   * @param {String} hash
   * @param {Object} update
   * @param {String} expectedCurrentStatus
   * @returns {Promise<Boolean>}
   */
  async updateTransaction(hash, update, expectedCurrentStatus) {
    try {
      const filter = { _id: hash }; // Use _id instead of hash for Mongoose

      if (expectedCurrentStatus !== undefined) {
        filter.status = expectedCurrentStatus;
      }

      logger.debug("Updating transaction", { hash, filter, update });

      // Add update timestamp
      update.updatedAt = new Date();

      const result = await TxModel.updateOne(filter, { $set: update });

      logger.debug("Update result", {
        hash,
        matchedCount: result.matchedCount,
      });
      return result.matchedCount > 0;
    } catch (error) {
      logger.error("Error updating transaction", {
        hash,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Update transaction status with error handling
   * @param {String} hash
   * @param {String} newStatus
   * @param {String} expectedCurrentStatus
   * @param {Error} error
   * @returns {Promise<Boolean>}
   */
  async updateTxStatus(hash, newStatus, expectedCurrentStatus, error = null) {
    const filter = { _id: hash };
    if (expectedCurrentStatus !== undefined) {
      filter.status = expectedCurrentStatus;
    }

    const updateOp = {
      $set: {
        status: newStatus,
        updatedAt: new Date(),
      },
    };

    if (error) {
      updateOp.$set.lastError = error.message || error.toString();
      updateOp.$inc = { retryCount: 1 };
    }

    const result = await TxModel.updateOne(filter, updateOp);
    return result.matchedCount > 0;
  }

  /**
   * List transactions with enhanced filtering
   * @param {Object} filter - Query filter
   * @param {string} [filter.status] - Transaction status
   * @param {string} [filter.blockchain] - Blockchain identifier
   * @param {string} [filter.networkName] - Network name
   * @param {number} [filter.network] - Legacy Stellar network ID
   * @returns {AsyncIterable}
   */
  listTransactions(filter = {}, { limit } = {}) {
    // Convert filter format for Mongoose
    const mongooseFilter = { ...filter };

    if (mongooseFilter.hash) {
      mongooseFilter._id = mongooseFilter.hash;
      delete mongooseFilter.hash;
    }

    // Handle special operators
    if (mongooseFilter.minTime && typeof mongooseFilter.minTime === "object") {
      // Convert {$lte: timestamp} format
      mongooseFilter.minTime = mongooseFilter.minTime;
    }

    const projection = {
      hash: "$_id",
      _id: 0,
      status: 1,
      // Legacy Stellar fields
      network: 1,
      xdr: 1,
      // Blockchain-agnostic fields
      blockchain: 1,
      networkName: 1,
      payload: 1,
      encoding: 1,
      txUri: 1,
      // Common fields
      callbackUrl: 1,
      maxTime: 1,
      minTime: 1,
      signatures: 1,
      submit: 1,
      submitted: 1,
      desiredSigners: 1,
      createdAt: 1,
      updatedAt: 1,
      retryCount: 1,
      lastError: 1,
    };

    let query = TxModel.find(mongooseFilter, projection).lean();
    if (limit && limit > 0) {
      query = query.limit(limit);
    }
    return query.cursor();
  }

  /**
   * Get transaction statistics
   * @returns {Promise<Object>}
   */
  async getTransactionStats(filter = {}) {
    const matchStage = {};

    // Apply blockchain filter if provided
    if (filter.blockchain) {
      matchStage.blockchain = filter.blockchain;
    }

    const pipeline = [];

    // Add match stage if there are any filters
    if (Object.keys(matchStage).length > 0) {
      pipeline.push({ $match: matchStage });
    }

    pipeline.push({
      $group: {
        _id: "$status",
        count: { $sum: 1 },
        avgRetryCount: { $avg: "$retryCount" },
      },
    });

    const stats = await TxModel.aggregate(pipeline);

    const total = await TxModel.countDocuments(matchStage);

    // Get blockchain breakdown if no specific filter
    let byBlockchain = null;
    if (!filter.blockchain) {
      const blockchainStats = await TxModel.aggregate([
        {
          $group: {
            _id: { $ifNull: ["$blockchain", "stellar"] },
            count: { $sum: 1 },
          },
        },
      ]);
      byBlockchain = blockchainStats.reduce((acc, stat) => {
        acc[stat._id] = stat.count;
        return acc;
      }, {});
    }

    return {
      total,
      byStatus: stats.reduce((acc, stat) => {
        acc[stat._id] = {
          count: stat.count,
          avgRetryCount: stat.avgRetryCount,
        };
        return acc;
      }, {}),
      ...(byBlockchain && { byBlockchain }),
      ...(filter.blockchain && { blockchain: filter.blockchain }),
    };
  }

  /**
   * Clean up expired transactions
   * @returns {Promise<Number>} Number of cleaned up transactions
   */
  async cleanupExpiredTransactions() {
    const result = await TxModel.updateMany(
      {
        status: { $in: ["pending", "ready"] },
        maxTime: {
          $ne: null,
          $lte: Math.floor(Date.now() / 1000),
        },
      },
      {
        $set: {
          status: "failed",
          lastError: "Transaction expired",
          updatedAt: new Date(),
        },
      },
    );

    return result.modifiedCount;
  }

  /**
   * Check database connectivity and health
   * @returns {Promise<{connected: boolean, latencyMs: number, error?: string}>}
   */
  async checkHealth() {
    const start = Date.now();
    try {
      if (mongoose.connection.readyState !== 1) {
        return {
          connected: false,
          latencyMs: Date.now() - start,
          error: "Database connection not established",
        };
      }

      // Perform actual ping to verify connectivity
      await mongoose.connection.db.admin().ping();

      return {
        connected: true,
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      logger.error("Database health check failed", { error: error.message });
      return {
        connected: false,
        latencyMs: Date.now() - start,
        error: error.message,
      };
    }
  }

  /**
   * Close database connection
   */
  async close() {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      logger.info("MongoDB connection closed");
    }
  }
}

module.exports = MongooseDataProvider;
