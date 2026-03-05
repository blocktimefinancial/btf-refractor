# Code Review — Refractor API

**Date**: 2025-01-20 (updated)
**Scope**: 60 source files · 14,327 LOC | 30 test files · 9,917 LOC | 866 tests — all green
**Stack**: Node 22, Express 5.1, Mongoose 8.x, Jest 29, Winston 3, Joi 17, PM2

---

## Table of Contents

1. [Summary of Improvements Since Last Review](#1-summary-of-improvements-since-last-review)
2. [Architecture Overview](#2-architecture-overview)
3. [Bugs & Wrong Logic](#3-bugs--wrong-logic)
4. [Security](#4-security)
5. [Performance](#5-performance)
6. [Error Handling](#6-error-handling)
7. [Resource Leaks](#7-resource-leaks)
8. [Code Quality & Consistency](#8-code-quality--consistency)
9. [Testing](#9-testing)
10. [Positive Observations](#10-positive-observations)
11. [Recommended Actions](#11-recommended-actions)

---

## 1. Summary of Improvements Since Last Review

The following issues from the original review have been **resolved**:

| # | Issue | Fix |
|---|-------|-----|
| 3.1 | `$inc` nested inside `$set` in `updateTxStatus` | Moved `$inc` to top-level of update operator |
| 3.2 | `statusCode` vs `status` in callback-handler | Changed to `response.status` |
| 4.2 | `res.text()` in OPTIONS handler (not Express 5) | Changed to `res.end()` |
| 4.3 | `require('app.config.json')` in horizon-handler | Changed to `require('../../app.config')` |
| 5.1 | Dual tx-model (class + Mongoose schema) | Unified; TxModel is now a pure field reference with a comment pointing to Mongoose schema helpers |
| 5.2 | Verbose `config && config.x && config.x.y` patterns | Introduced `configGet(path, default)` helper; 14 files simplified |
| 5.4 | Manual `Object.assign(new Error(...), {status})` | Consolidated to `standardError(status, message)` everywhere |
| 5.5 | 470-line monolithic `signer.js` | Decomposed into thin orchestrator + 3 strategy modules (stellar, algorand, evm) |
| 6.1 | Error handler registered BEFORE routes in `api.js` | Moved to AFTER route registration |
| 6.3 | Jest `forceExit: true` masking leaks | Removed; clean shutdown in afterAll hooks |
| 6.4 | No `close()` on DataProvider base class | Added `async close() {}` to DataProvider; MongooseDataProvider overrides with real cleanup |
| 9.6 | No integration tests | Created `tests/integration/api.integration.test.js` (8 tests with supertest) |
| 9.7 | No coverage thresholds | Added `coverageThreshold` and `collectCoverageFrom` in `jest.config.js` |

---

## 2. Architecture Overview

```
api.js                       ─ Express app bootstrap, middleware, error handler
├── api/
│   ├── router.js            ─ Mount point for /tx, /key, /monitoring routes
│   ├── api-routes.js        ─ POST/GET /tx endpoints
│   ├── monitoring-routes.js ─ /monitoring/* (metrics, health, admin ops)
│   └── key-routes.js        ─ HSM key management endpoints
├── business-logic/
│   ├── signer.js            ─ Thin orchestrator (312 lines)
│   ├── strategies/
│   │   ├── stellar-strategy.js    ─ Stellar signing (146 lines)
│   │   ├── algorand-strategy.js   ─ Algorand/Solana signing (171 lines)
│   │   └── evm-strategy.js        ─ EVM signing (112 lines)
│   ├── finalization/
│   │   ├── finalizer.js           ─ Singleton scheduler + processor (389 lines)
│   │   ├── tx-submitter.js        ─ Routes submission to Stellar/EVM
│   │   ├── callback-handler.js    ─ POST callback with retry
│   │   └── horizon-handler.js     ─ Stellar Horizon submission
│   ├── queue/enhanced-queue.js    ─ FastQ wrapper with metrics, retry, adaptive concurrency
│   ├── hsm-signing-adapter.js     ─ Abstraction over btf-lib-v1 key stores
│   ├── blockchain-registry.js     ─ Blockchain/network configuration registry
│   ├── handlers/                  ─ Per-chain tx parsing, verification
│   └── (tx-loader, tx-params-parser, network-resolver, etc.)
├── middleware/
│   ├── auth.js              ─ API-key admin auth
│   ├── cors.js              ─ Blacklist-based CORS
│   ├── validation.js        ─ Joi request validation
│   └── request-id.js        ─ X-Request-Id / child logger
├── models/
│   ├── tx-model.js          ─ Plain field reference class (226 lines)
│   ├── tx-signature.js      ─ Key + signature pair (20 lines)
│   └── mongoose-models.js   ─ Mongoose model compilation
├── schemas/
│   └── tx-schema.js         ─ Joi + Joigoose schema (612 lines)
├── storage/
│   ├── storage-layer.js     ─ Singleton holding the active DataProvider
│   ├── data-provider.js     ─ Abstract base class
│   ├── mongoose-data-provider.js ─ Primary production provider (396 lines)
│   ├── inmemory-data-provider.js ─ Used in tests
│   └── (fs, mongodb, core-db, firestore providers)
└── utils/
    ├── logger.js            ─ Winston structured logging
    └── circuit-breaker.js   ─ Generic circuit breaker (not wired)
```

---

## 3. Bugs & Wrong Logic

### 3.1 · HIGH — `signStellarWithHsm` passes network ID instead of passphrase

**File**: `strategies/stellar-strategy.js` line 141
```js
const signedTx = TransactionBuilder.fromXDR(signedXdr, signer.txInfo.network);
```
`signer.txInfo.network` is a **numeric** Stellar network ID (`0`/`1`/`2`), not a network passphrase string. `TransactionBuilder.fromXDR()` requires the passphrase or a `Networks` constant. This will throw at runtime when HSM-signing a Stellar transaction.

**Fix**: resolve the passphrase first:
```js
const { resolveNetworkParams } = require("../network-resolver");
const { passphrase } = resolveNetworkParams(signer.txInfo.network);
const signedTx = TransactionBuilder.fromXDR(signedXdr, passphrase);
```

---

### 3.2 · HIGH — `signer.js` field declaration order vs constructor interaction

**File**: `signer.js` lines 69–90

The constructor sets `this.status = "created"` (line 66), then the class field declaration `status = "draft"` (line 73) can interfere. In ES2022 class semantics, *field initializers with values run as part of instance creation*, and the ordering between constructor body and field initializers can produce surprising results depending on engine behavior.

In practice `init()` re-sets `this.status` (line 99–100), which masks the issue. But the dual initialization is confusing and fragile.

**Fix**: Remove the `status = "draft"` field initializer. Let field declarations be type-only annotations (no value), and rely on the constructor for initial values:
```js
/** @type {'draft'|'created'|'updated'|'unchanged'} */
status;
```

---

### 3.3 · HIGH — `setStatus()` prevents transitions from `"created"` or `"updated"`

**File**: `signer.js` lines 299–302
```js
setStatus(newStatus) {
    if (this.status === "created" || this.status === "updated") return;
    this.status = newStatus;
}
```

Once `status` is `"created"`, calling `setStatus("updated")` is a no-op. After `processNewSignatures()` calls `this.setStatus("updated")` on a `"created"` record, the transition silently fails. While `saveChanges()` checks for both `"created"` and `"updated"` (so persistence still works), the guard logic appears inverted—it should *preserve* `"created"`/`"updated"` only by preventing *downgrades*, not blocking all transitions from those states.

---

### 3.4 · MEDIUM — `findSignatureByKey` has dead verification call

**File**: `signature-hint-utils.js` lines 59–63
```js
function findSignatureByKey(pubkey, allSignatures = []) {
  const matchingSignatures = allSignatures.filter((sig) =>
    hintMatchesKey(sig.hint(), pubkey)
  );
  return matchingSignatures.find((sig) => Keypair.fromPublicKey(pubkey));
}
```
The `.find()` callback always returns truthy (a Keypair instance) regardless of `sig`. It should verify the signature or simply return `matchingSignatures[0]`.

---

### 3.5 · MEDIUM — `TxSignature.toJSON()` assumes `signature` is a Buffer

**File**: `models/tx-signature.js` line 15
```js
toJSON() {
    return {key: this.key, signature: this.signature.toString('base64')}
}
```
For Algorand/EVM strategies, `signature` is a plain string (JSON or base64), not a Buffer. Calling `.toString('base64')` on a string returns the string itself in Node.js but is semantically incorrect.

**Fix**:
```js
toJSON() {
    const sig = Buffer.isBuffer(this.signature)
        ? this.signature.toString('base64')
        : this.signature;
    return { key: this.key, signature: sig };
}
```

---

### 3.6 · MEDIUM — `callback-handler` retry loop doesn't catch network errors

**File**: `callback-handler.js` lines 22–30
```js
for (let i = minShift; i <= maxShift; i++) {
    const response = await callbackHandler(txInfo);
    if (response.status >= 200 && response.status < 300) return;
    await new Promise((resolve) => setTimeout(resolve, 1 << i));
}
```
If `axios.post()` throws (DNS failure, connection refused, timeout), the error propagates immediately without retrying. Only non-2xx *responses* trigger retry.

**Fix**: Wrap the call in `try/catch` so network errors also retry.

---

### 3.7 · MEDIUM — `normalizeNetworkName` calls `.toLowerCase()` on numbers

**File**: `network-resolver.js` line 40
```js
default:
    return network.toLowerCase();
```
If `network` is a number not matched by any explicit case (e.g., `3`), this throws `TypeError`.

**Fix**: `return String(network).toLowerCase();`

---

### 3.8 · LOW — `1Money` / `onemoney` ambiguity in EVM_BLOCKCHAINS

`evm-handler.js` includes `"1money"` with `chainId: 1` (same as Ethereum mainnet). This causes collisions in any chain-ID-based lookup.

---

### 3.9 · LOW — Algorand/Solana handler `_simpleMsgpackDecode` is a stub

`algorand-handler.js` has a minimal msgpack decoder that handles only a subset of msgpack types. Complex Algorand transactions may fail to parse.

---

### 3.10 · LOW — Solana handler dead code in instruction parsing

`solana-handler.js` has unreachable branches in its instruction parser.

---

## 4. Security

### 4.1 · HIGH — `key-routes.js` accesses private `_hsmKeyStore` member

**File**: `api/key-routes.js` lines 139, 263, 310
```js
const metadata = await adapter._hsmKeyStore.getKeyMetadata({ keyId });
const result = await adapter._hsmKeyStore.rotateKey({ keyId, ... });
await adapter._hsmKeyStore.disableKey({ keyId, ... });
```
Three routes bypass the `HsmSigningAdapter` public API and directly access `_hsmKeyStore` (underscore-prefixed = conventionally private). If the adapter's internal structure changes, these routes break.

**Fix**: Add public methods to `HsmSigningAdapter`:
```js
async getKeyMetadata(keyId) { return this._hsmKeyStore.getKeyMetadata({ keyId }); }
async rotateKey(keyId, opts) { return this._hsmKeyStore.rotateKey({ keyId, ...opts }); }
async disableKey(keyId) { return this._hsmKeyStore.disableKey({ keyId }); }
```

---

### 4.2 · HIGH — `key-routes.js` POST `/:keyId/sign` accepts `tier` from request body

**File**: `api/key-routes.js` line 215
```js
const adapter = createAdapter(req.body.tier);
```
A caller can override the HSM tier (e.g., from `"envelope"` to `"direct"`) by passing `{"tier": "direct"}` in the request body. This bypasses intended tier restrictions.

**Fix**: Remove the tier override from the request body:
```js
const adapter = createAdapter(); // uses config.hsm.tier only
```

---

### 4.3 · MEDIUM — CORS allows requests with no `Origin` header

**File**: `middleware/cors.js`

The blacklist check returns `false` when `origin` is `null` or `undefined`. Non-browser clients send no `Origin` header, so they bypass the blacklist entirely. This is standard CORS behavior but means the blacklist only blocks browser-based requests.

If server-to-server blocking is needed, add an explicit API-key or allowlist check.

---

### 4.4 · MEDIUM — Callback URL SSRF risk

**File**: `callback-handler.js` — `callbackUrl` from the transaction record is POSTed to without URL validation. An attacker who submits a transaction with `callbackUrl: "http://169.254.169.254/latest/meta-data/"` could exfiltrate cloud metadata.

**Fix**: Validate callback URLs against a whitelist or block private/link-local IP ranges.

---

### 4.5 · MEDIUM — RPC URL credentials may appear in error logs

**File**: `tx-submitter.js` — The RPC URL is sanitized in the info log, but in the catch block the full `error.message` may include the URL with credentials.

---

### 4.6 · LOW — Custom `secureCompare` vs `crypto.timingSafeEqual`

**File**: `middleware/auth.js` lines 70–89

A hand-rolled constant-time comparison. Node.js provides `crypto.timingSafeEqual()` which is proven constant-time at the C level.

**Fix**:
```js
const crypto = require('crypto');
function secureCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}
```

---

### 4.7 · LOW — PostgreSQL connection without TLS validation

**File**: `storage/core-db-data-source.js` — `pg.Pool` is created without explicit SSL/TLS options. In production, connections should enforce TLS with `ssl: { rejectUnauthorized: true }`.

---

## 5. Performance

### 5.1 · HIGH — Finalizer streams ALL ready transactions without `.limit()`

**File**: `finalizer.js` lines 95–114

`scheduleTransactionsBatch()` calls `listTransactions({ status: "ready", minTime: { $lte: now } })` which opens a cursor over *all* matching documents. The loop breaks at `targetQueueSize`, but the cursor remains open server-side.

On a database with 100K+ ready transactions, this causes memory pressure and holds a MongoDB cursor slot.

**Fix**: Accept a `limit` parameter in `listTransactions`:
```js
return TxModel.find(mongooseFilter, projection).limit(limit || 1000).cursor();
```

---

### 5.2 · MEDIUM — Horizon servers cache key mismatch

**File**: `horizon-handler.js` — The LRU cache for Horizon `Server` instances may key on the raw network identifier, but `resolveNetworkParams` normalizes it. The same logical network (`"public"` / `"0"` / `"mainnet"`) produces different cache keys.

**Fix**: Always cache on the normalized network name.

---

### 5.3 · MEDIUM — `processNewSignatures` O(n×m) base64 comparison

**File**: `signer.js` lines 192–226

For each new signature, the code does a linear scan of `this.txInfo.signatures`. OK for typical multisig (2–5 signatures) but quadratic for larger sets.

**Mitigation**: Build a `Set` of existing signature strings before the loop.

---

### 5.4 · MEDIUM — `listTransactions` over-fetches fields

**File**: `mongoose-data-provider.js` lines 238–260

The projection includes ~18 fields even when the caller needs only `hash` and `status`. Accept a `fields` parameter to allow minimal projections.

---

### 5.5 · LOW — Enhanced queue unbounded retry timers

Retry delays create `setTimeout` handles not tracked by `kill()`. If the queue is killed mid-retry, pending timers fire post-shutdown.

---

### 5.6 · LOW — `fs-data-provider.js` no write debouncing

Every save does a full file write. Under concurrent load this creates file contention. Low impact since this provider is for development only.

---

## 6. Error Handling

### 6.1 · HIGH — `signer.init()` doesn't guard `schema` against strategy failure

**File**: `signer.js` lines 94–112

When `init()` calls the strategy's `initSigners()` and it throws (e.g., Horizon unreachable), `this.schema` remains `undefined`. Any subsequent call to `this.isReady` throws `Cannot read properties of undefined (reading 'checkFeasibility')`.

**Fix**: Guard `isReady`:
```js
get isReady() {
    if (!this.schema) return false;
    // ...existing logic
}
```

---

### 6.2 · HIGH — Finalizer `adaptiveConcurrency` uses `||` instead of `??`

**File**: `finalizer.js` line 24
```js
adaptiveConcurrency: config.adaptiveConcurrency || true,
```
`||` treats `false` as falsy, so explicitly setting `config.adaptiveConcurrency = false` still resolves to `true`. Same issue with `retryAttempts`, `retryDelay` where `0` is a valid value.

**Fix**: Use nullish coalescing `??` throughout.

---

### 6.3 · MEDIUM — `callback-handler` no error recovery on network failures

Overlaps with §3.6. Network errors from `axios.post()` propagate immediately; the transaction goes to "failed" with no retry at the callback level.

---

### 6.4 · MEDIUM — `storage-layer.js` has no `close()` method

`DataProvider` has `async close() {}` and `MongooseDataProvider` implements it, but the `storageLayer` singleton has no `close()` delegate. Graceful shutdown requires `storageLayer.dataProvider.close()` directly.

---

### 6.5 · MEDIUM — `account-info-provider.js` returns `undefined` silently

If the Horizon API call fails, the function catches and returns `undefined` without logging. Callers that destructure the result get confusing `TypeError`s.

---

### 6.6 · MEDIUM — Missing `schema` guard on `signer.isReady`

Related to §6.1. When `this.schema` is `undefined`, `this.isReady` throws. Add a null guard.

---

### 6.7 · LOW — `tx-loader.rehydrateTx` no guard for undefined network

Blockchain-agnostic transactions may have no `network` field, causing silent failures.

---

### 6.8 · LOW — `simple-predicate-matcher.js` wrong variable in error message

The error message references the wrong variable name in one code path.

---

## 7. Resource Leaks

### 7.1 · MEDIUM — Enhanced queue metrics interval not cleared on `kill()`

**File**: `queue/enhanced-queue.js`

`setupMonitoring()` creates a `setInterval` for metrics emission. If `kill()` doesn't `clearInterval` the metrics timer, it runs indefinitely.

---

### 7.2 · MEDIUM — PostgreSQL pools never closed

**File**: `storage/core-db-data-source.js` — `pg.Pool` instances are never explicitly closed on shutdown.

---

### 7.3 · MEDIUM — Finalizer `stop()` race with in-flight scheduling

**File**: `finalizer.js` lines 373–381

`stop()` clears the timeout and sets `processorTimerHandler = 0`, then awaits `finalizerQueue.kill()`. But if `scheduleTransactionsBatch()` is mid-execution, a new timer can slip in after the clear.

**Fix**: Add a `stopping` flag checked at the start of `scheduleTransactionsBatch()`.

---

### 7.4 · LOW — Circuit breaker timer leak on synchronous throw

If the wrapped function throws synchronously during the half-open state, the recovery timer may not be cleared.

---

## 8. Code Quality & Consistency

### 8.1 · `isEvmBlockchain()` duplicated across 3+ import paths

`evm-handler.js` exports `isEvmBlockchain()`, but it's imported via `./handlers/evm-handler`, `../handlers/evm-handler`, etc. Some files also inline EVM chain checks. Centralize to one canonical import.

---

### 8.2 · Callback URL regex duplicated ~7 times

The callback URL validation pattern appears in `tx-schema.js`, `api-routes.js`, and multiple test files. Extract to a shared constant.

---

### 8.3 · `mongodb-data-provider.js` appears legacy

Alongside `mongoose-data-provider.js` (the production provider), `mongodb-data-provider.js` exists with native MongoDB driver code. If unused, remove to reduce maintenance.

---

### 8.4 · Inconsistent logger initialization

Most files: `require('../utils/logger').forComponent('name')`
`cors.js`: `require('../utils/logger').child({ component: 'cors' })`

Both work but the inconsistency is surprising.

---

### 8.5 · `configGet` helper adopted unevenly

Some newer files (e.g., `enhanced-queue.js`) still use `config.queue || {}` instead of `configGet('queue', {})`.

---

### 8.6 · Algorand/Solana handlers have stub parsers

`algorand-handler.js` and `solana-handler.js` have partial implementations. Will need completing for production multi-chain support.

---

### 8.7 · Circuit breaker implemented but not wired

`utils/circuit-breaker.js` (189 lines, fully implemented and well-tested) is never imported by production code. Presumably for Horizon/RPC calls but never integrated.

---

## 9. Testing

### 9.1 · Overall Assessment

| Metric | Value |
|--------|-------|
| Test suites | 30 |
| Total tests | 866 |
| Pass rate | 100% |
| Test LOC | 9,917 |
| Source LOC | 14,327 |
| Test:Source ratio | 0.69:1 |

**Quality Ratings** (per-file assessment):

| Rating | Count | Example Files |
|--------|-------|---------------|
| Excellent | 6 | `signer.test.js`, `enhanced-queue.test.js`, `circuit-breaker.test.js`, `tx-schema.test.js` |
| Very Good | 9 | `hsm-signing-adapter.test.js`, `key-routes.test.js`, `monitoring-routes.test.js` |
| Good | 11 | `api-routes.test.js`, `originator-verifier.test.js`, `cors.test.js` |
| Adequate | 4 | `edge-cases.test.js`, `finalizer.test.js`, `simple-predicate-matcher.test.js` |

### 9.2 · Critical Coverage Gaps

These source files have **zero test coverage**:

| File | Lines | Risk |
|------|-------|------|
| `tx-loader.js` | 66 | Used in every transaction flow |
| `tx-params-parser.js` | 135 | Parsing logic with edge cases |
| `network-resolver.js` | 194 | Called by Stellar strategy |
| `info-handler.js` | 68 | Request info extraction |
| `signature-hint-utils.js` | 66 | Hint matching (contains bug §3.4) |
| `account-info-provider.js` | 83 | Horizon API integration |
| `std-error.js` | 23 | Utility — low risk |
| `timestamp-utils.js` | 29 | Utility — low risk |
| `tx-helpers.js` | 53 | XDR manipulation — low risk |

### 9.3 · Moderate Coverage Gaps

| Area | Notes |
|------|-------|
| `signer.processSignature` | Not directly tested (only via integration paths) |
| Database providers | No tests for `mongoose-data-provider` against real/mocked DB |
| `callback-handler` | Only tested via mock in finalizer; no unit tests for retry logic |
| `horizon-handler` | Stellar submission logic untested |
| Blockchain-agnostic validation | Schema validation for non-Stellar chains has minimal coverage |
| Integration test POST /tx | No success-path integration test (only error paths) |

### 9.4 · Test Infrastructure Strengths

- Clean `setup-jest.js` with proper timer cleanup in `afterAll`
- `InMemoryDataProvider` used consistently for unit tests
- Good mock isolation in strategy and handler tests
- `app-builder.js` helper for integration tests with supertest
- Coverage thresholds enforced in `jest.config.js`
- No `forceExit` — clean shutdown proves no resource leaks

---

## 10. Positive Observations

1. **Clean strategy decomposition**: `signer.js` decomposed into a thin orchestrator (312 lines) + 3 strategy modules. Each strategy is independently testable with clear responsibilities.

2. **Structured logging**: Consistent use of Winston with `forComponent()` and `forRequest()` child loggers. Log entries include correlation IDs via `request-id` middleware.

3. **Comprehensive Joi schema**: `tx-schema.js` (612 lines) provides thorough validation with blockchain-specific rules, custom validators, and Mongoose instance methods.

4. **Enhanced queue**: `enhanced-queue.js` — adaptive concurrency, metrics, retry with exponential backoff, event-driven monitoring. Well-tested (87 tests).

5. **Monitoring endpoints**: Full suite of `/monitoring/*` routes with per-blockchain filtering, health checks (including HSM), queue metrics, and admin operations — all API-key protected.

6. **Error standardization**: `standardError(status, message)` pattern and Express 5.1's async error handling eliminate boilerplate try/catch.

7. **Blockchain-agnostic design**: Registry + handler pattern makes adding new blockchains straightforward without modifying core logic.

8. **Test quality**: 866 tests, 100% pass rate. Strategy tests thoroughly cover init, signature processing, HSM signing, and error paths.

9. **Clean test infrastructure**: No `forceExit`, proper teardown hooks, `InMemoryDataProvider` isolation, coverage thresholds enforced.

---

## 11. Recommended Actions

### Immediate (pre-production)

| # | Issue | Refs | Effort |
|---|-------|------|--------|
| A1 | Fix `signStellarWithHsm` network passphrase | §3.1 | 15 min |
| A2 | Fix `adaptiveConcurrency: \|\|` → `??` (and other `\|\|` defaults) | §6.2 | 15 min |
| A3 | Remove `req.body.tier` override in key-routes sign endpoint | §4.2 | 10 min |
| A4 | Add public methods to `HsmSigningAdapter` for key management | §4.1 | 30 min |
| A5 | Fix `TxSignature.toJSON()` Buffer assumption | §3.5 | 10 min |
| A6 | Guard `signer.isReady` against undefined `schema` | §6.1, §6.6 | 10 min |
| A7 | Add `try/catch` in callback-handler retry loop | §3.6, §6.3 | 15 min |
| A8 | Use `crypto.timingSafeEqual` in auth middleware | §4.6 | 10 min |

### Medium-term (first sprint)

| # | Issue | Refs | Effort |
|---|-------|------|--------|
| B1 | Add `.limit()` to finalizer's `listTransactions` query | §5.1 | 30 min |
| B2 | Validate callback URLs against private IP ranges (SSRF) | §4.4 | 1 hr |
| B3 | Fix `normalizeNetworkName` for unexpected types | §3.7 | 10 min |
| B4 | Add `close()` to `storageLayer` singleton | §6.4 | 15 min |
| B5 | Fix `findSignatureByKey` dead verification call | §3.4 | 10 min |
| B6 | Write tests for `tx-loader`, `network-resolver`, `tx-params-parser` | §9.2 | 4 hrs |
| B7 | Wire circuit breaker for Horizon/RPC calls, or remove | §8.7 | 2 hrs |
| B8 | Add `stopping` flag to finalizer to prevent `stop()` race | §7.3 | 30 min |
| B9 | Normalize Horizon cache key in `horizon-handler` | §5.2 | 15 min |

### Long-term (technical debt)

| # | Issue | Refs | Effort |
|---|-------|------|--------|
| C1 | Remove legacy `mongodb-data-provider.js` if unused | §8.3 | 1 hr |
| C2 | Centralize `isEvmBlockchain` imports to one path | §8.1 | 30 min |
| C3 | Extract shared callback URL regex constant | §8.2 | 15 min |
| C4 | Complete Algorand/Solana handler implementations | §8.6 | 4 hrs |
| C5 | Add DB provider tests (Mongoose with in-memory MongoDB) | §9.3 | 4 hrs |
| C6 | Clean up `signer.js` field declaration ordering | §3.2 | 30 min |
| C7 | Unify logger initialization style across all files | §8.4 | 30 min |
| C8 | Finish `configGet` migration for remaining files | §8.5 | 30 min |
| C9 | Add integration test for successful POST /tx flow | §9.3 | 2 hrs |

---

*Total immediate fixes: ~2 hours of engineering time.*
*Total medium-term: ~1 day.*
*Total long-term: ~2 days.*
