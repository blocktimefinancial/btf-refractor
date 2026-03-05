/**
 * logging stub — btf-lib-v1/logging/logging
 *
 * Standardized BTF platform logging. Stub until real library is linked.
 * Provides the same interface used in the deployment plan §3.2.A.
 */

function createLogger(options = {}) {
  const component = options.component || "default";
  const noop = () => {};

  return {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    child: (meta) => createLogger({ ...options, ...meta }),
    forComponent: (name) => createLogger({ ...options, component: name }),
    forRequest: (req) =>
      createLogger({ ...options, requestId: req?.id || "unknown" }),
  };
}

module.exports = {
  createLogger,
  defaultLogger: createLogger(),
};
