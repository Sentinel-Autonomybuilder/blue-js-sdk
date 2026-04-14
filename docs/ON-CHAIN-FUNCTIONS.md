# Sentinel On-Chain Function Catalog

Complete reference for all on-chain message types and query functions supported by the Sentinel SDK, with exact signatures for both JavaScript and C# implementations.

**Chain version:** v3 (v2 paths return "Not Implemented" — except provider, which remains v2)  
**Token:** Display `P2P`, chain denom `udvpn` (1 P2P = 1,000,000 udvpn)  
**Gas price:** 0.2 udvpn per gas unit

---

## Overview

| Category | Count | Modules |
|----------|-------|---------|
| Sentinel node messages | 4 | `sentinel.node.v3` |
| Sentinel session messages | 2 | `sentinel.session.v3` |
| Sentinel subscription messages | 6 | `sentinel.subscription.v3` |
| Sentinel plan messages | 6 | `sentinel.plan.v3` |
| Sentinel provider messages | 3 | `sentinel.provider.v3` |
| Sentinel lease messages | 2 | `sentinel.lease.v1` |
| Cosmos feegrant messages | 2 | `cosmos.feegrant.v1beta1` |
| Cosmos authz messages | 3 | `cosmos.authz.v1beta1` |
| Cosmos bank messages | 1 | `cosmos.bank.v1beta1` |
| **Total registered** | **29** | |

---

## Address Formats

| Prefix | Type | Used By |
|--------|------|---------|
| `sent1...` | Account address | Consumers, operators (signing `from`) |
| `sentnode1...` | Node address | Node addresses in messages |
| `sentprov1...` | Provider address | Plan/provider `from` fields |

---

## Module: Node (`sentinel.node.v3`)

### MsgStartSessionRequest

Start a direct pay-per-GB or pay-per-hour session on a node. Charges the wallet for bandwidth before any data flows.

- **Type URL:** `/sentinel.node.v3.MsgStartSessionRequest`
- **Audience:** Consumer apps (end users)
- **Gas estimate:** ~200,000 gas (~40,000 udvpn fee)
- **Cost:** Node's gigabyte or hourly price, paid from wallet balance

**Protobuf fields:**

| Field | Number | Wire Type | Description |
|-------|--------|-----------|-------------|
| `from` | 1 | string | Account address (`sent1...`) |
| `node_address` | 2 | string | Node address (`sentnode1...`) |
| `gigabytes` | 3 | int64 | GB to purchase (set to 0 for hourly) |
| `hours` | 4 | int64 | Hours to purchase (set to 0 for GB) |
| `max_price` | 5 | embedded Price | Maximum acceptable price |

**JS — build layer (`protocol/messages.js`):**
```js
import { buildMsgStartSession } from './protocol/messages.js';

const msg = buildMsgStartSession({
  from,            // string — sent1... account address
  nodeAddress,     // string — sentnode1... node address
  gigabytes,       // number — default: 1. Set to 0 for hourly.
  hours,           // number — default: 0. Set to 1+ for hourly.
  maxPrice,        // { denom, base_value, quote_value } or undefined
});
// Returns: { typeUrl: '/sentinel.node.v3.MsgStartSessionRequest', value: object }
```

**JS — encode layer (`v3protocol.js` / `protocol/encoding.js`):**
```js
encodeMsgStartSession({ from, node_address, nodeAddress, gigabytes, hours, max_price, maxPrice })
// Returns: Uint8Array (raw protobuf bytes)
```

**C# (`MessageBuilder.Session.cs`):**
```csharp
SentinelMessage msg = MessageBuilder.StartSession(
    from,         // string — sent1... account address
    nodeAddress,  // string — sentnode1... node address
    gigabytes,    // long — default: 1. Set to 0 for hourly.
    maxPrice,     // PriceEntry? — optional max price
    hours         // long — default: 0. Set to 1+ for hourly.
);
// Validates: gigabytes 0-100, hours >= 0, not both zero
```

**Notes:**
- Exactly one of `gigabytes` or `hours` must be > 0; setting both > 0 is undefined behavior
- `maxPrice` must come from the node's LCD `gigabyte_prices` (GB sessions) or `hourly_prices` (hourly sessions) — the chain validates this exactly
- The chain enforces `max_price` strictly: if the node raises its price after you query, the TX fails with "invalid price"
- Session ID is extracted from TX events after broadcast — use `extractId(result, /session/i, ['session_id', 'id'])`
- After TX success, the handshake (POST to node URL) must complete within ~60 seconds before the chain auto-cancels

---

### MsgRegisterNodeRequest

Register a new node operator. One-time operation per node.

- **Type URL:** `/sentinel.node.v3.MsgRegisterNodeRequest`
- **Audience:** Node operators only (NOT consumer apps)
- **Gas estimate:** ~200,000 gas

**Protobuf fields:**

| Field | Number | Wire Type | Description |
|-------|--------|-----------|-------------|
| `from` | 1 | string | Account address (`sent1...`) |
| `gigabyte_prices` | 2 | embedded Price (repeated) | Per-GB prices |
| `hourly_prices` | 3 | embedded Price (repeated) | Per-hour prices |
| `remote_addrs` | 4 | string (repeated) | Node endpoints (e.g. `"1.2.3.4:8585"`) |

**JS:**
```js
import { buildMsgRegisterNode } from './protocol/messages.js';
const msg = buildMsgRegisterNode({ from, gigabytePrices, hourlyPrices, remoteAddrs });

// encodeMsg variant:
encodeMsgRegisterNode({ from, gigabytePrices, gigabyte_prices, hourlyPrices, hourly_prices, remoteAddrs, remote_addrs })
```

**C#:**
```csharp
SentinelMessage msg = MessageBuilder.RegisterNode(from, gigabytePrices, hourlyPrices, remoteAddrs);
```

---

### MsgUpdateNodeDetailsRequest

Update an existing node's pricing and/or endpoints.

- **Type URL:** `/sentinel.node.v3.MsgUpdateNodeDetailsRequest`
- **Audience:** Node operators only

**Protobuf fields:** Same as `MsgRegisterNodeRequest`.

**JS:**
```js
const msg = buildMsgUpdateNodeDetails({ from, gigabytePrices, hourlyPrices, remoteAddrs });
encodeMsgUpdateNodeDetails({ from, gigabytePrices, gigabyte_prices, hourlyPrices, hourly_prices, remoteAddrs, remote_addrs })
```

**C#:**
```csharp
SentinelMessage msg = MessageBuilder.UpdateNodeDetails(from, gigabytePrices, hourlyPrices, remoteAddrs);
```

---

### MsgUpdateNodeStatusRequest

Activate or deactivate a node.

- **Type URL:** `/sentinel.node.v3.MsgUpdateNodeStatusRequest`
- **Audience:** Node operators only

**Protobuf fields:**

| Field | Number | Wire Type | Description |
|-------|--------|-----------|-------------|
| `from` | 1 | string | Account address |
| `status` | 2 | int64/enum | 1=active, 2=inactive\_pending, 3=inactive |

**JS:**
```js
const msg = buildMsgUpdateNodeStatus({ from, status });
encodeMsgUpdateNodeStatus({ from, status })
```

