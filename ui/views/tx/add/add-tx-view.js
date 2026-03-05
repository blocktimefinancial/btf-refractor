import React, { useCallback, useState } from "react";
import isEqual from "react-fast-compare";
import { Button, Dropdown } from "@stellar-expert/ui-framework";
import { navigation } from "@stellar-expert/navigation";
import { apiSubmitTx } from "../../../infrastructure/tx-dispatcher";
import config from "../../../app.config.json";

const { blockchains, defaultBlockchain } = config;

// Build blockchain options from config
const blockchainOptions = Object.keys(blockchains).map((key) => ({
  value: key,
  title: blockchains[key].name,
}));

// Build network options dynamically based on selected blockchain
function getNetworkOptions(blockchain) {
  const bc = blockchains[blockchain];
  if (!bc) return [];
  return bc.networks.map((net) => ({ value: net, title: net }));
}

// Get encoding options for a blockchain
function getEncodingOptions(blockchain) {
  const bc = blockchains[blockchain];
  const defaultEnc = bc?.defaultEncoding || "base64";
  const encodings = ["base64", "hex", "base58"];
  return encodings.map((enc) => ({
    value: enc,
    title: enc + (enc === defaultEnc ? " (default)" : ""),
  }));
}

function Optional() {
  return <span className="dimmed text-small"> (optional)</span>;
}

function TxPropsBlock({ title, description, optional = false, children }) {
  return (
    <div className="space">
      {title}
      {!!optional && <Optional />}
      <div className="row micro-space">
        <div className="column column-60">{children}</div>
        <div className="column column-40">
          <div className="segment h-100 dimmed text-tiny">{description}</div>
        </div>
      </div>
    </div>
  );
}

