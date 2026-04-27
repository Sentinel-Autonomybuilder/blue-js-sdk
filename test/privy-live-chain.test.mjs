#!/usr/bin/env node
/**
 * Live-chain verification of the Privy adapter — mainnet, NOT in CI.
 *
 * Reads MNEMONIC from env (load it from a project-private .env before running).
 *
 * What this proves end-to-end against Sentinel mainnet:
 *   1. SentinelClient({ signer: PrivyCosmosSigner.fromMnemonic(...) }) — getBalance() works.
 *   2. SentinelClient({ signer: PrivyRawSignDirectSigner(...) }) where the raw-sign
 *      callback is exactly the shape Privy's "sign raw secp256k1 hash" endpoint
 *      delivers — getBalance() works AND a self-MsgSend of 1 udvpn broadcasts and
 *      lands in a block. This is the actual contract: chain validators verify the
 *      signature the adapter produces.
 *   3. Mode A and Mode B derive the same sent1... address from the same seed.
 *
 * Usage:
 *   MNEMONIC="..." node test/privy-live-chain.test.mjs
 */

import {
  SentinelClient,
  PrivyCosmosSigner,
  PrivyRawSignDirectSigner,
  privyCosmosSignerFromMnemonic,
} from '../index.js';
import {
  Bip39, EnglishMnemonic, Slip10, Slip10Curve, Secp256k1,
} from '@cosmjs/crypto';
import { makeCosmoshubPath } from '@cosmjs/amino';

const MNEMONIC = process.env.MNEMONIC;
if (!MNEMONIC) {
  console.error('MNEMONIC env var required');
  process.exit(2);
}
const RPC = process.env.RPC_URL || 'https://rpc.sentinel.co:443';

let pass = 0, fail = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL: ${name}`); }
}

console.log('Privy adapter — LIVE CHAIN integration test\n');
console.log(`RPC: ${RPC}\n`);

// ─── Set up a "fake Privy" raw-sign callback backed by the local privkey ────
// This is what Privy's signRawHash({ hash, curve: 'secp256k1' }) delivers shape-
// for-shape: 64 bytes (r||s), no recovery byte, signed over the raw 32-byte
// digest the SDK passes in (no eth_sign-style prefixing).

const seed = await Bip39.mnemonicToSeed(new EnglishMnemonic(MNEMONIC));
const { privkey } = Slip10.derivePath(Slip10Curve.Secp256k1, seed, makeCosmoshubPath(0));
const keypair = await Secp256k1.makeKeypair(privkey);
const compressedPubkey = Secp256k1.compressPubkey(keypair.pubkey);

let rawSignCallCount = 0;
async function privyLikeRawSign(digest32) {
  rawSignCallCount++;
  if (!(digest32 instanceof Uint8Array) || digest32.length !== 32) {
    throw new Error(`Privy callback received bad digest: ${digest32?.length} bytes`);
  }
  const sig = await Secp256k1.createSignature(digest32, privkey);
  const out = new Uint8Array(64);
  out.set(sig.r(32), 0);
  out.set(sig.s(32), 32);
  return out;
}

// ─── 1. Mode A — SentinelClient + Privy mnemonic signer ─────────────────────

console.log('1. Mode A: SentinelClient({ signer: PrivyCosmosSigner.fromMnemonic })...');
const modeASigner = await PrivyCosmosSigner.fromMnemonic({ mnemonic: MNEMONIC });
const [modeAAcc] = await modeASigner.getAccounts();
console.log(`   address: ${modeAAcc.address}`);

const clientA = new SentinelClient({ signer: modeASigner, rpcUrl: RPC, mnemonic: MNEMONIC });
const balA = await clientA.getBalance();
console.log(`   balance: ${balA.dvpn} P2P (${balA.udvpn} udvpn)`);
assert(typeof balA.udvpn === 'bigint' || typeof balA.udvpn === 'number',
  'Mode A getBalance() returned a numeric balance');
assert(modeAAcc.address.startsWith('sent1'), 'Mode A address has sent1 prefix');
clientA.destroy();

// ─── 2. Mode B — SentinelClient + Privy raw-sign signer ─────────────────────

console.log('\n2. Mode B: SentinelClient({ signer: PrivyRawSignDirectSigner })...');
const modeBSigner = new PrivyRawSignDirectSigner({
  pubkey: compressedPubkey,
  signRawSecp256k1: privyLikeRawSign,
});
const [modeBAcc] = await modeBSigner.getAccounts();
console.log(`   address: ${modeBAcc.address}`);
assert(modeBAcc.address === modeAAcc.address,
  'Mode B address matches Mode A (same seed, same path, same prefix)');

const clientB = new SentinelClient({ signer: modeBSigner, rpcUrl: RPC });
const balB = await clientB.getBalance();
console.log(`   balance: ${balB.dvpn} P2P`);
assert(balB.udvpn === balA.udvpn,
  'Mode B getBalance() matches Mode A balance (same address)');

// ─── 3. Mode B — broadcast a real TX (self-MsgSend, 1 udvpn) ────────────────

console.log('\n3. Mode B: broadcasting real TX (self-MsgSend of 1 udvpn)...');
console.log('   This proves chain validators accept signatures the adapter produces.');

if (balA.udvpn === 0n || balA.udvpn === 0) {
  console.log('   SKIP: wallet is empty — fund it with at least gas + 1 udvpn to run this step.');
} else {
  const sigClient = await clientB.getClient();
  const before = rawSignCallCount;
  const fee = { amount: [{ denom: 'udvpn', amount: '20000' }], gas: '200000' };
  const result = await sigClient.sendTokens(
    modeBAcc.address,
    modeBAcc.address, // self-send
    [{ denom: 'udvpn', amount: '1' }],
    fee,
    'privy-adapter live test',
  );
  console.log(`   tx hash: ${result.transactionHash}`);
  console.log(`   height : ${result.height}`);
  console.log(`   code   : ${result.code}`);
  console.log(`   raw-sign calls: ${rawSignCallCount - before}`);

  assert(result.code === 0, 'broadcast succeeded with code 0');
  assert(typeof result.transactionHash === 'string' && result.transactionHash.length === 64,
    'broadcast returned a 64-char tx hash');
  assert(rawSignCallCount > before,
    'Privy-style raw-sign callback was actually invoked during broadcast');
}

clientB.destroy();

// ─── Summary ────────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(60));
console.log(`Results: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
console.log('Live-chain Privy integration verified.');
