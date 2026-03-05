// Edit: LJM - Replaced all substr calls with slice

const { Keypair } = require("@stellar/stellar-sdk");

/**
 * Convert the signature hint to the StrKey mask.
 * @param {Buffer} hint - Hint to convert.
 * @return {string}
 */
function hintToMask(hint) {
  const partialPublicKey = Buffer.concat([Buffer.alloc(28), hint]),
    hintKeypair = new Keypair({ type: "ed25519", publicKey: partialPublicKey }),
    pk = hintKeypair.publicKey();
  return pk.slice(0, 1) + "_".repeat(46) + pk.slice(47, 52) + "_".repeat(4);
}

/**
 * Format the signature hint to the friendly form for UI.
 * @param {Buffer} hint - Hint to convert.
 * @return {string}
 */
function formatHint(hint) {
  const mask = hintToMask(hint);
  return mask.slice(0, 2) + "…" + mask.slice(46);
}

/**
 * Check if the hint matches the specific key.
 * @param {Buffer} hint - Hint to check.
 * @param {String} key - Key to compare.
 * @return {boolean}
 */
function hintMatchesKey(hint, key) {
  return hintToMask(hint).slice(47, 52) === key.slice(47, 52);
}

/**
 * Find matching key by the signature hint from a list of available keys.
 * @param {Buffer} hint - Hint to look for.
 * @param {Array<String>} allKeys - Array of potentially matching keys.
 * @return {String|null}
 */
function findKeysByHint(hint, allKeys) {
  return allKeys.find((key) => hintMatchesKey(hint, key));
}

/**
 * Find a signature by public key from the list of signatures.
 * @param {String} pubkey
 * @param {Array<TxSignature>} allSignatures
 * @returns {*}
 */
function findSignatureByKey(pubkey, allSignatures = []) {
  return allSignatures.find((sig) => {
    if (!hintMatchesKey(sig.hint(), pubkey)) return false;
    try {
      return Keypair.fromPublicKey(pubkey).verify(sig.hash(), sig.signature());
    } catch {
      return hintMatchesKey(sig.hint(), pubkey);
    }
  });
}

module.exports = {
  hintToMask,
  hintMatchesKey,
  formatHint,
  findKeysByHint,
  findSignatureByKey,
};