**C#:**
```csharp
SentinelMessage msg = MessageBuilder.UpdateNodeStatus(from, status);
```

---

## Module: Session (`sentinel.session.v3`)

### MsgCancelSessionRequest

Cancel (end) an active session. Formerly named `MsgEndSession` in v2.

- **Type URL:** `/sentinel.session.v3.MsgCancelSessionRequest`
- **Audience:** Consumer apps (end users)
- **Gas estimate:** ~150,000 gas

**Protobuf fields:**

| Field | Number | Wire Type | Description |
|-------|--------|-----------|-------------|
| `from` | 1 | string | Account address (`sent1...`) |
| `id` | 2 | uint64 | Session ID |

**JS:**
```js
import { buildMsgCancelSession, buildMsgEndSession } from './protocol/messages.js';
// Both names work — buildMsgEndSession is an alias:
const msg = buildMsgCancelSession({ from, id });  // id: number | bigint

// encode variant:
encodeMsgEndSession({ from, id })  // from v3protocol.js / encoding.js
```

**C#:**
```csharp
SentinelMessage msg = MessageBuilder.EndSession(from, sessionId); // sessionId: ulong
// Validates: sessionId > 0
```

**Notes:**
- v3 removed the `rating` field that existed in v2 — do not send it
- `buildMsgEndSession` is a JS alias for `buildMsgCancelSession` (backward compatibility)
- In `broadcast.js`, `buildEndSessionMsg(from, sessionId)` uses `BigInt(sessionId)` for the `id` field while `buildMsgCancelSession` uses `Number(id)` — this is a known inconsistency. Use `buildMsgCancelSession` from `messages.js` for consumer apps.

---

### MsgUpdateSessionRequest

Report bandwidth usage for a session. Called by node operators, not consumers.

- **Type URL:** `/sentinel.session.v3.MsgUpdateSessionRequest`
- **Audience:** Node operators only

**Protobuf fields:**

| Field | Number | Wire Type | Description |
|-------|--------|-----------|-------------|
| `from` | 1 | string | Account address |
| `id` | 2 | uint64 | Session ID |
| `download_bytes` | 3 | int64 | Bytes downloaded |
| `upload_bytes` | 4 | int64 | Bytes uploaded |

**JS:**
```js
const msg = buildMsgUpdateSession({ from, id, downloadBytes, uploadBytes });
encodeMsgUpdateSession({ from, id, downloadBytes, download_bytes, uploadBytes, upload_bytes })
```

**C#:**
```csharp
SentinelMessage msg = MessageBuilder.UpdateSession(from, sessionId, downloadBytes, uploadBytes);
```

---

## Module: Subscription (`sentinel.subscription.v3`)

### MsgStartSubscriptionRequest

Subscribe to a plan (without starting a session). Use `MsgStartSessionRequest` via plan to subscribe + start session in one TX.

- **Type URL:** `/sentinel.subscription.v3.MsgStartSubscriptionRequest`
- **Audience:** Consumer apps (plan-based flow)
- **Gas estimate:** ~250,000 gas

**Protobuf fields:**

| Field | Number | Wire Type | Description |
|-------|--------|-----------|-------------|
| `from` | 1 | string | Account address (`sent1...`) |
| `id` | 2 | uint64 | Plan ID |
| `denom` | 3 | string | Payment denom (default: `"udvpn"`) |
| `renewal_price_policy` | 4 | int64 | 0=unspecified (omit when 0) |

**JS:**
```js
const msg = buildMsgStartSubscription({ from, id, denom, renewalPricePolicy });
// id is converted to Number(id) internally
encodeMsgStartSubscription({ from, id, denom, renewalPricePolicy, renewal_price_policy })
```

**C#:**
```csharp
SentinelMessage msg = MessageBuilder.StartSubscription(from, planId, denom, renewalPricePolicy);
// planId: ulong. renewalPricePolicy: int, default 0
// Validates: planId > 0
```

---

### MsgStartSessionRequest (subscription variant)

Start a session on an existing subscription (plan already subscribed).

- **Type URL:** `/sentinel.subscription.v3.MsgStartSessionRequest`
- **Audience:** Consumer apps (plan-based flow)

**Protobuf fields:**

| Field | Number | Wire Type | Description |
|-------|--------|-----------|-------------|
| `from` | 1 | string | Account address (`sent1...`) |
| `id` | 2 | uint64 | Subscription ID |
| `node_address` | 3 | string | Node address (`sentnode1...`) |

**JS:**
```js
const msg = buildMsgSubStartSession({ from, id, nodeAddress });
// id is converted to Number(id) internally
encodeMsgSubStartSession({ from, id, nodeAddress, node_address })
```

**C#:**
```csharp
SentinelMessage msg = MessageBuilder.SubStartSession(from, subscriptionId, nodeAddress);
// subscriptionId: ulong
// Validates: subscriptionId > 0, nodeAddress not empty
```

---

### MsgCancelSubscriptionRequest

Cancel an active subscription.

- **Type URL:** `/sentinel.subscription.v3.MsgCancelSubscriptionRequest`
- **Audience:** Consumer apps

**Protobuf fields:**

| Field | Number | Wire Type | Description |
|-------|--------|-----------|-------------|
| `from` | 1 | string | Account address |
| `id` | 2 | uint64 | Subscription ID |

**JS:**
```js
const msg = buildMsgCancelSubscription({ from, id });
encodeMsgCancelSubscription({ from, id })
```

**C#:**
```csharp
SentinelMessage msg = MessageBuilder.CancelSubscription(from, subscriptionId);
```

---

### MsgRenewSubscriptionRequest

Renew an expiring subscription.

- **Type URL:** `/sentinel.subscription.v3.MsgRenewSubscriptionRequest`

**Protobuf fields:**

| Field | Number | Wire Type | Description |
|-------|--------|-----------|-------------|
| `from` | 1 | string | Account address |
| `id` | 2 | uint64 | Subscription ID |
| `denom` | 3 | string | Payment denom (default: `"udvpn"`) |

**JS:**
```js
const msg = buildMsgRenewSubscription({ from, id, denom });
encodeMsgRenewSubscription({ from, id, denom })
```

**C#:**
```csharp
SentinelMessage msg = MessageBuilder.RenewSubscription(from, subscriptionId, denom);
```

---

### MsgShareSubscriptionRequest

Share a subscription's bandwidth with another address.

- **Type URL:** `/sentinel.subscription.v3.MsgShareSubscriptionRequest`
- **Audience:** Plan operators (sharing with users)

**Protobuf fields:**

| Field | Number | Wire Type | Description |
|-------|--------|-----------|-------------|
| `from` | 1 | string | Subscription owner address |
| `id` | 2 | uint64 | Subscription ID |
| `acc_address` | 3 | string | Recipient address |
| `bytes` | 4 | **string** | Bandwidth quota in bytes (cosmossdk.io/math.Int) |

**JS:**
```js
const msg = buildMsgShareSubscription({ from, id, accAddress, bytes });
// bytes converted to String(bytes) internally
encodeMsgShareSubscription({ from, id, accAddress, acc_address, bytes })
```

