# Sentinel Chain Protocol Upgrade Proposal

**Version:** 1.0
**Date:** 2026-04-13
**Source:** 9,913 mainnet node tests + SDK development findings
**Prepared by:** Sentinel SDK Team

---

## Executive Summary

Across 9,913 node test transactions on Sentinel mainnet (23 audit runs, test period 2026-03-19 to 2026-04-13), systematic analysis identified **8 chain-level protocol issues**, **5 node software issues**, and **9 cross-cutting recommendations** that collectively cause an **18% overall failure rate**.

The top three issues — insufficient balance handling in batch transactions, dead V2Ray services still accepting sessions, and chain Code 5 errors — account for **93% of all failures**. The remaining 7% is distributed across price validation bugs, session propagation lag, event format deficiencies, and LCD pagination inconsistencies.

This proposal recommends specific, targeted protocol changes, node software requirements, and economic mechanisms that, if implemented, would reduce the failure rate from 18% to under 3%. All findings are backed by transaction hashes on Sentinel mainnet.

A separate feature proposal (Part 5) addresses a structural gap in the subscription model: the current `MsgShareSubscription` interface supports only bytes-based allocation, blocking operators from offering time-based or hybrid commercial plans entirely on-chain.

---

## Table of Contents

1. [Test Data Overview](#test-data-overview)
2. [Part 1: Chain-Level Issues](#part-1-chain-level-issues)
3. [Part 2: Node Software Issues](#part-2-node-software-issues)
4. [Part 3: Economic Recommendations](#part-3-economic-recommendations)
5. [Part 4: Performance Recommendations](#part-4-performance-recommendations)
6. [Part 5: Protocol Enhancement — Time-Based Subscription Sharing](#part-5-protocol-enhancement--time-based-subscription-sharing)
7. [Recommendation Summary Table](#recommendation-summary-table)
8. [Appendix: Mainnet Transaction Evidence](#appendix-mainnet-transaction-evidence)

---

## Test Data Overview

| Metric | Value |
|--------|-------|
| Total node tests | 9,913 |
| Passed | 8,130 (82.0%) |
| Failed | 1,783 (18.0%) |
| Unique nodes tested | ~1,050 |
| Repeat offender nodes (fail 3+ times) | 15 |
| Chain error codes encountered | Code 5, Code 105, Code 106 |
| Test period | 2026-03-19 to 2026-04-13 |

### Failure Breakdown

| # | Category | Count | % of Failures | Layer |
|---|----------|-------|---------------|-------|
| 1 | Insufficient balance (Code 5) | 924 | 51.8% | Chain |
| 2 | V2Ray service dead (status OK, no ports) | 398 | 22.3% | Node software |
| 3 | Binary compatibility (spawn UNKNOWN) | 190 | 10.7% | Client |
| 4 | Unknown / unclassified | 156 | 8.7% | Mixed |
| 5 | Handshake 500 (Code 106: invalid price) | 50 | 2.8% | Chain |
| 6 | Address mismatch (400) | 21 | 1.2% | Node software |
| 7 | Session conflict (409 / Code 5) | 13 | 0.7% | Chain |
| 8 | Node deactivated | 7 | 0.4% | Chain |
| 9 | Network timeout | 7 | 0.4% | Network |
| 10 | Tunnel no connectivity | 5 | 0.3% | Transport |

---

## Part 1: Chain-Level Issues

### Issue 1: Code 5 — "Spendable Balance Insufficient" in Batch Transactions

**Severity:** CRITICAL
**Evidence:** 596 occurrences (33% of all failures)
**Chain error:** `Code: 5; Raw log: failed to execute message`

#### Problem

When submitting batch `MsgStartSession` transactions (e.g., 5 nodes per TX), the chain validates the total cost upfront but the error message does not specify which message in the batch failed or how much was needed. The client has no way to:

1. Know the exact shortfall before broadcasting
2. Identify which node in the batch caused the failure
3. Partially succeed (pay for 3 of 5 nodes when balance covers only 3)

#### Current Workaround

The SDK estimates cost per node from `gigabyte_prices`, but the chain may apply different pricing logic. The only reliable approach is: query balance → estimate → broadcast → catch Code 5 → retry with fewer nodes. This wastes gas on failed transactions and adds 6–15 seconds of latency per retry cycle.

#### Recommendations

- **R-1a:** Return per-message failure details in batch TX responses (which message index failed, and the reason)
- **R-1b:** Support partial execution of batch messages (succeed for messages 0–2, fail for 3–4, return partial results rather than full rollback)
- **R-1c:** Add a `QueryEstimateSessionCost` endpoint that returns the exact cost for a `MsgStartSession` without broadcasting

---

### Issue 2: Code 106 — "Invalid Price" Rejection

**Severity:** HIGH
**Evidence:** 50 occurrences across 14 distinct transactions
**Chain error:** `Code: 106; Raw log: failed to execute ... invalid price`

#### Problem

Nodes register with specific `gigabyte_prices`. Clients query these prices and include them in `MsgStartSession.max_price`. The chain rejects the transaction even though the client used the exact price the node registered with.

The price format has `denom`, `base_value` (`sdk.Dec`), and `quote_value`. Certain combinations that nodes successfully registered with are subsequently rejected by the chain's `MsgStartSession` validation logic — meaning the node registration and session validation use inconsistent validation rules.

**Affected operator pattern:** All nodes with a specific naming prefix (14 unique nodes from the same operator) reproduce this failure consistently.

#### Current Workaround

On Code 106, the SDK retries without `max_price`, letting the chain use the node's registered price directly. This works but:

1. The first transaction burns gas and fails
2. The client has no price protection (pays whatever the node charges)
3. The extra round-trip adds 6–10 seconds per connection

#### Recommendations

- **R-2a:** Fix price validation in `MsgStartSession` to accept the exact format that `MsgRegisterNode` / `MsgUpdateNodeDetails` accepts
- **R-2b:** If a node's registered price is invalid per session validation rules, reject the node registration — do not allow nodes to register prices that clients cannot use
- **R-2c:** Add price validation to `MsgRegisterNode` / `MsgUpdateNodeDetails` that runs the same logic as `MsgStartSession` validation, so invalid prices are caught at registration time

---

### Issue 3: TX Event Format — No `node_address` in Session Creation Events

**Severity:** HIGH
**Evidence:** Affects all batch session creation; directly caused 21 documented address mismatch failures

#### Problem

When a batch TX creates multiple sessions, the chain emits session events containing `session_id` but does **not** include `node_address`. Furthermore, event order is not guaranteed to match message order.

**Consequence:**

1. Client broadcasts `[MsgStartSession(nodeA), MsgStartSession(nodeB), ...]`
2. Chain returns events: `[session_id: 123, session_id: 456, ...]`
3. Client cannot map which session ID belongs to which node

#### Current Workaround

After every batch TX, the SDK must:

1. Wait 3 seconds for chain indexing
2. Query all active sessions for the wallet (expensive LCD pagination call)
3. Rebuild a session map by matching `node_address` in the full session objects
4. This adds 3–8 seconds per batch and generates significant LCD load

Attempting to map sessions by array index causes address mismatch failures on handshake — the node rejects the signature because the session belongs to a different node. Twenty-one failures were traced directly to this bug before the full session-map rebuild workaround was implemented.

#### Recommendations

- **R-3a:** Include `node_address` in `MsgStartSession` event attributes
- **R-3b:** Guarantee event order matches message order in batch TXs, or include a `message_index` attribute in each event
- **R-3c:** Return full session details (`session_id` + `node_address`) in the TX response body directly, not just as events

---

### Issue 4: Session Propagation Lag (Chain → Node)

**Severity:** MEDIUM
**Evidence:** ~5% of connections affected; documented across all 23 test runs

#### Problem

After `MsgStartSession` is confirmed in a block, nodes do not immediately see the session. The node's handshake endpoint returns "session does not exist on blockchain" (HTTP 500, code 5) for 2–12 seconds after TX confirmation.

**Propagation timing from 9,913 tests:**

| Delay | % of nodes |
|-------|------------|
| < 3 seconds | ~95% |
| 5–10 seconds | ~4% |
| 10+ seconds | ~1% |

#### Current Workaround

The SDK waits 5 seconds after session creation before attempting handshake. If the handshake fails with "does not exist," it retries up to 3 times with 3-second delays. This adds 5–17 seconds to every connection attempt and accounts for a meaningful fraction of the user-perceived latency.

#### Recommendations

- **R-4a:** Nodes should query their own local RPC (not LCD) for session verification — RPC has faster propagation than LCD
- **R-4b:** Add WebSocket subscription for session events on nodes — instant notification instead of polling the chain
- **R-4c:** Consider session pre-creation (reserve a session slot before payment is finalized) to eliminate post-payment propagation windows

---

### Issue 5: LCD API Pagination Inconsistencies

**Severity:** MEDIUM
**Evidence:** Documented across all node fetch operations; different endpoints disagree on node count by 5–10%

#### Problems Documented

1. **`count_total` is unreliable:** Paginated fetch of 1,052 nodes returned `count_total: 847` on one LCD endpoint and `count_total: 1052` on another for the same query.
2. **`next_key` is sometimes null when more data exists:** When requesting `limit=200` and receiving 200 results, `next_key` should always be set. Some endpoints return `null`, causing silent data truncation.
3. **Different LCD endpoints return different results:** Polkachu, QuokaStake, and PublicNode can disagree on node count by 5–10% at any given time due to differing indexing lag.

#### Current Workaround

The SDK uses `limit=5000` in a single request (viable for the current network size of ~1,050 nodes). For pagination-dependent queries, `count_total` is ignored entirely; the SDK checks `next_key` + actual result count to detect truncation. This is fragile and will break as the network grows.

#### Recommendations

- **R-5a:** Audit and fix LCD pagination across all endpoints (node, session, subscription, plan queries)
- **R-5b:** Add RPC query endpoints as a first-class supported query path — many clients already prefer RPC for reliability
- **R-5c:** Standardize LCD response format and pagination semantics across all query types

---

### Issue 6: v2 → v3 Field Name Migration Incomplete

**Severity:** LOW
**Evidence:** Observed in SDK normalization layer; requires dual-format handling throughout

#### Problem

The chain migrated from v2 to v3, but certain endpoints and field names remain in v2 format or return inconsistently:

| Field | v2 (legacy) | v3 (current) | Observed Status |
|-------|-------------|-------------|-----------------|
| Node service type | `type` | `service_type` | Both seen in responses |
| Remote endpoint | `remote_url` (string) | `remote_addrs` (array) | LCD returns array; some nodes return string |
| Account field | `address` | `acc_address` | Both seen in session objects |
| Session wrapper | Flat object | `base_session` wrapper | Some queries return flat, others wrapped |
| Status filter | `status=STATUS_ACTIVE` | `status=1` | String form returns "Not Implemented" on v3 paths |
| Provider endpoint | v3 path | v2 path | Provider is **still v2** (`/sentinel/provider/v2/providers/`) |

#### Current Workaround

SDK normalizes both formats at every call site:

```javascript
const type = node.service_type || node.type;
const addrs = node.remote_addrs || [node.remote_url];
const session = resp.base_session || resp;
```

#### Recommendations

- **R-6a:** Complete the v2→v3 migration for provider endpoints (currently hard-blocked on `/sentinel/provider/v2/providers/`)
- **R-6b:** Deprecate v2 field names with a published timeline (return both for 6 months, then drop v2 names)
- **R-6c:** Publish a canonical chain API specification with authoritative field names for each endpoint

---

### Issue 7: Session Conflict (409) Without Resolution Path

**Severity:** MEDIUM
**Evidence:** 13 occurrences

#### Problem

Nodes return HTTP 409 "session already exists" when a wallet already has an active session on that node. The existing session may be:

1. From a previous run (still active, not ended)
2. Poisoned (handshake failed; session is unusable)
3. Expired on the node side but not yet cleaned up on-chain

The client has no way to:
- End a session without the original handshake credentials
- Force a new session when the old one is stuck
- Query session health (usable vs. poisoned)

#### Current Workaround

The SDK creates a new session (paying again), waits for propagation, and retries the handshake with the new session ID. If the 409 persists even with a fresh session, the node is flagged as a "persistent 409" and skipped for the remainder of the session. This wastes tokens on stuck sessions.

#### Recommendations

- **R-7a:** Add a `MsgCancelSession` variant that works without original handshake credentials — authenticated only by the wallet signature that created the session
- **R-7b:** Add a session health check endpoint on nodes (`GET /session/{id}/health`) that reports whether a session is usable or should be recreated
- **R-7c:** Auto-expire sessions on-chain that have had no handshake activity within 10 minutes of creation

---

## Part 2: Node Software Issues

These issues require updates to `sentinel-dvpn-node`, not chain governance. They are listed here because they directly affect client behavior and token economics.

---

### Node Issue 1: V2Ray Service Dead — Status OK but No Ports Open

**Severity:** CRITICAL
**Evidence:** 398 failures (22.3% of all failures)

#### Problem

A node's `/status` endpoint returns HTTP 200 with `service_type: 2` (V2Ray) and `peers > 0`, but no V2Ray ports are actually listening. The status API is functional, the chain registration is active, but the VPN service itself has crashed or stopped.

**Root cause:** The V2Ray process crashes without the `sentinel-dvpn-node` health check detecting it. The node continues advertising itself as active, accepting sessions and burning client tokens, but cannot provide VPN service.

**Repeat offender patterns identified in 9,913 tests:**
- `kfmg*` family: 6 unique nodes, 40+ combined failures — V2Ray repeatedly crashes
- `000-*` family: 8 unique nodes, 30+ failures — intermittent V2Ray availability
- `SG2-10GNode-V2`: persistent V2Ray death across multiple test windows

#### Recommendations

- **N-1a:** `sentinel-dvpn-node` must health-check its VPN service (V2Ray/WireGuard) on a regular interval (suggested: every 60 seconds)
- **N-1b:** If the VPN service is detected as down, the node must automatically set its status to inactive and stop accepting new sessions
- **N-1c:** Expose VPN service health in the `/status` response: `{ "vpn_alive": true, "last_health_check": "<timestamp>" }`

---

### Node Issue 2: Address Mismatch on Handshake (Code 6)

**Severity:** HIGH
**Evidence:** 21 failures

#### Problem

Nodes return `{"code": 6, "message": "node address mismatch"}` on handshake. The client's session was created for node A, but node B responds at the same IP. This occurs when:

1. An operator runs multiple nodes on the same server with a shared IP
2. A node was migrated but its chain registration was not updated
3. The `remote_addrs` field points to the wrong node instance

**Persistent offenders identified:** Two specific node IPs reproduced this failure across 9+ tests each, confirming the issue is operator misconfiguration rather than transient.

#### Recommendations

- **N-2a:** `sentinel-dvpn-node` should verify on startup that its registered `remote_addrs` match its actual network interfaces, logging a warning if they do not
- **N-2b:** The chain should prevent registering two distinct nodes with identical `remote_addrs` IP:port combinations
- **N-2c:** The handshake error response for address mismatch should include the expected node address so clients can detect operator misconfiguration rather than assuming a transient failure

---

### Node Issue 3: Clock Drift Causing VMess AEAD Authentication Drain

**Severity:** MEDIUM
**Evidence:** Detected but mitigated after SDK fix; not counted as failure in final results

#### Problem

VMess AEAD authentication requires client and server clocks to be within ±120 seconds. Nodes with clock drift exceeding this threshold cause:

1. VMess connection opens successfully
2. Server reads random bytes for ~16 seconds (AEAD auth fails silently — no error returned)
3. Server closes the connection with "context canceled"
4. Client wastes 16 seconds per attempt

**Detected nodes:** Two specific nodes had drifts of +215 seconds and −887 seconds respectively.

#### Current Mitigation

The SDK measures clock drift from the HTTP `Date` header during the node status check. VMess nodes with drift > 120 seconds are tested with VLess protocol instead (VLess does not use timestamp-based authentication).

#### Recommendations

- **N-3a:** `sentinel-dvpn-node` should run NTP synchronization on startup and periodically (suggested: every hour)
- **N-3b:** Add clock drift (in seconds) to the `/status` response so clients can detect it without a separate measurement
- **N-3c:** Governance consideration: require nodes to maintain < 60 seconds of clock drift to remain in active status (enforceable via periodic on-chain attestation)

---

### Node Issue 4: QUIC Transport — 0% Success Rate

**Severity:** MEDIUM
**Evidence:** All QUIC-only nodes fail; filtered from results rather than counted

#### Problem

Nodes that advertise only QUIC transport (`transport_protocol: 6`) have a 0% success rate from tested clients. The V2Fly/V2Ray QUIC implementation appears broken or misconfigured in current node deployments.

#### Current Mitigation

The SDK identifies and skips QUIC-only nodes, flagging them as untestable with a clear diagnostic message.

#### Recommendations

- **N-4a:** Node operators should ensure at least one non-QUIC transport is available (TCP, WebSocket, or gRPC) alongside QUIC
- **N-4b:** The default `sentinel-dvpn-node` configuration should include TCP and WebSocket as baseline transports; QUIC should be opt-in

---

### Node Issue 5: Nodes Accepting Sessions When VPN Service Is Dead (Economic Impact)

**Severity:** CRITICAL
**Evidence:** Directly responsible for 398 token-wasting failures

#### Problem

This is the economic consequence of Node Issue 1. When a node's V2Ray or WireGuard service is down but the node remains registered as active:

1. Client discovers the node (appears healthy: peers > 0, status 200 OK)
2. Client pays for a session (~40 udvpn)
3. Client completes the handshake (handshake is with the status API, not the VPN service)
4. Client attempts VPN connection — fails (no ports open)
5. Session fee is lost

**Estimated economic impact from this test set:** 398 V2Ray-dead failures × ~40 udvpn = ~15,920 udvpn wasted on dead nodes during testing alone.

#### Recommendations

- **N-5a:** Before accepting a handshake POST, the node must verify its VPN service is running — do not accept a session if the VPN cannot serve it
- **N-5b:** Implement a refund mechanism: if a session is created but the handshake fails due to node-side issues (VPN down, address mismatch), the session fee should be automatically refundable within 5 minutes
- **N-5c:** Governance consideration: nodes that consistently accept sessions but cannot provide service should be subject to a staking slash

---

## Part 3: Economic Recommendations

### E-1: Pre-Flight Cost Estimation

**Problem:** There is no way to know the exact session cost before paying. Node prices are in `sdk.Dec` format (18 decimal places) and the chain applies pricing logic that differs from client-side estimation. This forces clients to either over-estimate (conservative, but wastes balance) or under-estimate (causes Code 5 failures).

**Recommendation:** Add a `QueryEstimateSessionCost` RPC endpoint that returns the exact cost for a proposed `MsgStartSession` without broadcasting the transaction. Input: node address + proposed duration or data cap. Output: exact udvpn cost. This eliminates speculative balance checks and allows clients to show users exact prices before payment.

---

### E-2: Session Refund Window

**Problem:** If a node is dead or misconfigured, the client loses the full session fee with no recourse. The current model requires clients to absorb 100% of the cost of failed connections caused by node-side failures.

**Recommendation:** Implement a 5-minute refund window: if no data has flowed through a session within 5 minutes of creation (measurable via the existing bandwidth proof system), the session fee is automatically returned to the client wallet. Nodes that trigger this refund repeatedly should face rate limits on new session acceptance.

---

### E-3: On-Chain Node Quality Scoring

**Problem:** Clients have no way to know node quality before paying. A node with 3 peers and 1 Mbps costs the same as a node with 50 peers and 500 Mbps. Quality differentiation is entirely invisible to the protocol.

**Recommendation:** Implement on-chain quality metrics: session success rate, average throughput (derived from bandwidth proofs), and uptime percentage. Allow clients to filter nodes by quality tier. Consider tiered staking rewards that incentivize high-quality node operation. This creates economic alignment between node quality and node rewards.

---

## Part 4: Performance Recommendations

### P-1: RPC as First-Class Query Path

**Problem:** LCD REST queries are slow (3–5 seconds for 1,000 nodes), have pagination bugs (see Issue 5), and different LCD endpoints can disagree on results. RPC via protobuf is consistently ~10x faster and returns authoritative data.

**Recommendation:** Document and officially support RPC queries as the primary query path for latency-sensitive operations. Ensure all Sentinel-specific queries (node list, subscription status, session status) have documented RPC equivalents with maintained compatibility guarantees. Publish an RPC query reference to reduce LCD dependency.

---

### P-2: WebSocket Event Subscriptions

**Problem:** Clients must poll LCD for session status, balance changes, and node updates. Polling creates unnecessary load on LCD infrastructure and adds 1–5 seconds of latency to detecting state changes (session end, balance depletion, node deactivation).

**Recommendation:** Formally support Tendermint WebSocket subscriptions for Sentinel-specific events: session created, session ended, node status changed, subscription created, allocation exhausted. This would allow client SDKs to react to chain events in near-real-time rather than polling on intervals.

---

### P-3: Structured Batch Session Creation Response

**Problem:** Creating multiple sessions in a single TX saves gas but makes response parsing unreliable (no `node_address` in events, no guaranteed event order — see Issue 3). Clients must perform expensive post-TX queries to reconstruct the session map.

**Recommendation:** Return a structured, ordered response for batch operations in the TX result body:

```json
[
  { "node_address": "sentnode1...", "session_id": 12345, "status": "created" },
  { "node_address": "sentnode1...", "session_id": 12346, "status": "created" }
]
```

This eliminates the post-TX session-map rebuild entirely and makes batch session creation safe and deterministic.

---

## Part 5: Protocol Enhancement — Time-Based Subscription Sharing

### Overview

This section is a **feature proposal**, not a bug report. It addresses a structural gap in the current subscription model that prevents operators from offering time-based or hybrid commercial plans using purely on-chain mechanisms.

**Severity:** HIGH (blocks an entire class of commercial VPN business models)
**Mainnet verification:** Confirmed on 2026-04-13

---

### Current Limitation

`MsgShareSubscriptionRequest` accepts only a `bytes` field (`cosmossdk.io/math.Int`). The on-chain `Allocation` structure is:

```protobuf
message Allocation {
  uint64 id = 1;
  string address = 2;          // recipient wallet
  string granted_bytes = 3;    // math.Int — the ONLY allocation metric
  string utilised_bytes = 4;   // math.Int — bytes consumed so far
}
```

There is no `duration`, `expires_at`, or `granted_time` field. This means:

1. **Operators cannot offer "30-day unlimited" plans** — only "X GB" plans
2. **Operators cannot offer "30 days OR 50 GB, whichever comes first"** — the most common commercial VPN pricing model
3. **Time-based expiry must be managed off-chain** — operators must track when a user's time is up, then manually revoke access. This is fragile, centralized, and undermines the value of on-chain subscription management.
4. **No on-chain enforcement of time limits** — a user with 100 GB allocated for "30 days" (tracked off-chain) could continue using the VPN indefinitely if the operator's off-chain system fails.

---

### Current Operator Reality

| Plan type | On-chain status | Implementation |
|-----------|----------------|----------------|
| Bytes-only ("10 GB for 100 P2P") | Fully supported | Chain handles everything |
| Time-only ("30 days unlimited") | Hacky | Operator allocates 1 TB, runs external service to revoke at day 30. If service fails, user gets free VPN indefinitely. |
| Hybrid ("30 days OR 50 GB") | Impossible on-chain | Cannot be expressed in a single allocation; requires two separate external systems |

---

### Proposed Chain Changes

#### R-8a: Add Optional Time Fields to `Allocation`

```protobuf
message Allocation {
  uint64 id = 1;
  string address = 2;
  string granted_bytes = 3;                           // existing — bytes limit (unchanged)
  string utilised_bytes = 4;                          // existing — bytes consumed (unchanged)
  google.protobuf.Timestamp granted_until = 5;        // NEW — time limit (optional, absent = no time limit)
  google.protobuf.Timestamp created_at = 6;           // NEW — when allocation was created
}
```

#### R-8b: Add Optional `duration` or `expires_at` to `MsgShareSubscriptionRequest`

```protobuf
message MsgShareSubscriptionRequest {
  string from = 1;
  uint64 id = 2;                                      // subscription ID (existing)
  string address = 3;                                 // recipient (existing)
  string bytes = 4;                                   // max bytes, 0 = unlimited bytes (existing)
  google.protobuf.Duration duration = 5;              // NEW — optional time limit from now
  google.protobuf.Timestamp expires_at = 6;           // NEW — optional absolute expiry timestamp
}
```

**Validation rule:** At most one of `duration` or `expires_at` may be set (or neither, for bytes-only behavior). If `duration` is set, `granted_until = block_time + duration`. If `expires_at` is set, `granted_until = expires_at`.

#### R-8c: On-Chain Time Enforcement

When a session submits bandwidth proofs, the chain should check both conditions:

1. `utilised_bytes < granted_bytes` — existing check (unchanged)
2. `block_time < granted_until` — new check, applied only when `granted_until` is set

If either condition fails, the session is terminated on-chain. No off-chain operator intervention is required.

#### R-8d: Hybrid Allocation Support

With both fields available, operators can express the full range of commercial plan structures:

| Plan structure | `bytes` | `duration` | Behavior |
|----------------|---------|------------|---------|
| Bytes-only | 50 GB | (absent) | Current behavior — no change |
| Time-only | 0 | 30 days | Unlimited data for 30 days |
| Hybrid | 50 GB | 30 days | 50 GB OR 30 days, whichever is exhausted first |

---

### Backward Compatibility Analysis

Both new fields (`duration` and `expires_at`) are optional with no default value. This means:

- All existing `MsgShareSubscription` calls that include only `bytes` will continue to work without modification
- Existing allocations without `granted_until` will behave exactly as they do today
- Nodes and clients that do not understand the new fields will continue to function for bytes-only plans
- Only the chain's session proof validation module needs to be updated to check `granted_until` when present

**Migration risk:** None for bytes-only plans. Time-based plans are entirely new functionality.

---

### SDK Readiness

Both the JavaScript and C# SDKs already implement `shareSubscription()` / `ShareSubscriptionAsync()`. Adding optional `duration` / `expiresAt` parameters to these functions is straightforward once chain support is confirmed. The SDK will detect chain version and include the new fields only when supported, preserving compatibility with older chain versions.

```javascript
// Existing (bytes-only) — no change required
await sdk.shareSubscription({ subscriptionId, recipient, bytes: '10737418240' });

// New (time-based) — once chain supports R-8a/R-8b
await sdk.shareSubscription({
  subscriptionId,
  recipient,
  bytes: '0',
  duration: { seconds: 2592000 } // 30 days
});

// New (hybrid) — once chain supports R-8a/R-8b
await sdk.shareSubscription({
  subscriptionId,
  recipient,
  bytes: '53687091200', // 50 GB
  duration: { seconds: 2592000 } // 30 days, whichever comes first
});
```

---

## Recommendation Summary Table

| ID | Recommendation | Severity | Type |
|----|----------------|----------|------|
| R-1a | Per-message failure details in batch TX responses | CRITICAL | Chain |
| R-1b | Partial execution of batch messages (succeed what can succeed) | HIGH | Chain |
| R-1c | `QueryEstimateSessionCost` simulation endpoint | HIGH | Chain |
| R-2a | Fix price validation — accept what `MsgRegisterNode` accepts | HIGH | Chain |
| R-2b | Reject invalid prices at node registration time | HIGH | Chain |
| R-2c | Unify price validation rules across `MsgRegisterNode` and `MsgStartSession` | HIGH | Chain |
| R-3a | Include `node_address` in `MsgStartSession` event attributes | HIGH | Chain |
| R-3b | Guarantee event order matches message order in batch TXs | MEDIUM | Chain |
| R-3c | Return session details (`session_id` + `node_address`) in TX response body | HIGH | Chain |
| R-4a | Nodes use local RPC (not LCD) for session verification | MEDIUM | Node |
| R-4b | WebSocket session event subscriptions on nodes | LOW | Node |
| R-4c | Session pre-creation / reservation mechanism | LOW | Chain |
| R-5a | Audit and fix LCD pagination across all endpoints | MEDIUM | Chain |
| R-5b | RPC as first-class query path with documentation | HIGH | Chain |
| R-5c | Standardize LCD response format and pagination semantics | MEDIUM | Chain |
| R-6a | Complete v2→v3 migration for provider endpoints | LOW | Chain |
| R-6b | Deprecate v2 field names with published timeline | LOW | Chain |
| R-6c | Publish canonical chain API field name specification | LOW | Chain |
| R-7a | `MsgCancelSession` without original handshake credentials | HIGH | Chain |
| R-7b | Session health check endpoint on nodes | MEDIUM | Node |
| R-7c | Auto-expire sessions with no handshake within 10 minutes | MEDIUM | Chain |
| N-1a | VPN service health check on nodes (60-second interval) | CRITICAL | Node |
| N-1b | Auto-deactivate node when VPN service is detected as down | CRITICAL | Node |
| N-1c | Expose `vpn_alive` + `last_health_check` in `/status` response | HIGH | Node |
| N-2a | Node startup self-check: verify `remote_addrs` match local interfaces | MEDIUM | Node |
| N-2b | Prevent duplicate `remote_addrs` IP:port registration on chain | MEDIUM | Chain |
| N-2c | Include expected node address in address mismatch handshake error | LOW | Node |
| N-3a | Mandatory NTP sync on node startup and periodically | MEDIUM | Node |
| N-3b | Expose clock drift in `/status` response | MEDIUM | Node |
| N-3c | Governance: require < 60s clock drift to maintain active status | LOW | Governance |
| N-4a | Require at least one non-QUIC transport per node | MEDIUM | Node |
| N-4b | Default node config: include TCP + WebSocket as baseline transports | LOW | Node |
| N-5a | Verify VPN service is running before accepting handshake POST | CRITICAL | Node |
| N-5b | Automatic 5-minute session fee refund if no data flows | HIGH | Chain |
| N-5c | Staking slash for nodes that consistently accept but cannot serve sessions | MEDIUM | Governance |
| E-1 | `QueryEstimateSessionCost` pre-flight RPC endpoint | HIGH | Chain |
| E-2 | 5-minute automatic session refund window | HIGH | Chain |
| E-3 | On-chain node quality scoring (success rate, throughput, uptime) | MEDIUM | Chain |
| P-1 | RPC first-class support with documented query reference | HIGH | Chain |
| P-2 | WebSocket event subscriptions for Sentinel-specific events | MEDIUM | Chain |
| P-3 | Structured batch session creation response format | HIGH | Chain |
| R-8a | Add `granted_until` and `created_at` to `Allocation` struct | HIGH | Chain |
| R-8b | Add optional `duration` / `expires_at` to `MsgShareSubscriptionRequest` | HIGH | Chain |
| R-8c | On-chain time enforcement in session bandwidth proof validation | HIGH | Chain |
| R-8d | Support hybrid bytes+time allocation (whichever exhausted first) | HIGH | Chain |

---

## Appendix: Mainnet Transaction Evidence

All findings are backed by verifiable transactions on Sentinel mainnet. Representative transaction hashes:

| Finding | Transaction Hash |
|---------|-----------------|
| Code 5 batch failure (Issue 1) | `FC241D8DEFC2B0CFFC67D27D736472217F6BC3E40A66D206B402D07423DA86E9` |
| Code 106 invalid price (Issue 2) | `E2A8E00C803753745F690F3377574E6C62B2954FD354639F865CCCF6F6B1B18C` |
| Code 5 session conflict (Issue 7) | `552674AF448634F9D5609EBDA390BA284EB0C3DA15B8FE522E3EAA2753284B3E` |
| Time-based sharing verification (Part 5) | `5E474CF1...` (2026-04-13, mainnet) |

Session propagation lag, address mismatch failures, and LCD pagination inconsistencies are documented across all 23 test runs in the node tester result archive (`results/runs/`).

---

*This proposal was prepared from empirical data collected during SDK development and mainnet integration testing. All recommendations are derived from observed failures with documented transaction evidence, not theoretical concerns.*
