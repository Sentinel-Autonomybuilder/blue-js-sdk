#!/usr/bin/env node
/**
 * SentinelClient + Privy adapter integration tests.
 *
 * Covers:
 *   1. SentinelClient with `signer` (Mode B / Privy raw-sign) — getWallet()
 *      returns the signer + first account, no mnemonic required.
 *   2. Same SentinelClient — getAccounts()[0].address matches the address that
 *      Mode A (mnemonic) derives from the same seed.
 *   3. SentinelClient with `mnemonic` (the original path) still works.
 *   4. SentinelClient with `signer` rejects connect()/autoConnect()/connectPlan()
 *      with the expected "VPN connect/disconnect requires a mnemonic" error,
 *      because the WireGuard/V2Ray handshake signs with the raw cosmos privkey.
 *
 * No network — pure offline assertions on the wiring.
 *
 * Run: node test/privy-client-integration.test.mjs
 */

import {
  SentinelClient,
  PrivyRawSignDirectSigner,
  privyCosmosSignerFromMnemonic,
  createWallet,
} from '../index.js';
import {
  Bip39, EnglishMnemonic, Slip10, Slip10Curve, Secp256k1,
} from '@cosmjs/crypto';
import { makeCosmoshubPath } from '@cosmjs/amino';

let pass = 0, fail = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL: ${name}`); }
}

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

console.log('SentinelClient + Privy adapter integration tests\n');

// Re-derive the privkey + compressed pubkey locally (this is what Privy holds).
const seed = await Bip39.mnemonicToSeed(new EnglishMnemonic(MNEMONIC));
const { privkey } = Slip10.derivePath(Slip10Curve.Secp256k1, seed, makeCosmoshubPath(0));
const keypair = await Secp256k1.makeKeypair(privkey);
const compressedPubkey = Secp256k1.compressPubkey(keypair.pubkey);

async function fakePrivyRawSign(digest32) {
  const sig = await Secp256k1.createSignature(digest32, privkey);
  const out = new Uint8Array(64);
  out.set(sig.r(32), 0);
  out.set(sig.s(32), 32);
  return out;
}

const { account: refAccount } = await createWallet(MNEMONIC);

// ─── 1. SentinelClient with signer (no mnemonic) ────────────────────────────

console.log('1. SentinelClient with `signer` (no mnemonic)...');
const privySigner = new PrivyRawSignDirectSigner({
  pubkey: compressedPubkey,
  signRawSecp256k1: fakePrivyRawSign,
});
const clientB = new SentinelClient({ signer: privySigner });
const wB = await clientB.getWallet();
assert(wB && wB.account && typeof wB.account.address === 'string',
  'getWallet() returns { wallet, account } shape');
assert(wB.wallet === privySigner,
  'getWallet().wallet IS the supplied signer (not re-wrapped)');
assert(wB.account.address === refAccount.address,
  `signer address matches createWallet() address (${wB.account.address})`);
assert(wB.account.address.startsWith('sent1'),
  'address has sent1 prefix');

// Cached on second call.
const wB2 = await clientB.getWallet();
assert(wB2 === wB, 'getWallet() returns the same object on second call');
clientB.destroy();

// ─── 2. SentinelClient with mnemonic (backwards compat) ─────────────────────

console.log('\n2. SentinelClient with `mnemonic` (backwards compat)...');
const clientA = new SentinelClient({ mnemonic: MNEMONIC });
const wA = await clientA.getWallet();
assert(wA && wA.account && wA.account.address === refAccount.address,
  'mnemonic-mode address matches refAccount');
clientA.destroy();

// ─── 3. SentinelClient with neither mnemonic nor signer throws helpfully ────

console.log('\n3. SentinelClient with no auth throws helpfully...');
const clientNone = new SentinelClient({});
let threwNone = false;
let noneMsg = '';
try { await clientNone.getWallet(); }
catch (err) { threwNone = true; noneMsg = err?.message || ''; }
assert(threwNone && noneMsg.includes('mnemonic or signer'),
  'getWallet() throws with helpful message when neither is provided');
clientNone.destroy();

// ─── 4. signer-only mode rejects connect()/autoConnect()/connectPlan() ──────

console.log('\n4. signer-only mode rejects tunnel connect paths...');
const clientB2 = new SentinelClient({ signer: privySigner });

let threwConnect = false, msgConnect = '';
try { await clientB2.connect({ nodeAddress: 'sentnode1xxx' }); }
catch (err) { threwConnect = true; msgConnect = err?.message || ''; }
assert(threwConnect && msgConnect.includes('requires a mnemonic'),
  'connect() rejects signer-only mode with mnemonic-required error');
assert(msgConnect.includes('PRIVY-INTEGRATION'),
  'error message points to docs/PRIVY-INTEGRATION.md');

let threwAuto = false, msgAuto = '';
try { await clientB2.autoConnect({}); }
catch (err) { threwAuto = true; msgAuto = err?.message || ''; }
assert(threwAuto && msgAuto.includes('requires a mnemonic'),
  'autoConnect() rejects signer-only mode');

let threwPlan = false, msgPlan = '';
try { await clientB2.connectPlan({ planId: 1n }); }
catch (err) { threwPlan = true; msgPlan = err?.message || ''; }
assert(threwPlan && msgPlan.includes('requires a mnemonic'),
  'connectPlan() rejects signer-only mode');

clientB2.destroy();

// ─── 5. Mnemonic-mode SentinelClient address matches Mode A signer address ──

console.log('\n5. Address parity SentinelClient(mnemonic) vs PrivyCosmosSigner(mnemonic)...');
const modeASigner = await privyCosmosSignerFromMnemonic({ mnemonic: MNEMONIC });
const [modeAAcc] = await modeASigner.getAccounts();
const clientA2 = new SentinelClient({ mnemonic: MNEMONIC });
const { account: clientAAcc } = await clientA2.getWallet();
assert(modeAAcc.address === clientAAcc.address,
  'PrivyCosmosSigner(mnemonic) and SentinelClient(mnemonic) derive same address');
clientA2.destroy();

// ─── Summary ────────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(60));
console.log(`Results: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
console.log('All SentinelClient + Privy integration tests passed.');
