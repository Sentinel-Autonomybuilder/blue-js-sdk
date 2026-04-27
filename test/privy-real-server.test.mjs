#!/usr/bin/env node
/**
 * Real-Privy-server end-to-end test — NOT in CI, requires app credentials.
 *
 * Reads PRIVY_APP_ID and PRIVY_APP_SECRET from env. Creates a fresh server-
 * managed Cosmos secp256k1 wallet on Privy, then drives PrivyRawSignDirectSigner
 * with a callback that hits the real /v1/wallets/{id}/raw_sign endpoint, and
 * verifies the resulting cosmjs SignDirect signature against the Privy-derived
 * pubkey using @cosmjs/crypto's verifier.
 *
 * What this proves end-to-end:
 *   1. Privy's create-wallet returns a 33-byte compressed secp256k1 pubkey
 *      that pubkeyToBech32Address() can hash into a valid sent1... address.
 *   2. The bytes Privy's raw_sign returns are exactly the r||s shape the
 *      adapter expects — no recovery byte, no DER, no eth_sign prefixing.
 *   3. The signature the adapter assembles for a fake SignDoc verifies
 *      against the Privy-derived pubkey on sha256(makeSignBytes(signDoc)).
 *
 * No chain broadcast — the test wallet has no funds.
 *
 * Usage:
 *   PRIVY_APP_ID=... PRIVY_APP_SECRET=... node test/privy-real-server.test.mjs
 */

import {
  PrivyRawSignDirectSigner,
} from '../index.js';
import { Secp256k1, sha256 } from '@cosmjs/crypto';
import { Secp256k1Signature } from '@cosmjs/crypto';
import { fromHex } from '@cosmjs/encoding';
import { makeSignBytes } from '@cosmjs/proto-signing';

const APP_ID = process.env.PRIVY_APP_ID;
const APP_SECRET = process.env.PRIVY_APP_SECRET;
if (!APP_ID || !APP_SECRET) {
  console.error('PRIVY_APP_ID and PRIVY_APP_SECRET env vars required');
  process.exit(2);
}

const BASIC = Buffer.from(`${APP_ID}:${APP_SECRET}`).toString('base64');
const HEADERS = {
  'Authorization': `Basic ${BASIC}`,
  'privy-app-id': APP_ID,
  'Content-Type': 'application/json',
};

let pass = 0, fail = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL: ${name}`); }
}

console.log('Privy → Sentinel — REAL SERVER end-to-end\n');

// ─── 1. Create a fresh server-managed Cosmos wallet on Privy ────────────────

console.log('1. Creating server-managed Cosmos wallet via Privy API...');
const createRes = await fetch('https://api.privy.io/v1/wallets', {
  method: 'POST',
  headers: HEADERS,
  body: JSON.stringify({ chain_type: 'cosmos' }),
});
const createJson = await createRes.json();
console.log(`   HTTP ${createRes.status}`);
if (!createRes.ok) {
  console.error('   error response:', JSON.stringify(createJson));
  process.exit(1);
}
console.log(`   wallet id   : ${createJson.id}`);
console.log(`   address     : ${createJson.address}`);
console.log(`   public_key  : ${createJson.public_key}`);
console.log(`   chain_type  : ${createJson.chain_type}`);

assert(createJson.chain_type === 'cosmos', 'wallet chain_type === cosmos');
assert(typeof createJson.id === 'string' && createJson.id.length > 0,
  'wallet id is a non-empty string');
assert(typeof createJson.public_key === 'string' && createJson.public_key.length > 0,
  'public_key is present');

// Privy returns the public_key as a hex string. Verify it parses to 33 bytes
// (compressed secp256k1).
const pubHex = createJson.public_key.startsWith('0x')
  ? createJson.public_key.slice(2)
  : createJson.public_key;
const pubkey = fromHex(pubHex);
console.log(`   pubkey bytes: ${pubkey.length}`);
assert(pubkey.length === 33,
  `Privy public_key parses to 33 bytes (got ${pubkey.length})`);
assert(pubkey[0] === 0x02 || pubkey[0] === 0x03,
  `Privy public_key has compressed prefix 0x02/0x03 (got 0x${pubkey[0].toString(16)})`);

// ─── 2. Wire the Privy raw_sign endpoint into the adapter ───────────────────

console.log('\n2. Wiring Privy /raw_sign callback into PrivyRawSignDirectSigner...');

let rawSignCallCount = 0;
async function privyRawSign(digest32) {
  rawSignCallCount++;
  if (!(digest32 instanceof Uint8Array) || digest32.length !== 32) {
    throw new Error(`bad digest: ${digest32?.length} bytes`);
  }
  const hashHex = '0x' + Buffer.from(digest32).toString('hex');
  const res = await fetch(`https://api.privy.io/v1/wallets/${createJson.id}/raw_sign`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ params: { hash: hashHex } }),
  });
  const j = await res.json();
  if (!res.ok) {
    throw new Error(`Privy raw_sign HTTP ${res.status}: ${JSON.stringify(j)}`);
  }
  const sigHex = j?.data?.signature;
  if (typeof sigHex !== 'string') {
    throw new Error(`Privy raw_sign returned no signature: ${JSON.stringify(j)}`);
  }
  const stripped = sigHex.startsWith('0x') ? sigHex.slice(2) : sigHex;
  let bytes = fromHex(stripped);
  // Privy may return r||s||recovery (65 bytes); the adapter contract is r||s (64).
  if (bytes.length === 65) bytes = bytes.slice(0, 64);
  if (bytes.length !== 64) {
    throw new Error(`Privy raw_sign returned ${bytes.length} bytes, expected 64`);
  }
  return bytes;
}