**C#:**
```csharp
SentinelMessage msg = MessageBuilder.ShareSubscription(from, subscriptionId, accAddress, bytes);
// bytes: long, written as string (WriteStringField) — NOT varint
```

**Critical note:** The `bytes` field is `cosmossdk.io/math.Int` — its protobuf wire type is **string (wire type 2)**, not varint (wire type 0). Using varint encoding causes a silent TX failure. Both JS and C# SDKs correctly use `String(bytes)` / `bytes.ToString()`.

**Sharing semantics:** The chain only supports bytes-based bandwidth sharing. There is no time/duration field. For monthly plans, the operator must track expiry externally and remove users when time expires.

---

### MsgUpdateSubscriptionRequest

Update a subscription's renewal price policy.

- **Type URL:** `/sentinel.subscription.v3.MsgUpdateSubscriptionRequest`

**Protobuf fields:**

| Field | Number | Wire Type | Description |
|-------|--------|-----------|-------------|
| `from` | 1 | string | Account address |
| `id` | 2 | uint64 | Subscription ID |
| `renewal_price_policy` | 3 | int64/enum | Renewal policy value |

**JS:**
```js
const msg = buildMsgUpdateSubscription({ from, id, renewalPricePolicy });
encodeMsgUpdateSubscription({ from, id, renewalPricePolicy, renewal_price_policy })
```

**C#:**
```csharp
SentinelMessage msg = MessageBuilder.UpdateSubscription(from, subscriptionId, renewalPricePolicy);
```

---

## Module: Plan (`sentinel.plan.v3`)

### MsgStartSessionRequest (plan variant)

Subscribe to a plan AND start a session in one TX. This is the recommended single-step flow for plan-based consumer apps.

- **Type URL:** `/sentinel.plan.v3.MsgStartSessionRequest`
- **Audience:** Consumer apps (plan-based flow — recommended)

**Protobuf fields:**

| Field | Number | Wire Type | Description |
|-------|--------|-----------|-------------|
| `from` | 1 | string | Account address (`sent1...`) |
| `id` | 2 | uint64 | Plan ID |
| `denom` | 3 | string | Payment denom (default: `"udvpn"`) |
| `renewal_price_policy` | 4 | int64 | Omit when 0 |
| `node_address` | 5 | string | Node to start session on |

**JS:**
```js
const msg = buildMsgPlanStartSession({ from, id, denom, renewalPricePolicy, nodeAddress });
encodeMsgPlanStartSession({ from, id, denom, renewalPricePolicy, renewal_price_policy, nodeAddress, node_address })
```

**C#:**
```csharp
SentinelMessage msg = MessageBuilder.PlanStartSession(from, planId, denom, nodeAddress);
// planId: ulong. nodeAddress is optional (string?)
// Validates: planId > 0
```

---

### MsgCreatePlanRequest

Create a new subscription plan. Plans start **INACTIVE** by default — a separate `MsgUpdatePlanStatusRequest` is required to activate.

- **Type URL:** `/sentinel.plan.v3.MsgCreatePlanRequest`
- **Audience:** Plan operators only

**Protobuf fields:**

| Field | Number | Wire Type | Description |
|-------|--------|-----------|-------------|
| `from` | 1 | string | Provider address (`sentprov1...`) |
| `bytes` | 2 | string | Total bandwidth (e.g. `"10000000000"` = 10 GB) |
| `duration` | 3 | embedded Duration | Plan validity period |
| `prices` | 4 | embedded Price (repeated) | Subscription cost |
| `is_private` | 5 | bool/varint | Optional, omit when false |

**JS:**
```js
const msg = buildMsgCreatePlan({ from, bytes, duration, prices, isPrivate });
// duration: { seconds: N } or number (seconds)
// bytes: converted to String(bytes)
encodeMsgCreatePlan({ from, bytes, duration, prices, isPrivate })
```

**C#:**
```csharp
SentinelMessage msg = MessageBuilder.CreatePlan(from, bytes, durationSeconds, prices, isPrivate);
// from: sentprov1... provider address
// bytes: string
// durationSeconds: long (must be > 0)
// prices: PriceEntry[]
// Validates: durationSeconds > 0
```

**Notes:**
- Plans are **INACTIVE** after creation. You must broadcast `MsgUpdatePlanStatusRequest` with `status=1` to activate.
- The `from` field must be the `sentprov1...` provider address, not the `sent1...` account address.

---

### MsgUpdatePlanDetailsRequest

Update plan bandwidth, duration, or prices without recreating.

- **Type URL:** `/sentinel.plan.v3.MsgUpdatePlanDetailsRequest`

**Protobuf fields:**

| Field | Number | Wire Type | Description |
|-------|--------|-----------|-------------|
| `from` | 1 | string | Provider address (`sentprov1...`) |
| `id` | 2 | uint64 | Plan ID |
| `bytes` | 3 | string | New bandwidth (optional) |
| `duration` | 4 | embedded Duration | New validity period (optional) |
| `prices` | 5 | embedded Price (repeated) | New prices (optional) |

**JS:**
```js
const msg = buildMsgUpdatePlanDetails({ from, id, bytes, duration, prices });
encodeMsgUpdatePlanDetails({ from, id, bytes, duration, prices })
```

**C#:**
```csharp
SentinelMessage msg = MessageBuilder.UpdatePlanDetails(from, planId, bytes, durationSeconds, prices);
// All params after planId are nullable/optional
```

---

### MsgUpdatePlanStatusRequest

Activate or deactivate a plan.

- **Type URL:** `/sentinel.plan.v3.MsgUpdatePlanStatusRequest`

**Protobuf fields:**

| Field | Number | Wire Type | Description |
|-------|--------|-----------|-------------|
| `from` | 1 | string | Provider address (`sentprov1...`) |
| `id` | 2 | uint64 | Plan ID |
| `status` | 3 | int64/enum | 1=active, 2=inactive\_pending, 3=inactive |

**JS:**
```js
const msg = buildMsgUpdatePlanStatus({ from, id, status });
encodeMsgUpdatePlanStatus({ from, id, status })
```

**C#:**
```csharp
SentinelMessage msg = MessageBuilder.UpdatePlanStatus(from, planId, status);
// Validates: planId > 0, status 1-3
```

---

### MsgLinkNodeRequest

Link a leased node to a plan. The node must have an active lease from the provider before linking.

- **Type URL:** `/sentinel.plan.v3.MsgLinkNodeRequest`

**Protobuf fields:**

| Field | Number | Wire Type | Description |
|-------|--------|-----------|-------------|
| `from` | 1 | string | Provider address (`sentprov1...`) |
| `id` | 2 | uint64 | Plan ID |
| `node_address` | 3 | string | Node address (`sentnode1...`) |

**JS:**
```js
const msg = buildMsgLinkNode({ from, id, nodeAddress });
encodeMsgLinkNode({ from, id, nodeAddress, node_address })
```

**C#:**
```csharp
SentinelMessage msg = MessageBuilder.LinkNode(from, planId, nodeAddress);
// Validates: planId > 0, nodeAddress not empty
```

