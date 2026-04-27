#!/usr/bin/env node
/**
 * Privy → Cosmos signer adapter tests.
 *
 * Covers:
 *   1. Mode A (mnemonic) produces the same address as `createWallet()`.
 *   2. `deriveCosmosPubkeyFromMnemonic` matches the address Mode A produces.
 *   3. Mode B (rawSign) using a known privkey produces the same address.
 *   4. Mode B `signDirect` returns a signature that verifies against the
 *      pubkey on the cosmjs `SignDoc`-derived digest.
 *   5. Mode B normalizes high-S signatures to low-S.
 *   6. Mode B rejects signerAddress mismatch.
 *
 * No network, no Privy SDK — the raw-sign callback is simulated locally
 * with cosmjs's `Secp256k1.createSignature`. The interface contract is
 * what the real Privy raw-sign endpoint must satisfy.
 *
 * Run: node test/privy-cosmos-signer.test.mjs
 */

import {
  PrivyCosmosSigner,
  PrivyRawSignDirectSigner,
  privyCosmosSignerFromMnemonic,
  privyCosmosSignerFromRawSign,
  createPrivyCosmosSigner,
  deriveCosmosPubkeyFromMnemonic,
  createWallet,
} from '../index.js';
import {
  Bip39, EnglishMnemonic, Slip10, Slip10Curve, Secp256k1, sha256,
} from '@cosmjs/crypto';
import { makeCosmoshubPath } from '@cosmjs/amino';
import { makeSignBytes } from '@cosmjs/proto-signing';

