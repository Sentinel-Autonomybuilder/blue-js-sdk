#!/usr/bin/env node

/**
 * Audit Sentinel RPC + LCD endpoints (consensus mode).
 *
 * Health = endpoint responds AND its (height, balance) matches the modal
 * answer across all responding candidates, within 50 blocks of tip.
 *
 * Why consensus instead of a hardcoded expected balance: the audited address
 * may transact (its balance changes), making any constant in this file go
 * stale. Consensus survives that — the truth is whatever the majority of
 * responding nodes agree on. A node that disagrees with the majority is
 * either stale (rpc.sentinel.co was 22k blocks behind tip and returning 0)
 * or operating on a forked / corrupted state.
 *
 * Usage:
 *   node tools/audit-rpc-endpoints.mjs
 *   node tools/audit-rpc-endpoints.mjs <funded-address>
 *
 * The default address is a public wallet we control; it doesn't matter what
 * the balance IS — only that all healthy nodes agree on the same number.
 */

import axios from 'axios';
import { Tendermint37Client } from '@cosmjs/tendermint-rpc';
import { QueryClient, setupBankExtension } from '@cosmjs/stargate';
import { RPC_ENDPOINTS, LCD_ENDPOINTS } from '../defaults.js';

const FUNDED_ADDR = process.argv[2] || 'sent1uav3z70yynp4jnt39c6pg3d6ujw78m52v2h7gs';
const HEIGHT_TOLERANCE = 50;

// Audit candidates = SDK list + every public Sentinel endpoint we've ever seen.
// Add new entries here when you discover them; the script tells you which
// ones to keep in defaults.js.
const RPC_EXTRAS = [
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

const LCD_EXTRAS = [
  ['https://api.sentinel.chaintools.tech',         'ChainTools'],
  ['https://lcd.sentineldao.com',                  'Sentinel Growth DAO'],
  ['https://api-sentinel.busurnode.com',           'Busurnode'],
  ['https://api.sentinel.suchnode.net',            'SuchNode'],
  ['https://api.sentinel.quokkastake.io',          'QuokkaStake'],
  ['https://sentinel-api.polkachu.com',            'Polkachu'],
  ['https://sentinel-rest.publicnode.com',         'PublicNode (Allnodes)'],
  ['https://api.dvpn.roomit.xyz',                  'Roomit'],
  ['https://api.sentinel.validatus.com',           'Validatus'],
  ['https://api.mathnodes.com',                    'MathNodes'],
  ['https://api-sentinel.chainvibes.com',          'ChainVibes'],
];

function dedupe(sdkList, extras) {
  const seen = new Set();
  const out = [];
  for (const ep of sdkList) {
    if (!seen.has(ep.url)) { seen.add(ep.url); out.push([ep.url, ep.name]); }
  }
  for (const [url, name] of extras) {
    if (!seen.has(url)) { seen.add(url); out.push([url, name]); }
  }
  return out;
}

async function probeRpc(url, name) {
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
    return { url, name, ok: true, height, catchingUp, balance: bal.amount, ms: Date.now() - t0 };
  } catch (e) {
    return { url, name, ok: false, error: e.message, ms: Date.now() - t0 };
  } finally {
    try { tm && tm.disconnect(); } catch {}
  }
}

async function probeLcd(url, name) {
  const t0 = Date.now();
  try {
    const [statusResp, balResp] = await Promise.all([
      axios.get(`${url}/cosmos/base/tendermint/v1beta1/blocks/latest`, { timeout: 10000 }),
      axios.get(`${url}/cosmos/bank/v1beta1/balances/${FUNDED_ADDR}/by_denom?denom=udvpn`, { timeout: 10000 }),
    ]);
    const height = Number(statusResp.data?.block?.header?.height || 0);
    const balance = balResp.data?.balance?.amount || '0';
    return { url, name, ok: true, height, balance, ms: Date.now() - t0 };
  } catch (e) {
    const reason = e.response ? `${e.response.status} ${e.response.statusText}` : e.message;
    return { url, name, ok: false, error: reason, ms: Date.now() - t0 };
  }
}

function consensus(results, { rejectCatchingUp = false } = {}) {
  const responding = results.filter(r => r.ok);
  const balCounts = new Map();
  for (const r of responding) balCounts.set(r.balance, (balCounts.get(r.balance) || 0) + 1);
  let consensusBal = null, max = 0;
  for (const [b, c] of balCounts) if (c > max) { max = c; consensusBal = b; }
  const tipHeight = Math.max(0, ...responding.map(r => r.height));
  const healthy = responding
    .filter(r => r.balance === consensusBal)
    .filter(r => (tipHeight - r.height) <= HEIGHT_TOLERANCE)
    .filter(r => !(rejectCatchingUp && r.catchingUp))
    .sort((a, b) => a.ms - b.ms);
  return { consensusBal, agree: max, totalResponding: responding.length, tipHeight, healthy };
}