**Notes:**
- Fails with "lease not found" if no active lease exists for this node
- Fails with "duplicate node for plan" if node is already linked
- Sequence: `StartLease` → wait for TX → `LinkNode`

---

### MsgUnlinkNodeRequest

Remove a node from a plan.

- **Type URL:** `/sentinel.plan.v3.MsgUnlinkNodeRequest`

**Protobuf fields:** Same structure as `MsgLinkNodeRequest`.

**JS:**
```js
const msg = buildMsgUnlinkNode({ from, id, nodeAddress });
encodeMsgUnlinkNode({ from, id, nodeAddress, node_address })
```

**C#:**
```csharp
SentinelMessage msg = MessageBuilder.UnlinkNode(from, planId, nodeAddress);
```

---

## Module: Provider (`sentinel.provider.v3`)

### MsgRegisterProviderRequest

Register as a dVPN provider. One wallet = one provider. One-time operation.

- **Type URL:** `/sentinel.provider.v3.MsgRegisterProviderRequest`
- **Audience:** Plan operators only

**Protobuf fields:**

| Field | Number | Wire Type | Description |
|-------|--------|-----------|-------------|
| `from` | 1 | string | Account address (`sent1...`) |
| `name` | 2 | string | Provider display name |
| `identity` | 3 | string | Optional identity |
| `website` | 4 | string | Optional website URL |
| `description` | 5 | string | Optional description |

**JS:**
```js
const msg = buildMsgRegisterProvider({ from, name, identity, website, description });
encodeMsgRegisterProvider({ from, name, identity, website, description })
```

**C#:**
```csharp
SentinelMessage msg = MessageBuilder.RegisterProvider(from, name, identity, website, description);
// identity, website, description: nullable strings
// Validates: from and name not empty
```

**Notes:**
- Fails with "duplicate provider" if wallet already registered a provider
- After registration, the provider address (`sentprov1...`) is derived from the account address (`sent1...`)
- Provider endpoint remains at LCD v2: `/sentinel/provider/v2/providers/{sentprov1...}` (not migrated to v3)

---

### MsgUpdateProviderDetailsRequest

Update provider metadata.

- **Type URL:** `/sentinel.provider.v3.MsgUpdateProviderDetailsRequest`

**Protobuf fields:** Same as `MsgRegisterProviderRequest`.

**JS:**
```js
const msg = buildMsgUpdateProviderDetails({ from, name, identity, website, description });
encodeMsgUpdateProviderDetails({ from, name, identity, website, description })
// Note: from should be sentprov1... in v3protocol, but JS accepts both
```

**C#:**
```csharp
SentinelMessage msg = MessageBuilder.UpdateProviderDetails(from, name, identity, website, description);
// from: sentprov1... provider address
// All params after from are nullable/optional
```

---

### MsgUpdateProviderStatusRequest

Activate or deactivate a provider.

- **Type URL:** `/sentinel.provider.v3.MsgUpdateProviderStatusRequest`

**Protobuf fields:**

| Field | Number | Wire Type | Description |
|-------|--------|-----------|-------------|
| `from` | 1 | string | Account address (`sent1...`) |
| `status` | 2 | int64/enum | 1=active, 2=inactive\_pending, 3=inactive |

**JS:**
```js
const msg = buildMsgUpdateProviderStatus({ from, status });
encodeMsgUpdateProviderStatus({ from, status })
```

**C#:**
```csharp
SentinelMessage msg = MessageBuilder.UpdateProviderStatus(from, status);
// Validates: status 1-3
```

---

## Module: Lease (`sentinel.lease.v1`)

### MsgStartLeaseRequest

Lease a node from its operator. Providers use leases to access nodes for their plans.

- **Type URL:** `/sentinel.lease.v1.MsgStartLeaseRequest`
- **Audience:** Plan operators only

**Protobuf fields:**

| Field | Number | Wire Type | Description |
|-------|--------|-----------|-------------|
| `from` | 1 | string | Provider address (`sentprov1...`) |
| `node_address` | 2 | string | Node address (`sentnode1...`) |
| `hours` | 3 | int64 | Lease duration in hours |
| `max_price` | 4 | embedded Price | Max hourly price (must match node exactly) |
| `renewal_price_policy` | 5 | int64 | Omit when 0 |

**JS:**
```js
const msg = buildMsgStartLease({ from, nodeAddress, hours, maxPrice, renewalPricePolicy });
encodeMsgStartLease({ from, nodeAddress, node_address, hours, maxPrice, max_price, renewalPricePolicy, renewal_price_policy })
```

**C#:**
```csharp
SentinelMessage msg = MessageBuilder.StartLease(from, nodeAddress, hours, maxPrice, renewalPricePolicy);
// from: sentprov1... provider address
// hours: long (must be > 0)
// maxPrice: PriceEntry? (optional but recommended)
// Validates: hours > 0
```

**Critical:** `maxPrice` must exactly match the node's current `hourly_prices` entry from LCD. Any mismatch (including stale price after a node update) → chain error "invalid price".

---

### MsgEndLeaseRequest

End an active lease.

- **Type URL:** `/sentinel.lease.v1.MsgEndLeaseRequest`
- **Audience:** Plan operators only

**Protobuf fields:**

| Field | Number | Wire Type | Description |
|-------|--------|-----------|-------------|
| `from` | 1 | string | Provider address (`sentprov1...`) |
| `id` | 2 | uint64 | Lease ID |

**JS:**
```js
const msg = buildMsgEndLease({ from, id });
encodeMsgEndLease({ from, id })
```

**C#:**
```csharp
SentinelMessage msg = MessageBuilder.EndLease(from, leaseId);
// leaseId: ulong (must be > 0)
```

---

## Module: Cosmos Feegrant (`cosmos.feegrant.v1beta1`)

### MsgGrantAllowance

Grant a fee allowance — the granter pays gas fees on behalf of the grantee.

- **Type URL:** `/cosmos.feegrant.v1beta1.MsgGrantAllowance`
- **Audience:** Plan operators (paying user gas), any wallet

**Protobuf fields:**

| Field | Number | Wire Type | Description |
|-------|--------|-----------|-------------|
| `granter` | 1 | string | Address paying fees |
| `grantee` | 2 | string | Address receiving grant |
| `allowance` | 3 | embedded Any | Wraps `BasicAllowance` |

`BasicAllowance` fields:

| Field | Number | Type | Description |
|-------|--------|------|-------------|
| `spend_limit` | 1 | repeated Coin | Optional max spend |
| `expiration` | 2 | Timestamp | Optional expiry |

**JS (build from `broadcast.js`):**
```js
// No dedicated buildMsgGrantAllowance in messages.js — construct directly or use broadcast helpers:
import { broadcastWithFeeGrant } from './chain/broadcast.js';

// For consumer TX with fee grant:
await broadcastWithFeeGrant(client, signerAddress, msgs, granterAddress, memo);
// gasPerMsg = 200,000; gasLimit = max(300,000, msgs.length * gasPerMsg)
```

**C#:**
```csharp
SentinelMessage msg = MessageBuilder.GrantFeeAllowance(
    granter,          // string — address paying fees
    grantee,          // string — address receiving grant
    spendLimitUdvpn,  // long? — optional max spend
    expiration        // DateTime? — optional expiry (UTC)
);
```

