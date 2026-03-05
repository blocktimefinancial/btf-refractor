/**
 * envelopeEncryption stub — btf-lib-v1/secret/envelopeEncryption
 *
 * KEK-DEK envelope encryption utilities. Stub until real library
 * is linked.
 */

const NOT_CONFIGURED =
  "btf-lib-v1 stub: envelopeEncryption is not configured.";

function notConfigured(method) {
  return async function () {
    throw new Error(`${NOT_CONFIGURED} (called: ${method})`);
  };
}

module.exports = {
  wrapKey: notConfigured("wrapKey"),
  unwrapKey: notConfigured("unwrapKey"),
  encrypt: notConfigured("encrypt"),
  decrypt: notConfigured("decrypt"),
};
