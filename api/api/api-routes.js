const { registerRoute } = require("./router"),
  { loadRehydrateTx } = require("../business-logic/tx-loader"),
  Signer = require("../business-logic/signer"),
  { serviceInfo } = require("../business-logic/info-handler"),
  monitoringRoutes = require("./monitoring-routes"),
  keyRoutes = require("./key-routes"),
  ValidationMiddleware = require("../middleware/validation"),
  {
    normalizeRequest,
    isStellarRequest,
    toLegacyFormat,
  } = require("../business-logic/request-adapter"),
  { standardError } = require("../business-logic/std-error"),
  logger = require("../utils/logger").forComponent("api-routes");

module.exports = function registerRoutes(app) {
  registerRoute(app, "/", { rate: "general" }, () => serviceInfo());

  registerRoute(
    app,
    "tx/:hash",
    {
      rate: "general",
      middleware: [ValidationMiddleware.validateTransactionHash()],
    },
    ({ params }) => loadRehydrateTx(params.hash),
  );

  registerRoute(
    app,
    "/tx",
    {
      rate: "strict",
      method: "post",
      middleware: [ValidationMiddleware.validateTransactionSubmission()],
    },
    async ({ body }) => {
      // Normalize request to internal format (supports legacy and blockchain-agnostic)
      const normalizedRequest = normalizeRequest(body);

      logger.debug("Processing transaction submission", {
        blockchain: normalizedRequest.blockchain,
        network: normalizedRequest.networkName,
        format: body.txUri ? "txUri" : body.xdr ? "legacy" : "components",
      });

      // For now, only Stellar is fully supported
      // Other blockchains will be enabled in Phase 2C
      if (!isStellarRequest(normalizedRequest)) {
        throw standardError(
          501,
          `Blockchain '${normalizedRequest.blockchain}' is not yet fully implemented. ` +
            `Currently only Stellar transactions are supported.`,
        );
      }

      // Convert to legacy format for existing Signer (backward compatibility)
      const legacyRequest = toLegacyFormat(normalizedRequest);

      const signer = new Signer(legacyRequest);
      await signer.init();
      signer.processNewSignatures();
      await signer.saveChanges();

      // Return response with blockchain-agnostic fields
      const result = signer.toJSON();

      // Augment with blockchain-agnostic metadata
      return {
        ...result,
        blockchain: normalizedRequest.blockchain,
        networkName: normalizedRequest.networkName,
        txUri: normalizedRequest.txUri,
      };
    },
  );

  // Add monitoring routes with validation
  app.use("/monitoring", monitoringRoutes);

  // Add key management routes (admin-only, HSM operations)
  app.use("/keys", keyRoutes);

  // Add validation error handler
  app.use(ValidationMiddleware.errorHandler());
};