**Notes:**
- `client.simulate()` does NOT work with fee grants (CosmJS limitation) — use a fixed gas estimate instead
- Recommended fixed gas: 300,000 per single-message TX; scale by `msgs.length * 200,000` for multi-message

---

### MsgRevokeAllowance

Revoke a previously granted fee allowance.

- **Type URL:** `/cosmos.feegrant.v1beta1.MsgRevokeAllowance`

**Protobuf fields:**

| Field | Number | Wire Type | Description |
|-------|--------|-----------|-------------|
| `granter` | 1 | string | Address that granted fees |
| `grantee` | 2 | string | Address whose grant is revoked |

**C#:**
```csharp
SentinelMessage msg = MessageBuilder.RevokeFeeAllowance(granter, grantee);
```

**JS:** Construct the `{ typeUrl, value }` object directly using `MSG_TYPES.REVOKE_FEE_ALLOWANCE`.

---

## Module: Cosmos Authz (`cosmos.authz.v1beta1`)

### MsgGrant

Grant authorization for a grantee to execute a specific message type on behalf of the granter.

- **Type URL:** `/cosmos.authz.v1beta1.MsgGrant`

**Protobuf fields:**

| Field | Number | Wire Type | Description |
|-------|--------|-----------|-------------|
| `granter` | 1 | string | Address granting permission |
| `grantee` | 2 | string | Address receiving permission |
| `grant` | 3 | embedded Grant | Contains GenericAuthorization + optional expiry |

`Grant` wraps `GenericAuthorization` (which contains the `msg` type URL) inside a `google.protobuf.Any`.

**C#:**
```csharp
SentinelMessage msg = MessageBuilder.AuthzGrant(
    granter,      // string
    grantee,      // string
    msgTypeUrl,   // string — e.g. "/sentinel.node.v3.MsgStartSessionRequest"
    expiration    // DateTime? — optional
);
```

**JS:** Construct directly using `MSG_TYPES.AUTHZ_GRANT`.

---

### MsgRevoke

Revoke a previously granted authorization.

- **Type URL:** `/cosmos.authz.v1beta1.MsgRevoke`

**Protobuf fields:**

| Field | Number | Wire Type | Description |
|-------|--------|-----------|-------------|
| `granter` | 1 | string | Address that granted permission |
| `grantee` | 2 | string | Address whose permission is revoked |
| `msg_type_url` | 3 | string | Message type URL to revoke |

**C#:**
```csharp
SentinelMessage msg = MessageBuilder.AuthzRevoke(granter, grantee, msgTypeUrl);
```

---

### MsgExec

Execute messages on behalf of a granter using a previously granted authorization.

- **Type URL:** `/cosmos.authz.v1beta1.MsgExec`

**Protobuf fields:**

| Field | Number | Wire Type | Description |
|-------|--------|-----------|-------------|
| `grantee` | 1 | string | Address executing on behalf of granter |
| `msgs` | 2 | repeated Any | Messages to execute (pre-built, wrapped as Any) |

**C#:**
```csharp
SentinelMessage exec = MessageBuilder.AuthzExec(grantee, new[] { innerMsg1, innerMsg2 });
// innerMsgs: SentinelMessage[] — each wrapped as Any internally
// Validates: at least one inner message required
```

---

## Module: Cosmos Bank (`cosmos.bank.v1beta1`)

### MsgSend

Transfer P2P tokens between addresses.

- **Type URL:** `/cosmos.bank.v1beta1.MsgSend`

**Protobuf fields:**

| Field | Number | Wire Type | Description |
|-------|--------|-----------|-------------|
| `from_address` | 1 | string | Sender address |
| `to_address` | 2 | string | Recipient address |
| `amount` | 3 | repeated Coin | Token amount(s) |

**JS (`broadcast.js`):**
```js
import { sendTokens } from './chain/broadcast.js';

// High-level:
await sendTokens(client, fromAddress, toAddress, amountUdvpn, memo);
// amountUdvpn: string | number | bigint | { amount, denom }

// Low-level batch:
const msgs = buildBatchSend(fromAddress, [
  { address: to1, amountUdvpn: 1000000 },
  { address: to2, amountUdvpn: 2000000 },
]);
await broadcast(client, fromAddress, msgs);
```

**C#:**
```csharp
SentinelMessage msg = MessageBuilder.Send(from, to, amountUdvpn);
// amountUdvpn: long (must be > 0)
```

---

## JS SDK — Registry and Broadcast Layer

### `buildRegistry()` — `chain/client.js`

Registers all 23 Sentinel message types with CosmJS. Required before any `signAndBroadcast` call.

```js
import { buildRegistry } from './chain/client.js';
// Called internally by createClient() — no manual call needed for most use cases.
```

All registered type URLs (from `buildRegistry()`):

```
/sentinel.node.v3.MsgStartSessionRequest
/sentinel.session.v3.MsgCancelSessionRequest
/sentinel.subscription.v3.MsgStartSubscriptionRequest
/sentinel.subscription.v3.MsgStartSessionRequest
/sentinel.plan.v3.MsgStartSessionRequest
/sentinel.plan.v3.MsgCreatePlanRequest
/sentinel.plan.v3.MsgLinkNodeRequest
/sentinel.plan.v3.MsgUnlinkNodeRequest
/sentinel.plan.v3.MsgUpdatePlanStatusRequest
/sentinel.provider.v3.MsgRegisterProviderRequest
/sentinel.provider.v3.MsgUpdateProviderDetailsRequest
/sentinel.provider.v3.MsgUpdateProviderStatusRequest
/sentinel.plan.v3.MsgUpdatePlanDetailsRequest
/sentinel.lease.v1.MsgStartLeaseRequest
/sentinel.lease.v1.MsgEndLeaseRequest
/sentinel.subscription.v3.MsgCancelSubscriptionRequest
/sentinel.subscription.v3.MsgRenewSubscriptionRequest
/sentinel.subscription.v3.MsgShareSubscriptionRequest
/sentinel.subscription.v3.MsgUpdateSubscriptionRequest
/sentinel.session.v3.MsgUpdateSessionRequest
/sentinel.node.v3.MsgRegisterNodeRequest
/sentinel.node.v3.MsgUpdateNodeDetailsRequest
/sentinel.node.v3.MsgUpdateNodeStatusRequest
```

Cosmos standard types (feegrant, authz, bank) are included via `defaultRegistryTypes`.

### `MSG_TYPES` constants — `chain/client.js`

```js
import { MSG_TYPES } from './chain/client.js';
// Same constants also exported as TYPE_URLS from './protocol/messages.js'
```

### `broadcast(client, signerAddress, msgs, fee)` — `chain/broadcast.js`

Simple single-shot broadcast. Use for one-off TXs.

```js
import { broadcast } from './chain/broadcast.js';
const result = await broadcast(client, address, [msg]);
// fee: optional. Null/'auto'/{gas,amount} — defaults to 'auto'
// Throws ChainError on network failure or non-zero code
```

### `createSafeBroadcaster(rpcUrl, wallet, signerAddress)` — `chain/broadcast.js`

