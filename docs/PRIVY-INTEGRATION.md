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

- `connect()`, `connectDirect()`, `connectViaPlan()` — VPN session start
- `disconnect()` — session end
- `broadcast()`, `broadcastWithFeeGrant()`, `createSafeBroadcaster()` — TX broadcast
- Operator helpers: `autoLeaseNode()`, `batchLeaseNodes()`, `batchRevokeFeeGrants()`, etc.

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