const signer = new PrivyRawSignDirectSigner({
  pubkey,
  signRawSecp256k1: privyRawSign,
  prefix: 'sent', // Privy returns address with default cosmos1 prefix; adapter
                  // re-derives the address from pubkey using the requested prefix.
});

const [acc] = await signer.getAccounts();
console.log(`   adapter address (sent prefix): ${acc.address}`);
assert(acc.address.startsWith('sent1'), 'adapter re-derives sent1... address from Privy pubkey');
assert(acc.algo === 'secp256k1', 'adapter reports algo=secp256k1');
assert(acc.pubkey.length === 33, 'adapter exposes the 33-byte pubkey unchanged');

// ─── 3. Drive signDirect with a synthetic SignDoc and verify the signature ──

console.log('\n3. signDirect — Privy actually signs, signature verifies on cosmjs side...');
const fakeSignDoc = {
  bodyBytes: new Uint8Array([1, 2, 3, 4, 5]),
  authInfoBytes: new Uint8Array([6, 7, 8, 9]),
  chainId: 'sentinelhub-2',
  accountNumber: BigInt(0),
};

const beforeCalls = rawSignCallCount;
const { signed, signature } = await signer.signDirect(acc.address, fakeSignDoc);
const afterCalls = rawSignCallCount;
console.log(`   raw_sign calls: ${afterCalls - beforeCalls}`);

assert(afterCalls === beforeCalls + 1,
  'signDirect made exactly one HTTP call to Privy /raw_sign');
assert(signed === fakeSignDoc, 'signDirect returns the SignDoc unchanged in `signed`');
assert(signature.pub_key.type === 'tendermint/PubKeySecp256k1',
  'signature pub_key.type is tendermint/PubKeySecp256k1');
assert(typeof signature.signature === 'string' && signature.signature.length > 0,
  'signature.signature is non-empty base64');

const expectedDigest = sha256(makeSignBytes(fakeSignDoc));
const sigBytes = Buffer.from(signature.signature, 'base64');
const parsed = Secp256k1Signature.fromFixedLength(new Uint8Array(sigBytes));
const ok = await Secp256k1.verifySignature(parsed, expectedDigest, pubkey);
assert(ok === true,
  'Privy-produced signature VERIFIES on the Sentinel-side digest with @cosmjs/crypto');

// ─── Summary ────────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(60));
console.log(`Results: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
console.log('Privy real server → Sentinel adapter end-to-end verified.');