Mutex-serialized broadcaster with sequence recovery and RPC rotation. Use for any workflow sending multiple TXs.

```js
const { safeBroadcast } = createSafeBroadcaster(rpcUrl, wallet, signerAddress);
const result = await safeBroadcast([msg1, msg2]); // batch = one TX
// Retries: 5 attempts, 2s/4s/6s backoff, sequence reset on error code 32
// RPC rotation: tries all endpoints on connection failure
```

### `broadcastWithFeeGrant(client, signerAddress, msgs, granterAddress, memo)` — `chain/broadcast.js`

Broadcast with fee grant — granter pays gas.

```js
const result = await broadcastWithFeeGrant(client, signerAddress, msgs, granterAddress);
// Fixed gas: max(300_000, msgs.length * 200_000)
// DO NOT use client.simulate() with fee grants — it fails
```

### Broadcast helper functions

```js
// Build batch start session messages
buildBatchStartSession(from, nodes)
// nodes: Array<{ nodeAddress, gigabytes?, maxPrice }>

// Build end session message
buildEndSessionMsg(from, sessionId)
// WARNING: uses BigInt(sessionId) — inconsistent with buildMsgCancelSession which uses Number(id)

// Batch token send
buildBatchSend(fromAddress, recipients)
// recipients: Array<{ address, amountUdvpn }>

// Batch link nodes to plan
buildBatchLink(provAddress, planId, nodeAddresses)

// Send tokens
sendTokens(client, fromAddress, toAddress, amountUdvpn, memo)

// Subscribe to plan (returns subscriptionId from events)
subscribeToPlan(client, fromAddress, planId, denom)

// Share subscription
shareSubscription(client, ownerAddress, subscriptionId, recipientAddress, bytes)
shareSubscriptionWithFeeGrant(client, ownerAddress, subscriptionId, recipientAddress, bytes, granterAddress)

// Onboard user to plan (subscribe + share + optional fee grant)
onboardPlanUser(client, operatorAddress, { planId, userAddress, bytes, denom, grantFee, feeSpendLimit, feeExpiration, buildFeeGrant })

// Estimate session cost
estimateSessionCost(nodeInfo, gigabytes, { preferHourly, hours })
// Returns: { udvpn, dvpn, gasUdvpn, totalUdvpn, mode, hourlyUdvpn, gigabyteUdvpn }

// Gas fee estimation
estimateBatchFee(msgCount, msgType)
// msgType: 'startSession' | 'feeGrant' | 'send' | 'link'
```

### TX Event extraction

```js
// Extract single ID from TX events (session, subscription, plan, lease)
extractId(txResult, /session/i, ['session_id', 'id'])
extractId(txResult, /subscription/i, ['subscription_id', 'id'])
extractId(txResult, /plan/i, ['plan_id', 'id'])

// Extract all session IDs from a batch TX
extractAllSessionIds(txResult) // returns bigint[]

// Decode base64-encoded TX events
decodeTxEvents(events)

// Serialize result (BigInt → string for JSON responses)
serializeResult(connectResult)

// Parse chain error to user-friendly message
parseChainError(raw)
```

---

## JS SDK — Query Functions

### LCD Queries (`chain/queries.js`)

| Function | LCD Path | Returns |
|----------|----------|---------|
| `getBalance(client, address)` | `/cosmos/bank/v1beta1/balances/{addr}` | `{ udvpn: number, dvpn: number }` |
| `fetchActiveNodes(lcdUrl, limit, maxPages)` | `/sentinel/node/v3/nodes?status=1` | `Node[]` (cached 5 min) |
| `queryNode(nodeAddress, opts)` | `/sentinel/node/v3/nodes/{addr}` | `Node` object |
| `getNodePrices(nodeAddress, lcdUrl)` | via `queryNode()` | `{ gigabyte, hourly, denom, nodeAddress }` |
| `querySubscriptions(lcdUrl, walletAddr, opts)` | `/sentinel/subscription/v3/accounts/{addr}/subscriptions` | `{ subscriptions, total }` |
| `querySubscription(id, lcdUrl)` | `/sentinel/subscription/v3/subscriptions/{id}` | `Subscription \| null` |
| `hasActiveSubscription(address, planId, lcdUrl)` | via `querySubscriptions()` | `{ has: boolean, subscription? }` |
| `querySubscriptionAllocations(subscriptionId, lcdUrl)` | `/sentinel/subscription/v2/subscriptions/{id}/allocations` | `Allocation[]` |
| `querySessions(address, lcdUrl, opts)` | `/sentinel/session/v3/sessions?address={addr}` | `{ items: Session[], total }` |
| `querySessionById(lcdUrl, sessionId)` | `/sentinel/session/v3/sessions/{id}` | `Session \| null` |
| `querySessionAllocation(lcdUrl, sessionId)` | `/sentinel/session/v3/sessions/{id}` | `{ maxBytes, usedBytes, remainingBytes, percentUsed }` |
| `findExistingSession(lcdUrl, walletAddr, nodeAddr)` | `/sentinel/session/v3/sessions?address={addr}&status=1` | `BigInt \| null` |
| `queryPlanNodes(planId, lcdUrl)` | `/sentinel/node/v3/plans/{id}/nodes?pagination.limit=5000` | `{ items, total }` |
| `queryPlanSubscribers(planId, opts)` | `/sentinel/subscription/v3/plans/{id}/subscriptions` | `{ subscribers, total }` |
| `getPlanStats(planId, ownerAddress, opts)` | via `queryPlanSubscribers()` | `{ subscriberCount, totalOnChain, ownerSubscribed }` |
| `discoverPlans(lcdUrl, opts)` | Probes subscriptions + nodes per plan ID | `DiscoveredPlan[]` |
| `discoverPlanIds(lcdUrl, maxId)` | via `discoverPlans()` | `number[]` |
| `getProviderByAddress(provAddress, opts)` | `/sentinel/provider/v2/providers/{addr}` | `Provider \| null` |
| `getNetworkOverview(lcdUrl)` | via `fetchActiveNodes()` | `{ totalNodes, byCountry, byType, averagePrice, nodes }` |
| `flattenSession(session)` | — (utility) | Flattened session object |
| `resolveNodeUrl(node)` | — (utility) | HTTPS URL string |
| `invalidateNodeCache()` | — (utility) | Clears 5-min node cache |
| `loadVpnSettings()` | `~/.sentinel-sdk/settings.json` | `Record<string, any>` |
| `saveVpnSettings(settings)` | `~/.sentinel-sdk/settings.json` | void |

**Important note on `querySubscriptionAllocations`:** This function uses the v2 LCD path because the v3 equivalent returns 501 Not Implemented. Same situation applies to `/sentinel/plan/v3/plans/{id}` — the plan detail endpoint is also 501. Use `discoverPlans()` instead.

**`flattenSession()` is mandatory** — sessions from `/sentinel/session/v3/sessions` have fields nested under `base_session`. Accessing `session.id` without flattening returns `undefined`. `querySessions()` auto-flattens; `querySessionById()` also flattens.

### RPC Queries (`chain/rpc.js`)

