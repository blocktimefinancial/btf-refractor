/**
 * Blockchain Handlers Index
 *
 * Exports all blockchain handlers and the handler factory.
 *
 * @module business-logic/handlers
 */

const BlockchainHandler = require("./blockchain-handler");
const handlerFactory = require("./handler-factory");
const stellarHandler = require("./stellar-handler");
const onemoneyHandler = require("./onemoney-handler");
const algorandHandler = require("./algorand-handler");
const solanaHandler = require("./solana-handler");
const evmHandler = require("./evm-handler");

module.exports = {
  // Abstract interface
  BlockchainHandler,

  // Factory functions
  ...handlerFactory,

  // Individual handlers (for direct access if needed)
  stellarHandler,
  onemoneyHandler,
  algorandHandler,
  solanaHandler,

  // EVM handler module
  EvmHandler: evmHandler.EvmHandler,
  createEvmHandler: evmHandler.createEvmHandler,
  isEvmBlockchain: evmHandler.isEvmBlockchain,
  EVM_BLOCKCHAINS: evmHandler.EVM_BLOCKCHAINS,
};
