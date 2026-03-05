// Edit : LJM - Added fallback to Horizon if coredb is not configured.
// TODO: Use Stellar Composable Data Platform to query the accounts.  Assigned to Tillman
const { Pool } = require("pg"),
  { parse: parseConnectionString } = require("pg-connection-string"),
  { Horizon, StrKey } = require("@stellar/stellar-sdk"),
  { networks } = require("../app.config"),
  logger = require("../utils/logger").forComponent("core-db");

const pools = {};

function initPgDbPools() {
  for (const network of Object.keys(networks)) {
    const { coredb } = networks[network];
    if (coredb) {
      pools[network] = new Pool(coredb);
    } else {
      // Fall back to Horizon
      pools[network] = new Horizon.Server(networks[network].horizon);
    }
  }
}

function formatSigner(key, weight) {
  return {
    type: "ed25519_public_key",
    key,
    weight,
  };
}

async function loadAccountsInfo(network, accounts) {
  if (!pools[network]) {
    throw new Error(`No connection pool for network: ${network}`);
  }
  if (!Array.isArray(accounts)) {
    throw new Error(`Expected accounts to be an array, got ${typeof accounts}`);
  }
  if (accounts.length === 0) {
    return [];
  }

  const pool = pools[network];

  // Check if we're using Horizon instead of PostgreSQL
  if (pool instanceof Horizon.Server) {
    logger.info(
      `Using Horizon fallback for account info (network: ${network})`
    );
    // For each account in the accounts array, call Horizon to get the account details
    const accountPromises = accounts.map(async (account) => {
      try {
        const accountData = await pool.loadAccount(account);
        return {
          account_id: accountData.accountId(),
          id: accountData.accountId(),
          signers: accountData.signers,
          thresholds: accountData.thresholds,
        };
      } catch (error) {
        logger.warn(
          `Failed to load account ${account} from Horizon: ${error.message}`
        );
        return null;
      }
    });

    const accountResults = await Promise.all(accountPromises);
    return accountResults.filter((account) => account !== null);
  }

  // Use PostgreSQL for core database access
  const { rows } = await pool.query(
    "select accountid, thresholds, flags, signers from accounts where accountid = ANY($1)",
    [accounts]
  );

  return rows.map(function ({ accountid, thresholds, flags, signers }) {
    const accountSigners = [];
    const rawThresholds = Buffer.from(thresholds, "base64");
    const masterWeight = rawThresholds[0];
    if (masterWeight > 0) {
      accountSigners.push(formatSigner(accountid, masterWeight));
    }
    if (signers) {
      const raw = Buffer.from(signers, "base64");
      const signersCount = raw.readUInt32BE(0);
      let ptr = 4;
      for (let i = 0; i < signersCount; i++) {
        const type = raw.readUInt32BE(ptr);
        ptr += 4;
        const key = StrKey.encodeEd25519PublicKey(raw.slice(ptr, ptr + 32));
        ptr += 32;
        const weight = raw.readUInt32BE(ptr);
        ptr += 4;
        if (type === 0) {
          accountSigners.push(formatSigner(key, weight));
        }
        //TODO: handle other signer types
      }
    }

    return {
      account_id: accountid,
      id: accountid,
      signers: accountSigners,
      thresholds: {
        low_threshold: rawThresholds[1],
        med_threshold: rawThresholds[2],
        high_threshold: rawThresholds[3],
      },
    };
    //const parsedFlags = xdr.AccountFlags.fromXDR(Buffer.from(flags, 'base64'))
  });
}

module.exports = { loadAccountsInfo, initPgDbPools };
