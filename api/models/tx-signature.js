class TxSignature {
    /**
     * Signature pubkey.
     * @type {String}
     */
    key

    /**
     * Raw signature.
     * @type {Buffer}
     */
    signature

    toJSON() {
        const sig = Buffer.isBuffer(this.signature)
            ? this.signature.toString('base64')
            : this.signature;
        return {key: this.key, signature: sig}
    }
}

module.exports = TxSignature