function reasonFor(r, consensusBal, tipHeight) {
  if (r.error) return r.error;
  if (r.catchingUp) return 'catching_up=true';
  if (r.balance !== consensusBal) return `balance=${r.balance} (consensus=${consensusBal})`;
  if ((tipHeight - r.height) > HEIGHT_TOLERANCE) return `behind tip by ${tipHeight - r.height} blocks`;
  return 'unknown';
}

const today = new Date().toISOString().slice(0, 10);

// ─── RPC ────────────────────────────────────────────────────────────────────
const rpcCandidates = dedupe(RPC_ENDPOINTS, RPC_EXTRAS);
console.log(`Auditing ${rpcCandidates.length} RPC endpoints against ${FUNDED_ADDR}\n`);

const rpcResults = [];
for (const [url, name] of rpcCandidates) {
  process.stdout.write(`  ${name.padEnd(28)} ${url.padEnd(58)} `);
  const r = await probeRpc(url, name);
  rpcResults.push(r);
  if (r.ok) console.log(`resp h=${r.height} bal=${r.balance} catching=${r.catchingUp} ${r.ms}ms`);
  else console.log(`FAIL ${r.error} (${r.ms}ms)`);
}

const rpcVerdict = consensus(rpcResults, { rejectCatchingUp: true });
const rpcHealthy = new Set(rpcVerdict.healthy);
const rpcUnhealthy = rpcResults.filter(r => !rpcHealthy.has(r));

console.log(`\nRPC consensus: balance=${rpcVerdict.consensusBal} (${rpcVerdict.agree}/${rpcVerdict.totalResponding} agree), tip=${rpcVerdict.tipHeight}\n`);
console.log('=== TIER 1 RPC — paste into defaults.js RPC_ENDPOINTS ===');
for (const r of rpcVerdict.healthy) {
  const lat = String(r.ms).padStart(5);
  console.log(`  { url: '${r.url}', name: '${r.name}', verified: '${today}' },  // ${lat}ms`);
}
console.log('\n=== TIER 2 RPC (excluded) ===');
for (const r of rpcUnhealthy) {
  console.log(`  ${r.url.padEnd(58)} ${reasonFor(r, rpcVerdict.consensusBal, rpcVerdict.tipHeight)}`);
}
console.log(`\n${rpcVerdict.healthy.length}/${rpcResults.length} RPC healthy`);

// ─── LCD ────────────────────────────────────────────────────────────────────
const lcdCandidates = dedupe(LCD_ENDPOINTS, LCD_EXTRAS);
console.log(`\nAuditing ${lcdCandidates.length} LCD endpoints against ${FUNDED_ADDR}\n`);

const lcdResults = [];
for (const [url, name] of lcdCandidates) {
  process.stdout.write(`  ${name.padEnd(28)} ${url.padEnd(50)} `);
  const r = await probeLcd(url, name);
  lcdResults.push(r);
  if (r.ok) console.log(`resp h=${r.height} bal=${r.balance} ${r.ms}ms`);
  else console.log(`FAIL ${r.error} (${r.ms}ms)`);
}

const lcdVerdict = consensus(lcdResults);
const lcdHealthy = new Set(lcdVerdict.healthy);
const lcdUnhealthy = lcdResults.filter(r => !lcdHealthy.has(r));

console.log(`\nLCD consensus: balance=${lcdVerdict.consensusBal} (${lcdVerdict.agree}/${lcdVerdict.totalResponding} agree), tip=${lcdVerdict.tipHeight}\n`);
console.log('=== TIER 1 LCD — paste into defaults.js LCD_ENDPOINTS ===');
for (const r of lcdVerdict.healthy) {
  const lat = String(r.ms).padStart(5);
  console.log(`  { url: '${r.url}', name: '${r.name}', verified: '${today}' },  // ${lat}ms`);
}
console.log('\n=== TIER 2 LCD (excluded) ===');
for (const r of lcdUnhealthy) {
  console.log(`  ${r.url.padEnd(50)} ${reasonFor(r, lcdVerdict.consensusBal, lcdVerdict.tipHeight)}`);
}
console.log(`\n${lcdVerdict.healthy.length}/${lcdResults.length} LCD healthy`);

const totalHealthy = rpcVerdict.healthy.length + lcdVerdict.healthy.length;
process.exit(totalHealthy === 0 ? 1 : 0);
