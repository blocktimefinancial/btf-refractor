const axios = require("axios");
const config = require("../../app.config");
const { validateCallbackUrl } = require("../../utils/url-validator");
const callbackConfig = config.callback;

let callbackHandler = function (txInfo) {
  const { tx, network, hash, callbackUrl } = txInfo;
  return axios.post(callbackUrl, { tx, hash, network });
};

/**
 *
 * @param {TxModel} txInfo
 * @returns {Promise}
 */
async function processCallback(txInfo) {
  if (!txInfo.callbackUrl)
    throw new Error(
      `Attempt to execute an empty callback for tx ${txInfo.hash}`,
    );
  // Runtime SSRF check with DNS resolution
  const { safe, reason } = await validateCallbackUrl(txInfo.callbackUrl, {
    checkDns: true,
  });
  if (!safe) {
    throw new Error(`Callback URL blocked (SSRF): ${reason}`);
  }
  const minShift = callbackConfig.retryMinShift || 4;
  const maxShift = callbackConfig.retryMaxShift || 12;
  for (let i = minShift; i <= maxShift; i++) {
    try {
      const response = await callbackHandler(txInfo);
      if (response.status >= 200 && response.status < 300) return;
    } catch (e) {
      // Network error — fall through to retry
    }
    //repeat
    await new Promise((resolve) => setTimeout(resolve, 1 << i)); //exponential backoff waiting strategy
  }
  throw new Error(
    `Server returned invalid status code after processing the callback`,
  ); //no response from the server
}

function setCallbackHandler(handler) {
  callbackHandler = handler;
}

module.exports = { processCallback, setCallbackHandler };