let pass = 0, fail = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL: ${name}`); }
}

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

console.log('Privy → Cosmos signer adapter tests\n');

// ─── 1. Mode A address parity with createWallet ─────────────────────────────

console.log('1. Mode A: address parity with createWallet()...');
const { account: refAccount } = await createWallet(MNEMONIC);
const signerA = await privyCosmosSignerFromMnemonic({ mnemonic: MNEMONIC });
const [accA] = await signerA.getAccounts();
assert(accA.address === refAccount.address,
  `Mode A address matches createWallet (${accA.address})`);
assert(accA.address.startsWith('sent1'),
  'Mode A address has sent1 prefix');

// ─── 2. deriveCosmosPubkeyFromMnemonic matches ──────────────────────────────

console.log('\n2. deriveCosmosPubkeyFromMnemonic...');
const derived = await deriveCosmosPubkeyFromMnemonic(MNEMONIC);
assert(derived.address === refAccount.address,
  'derive helper produces same address');
assert(derived.pubkey instanceof Uint8Array && derived.pubkey.length === 33,
  'derive helper returns 33-byte compressed pubkey');

// ─── 3. Mode B address parity using the derived privkey ─────────────────────

console.log('\n3. Mode B: rawSign address parity...');

// Re-derive the privkey locally (this is what Privy holds internally).
const seed = await Bip39.mnemonicToSeed(new EnglishMnemonic(MNEMONIC));
const { privkey } = Slip10.derivePath(Slip10Curve.Secp256k1, seed, makeCosmoshubPath(0));
const keypair = await Secp256k1.makeKeypair(privkey);
const compressedPubkey = Secp256k1.compressPubkey(keypair.pubkey);

let lastDigest = null;
async function fakePrivyRawSign(digest32) {
  lastDigest = digest32;
  // cosmjs returns ExtendedSecp256k1Signature; r/s each 32 bytes, recovery byte present.
  const sig = await Secp256k1.createSignature(digest32, privkey);
  const r = sig.r(32);
  const s = sig.s(32);
  const out = new Uint8Array(64);
  out.set(r, 0);
  out.set(s, 32);
  return out;
}

const signerB = await privyCosmosSignerFromRawSign({
  pubkey: compressedPubkey,
  signRawSecp256k1: fakePrivyRawSign,
});
const [accB] = await signerB.getAccounts();
assert(accB.address === refAccount.address,
  'Mode B address matches Mode A');
assert(accB.algo === 'secp256k1', 'Mode B algo is secp256k1');
assert(accB.pubkey instanceof Uint8Array && accB.pubkey.length === 33,
  'Mode B account.pubkey is 33-byte compressed');

// ─── 4. signDirect signature verifies ───────────────────────────────────────

console.log('\n4. Mode B: signDirect produces verifiable signature...');

// Build a synthetic SignDoc — same shape SigningStargateClient hands to a signer.
const fakeSignDoc = {
  bodyBytes: new Uint8Array([1, 2, 3, 4, 5]),
  authInfoBytes: new Uint8Array([6, 7, 8, 9]),
  chainId: 'sentinelhub-2',
  accountNumber: BigInt(42),
};
const { signed, signature } = await signerB.signDirect(accB.address, fakeSignDoc);

assert(signed === fakeSignDoc, 'signDirect returns the SignDoc unchanged in `signed`');
assert(signature.pub_key.type === 'tendermint/PubKeySecp256k1',
  'signature pub_key.type is tendermint/PubKeySecp256k1');
assert(typeof signature.signature === 'string' && signature.signature.length > 0,
  'signature.signature is non-empty base64');

// Recompute the digest and verify.
const expectedDigest = sha256(makeSignBytes(fakeSignDoc));
assert(lastDigest && Buffer.from(lastDigest).equals(Buffer.from(expectedDigest)),
  'signRawSecp256k1 was called with sha256(makeSignBytes(signDoc))');

// Verify the returned signature against the pubkey.
const sigBytes = Buffer.from(signature.signature, 'base64');
const { Secp256k1Signature } = await import('@cosmjs/crypto');
const parsed = Secp256k1Signature.fromFixedLength(new Uint8Array(sigBytes));
const ok = await Secp256k1.verifySignature(parsed, expectedDigest, compressedPubkey);
assert(ok === true, 'Returned signature verifies against the pubkey');

// ─── 5. Low-S normalization ─────────────────────────────────────────────────

console.log('\n5. Mode B: high-S signature is normalized to low-S...');

const SECP256K1_N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
const HALF_N = SECP256K1_N >> 1n;
function bytesToBigInt(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
}
function bigIntTo32Bytes(n) {
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) { out[i] = Number(n & 0xffn); n >>= 8n; }
  return out;
}

// Force a high-S signature: sign normally, then if s is already low, flip it.
async function highSSign(digest32) {
  const sig = await Secp256k1.createSignature(digest32, privkey);
  const r = sig.r(32);
  const s = sig.s(32);
  let sBig = bytesToBigInt(s);
  if (sBig <= HALF_N) sBig = SECP256K1_N - sBig;  // make it high-S
  const out = new Uint8Array(64);
  out.set(r, 0);
  out.set(bigIntTo32Bytes(sBig), 32);
  return out;
}

const signerHighS = new PrivyRawSignDirectSigner({
  pubkey: compressedPubkey,
  signRawSecp256k1: highSSign,
});
const { signature: sigHighS } = await signerHighS.signDirect(accB.address, fakeSignDoc);
const normalized = Buffer.from(sigHighS.signature, 'base64');
const sNormalized = bytesToBigInt(new Uint8Array(normalized.subarray(32, 64)));
assert(sNormalized <= HALF_N, 'Adapter normalized s into the lower half of the curve');

// And the normalized signature still verifies.
const okNorm = await Secp256k1.verifySignature(
  Secp256k1Signature.fromFixedLength(new Uint8Array(normalized)),
  expectedDigest,
  compressedPubkey,
);
assert(okNorm === true, 'Normalized signature still verifies');

// ─── 6. signerAddress mismatch is rejected ──────────────────────────────────

console.log('\n6. Mode B: signerAddress mismatch rejected...');
let threw = false;
try {
  await signerB.signDirect('sent1notthesigner000000000000000000000000', fakeSignDoc);
} catch (err) {
  threw = err?.message?.includes('signerAddress mismatch');
}
assert(threw, 'signDirect rejects wrong signerAddress with helpful message');

// ─── 7. Unified factory routes correctly ────────────────────────────────────

console.log('\n7. createPrivyCosmosSigner unified factory...');
const viaFactoryA = await createPrivyCosmosSigner({ mode: 'mnemonic', mnemonic: MNEMONIC });
const [vfaAcc] = await viaFactoryA.getAccounts();
assert(vfaAcc.address === refAccount.address, 'factory mode=mnemonic works');

const viaFactoryB = await createPrivyCosmosSigner({
  mode: 'rawSign', pubkey: compressedPubkey, signRawSecp256k1: fakePrivyRawSign,
});
const [vfbAcc] = await viaFactoryB.getAccounts();
assert(vfbAcc.address === refAccount.address, 'factory mode=rawSign works');

let factoryThrew = false;
try { await createPrivyCosmosSigner({ mode: 'bogus' }); }
catch (err) { factoryThrew = err?.message?.includes('unknown mode'); }
assert(factoryThrew, 'factory rejects unknown mode');

// ─── 8. Static facade equivalence ───────────────────────────────────────────

console.log('\n8. PrivyCosmosSigner static facade...');
const viaStatic = await PrivyCosmosSigner.fromMnemonic({ mnemonic: MNEMONIC });
const [staticAcc] = await viaStatic.getAccounts();
assert(staticAcc.address === refAccount.address,
  'PrivyCosmosSigner.fromMnemonic delegates correctly');

const viaStaticDerive = await PrivyCosmosSigner.derivePubkeyFromMnemonic(MNEMONIC);
assert(viaStaticDerive.address === refAccount.address,
  'PrivyCosmosSigner.derivePubkeyFromMnemonic delegates correctly');

// ─── Summary ────────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(60));
console.log(`Results: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
console.log('All Privy adapter tests passed.');
