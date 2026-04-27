/**
 * Sentinel SDK — Privy → Cosmos Signer Adapter
 *
 * Bridges a Privy embedded wallet (EVM/Solana-native) to a Sentinel Cosmos
 * signer. The result satisfies cosmjs `OfflineDirectSigner`, so it can be
 * passed straight to `SigningStargateClient.connectWithSigner` and to every
 * Sentinel SDK helper that takes a `wallet`.
 *
 * Two strategies are supported, picked by the `mode` field on the input.
 *
 * ─── Mode A: 'mnemonic' (seed-import) ──────────────────────────────────────
 * The consumer triggers Privy's `exportWallet()` once, captures the seed
 * phrase the user reveals, and hands it to this adapter. The adapter derives
 * a Cosmos secp256k1 key on Sentinel's HD path (cosmoshub-style, coinType
 * 118) and wraps it in `DirectSecp256k1HdWallet`. Same trust model as a
 * normal mnemonic wallet — the seed leaves Privy's secure enclave.
 *
 * Use this when you need full broadcast capability (sessions, payments,
 * fee-grants) and your UX can prompt the user to export once.
 *
 * ─── Mode B: 'rawSign' (custody-preserving) ────────────────────────────────
 * The seed never leaves Privy. The consumer supplies:
 *   - `pubkey`: the compressed secp256k1 pubkey (33 bytes) Privy derived for
 *     this user on the Cosmos `m/44'/118'/0'/0/0` path. Privy exposes raw
 *     signing for embedded wallets; deriving the pubkey from the same path
 *     yields the same `sent1...` address Mode A would produce.
 *   - `signRawSecp256k1(digest32)`: an async function that asks Privy to
 *     produce a 64-byte (r||s) signature over the supplied 32-byte digest,
 *     using the same key the pubkey came from. The adapter computes the
 *     digest of the cosmjs `SignDoc` itself, so Privy only sees a hash.
 *
 * Use this when you must keep custody inside Privy. Note that
 * `signRawSecp256k1` MUST return a *normalized low-S* signature — cosmjs
 * rejects high-S sigs. The adapter normalizes defensively.
 *
 * ─── Usage ─────────────────────────────────────────────────────────────────
 *
 *   // Mode A
 *   const signer = await PrivyCosmosSigner.fromMnemonic({
 *     mnemonic: privyExportedSeed,
 *     prefix: 'sent',
 *   });
 *
 *   // Mode B
 *   const signer = await PrivyCosmosSigner.fromRawSign({
 *     pubkey: privyDerivedCompressedPubkey,   // Uint8Array(33)
 *     signRawSecp256k1: async (digest32) => {
 *       const sig = await privy.signRawHash({ hash: digest32, curve: 'secp256k1' });
 *       return sig; // Uint8Array(64), r||s
 *     },
 *     prefix: 'sent',
 *   });
 *
 *   const [account] = await signer.getAccounts();
 *   // account.address === 'sent1...'
 *   const client = await SigningStargateClient.connectWithSigner(rpc, signer, ...);
 */

import {
  Bip39,
  EnglishMnemonic,
  Slip10,
  Slip10Curve,
  Secp256k1,
  sha256,
  ripemd160,
} from '@cosmjs/crypto';
import { makeCosmoshubPath } from '@cosmjs/amino';
import { DirectSecp256k1HdWallet, makeSignDoc } from '@cosmjs/proto-signing';
import { fromBech32, toBech32 } from '@cosmjs/encoding';
import { ValidationError, ErrorCodes } from '../errors/index.js';

// ─── Internal helpers ────────────────────────────────────────────────────────

function assertPrefix(prefix) {
  if (typeof prefix !== 'string' || prefix.length === 0) {
    throw new ValidationError(ErrorCodes.INVALID_OPTIONS,
      'PrivyCosmosSigner: prefix must be a non-empty string (e.g. "sent")',
      { prefix });
  }
}

// secp256k1 group order n. Signatures with s > n/2 are non-canonical and
// rejected by Cosmos chains since cosmos-sdk v0.42. Privy's raw-sign path is
// not guaranteed to return low-S form, so we normalize defensively.
const SECP256K1_N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
const SECP256K1_HALF_N = SECP256K1_N >> 1n;

function bytesToBigInt(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
}

function bigIntTo32Bytes(n) {
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}

