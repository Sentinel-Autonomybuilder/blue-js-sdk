# Privy Integration

Privy provides embedded EVM/Solana wallets but has no native Cosmos signer. This SDK ships an adapter that bridges a Privy-held key to a cosmjs-compatible Cosmos signer, so a consumer can use Privy for auth/onboarding while still using every Sentinel SDK helper that takes a `wallet`.

The adapter lives in `auth/privy-cosmos-signer.js` and is re-exported from the SDK root.

## Two strategies

The adapter supports two paths, selected by the `mode` field on `createPrivyCosmosSigner`. Pick the one that matches your custody requirements.

### Mode A — `mnemonic` (seed-import)

The consumer triggers Privy's `exportWallet()`. The user reveals their seed once. The adapter re-derives a Cosmos secp256k1 key on the standard Cosmos HD path (`m/44'/118'/0'/0/0`) and wraps it in `DirectSecp256k1HdWallet`.

```js
import { PrivyCosmosSigner } from 'blue-js-sdk';

const signer = await PrivyCosmosSigner.fromMnemonic({
  mnemonic: privyExportedSeed,
  prefix: 'sent',
});

const [account] = await signer.getAccounts();
// account.address === 'sent1...'
```

Trust model: identical to a normal mnemonic wallet — the seed has left Privy's enclave. Use this when you need full broadcast capability and your UX can prompt the user to export once.

### Mode B — `rawSign` (custody-preserving)

The seed never leaves Privy. The consumer supplies:

- `pubkey` — the compressed secp256k1 pubkey (33 bytes) Privy derived for this user on the Cosmos `m/44'/118'/0'/0/0` path.
- `signRawSecp256k1(digest32)` — async function that asks Privy to produce a 64-byte (`r||s`) signature over the supplied 32-byte digest using the same key.

The adapter computes the digest of the cosmjs `SignDoc` itself, so Privy only sees a hash.

```js
import { PrivyCosmosSigner } from 'blue-js-sdk';

const signer = await PrivyCosmosSigner.fromRawSign({
  pubkey: privyDerivedCompressedPubkey,
  signRawSecp256k1: async (digest32) => {
    const sig = await privy.signRawHash({ hash: digest32, curve: 'secp256k1' });
    return sig; // Uint8Array(64), r||s
  },
  prefix: 'sent',
});
```

Use this when you must keep custody inside Privy. Requirements on the callback:

- Returns a 64-byte (`r||s`) `Uint8Array`. The adapter rejects any other shape.
- The signature MUST be over the raw 32-byte digest the adapter passed in. Do not let Privy re-hash it (no `eth_sign`-style "Ethereum Signed Message" prefixing).
- Low-S form is preferred but not required — the adapter normalizes high-S signatures to low-S before encoding the result, since cosmos-sdk validators reject high-S since v0.42.

## Address parity

Both modes derive the **same** `sent1...` address from the same seed. You can pre-compute the address in either direction with `deriveCosmosPubkeyFromMnemonic`:

```js
import { deriveCosmosPubkeyFromMnemonic } from 'blue-js-sdk';

const { pubkey, address } = await deriveCosmosPubkeyFromMnemonic(mnemonic);
```

This is useful when the consumer wants to display the user's `sent1...` address in Privy onboarding before a Mode B signer is wired up.

## What the adapter is

The Mode A return value IS a `DirectSecp256k1HdWallet`. The Mode B return value is an `OfflineDirectSigner` — `getAccounts()` + `signDirect(signerAddress, signDoc)`. Either can be passed straight to `SigningStargateClient.connectWithSigner` and to every Sentinel SDK helper that accepts a `wallet`:

- `broadcast()`, `broadcastWithFeeGrant()`, `createSafeBroadcaster()` — TX broadcast
- Operator helpers: `autoLeaseNode()`, `batchLeaseNodes()`, `batchRevokeFeeGrants()`, etc.
- `SentinelClient` query surface — `getBalance()`, `getClient()`, `listNodes()`, etc.

### Tunnel connect/disconnect — Mode A only (today)

VPN session start (`connect()`, `autoConnect()`, `connectPlan()`) and matching teardown perform a WireGuard/V2Ray handshake with the node. The handshake protocol requires the SDK to sign a small payload with the **raw** secp256k1 privkey **locally**, before any chain TX. That privkey is not available in Mode B — Privy's raw-sign endpoint signs digests but does not export the key.

In short:

| Operation | Mode A (mnemonic) | Mode B (rawSign) |
|---|---|---|
| `getBalance()`, `listNodes()`, queries | works | works |
| `broadcast()`, `broadcastWithFeeGrant()` | works | works |
| Operator helpers (`autoLeaseNode`, batch*) | works | works |
| `connect()`, `autoConnect()`, `connectPlan()` | works | **throws** with "VPN connect/disconnect requires a mnemonic" |