RPC queries use protobuf transport via CosmJS ABCI — approximately 912x faster than LCD for bulk operations.

| Function | gRPC Path | Returns |
|----------|-----------|---------|
| `createRpcQueryClient(rpcUrl)` | — | `{ queryClient, rpc, tmClient }` |
| `createRpcQueryClientWithFallback()` | Tries all RPC endpoints | `{ queryClient, rpc, tmClient, url }` |
| `disconnectRpc()` | — | Clears cached client |
| `rpcQueryNodes(client, { status, limit })` | `/sentinel.node.v3.QueryService/QueryNodes` | `Node[]` |
| `rpcQueryNode(client, address)` | `/sentinel.node.v3.QueryService/QueryNode` | `Node \| null` |
| `rpcQueryNodesForPlan(client, planId, { status, limit })` | `/sentinel.node.v3.QueryService/QueryNodesForPlan` | `Node[]` |
| `rpcQuerySessionsForAccount(client, address, { limit })` | `/sentinel.session.v3.QueryService/QuerySessionsForAccount` | `Uint8Array[]` (raw) |
| `rpcQuerySubscriptionsForAccount(client, address, { limit })` | `/sentinel.subscription.v3.QueryService/QuerySubscriptionsForAccount` | `Uint8Array[]` (raw) |
| `rpcQueryPlan(client, planId)` | `/sentinel.plan.v3.QueryService/QueryPlan` | `Uint8Array \| null` (raw) |
| `rpcQueryBalance(client, address, denom)` | `/cosmos.bank.v1beta1.Query/Balance` | `{ denom, amount }` |

**Note:** RPC session/subscription/plan responses return raw `Uint8Array` protobuf bytes that require type-specific decoding. For most use cases, LCD queries return parsed JSON and are easier to work with. Use RPC for high-throughput bulk operations (e.g., scanning 1000+ nodes).

---

## C# SDK — Query Methods (`ChainClient.Queries.cs`)

| Method | LCD Path | Returns |
|--------|----------|---------|
| `GetBalanceAsync(address)` | `/cosmos/bank/v1beta1/balances/{addr}/by_denom?denom=udvpn` | `Balance` |
| `GetActiveNodesAsync(limit)` | `/sentinel/node/v3/nodes?status=1&pagination.limit={N}` | `List<ChainNode>` |
| `GetNodeAsync(nodeAddress)` | `/sentinel/node/v3/nodes/{addr}` | `ChainNode?` |
| `GetSubscriptionsAsync(address)` | `/sentinel/subscription/v3/accounts/{addr}/subscriptions` | `List<Subscription>` |
| `GetSessionsAsync(address, status)` | `/sentinel/session/v3/accounts/{addr}/sessions?status={N}` | `List<ChainSession>` |
| `GetPlanNodesAsync(planId)` | `/sentinel/node/v3/plans/{id}/nodes?pagination.limit=5000` | `List<ChainNode>` |
| `DiscoverPlansAsync(maxId)` | Probes subscriptions + nodes per plan ID | `List<DiscoveredPlan>` |
| `GetAccountInfoAsync(address)` | `/cosmos/auth/v1beta1/accounts/{addr}` | `(ulong AccountNumber, ulong Sequence)` |

**C# `GetSessionsAsync` note:** Uses `/sentinel/session/v3/accounts/{addr}/sessions` (not `/sessions?address={addr}`). The query-param format may return all sessions unfiltered — prefer the `/accounts/{addr}/sessions` path.

---

## C# SDK — Transaction Builder (`TransactionBuilder.cs`)

The `TransactionBuilder` implements SIGN\_MODE\_DIRECT with secp256k1 signing from scratch (no CosmJS dependency).

```csharp
var txBuilder = new TransactionBuilder(wallet, client);

// Optional: use fee grant (granter pays gas)
txBuilder.FeeGranter = providerAddress;

// Broadcast pre-encoded SentinelMessage objects
TxResult result = await txBuilder.BroadcastAsync(
    MessageBuilder.StartSession(from, nodeAddress, gigabytes: 1, maxPrice)
);

// Broadcast protobuf IMessage objects (if using generated protos)
TxResult result = await txBuilder.BroadcastProtobufAsync(protoMsg);
```