function normalizeLowS(rawSig) {
  const r = rawSig.slice(0, 32);
  const sBytes = rawSig.slice(32, 64);
  const s = bytesToBigInt(sBytes);
  if (s <= SECP256K1_HALF_N) return rawSig;
  const flipped = SECP256K1_N - s;
  const out = new Uint8Array(64);
  out.set(r, 0);
  out.set(bigIntTo32Bytes(flipped), 32);
  return out;
}

function pubkeyToBech32Address(compressedPubkey, prefix) {
  if (!(compressedPubkey instanceof Uint8Array) || compressedPubkey.length !== 33) {
    throw new ValidationError(ErrorCodes.INVALID_OPTIONS,
      'PrivyCosmosSigner: pubkey must be a 33-byte compressed secp256k1 Uint8Array',
      { length: compressedPubkey?.length });
  }
  const data = ripemd160(sha256(compressedPubkey));
  return toBech32(prefix, data);
}

// ─── Mode A: seed-import via Privy exportWallet ─────────────────────────────

/**
 * Build a signer from a mnemonic the user just exported from Privy.
 *
 * Internally this is `DirectSecp256k1HdWallet` with Sentinel's prefix — i.e.
 * the same key + address the consumer would get from `createWallet()` if
 * they typed the mnemonic in directly. The wrapper exists so a consumer can
 * write the same code path regardless of which Privy mode they're in.
 *
 * @param {object} opts
 * @param {string} opts.mnemonic
 * @param {string} [opts.prefix='sent']
 * @returns {Promise<DirectSecp256k1HdWallet>} A cosmjs OfflineDirectSigner
 */
export async function privyCosmosSignerFromMnemonic({ mnemonic, prefix = 'sent' } = {}) {
  assertPrefix(prefix);
  if (typeof mnemonic !== 'string' || mnemonic.trim().split(/\s+/).length < 12) {
    throw new ValidationError(ErrorCodes.INVALID_MNEMONIC,
      'privyCosmosSignerFromMnemonic: mnemonic must be a 12+ word BIP39 string',
      { wordCount: typeof mnemonic === 'string' ? mnemonic.trim().split(/\s+/).length : 0 });
  }
  return DirectSecp256k1HdWallet.fromMnemonic(mnemonic, { prefix });
}

/**
 * Convenience: derive the compressed secp256k1 pubkey + address from a
 * mnemonic on Sentinel's HD path. Useful for pre-computing what the
 * `sent1...` address WILL be in Mode B before plumbing the raw-sign callback.
 *
 * @param {string} mnemonic
 * @param {string} [prefix='sent']
 * @returns {Promise<{ pubkey: Uint8Array, address: string }>}
 */
export async function deriveCosmosPubkeyFromMnemonic(mnemonic, prefix = 'sent') {
  assertPrefix(prefix);
  const seed = await Bip39.mnemonicToSeed(new EnglishMnemonic(mnemonic));
  const { privkey } = Slip10.derivePath(Slip10Curve.Secp256k1, seed, makeCosmoshubPath(0));
  const { pubkey } = await Secp256k1.makeKeypair(privkey);
  const compressed = Secp256k1.compressPubkey(pubkey);
  return { pubkey: compressed, address: pubkeyToBech32Address(compressed, prefix) };
}

// ─── Mode B: raw-sign (Privy keeps custody) ─────────────────────────────────

/**
 * `OfflineDirectSigner` that delegates the actual ECDSA op to Privy. The
 * private key never leaves Privy's enclave; we hash the SignDoc locally and
 * ship the 32-byte digest to the supplied callback.
 *
 * Conforms to cosmjs `OfflineDirectSigner`:
 *   - `getAccounts()` → `[{ address, algo: 'secp256k1', pubkey }]`
 *   - `signDirect(signerAddress, signDoc)` → `{ signed, signature }`
 */
export class PrivyRawSignDirectSigner {
  /**
   * @param {object} opts
   * @param {Uint8Array} opts.pubkey - 33-byte compressed secp256k1 pubkey
   * @param {(digest: Uint8Array) => Promise<Uint8Array>} opts.signRawSecp256k1
   *        Returns a 64-byte (r||s) signature over `digest`. MUST be low-S
   *        normalized; the adapter re-normalizes defensively.
   * @param {string} [opts.prefix='sent']
   */
  constructor({ pubkey, signRawSecp256k1, prefix = 'sent' }) {
    assertPrefix(prefix);
    if (typeof signRawSecp256k1 !== 'function') {
      throw new ValidationError(ErrorCodes.INVALID_OPTIONS,
        'PrivyRawSignDirectSigner: signRawSecp256k1 must be a function',
        {});
    }
    this._pubkey = pubkey;
    this._sign = signRawSecp256k1;
    this._prefix = prefix;
    this._address = pubkeyToBech32Address(pubkey, prefix);
  }

