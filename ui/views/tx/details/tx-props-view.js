import React from "react";
import { Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import {
  AccountAddress,
  BlockSelect,
  CopyToClipboard,
  InfoTooltip,
  withErrorBoundary,
} from "@stellar-expert/ui-framework";
import { formatDateUTC } from "@stellar-expert/formatter";
import TxFormattedMemo, { hasMemo } from "./tx-formatted-memo-view";
import TxStatusView from "./tx-status-view";
import TxPreconditionsView from "./tx-preconditions-view";
import { getBlockchainName } from "../../../infrastructure/tx-dispatcher";

export default withErrorBoundary(function TxPropsView({ txInfo }) {
  const blockchain = txInfo.blockchain || "stellar";
  const networkName = txInfo.networkName || txInfo.network;
  const isStellar = blockchain === "stellar";

  // Parse Stellar transactions for detailed info
  let tx = null;
  let isFeeBump = false;
  let feeSponsor = null;

  if (isStellar) {
    try {
      const xdr = txInfo.payload || txInfo.xdr;
      tx = TransactionBuilder.fromXDR(xdr, Networks[networkName.toUpperCase()]);
      isFeeBump = !!tx.innerTransaction;
      feeSponsor = isFeeBump && tx.feeSource;
      if (isFeeBump) {
        tx = tx.innerTransaction;
      }
    } catch (e) {
      // Could not parse transaction
    }
  }

  return (
    <div className="space">
      <TxStatusView tx={txInfo} />
      <div>
        <span className="dimmed">Blockchain:</span>{" "}
        <BlockSelect>{getBlockchainName(blockchain)}</BlockSelect>
        <InfoTooltip>
          The blockchain network this transaction is for
        </InfoTooltip>
      </div>
      <div>
        <span className="dimmed">Network:</span>{" "}
        <BlockSelect>{networkName}</BlockSelect>
        <InfoTooltip>
          Network name (e.g., &quot;public&quot;, &quot;testnet&quot;,
          &quot;mainnet&quot;)
        </InfoTooltip>
      </div>
      {txInfo.encoding && txInfo.encoding !== "base64" && (
        <div>
          <span className="dimmed">Encoding:</span>{" "}
          <BlockSelect>{txInfo.encoding}</BlockSelect>
          <InfoTooltip>Transaction payload encoding format</InfoTooltip>
        </div>
      )}
      {!!txInfo.submit && (
        <div>
          <span className="dimmed">Autosubmit: </span> yes
          <InfoTooltip>
            This transaction will be automatically submitted to the network once
            ready
          </InfoTooltip>
        </div>
      )}
      {!!txInfo.callbackUrl && (
        <div>
          <span className="dimmed">Callback URL: </span>
          <BlockSelect inline>{txInfo.callbackUrl}</BlockSelect>
          <InfoTooltip>
            This transaction will be automatically sent to the callback URL via
            HTTP POST request once ready
          </InfoTooltip>
        </div>
      )}
      {!!txInfo.maxTime && (
        <div>
          <span className="dimmed">Expiration: </span>
          <BlockSelect>{formatDateUTC(txInfo.maxTime)}</BlockSelect>
          <InfoTooltip>
            When transaction expires, it will be deleted from the database
          </InfoTooltip>
        </div>
      )}
      {/* Stellar-specific fields */}
      {tx && hasMemo(tx) && (
        <div>
          <span className="label">Memo: </span>
          <TxFormattedMemo rawMemo={tx.memo} />
          <InfoTooltip>Memo attached to the transaction</InfoTooltip>
        </div>
      )}
      {tx && (
        <div>
          <span className="label">Source account: </span>
          <AccountAddress account={tx.source} chars={12} />
          <CopyToClipboard text={tx.source} />
          <InfoTooltip>Source account of this transaction</InfoTooltip>
        </div>
      )}
      {!!isFeeBump && (
        <div>
          <span className="label">Fee sponsor: </span>
          <AccountAddress account={feeSponsor} />
          <InfoTooltip>
            Fee sponsor account of the wrapped transaction
          </InfoTooltip>
        </div>
      )}
      {tx && (
        <div>
          <span className="label">Source sequence: </span>
          <span className="inline-block">
            <BlockSelect inline wrap className="condensed">
              {tx.sequence}
            </BlockSelect>
            <InfoTooltip>Sequence of the source account</InfoTooltip>
          </span>
        </div>
      )}
      {tx && <TxPreconditionsView tx={tx} />}

      {/* Originator attestation */}
      {txInfo.originator && (
        <div className="micro-space">
          <span className="dimmed">Originator:</span>{" "}
          {isStellar ? (
            <>
              <AccountAddress account={txInfo.originator} chars={12} />
              <CopyToClipboard text={txInfo.originator} />
            </>
          ) : (
            <>
              <BlockSelect inline className="condensed">
                {txInfo.originator}
              </BlockSelect>
              <CopyToClipboard text={txInfo.originator} />
            </>
          )}
          <InfoTooltip>
            The public key or address of the transaction creator. Signers can
            verify this to ensure the transaction came from a trusted source.
          </InfoTooltip>
          {txInfo.originatorSignature && (
            <span
              className="text-small dimmed"
              style={{ marginLeft: "0.5rem" }}
            >
              <i className="icon-ok color-success" /> signed
            </span>
          )}
        </div>
      )}
      {txInfo.originator && txInfo.originatorSignature && (
        <div className="micro-space">
          <span className="dimmed">Originator Signature:</span>{" "}
          <BlockSelect inline className="condensed text-tiny">
            {txInfo.originatorSignature.length > 32
              ? txInfo.originatorSignature.substring(0, 32) + "..."
              : txInfo.originatorSignature}
          </BlockSelect>
          <CopyToClipboard text={txInfo.originatorSignature} />
          <InfoTooltip>
            Cryptographic signature proving that the transaction was created by
            the specified originator. This is the originator&apos;s signature of
            the transaction hash.
          </InfoTooltip>
        </div>
      )}
    </div>
  );
});