export default function AddTxView() {
  const [data, setData] = useState({
    blockchain: defaultBlockchain,
    networkName: blockchains[defaultBlockchain]?.networks[0] || "public",
    payload: "",
    encoding: blockchains[defaultBlockchain]?.defaultEncoding || "base64",
    submit: false,
    callback: "",
    expires: "",
    desiredSigners: [],
    originator: "",
    originatorSignature: "",
  });
  const [inProgress, setInProgress] = useState(false);

  const setParam = useCallback((param, value) => {
    setData((prev) => {
      const newData = { ...prev, [param]: value };
      if (!isEqual(prev, newData)) return newData;
      return prev;
    });
  }, []);

  const storeTx = useCallback(() => {
    setInProgress(true);
    return apiSubmitTx(data)
      .then((res) => {
        navigation.navigate(`/tx/${res.hash}`);
      })
      .catch((e) => {
        setInProgress(false);
        notify({ type: "error", message: e.message });
      });
  }, [data]);

  const changeBlockchain = useCallback((bc) => {
    const bcConfig = blockchains[bc];
    setData((prev) => ({
      ...prev,
      blockchain: bc,
      networkName: bcConfig?.networks[0] || "mainnet",
      encoding: bcConfig?.defaultEncoding || "base64",
    }));
  }, []);

  const changeNetwork = useCallback(
    (n) => setParam("networkName", n),
    [setParam]
  );

  const changePayload = useCallback(
    (e) => setParam("payload", e.target.value.trim()),
    [setParam]
  );

  const changeEncoding = useCallback(
    (enc) => setParam("encoding", enc),
    [setParam]
  );

  const changeAutoSubmit = useCallback(
    (e) => setParam("submit", e.target.checked),
    [setParam]
  );

  const changeCallback = useCallback(
    (e) => setParam("callback", e.target.value.trim()),
    [setParam]
  );

  const changeExpires = useCallback(
    (e) => setParam("expires", e.target.value),
    [setParam]
  );

  const changeOriginator = useCallback(
    (e) => setParam("originator", e.target.value.trim()),
    [setParam]
  );

  const changeOriginatorSignature = useCallback(
    (e) => setParam("originatorSignature", e.target.value.trim()),
    [setParam]
  );

  const isStellar = data.blockchain === "stellar";
  const signingSupported = blockchains[data.blockchain]?.signingSupported;

  const isStellar = data.blockchain === "stellar";
  const signingSupported = blockchains[data.blockchain]?.signingSupported;

  return (
    <>
      <div className="dual-layout">
        <div>
          <h2>Store transaction</h2>
        </div>
      </div>

      <div className="card card-blank" style={{ paddingTop: "1px" }}>
        <div className="flex-row space" style={{ gap: "1rem" }}>
          &nbsp;{" "}
          <Dropdown
            options={blockchainOptions}
            value={data.blockchain}
            onChange={changeBlockchain}
          />
          <Dropdown
            options={getNetworkOptions(data.blockchain)}
            value={data.networkName}
            onChange={changeNetwork}
          />
          {!isStellar && (
            <Dropdown
              options={getEncodingOptions(data.blockchain)}
              value={data.encoding}
              onChange={changeEncoding}
            />
          )}
        </div>

        {!signingSupported && (
          <div className="segment warning space">
            <i className="icon-warning" /> Signing is not yet supported for{" "}
            {blockchains[data.blockchain]?.name}. Transactions can be stored but
            signatures must be added externally.
          </div>
        )}

        <TxPropsBlock
          title={isStellar ? "Transaction XDR" : "Transaction Payload"}
          description={
            isStellar ? (
              <>
                Base64-encoded transaction envelope. If the same transaction has
                been already stored earlier, all additional signatures will be
                added to this transaction.
                <br />
                You can prepare a transaction using{" "}
                <a href="https://lab.stellar.org/" target="_blank">
                  Stellar Laboratory
                </a>{" "}
                or any{" "}
                <a
                  href="https://developers.stellar.org/docs/tools/sdks"
                  target="_blank"
                >
                  {" "}
                  Stellar SDK
                </a>
                .
              </>
            ) : (
              <>
                {data.encoding}-encoded transaction data. The transaction will
                be stored and can be retrieved by its hash.
              </>
            )
          }
        >
          <textarea
            value={data.payload}
            disabled={inProgress}
            onChange={changePayload}
            className="text-small text-monospace condensed mobile-micro-space-bottom"
            placeholder={
              isStellar
                ? "Base64-encoded transaction envelope"
                : `${data.encoding}-encoded transaction data`
            }
            style={{
              width: "100%",
              minHeight: "8rem",
              height: "100%",
              display: "block",
              resize: "vertical",
              marginBottom: "-6px",
            }}
          />
        </TxPropsBlock>

        {signingSupported && (
          <TxPropsBlock
            description={
              <>
                Automatically submit this transaction to the network once
                gathered enough signatures to match the threshold.
              </>
            }
          >
            <label>
              <input
                type="checkbox"
                checked={data.submit}
                onChange={changeAutoSubmit}
              />{" "}
              Autosubmit to the network
              <Optional />
            </label>
          </TxPropsBlock>
        )}

        <TxPropsBlock
          title="Callback URL"
          optional
          description={
            <>
              Callback URL where this transaction will be automatically sent as
              a HTTP POST request gathered enough signatures to match the
              threshold.
            </>
          }
        >
          <input
            type="text"
            value={data.callback}
            onChange={changeCallback}
            placeholder="for example, https://my.service/success.php"
          />
        </TxPropsBlock>

        <TxPropsBlock
          title="Valid until"
          optional
          description={
            <>
              Transaction retention period. If not specified explicitly, the{" "}
              <code>validBefore</code> value from transaction is used. Maximum
              retention period is capped to 1 year.
            </>
          }
        >
          <input
            value={data.expires}
            onChange={changeExpires}
            placeholder="UNIX timestamp or ISO date, like 2020-11-29T09:29:13Z"
          />
        </TxPropsBlock>

        <TxPropsBlock
          title="Originator"
          optional
          description={
            <>
              Public key or address of the transaction creator. This allows
              signers to verify who created the transaction before signing.
              Format depends on blockchain (e.g., G... for Stellar, 0x... for
              EVM).
            </>
          }
        >
          <input
            type="text"
            value={data.originator}
            onChange={changeOriginator}
            placeholder={
              data.blockchain === "stellar" || data.blockchain === "onemoney"
                ? "Stellar public key (G...)"
                : data.blockchain === "ethereum" ||
                  [
                    "polygon",
                    "arbitrum",
                    "optimism",
                    "base",
                    "avalanche",
                  ].includes(data.blockchain)
                ? "Ethereum address (0x...)"
                : "Public key or address"
            }
          />
        </TxPropsBlock>

        {data.originator && (
          <TxPropsBlock
            title="Originator Signature"
            optional
            description={
              <>
                Signature of the transaction hash by the originator. This proves
                the transaction was created by the specified originator. The
                originator signs the transaction hash with their private key.
              </>
            }
          >
            <input
              type="text"
              value={data.originatorSignature}
              onChange={changeOriginatorSignature}
              placeholder={
                data.blockchain === "stellar" || data.blockchain === "onemoney"
                  ? "Base64-encoded signature"
                  : "Hex-encoded signature (0x...)"
              }
            />
          </TxPropsBlock>
        )}

        {/*<div>
                <label>Desired signers</label>
                <DesiredTxSignersView signers={data.desiredSigners}
                                      onChange={newSigners => setParam('desiredSigners', newSigners)}/>
            </div>*/}
        <hr className="space" />
        <div className="space row">
          <div className="column column-50">
            {!!inProgress && (
              <>
                <div className="loader inline" />
                <span className="dimmed text-small"> In progress...</span>
              </>
            )}
          </div>
          <div className="column column-25">
            <Button block outline href="/" disabled={inProgress}>
              Cancel
            </Button>
          </div>
          <div className="column column-25">
            <Button block disabled={inProgress} onClick={storeTx}>
              Save
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