  async getAccounts() {
    return [{
      address: this._address,
      algo: 'secp256k1',
      pubkey: this._pubkey,
    }];
  }

  /**
   * @param {string} signerAddress
   * @param {import('@cosmjs/proto-signing').SignDoc} signDoc
   */
  async signDirect(signerAddress, signDoc) {
    if (signerAddress !== this._address) {
      throw new ValidationError(ErrorCodes.INVALID_OPTIONS,
        `PrivyRawSignDirectSigner: signerAddress mismatch (got ${signerAddress}, signer holds ${this._address})`,
        { expected: this._address, got: signerAddress });
    }
    // Re-encode the SignDoc the same way cosmjs does, then SHA-256 it.
    // Importing the raw protobuf encoder via makeSignDoc → makeSignBytes
    // would also work, but doing it inline keeps the dep surface tight.
    const { makeSignBytes } = await import('@cosmjs/proto-signing');
    const signBytes = makeSignBytes(signDoc);
    const digest = sha256(signBytes);

    const rawSig = await this._sign(digest);
    if (!(rawSig instanceof Uint8Array) || rawSig.length !== 64) {
      throw new ValidationError(ErrorCodes.INVALID_OPTIONS,
        'PrivyRawSignDirectSigner: signRawSecp256k1 must return a 64-byte (r||s) Uint8Array',
        { length: rawSig?.length });
    }

    // Normalize to low-S so chain validators accept it. cosmjs's
    // Secp256k1Signature.fromFixedLength + Secp256k1.trimRecoveryByte path
    // is internal; instead we parse r/s as bigints and flip s if it sits in
    // the upper half of the curve order.
    const normalized = normalizeLowS(rawSig);

    return {
      signed: signDoc,
      signature: {
        pub_key: {
          type: 'tendermint/PubKeySecp256k1',
          value: Buffer.from(this._pubkey).toString('base64'),
        },
        signature: Buffer.from(normalized).toString('base64'),
      },
    };
  }
}

/**
 * Build a Mode B signer.
 *
 * @param {object} opts
 * @param {Uint8Array} opts.pubkey
 * @param {(digest: Uint8Array) => Promise<Uint8Array>} opts.signRawSecp256k1
 * @param {string} [opts.prefix='sent']
 * @returns {Promise<PrivyRawSignDirectSigner>}
 */
export async function privyCosmosSignerFromRawSign(opts) {
  return new PrivyRawSignDirectSigner(opts);
}

// ─── Unified factory ────────────────────────────────────────────────────────

/**
 * Single entry point picking the right strategy by `mode`.
 *
 * @param {{ mode: 'mnemonic', mnemonic: string, prefix?: string }
 *        | { mode: 'rawSign', pubkey: Uint8Array,
 *            signRawSecp256k1: (digest: Uint8Array) => Promise<Uint8Array>,
 *            prefix?: string }} opts
 * @returns {Promise<DirectSecp256k1HdWallet | PrivyRawSignDirectSigner>}
 */
export async function createPrivyCosmosSigner(opts = {}) {
  if (opts.mode === 'mnemonic') {
    return privyCosmosSignerFromMnemonic(opts);
  }
  if (opts.mode === 'rawSign') {
    return privyCosmosSignerFromRawSign(opts);
  }
  throw new ValidationError(ErrorCodes.INVALID_OPTIONS,
    `createPrivyCosmosSigner: unknown mode "${opts.mode}" — expected "mnemonic" or "rawSign"`,
    { mode: opts.mode });
}

// ─── Static facade ──────────────────────────────────────────────────────────

export class PrivyCosmosSigner {
  static fromMnemonic(opts) { return privyCosmosSignerFromMnemonic(opts); }
  static fromRawSign(opts) { return privyCosmosSignerFromRawSign(opts); }
  static create(opts) { return createPrivyCosmosSigner(opts); }
  static derivePubkeyFromMnemonic(mnemonic, prefix) {
    return deriveCosmosPubkeyFromMnemonic(mnemonic, prefix);
  }
}