A signer-only `SentinelClient` will throw a helpful error from the connect methods rather than failing deep inside the handshake. Lifting this restriction requires either (a) refactoring the handshake to call out to `signRawSecp256k1`, or (b) Privy exposing a "raw secp256k1 sign" endpoint shaped like the cosmjs `Secp256k1.createSignature` signature already accepted in Mode B — both viable, neither in this PR.

## Using `SentinelClient` with Privy

```js
import { SentinelClient, PrivyCosmosSigner } from 'blue-js-sdk';

// Mode A — full feature set
const signer = await PrivyCosmosSigner.fromMnemonic({ mnemonic: privyExportedSeed });
const client = new SentinelClient({
  signer,
  rpcUrl: 'https://rpc.sentinel.co',
  // mnemonic still required for VPN connect — see table above
  mnemonic: privyExportedSeed,
});
const balance = await client.getBalance(); // works
const conn = await client.autoConnect();   // works (uses mnemonic)

// Mode B — custody-preserving (queries + broadcasts only)
const custodySigner = await PrivyCosmosSigner.fromRawSign({
  pubkey: privyDerivedCompressedPubkey,
  signRawSecp256k1: async (digest32) => privy.signRawHash({ hash: digest32, curve: 'secp256k1' }),
});
const queryClient = new SentinelClient({ signer: custodySigner, rpcUrl: 'https://rpc.sentinel.co' });
await queryClient.getBalance();          // works — queries Privy for the address
// await queryClient.connect(...);       // throws: requires a mnemonic
```

## Unified factory

```js
import { createPrivyCosmosSigner } from 'blue-js-sdk';

// Routes to fromMnemonic / fromRawSign by `mode`.
const signer = await createPrivyCosmosSigner({ mode: 'mnemonic', mnemonic });
// or
const signer = await createPrivyCosmosSigner({
  mode: 'rawSign', pubkey, signRawSecp256k1,
});
```

## Failure modes

| Symptom | Cause | Fix |
|---------|-------|-----|
| `signerAddress mismatch (got X, signer holds Y)` | Caller passed a different `signerAddress` to `signDirect` than the one the signer derived from the pubkey. | Use the address from `getAccounts()[0]`. |
| `signRawSecp256k1 must return a 64-byte (r\|\|s) Uint8Array` | Privy callback returned DER, hex string, or included a recovery byte. | Strip to fixed 64-byte `r\|\|s` before returning. |
| Chain rejects TX with `signature verification failed` | Privy hashed the input again before signing (e.g. `eth_sign` prefixing). | Use Privy's "raw hash" sign endpoint, not `signMessage`. |
| Address differs between modes | Privy derived the pubkey on a non-Cosmos path. | Use Cosmos path `m/44'/118'/0'/0/0`; coinType MUST be 118. |

## Tests

`test/privy-cosmos-signer.test.mjs` — 20 assertions covering:

- Mode A address parity with `createWallet()`
- `deriveCosmosPubkeyFromMnemonic` matches Mode A
- Mode B address parity with Mode A using the same seed
- `signDirect` produces a signature that verifies against the pubkey on `sha256(makeSignBytes(signDoc))`
- High-S signatures returned by the callback are normalized to low-S
- `signerAddress` mismatch is rejected
- Unified factory routes correctly and rejects unknown modes
- Static facade delegates to the underlying functions

### Run the offline suite (CI-safe)

```sh
npm run test:privy   # 32 assertions, no network
```

### Run the live suites (require credentials, NOT in CI)

```sh
# Mainnet broadcast — proves Sentinel chain accepts adapter signatures.
# Sends a 1 udvpn self-MsgSend; needs ~20000 udvpn for fee.
MNEMONIC="..." npm run test:privy:live

# Real Privy API — creates a server-managed Cosmos wallet on Privy and proves
# the bytes Privy's /raw_sign returns verify against the Privy-derived pubkey.
PRIVY_APP_ID="..." PRIVY_APP_SECRET="..." npm run test:privy:server
```

`test/privy-client-integration.test.mjs` — 12 assertions covering:

- `SentinelClient({ signer })` — `getWallet()` returns the supplied signer + first account, no mnemonic required
- `SentinelClient({ mnemonic })` — backwards-compatible path still works
- `SentinelClient({})` — `getWallet()` throws with a helpful "mnemonic or signer" message
- `SentinelClient({ signer })` — `connect()`, `autoConnect()`, `connectPlan()` all reject with "requires a mnemonic" pointing to this doc
- Address parity between `PrivyCosmosSigner(mnemonic)` and `SentinelClient(mnemonic)`
