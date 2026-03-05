const { createCorsMiddleware } = require("../middleware/cors"),
  { getRequestLogger } = require("../middleware/request-id"),
  rateLimit = require("express-rate-limit"),
  config = require("../app.config");

// Create CORS middleware instance with blacklist support
const corsMiddleware = createCorsMiddleware();

const rateLimits = {
  general: rateLimit({
    windowMs: config.rateLimit.general.windowMs,
    max: config.rateLimit.general.max,
  }),
  strict: rateLimit({
    windowMs: config.rateLimit.strict.windowMs,
    max: config.rateLimit.strict.max,
  }),
};

function processResponse(res, promise, headers, prettyPrint = false) {
  if (typeof promise.then !== "function") {
    promise = Promise.resolve(promise);
  }
  promise
    .then((data) => {
      if (!data) data = {};
      if (headers) {
        res.set(headers);
        //send raw data if content-type was specified
        if (
          headers["content-type"] &&
          headers["content-type"] !== "application/json"
        ) {
          res.send(data);
          return;
        }
      }
      if (prettyPrint) {
        //pretty-print result (tabs)
        res.set({ "content-type": "application/json" });
        res.send(JSON.stringify(data, null, "  "));
      } else {
        res.json(data);
      }
    })
    .catch((err) => {
      const reqLogger = getRequestLogger(res.req);
      if (err.status) {
        return res
          .status(err.status)
          .json({ error: err.message, status: err.status });
      }
      //unhandled error
      reqLogger.error("Unhandled route error", {
        error: err.message,
        stack: err.stack,
      });
      res.status(500).json({ error: "Internal server error", status: 500 });
    });
}

module.exports = {
  /**
   * Register API route.
   * @param {object} app - Express app instance.
   * @param {string} route - Relative route path.
   * @param {object} options - Additional options.
   * @param {'get'|'post'} [options.method] - Route method. Default: 'get'
   * @param {'general'|'strict'} [options.rate] - Rate limiting rules. Default: 'general'
   * @param {object} [options.headers] - Additional response headers. Default: {}.
   * @param {Array} [options.middleware] - Additional middleware functions.
   * @param {routeHandler} handler - Request handler.
   */
  registerRoute(app, route, options, handler) {
    const {
      method = "get",
      rate = "general",
      headers,
      middleware = [],
    } = options;
    //middleware - CORS (with blacklist), rate limiting, and custom middleware
    const allMiddleware = [corsMiddleware, rateLimits[rate], ...middleware];

    //normalize route
    if (route.indexOf("/") !== 0) {
      route = "/" + route;
    }
    //register request handler
    app[method.toLowerCase()](route, allMiddleware, function (req, res) {
      processResponse(
        res,
        handler(req),
        headers,
        req.query && req.query.prettyPrint !== undefined,
      );
    });
    //register pre-flight request handler
    if (method.toLowerCase() !== "get") {
      app.options(route, [corsMiddleware], function (req, res) {
        res.end(method.toUpperCase());
      });
    }
  },

  /**
   * Route handler callback.
   * @callback routeHandler
   * @param {{params: object, query: object, path: string}} req - Request object.
   */
};