Gas estimation (C#): `200,000 * message_count * 1.4` safety multiplier. Fee = `ceil(gas * gasPrice)`.

Sequence retry: up to 6 attempts with 2s/4s/6s backoff. Checks if previous TX was already committed before retrying (avoids double-spend).

High-level composite operations:

```csharp
// Share bandwidth
TxResult result = await txBuilder.ShareSubscriptionAsync(subscriptionId, recipientAddress, bytes);

// Complete plan user onboarding (subscribe + share + optional fee grant)
OnboardResult result = await txBuilder.OnboardPlanUserAsync(
    planId, userAddress, bytes,
    denom: "udvpn",
    grantFee: false,
    feeSpendLimit: 500_000,
    feeExpiration: null
);
// Returns: OnboardResult { SubscriptionId, SubscribeTxHash, ShareTxHash, GrantTxHash? }
```

---

## Parity Matrix

| Message Type | JS `buildMsg` | JS `encodeMsg` | JS broadcast | C# Builder | C# TX | Status |
|-------------|---------------|----------------|--------------|------------|-------|--------|
| StartSession (node) | `buildMsgStartSession` | `encodeMsgStartSession` | `broadcast` | `StartSession` | `BroadcastAsync` | Verified |
| CancelSession | `buildMsgCancelSession` | `encodeMsgEndSession` | `broadcast` | `EndSession` | `BroadcastAsync` | Verified |
| UpdateSession | `buildMsgUpdateSession` | `encodeMsgUpdateSession` | `broadcast` | `UpdateSession` | `BroadcastAsync` | Untested |
| StartSubscription | `buildMsgStartSubscription` | `encodeMsgStartSubscription` | `subscribeToPlan` | `StartSubscription` | `BroadcastAsync` | Verified |
| SubStartSession | `buildMsgSubStartSession` | `encodeMsgSubStartSession` | `broadcast` | `SubStartSession` | `BroadcastAsync` | Verified |
| CancelSubscription | `buildMsgCancelSubscription` | `encodeMsgCancelSubscription` | `broadcast` | `CancelSubscription` | `BroadcastAsync` | Untested |
| RenewSubscription | `buildMsgRenewSubscription` | `encodeMsgRenewSubscription` | `broadcast` | `RenewSubscription` | `BroadcastAsync` | Untested |
| ShareSubscription | `buildMsgShareSubscription` | `encodeMsgShareSubscription` | `shareSubscription` | `ShareSubscription` | `ShareSubscriptionAsync` | Verified |
| UpdateSubscription | `buildMsgUpdateSubscription` | `encodeMsgUpdateSubscription` | `broadcast` | `UpdateSubscription` | `BroadcastAsync` | Untested |
| PlanStartSession | `buildMsgPlanStartSession` | `encodeMsgPlanStartSession` | `broadcast` | `PlanStartSession` | `BroadcastAsync` | Verified |
| CreatePlan | `buildMsgCreatePlan` | `encodeMsgCreatePlan` | `broadcast` | `CreatePlan` | `BroadcastAsync` | Verified |
| UpdatePlanDetails | `buildMsgUpdatePlanDetails` | `encodeMsgUpdatePlanDetails` | `broadcast` | `UpdatePlanDetails` | `BroadcastAsync` | Untested |
| UpdatePlanStatus | `buildMsgUpdatePlanStatus` | `encodeMsgUpdatePlanStatus` | `broadcast` | `UpdatePlanStatus` | `BroadcastAsync` | Verified |
| LinkNode | `buildMsgLinkNode` | `encodeMsgLinkNode` | `broadcast` | `LinkNode` | `BroadcastAsync` | Verified |
| UnlinkNode | `buildMsgUnlinkNode` | `encodeMsgUnlinkNode` | `broadcast` | `UnlinkNode` | `BroadcastAsync` | Untested |
| RegisterProvider | `buildMsgRegisterProvider` | `encodeMsgRegisterProvider` | `broadcast` | `RegisterProvider` | `BroadcastAsync` | Verified |
| UpdateProviderDetails | `buildMsgUpdateProviderDetails` | `encodeMsgUpdateProviderDetails` | `broadcast` | `UpdateProviderDetails` | `BroadcastAsync` | Untested |
| UpdateProviderStatus | `buildMsgUpdateProviderStatus` | `encodeMsgUpdateProviderStatus` | `broadcast` | `UpdateProviderStatus` | `BroadcastAsync` | Untested |
| StartLease | `buildMsgStartLease` | `encodeMsgStartLease` | `broadcast` | `StartLease` | `BroadcastAsync` | Verified |
| EndLease | `buildMsgEndLease` | `encodeMsgEndLease` | `broadcast` | `EndLease` | `BroadcastAsync` | Untested |
| RegisterNode | `buildMsgRegisterNode` | `encodeMsgRegisterNode` | `broadcast` | `RegisterNode` | `BroadcastAsync` | Untested |
| UpdateNodeDetails | `buildMsgUpdateNodeDetails` | `encodeMsgUpdateNodeDetails` | `broadcast` | `UpdateNodeDetails` | `BroadcastAsync` | Untested |
| UpdateNodeStatus | `buildMsgUpdateNodeStatus` | `encodeMsgUpdateNodeStatus` | `broadcast` | `UpdateNodeStatus` | `BroadcastAsync` | Untested |
| GrantFeeAllowance | — (construct directly) | — | `broadcastWithFeeGrant` | `GrantFeeAllowance` | `BroadcastAsync` | Verified |
| RevokeFeeAllowance | — (construct directly) | — | `broadcast` | `RevokeFeeAllowance` | `BroadcastAsync` | Untested |
| AuthzGrant | — (construct directly) | — | `broadcast` | `AuthzGrant` | `BroadcastAsync` | Untested |
| AuthzRevoke | — (construct directly) | — | `broadcast` | `AuthzRevoke` | `BroadcastAsync` | Untested |
| AuthzExec | — (construct directly) | — | `broadcast` | `AuthzExec` | `BroadcastAsync` | Untested |
| MsgSend (bank) | — | — | `sendTokens` | `Send` | `BroadcastAsync` | Verified |

**Status key:**
- **Verified** — mainnet-tested with real wallet, real nodes, real tokens
- **Untested** — code written and cross-referenced, not yet mainnet-verified in this language

**JS gaps:**
- No dedicated `buildMsgGrantAllowance` / `buildMsgRevoke*` / `buildMsgAuthz*` functions in `messages.js` — these must be constructed as `{ typeUrl, value }` objects directly
- `buildEndSessionMsg` in `broadcast.js` uses `BigInt(sessionId)` while `buildMsgCancelSession` in `messages.js` uses `Number(id)` — inconsistency; prefer `buildMsgCancelSession`

**C# gaps:**
- No `buildMsgGrantAllowance` shorthand at the `buildMsg` layer — but `MessageBuilder.GrantFeeAllowance()` covers this at the encode layer

---

## Known Bugs and Edge Cases

### Price Field Encoding (JS `buildMsgStartSession`)

The `messages.js` layer passes `maxPrice` directly to CosmJS as a plain object. The `v3protocol.js` / `encoding.js` layer manually encodes it using `encodePrice()`. The `encodePrice()` function calls `decToScaledInt()` on `base_value`, scaling it by 10^18.

**Bug:** If `base_value` is already scaled (e.g., from a node that returns the stored chain value directly), double-scaling corrupts the price. Always pass the raw LCD `quote_value` and `base_value` from the node's price array without pre-processing.

### `id` Field Type Inconsistency (JS)

`buildMsgCancelSession` converts `id` to `Number(id)`. `buildEndSessionMsg` converts to `BigInt(id)`. For session IDs that exceed `Number.MAX_SAFE_INTEGER` (9 quadrillion+), `Number()` truncates silently. Use `BigInt` in the encode layer; the `buildMsg` layer is safe for current chain session ID ranges.

### Session LCD Path

`querySessions(address, lcdUrl)` uses `/sentinel/session/v3/sessions?address={addr}`. The C# SDK uses `/sentinel/session/v3/accounts/{addr}/sessions`. Both paths work but may differ in filtering behavior. Use the `/accounts/{addr}/sessions` form when filtering by status for more reliable results.

### Plan Pagination Bug (LCD)

`/sentinel/node/v3/plans/{id}/nodes` returns incorrect `count_total` and always returns `null` for `next_key`. Use `pagination.limit=5000` in a single request and count the returned array. Both JS and C# SDKs implement this workaround.

### Plan Detail Endpoint (501)

`/sentinel/plan/v3/plans/{id}` returns 501 Not Implemented on all LCD endpoints. Use `discoverPlans()` / `DiscoverPlansAsync()` which probe via the subscriptions endpoint instead.

### Provider Endpoint Stays v2

`/sentinel/provider/v2/providers/{sentprov1...}` — the provider query endpoint was not migrated to v3. All other Sentinel queries use v3 paths.

### `client.simulate()` with Fee Grants (CosmJS)

`client.simulate()` does not include the `granter` field, so it bills gas to the grantee. If the grantee has low balance, simulation fails with "insufficient funds" even though the actual TX would succeed via fee grant. Use a fixed gas estimate (300,000 per single-message TX) instead of simulation when using fee grants.

### Plan Creation Requires Separate Activation

`MsgCreatePlanRequest` creates a plan in **INACTIVE** status. A second TX (`MsgUpdatePlanStatusRequest` with `status=1`) is required to activate it. Forgetting this step leaves the plan permanently inactive.

### Sequence Mismatch Recovery (Code 32)

Both JS (`createSafeBroadcaster`) and C# (`TransactionBuilder.BroadcastAsync`) handle Cosmos error code 32 (wrong sequence). Both implementations check if the previous TX was already committed before retrying, preventing double-spend. Both retry up to 5–6 times with exponential backoff.

### Subscription Sharing — Bytes Only

`MsgShareSubscriptionRequest` has no time/duration field. The chain only tracks bytes. For time-based plans (e.g., monthly access), the operator must track expiry externally and cancel or not renew the subscription when the period expires.
