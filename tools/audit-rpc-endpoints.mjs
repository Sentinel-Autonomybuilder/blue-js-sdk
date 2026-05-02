#!/usr/bin/env node

/**
 * Audit Sentinel RPC + LCD endpoints.
 *
 * For each candidate, this script verifies:
 *   1. Tendermint connect succeeds within 8s
 *   2. /status reports `catching_up: false`
 *   3. ABCI bank balance query for a known funded address returns the
 *      expected amount (this is stronger than /status alone -- a node can
 *      report in-sync while serving stale ABCI state, which is exactly the
 *      failure mode that bricked rpc.sentinel.co for several weeks)
 *
 * Output is sorted by latency, ready to paste into `defaults.js`.
 *
 * Usage:
 *   node tools/audit-rpc-endpoints.mjs
 *   node tools/audit-rpc-endpoints.mjs <funded-address> <expected-udvpn>
 *
 * The default funded address is a public wallet we control; override if it
 * gets drained or moved.
 */

import { Tendermint37Client } from '@cosmjs/tendermint-rpc';
import { QueryClient, setupBankExtension } from '@cosmjs/stargate';
import { RPC_ENDPOINTS } from '../defaults.js';

const FUNDED_ADDR = process.argv[2] || 'sent1uav3z70yynp4jnt39c6pg3d6ujw78m52v2h7gs';
const EXPECTED_UDVPN = process.argv[3] || '10000000000';

// Audit candidates = SDK list + every public Sentinel RPC we've ever seen.
// Add new endpoints here when you discover them. The script will tell you
// which ones to keep in defaults.js.
const EXTRA_CANDIDATES = [
  ['https://rpc-sentinel.busurnode.com',                  'Busurnode'],
  ['https://rpc-sentinel-ia.cosmosia.notional.ventures',  'Notional'],
  ['https://rpc.sentinel.chaintools.tech',                'ChainTools'],
  ['https://rpc.dvpn.roomit.xyz',                         'Roomit'],
  ['https://sentinel-rpc.badgerbite.io',                  'BadgerBite'],
  ['https://sentinel-rpc.validatornode.com',              'ValidatorNode'],
  ['https://rpc.trinitystake.io',                         'Trinity Stake'],
  ['https://rpc.sentineldao.com',                         'Sentinel Growth DAO'],
  ['https://public.stakewolle.com/cosmos/sentinel/rpc',   'Stakewolle'],
  ['https://sentinel.declab.pro:26628',                   'Decloud Nodes Lab'],
  ['https://rpc.dvpn.me:443',                             'MathNodes China'],
  ['https://rpc.ro.mathnodes.com:443',                    'MathNodes Romania'],
  ['https://rpc.noncompliant.network:443',                'Noncompliant'],
  ['https://rpc-sentinel.chainvibes.com',                 'ChainVibes'],
  ['https://sentinel.rpc.quasarstaking.ai:443',           'Quasar'],
  ['https://rpc.sentinel.validatus.com',                  'Validatus'],
  ['https://rpc.sentinel.suchnode.net',                   'SuchNode'],
];

// Dedupe by URL: SDK list takes priority for the name field.
const seen = new Set();
const candidates = [];
for (const ep of RPC_ENDPOINTS) {
  if (!seen.has(ep.url)) { seen.add(ep.url); candidates.push([ep.url, ep.name]); }
}
for (const [url, name] of EXTRA_CANDIDATES) {
  if (!seen.has(url)) { seen.add(url); candidates.push([url, name]); }
}

async function audit(url, name) {
  const t0 = Date.now();
  let tm = null;
  try {
    tm = await Promise.race([
      Tendermint37Client.connect(url),
      new Promise((_, rej) => setTimeout(() => rej(new Error('connect timeout 8s')), 8000)),
    ]);
    const status = await Promise.race([
      tm.status(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('status timeout 8s')), 8000)),
    ]);
    const height = Number(status.syncInfo.latestBlockHeight);
    const catchingUp = !!status.syncInfo.catchingUp;
    const q = QueryClient.withExtensions(tm, setupBankExtension);
    const bal = await Promise.race([
      q.bank.balance(FUNDED_ADDR, 'udvpn'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('balance timeout 10s')), 10000)),
    ]);
    const ms = Date.now() - t0;
    const balanceOk = bal.amount === EXPECTED_UDVPN;
    return { url, name, ok: !catchingUp && balanceOk, height, catchingUp, balance: bal.amount, balanceOk, ms };
  } catch (e) {
    const ms = Date.now() - t0;
    return { url, name, ok: false, error: e.message, ms };
  } finally {
    try { tm && tm.disconnect(); } catch {}
  }
}

console.log(`Auditing ${candidates.length} RPC endpoints against ${FUNDED_ADDR} (expected ${EXPECTED_UDVPN} udvpn)\n`);

const results = [];
for (const [url, name] of candidates) {
  process.stdout.write(`  ${name.padEnd(28)} ${url.padEnd(58)} `);
  const r = await audit(url, name);
  results.push(r);
  if (r.ok) console.log(`OK   h=${r.height} bal=${r.balance} ${r.ms}ms`);
  else if (r.error) console.log(`FAIL ${r.error} (${r.ms}ms)`);
  else console.log(`STALE catching=${r.catchingUp} balOk=${r.balanceOk} h=${r.height} bal=${r.balance}`);
}

const tier1 = results.filter(r => r.ok).sort((a, b) => a.ms - b.ms);
const tier2 = results.filter(r => !r.ok);

console.log('\n=== TIER 1 — paste this into defaults.js RPC_ENDPOINTS ===');
const today = new Date().toISOString().slice(0, 10);
for (const r of tier1) {
  const lat = String(r.ms).padStart(5);
  console.log(`  { url: '${r.url}', name: '${r.name}', verified: '${today}' },  // ${lat}ms`);
}

console.log('\n=== TIER 2 (failed/stale/wrong-balance) ===');
for (const r of tier2) {
  const reason = r.error || (r.catchingUp ? 'catching_up=true' : !r.balanceOk ? `wrong balance ${r.balance}` : 'unknown');
  console.log(`  ${r.url.padEnd(58)} ${reason}`);
}

console.log(`\n${tier1.length}/${results.length} healthy`);
process.exit(tier1.length === 0 ? 1 : 0);
