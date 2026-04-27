#!/usr/bin/env node
/**
 * SENTINEL SDK — FULL E2E TEST RUNNER
 *
 * Runs every test suite in order. All suites that need chain access use
 * the MNEMONIC from ../ ai-path/.env or a local .env.
 *
 * Usage:
 *   node test-e2e.js            # run everything
 *   node test-e2e.js --offline  # logic tests only (no network)
 *   node test-e2e.js --quick    # offline + chain queries, no TX or connection
 *
 * Suites (in order):
 *   1. Logic         — 127 pure-logic tests, no network (test-all-logic.js)
 *   2. FeeGrant E2E  — isActiveStatus, error codes, queryFeeGrant offline + live (test-plan-connect-e2e.js)
 *   3. Mainnet       — wallet, queries, cache, preflight, WireGuard connect (test-mainnet.js)
 *   4. Subscriptions — subscribe, share, feegrant, onboard, renew, cancel (test-subscription-flows.js)
 *
 * Suites 3-4 broadcast real TXs and cost ~1–3 P2P per run.
 * Suite 3 opens and closes one WireGuard session.
 * Never run suites in parallel — chain rate limits apply (7s between TXs).
 */

import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, '../ai-path/.env') });
dotenvConfig(); // also try CWD .env

const MNEMONIC = process.env.MNEMONIC;
const args = process.argv.slice(2);
const offlineOnly = args.includes('--offline');
const quickMode   = args.includes('--quick');

const FEE_GRANTER = 'sent1t0xjyflrah5n36rfkpfeuw6pz6vl2g27x2793l';
const FEE_GRANTEE = MNEMONIC ? undefined : null; // resolved from wallet
const PLAN_ID     = '42';

console.log('═══════════════════════════════════════════════════════════');
console.log('  SENTINEL SDK — FULL E2E TEST RUNNER');
console.log('═══════════════════════════════════════════════════════════');
console.log(`  Mode       : ${offlineOnly ? 'offline-only' : quickMode ? 'quick (no TX)' : 'full (chain + TX)'}`);
console.log(`  MNEMONIC   : ${MNEMONIC ? 'set' : 'NOT SET — chain tests will fail'}`);
console.log('');

// ─── Suite runner ─────────────────────────────────────────────────────────────

const results = [];

function runSuite(name, file, env = {}) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  SUITE: ${name}`);
  console.log(`${'─'.repeat(60)}`);

  const merged = { ...process.env, ...env };
  const r = spawnSync('node', [file], { cwd: __dirname, env: merged, stdio: 'inherit' });

  const ok = r.status === 0;
  results.push({ name, ok, status: r.status });
  if (!ok) console.log(`\n  [SUITE FAILED — exit ${r.status}]`);
  return ok;
}

// ─── Suite 1: Pure logic ───────────────────────────────────────────────────

runSuite('Logic (offline, no network)', 'test-all-logic.js');

if (offlineOnly) {
  printSummary();
  process.exit(results.every(r => r.ok) ? 0 : 1);
}

// ─── Suite 2: FeeGrant E2E (offline + live LCD) ───────────────────────────

// Resolve the grantee address from the wallet if mnemonic is available.
let granteeAddr = FEE_GRANTEE;
if (MNEMONIC && !granteeAddr) {
  try {
    const { createWallet } = await import('./index.js');
    const { account } = await createWallet(MNEMONIC);
    granteeAddr = account.address;
  } catch (_) {
    // leave undefined — live LCD section will be skipped
  }
}

runSuite('FeeGrant + isActiveStatus + error codes (offline + live LCD)',
  'test-plan-connect-e2e.js',
  {
    E2E_LIVE: MNEMONIC ? '1' : '0',
    FEE_GRANTER,
    FEE_GRANTEE: granteeAddr || '',
    PLAN_ID,
  },
);

if (quickMode) {
  printSummary();
  process.exit(results.every(r => r.ok) ? 0 : 1);
}

// ─── Suite 3: Mainnet — wallet + queries + WireGuard connect ─────────────

if (!MNEMONIC) {
  console.log('\n  SKIP Suite 3+4 — MNEMONIC not set');
} else {
  runSuite('Mainnet (wallet, chain queries, WireGuard connect)', 'test-mainnet.js',
    { MNEMONIC });

  // 60s gap between full suites to let chain settle
  console.log('\n  Waiting 60s between suites (chain settle)...');
  await new Promise(r => setTimeout(r, 60000));

  // ─── Suite 4: Subscription flows ─────────────────────────────────────────

  runSuite('Subscription flows (subscribe, share, feegrant, onboard, renew, cancel)',
    'test-subscription-flows.js', { MNEMONIC });
}

// ─── Summary ──────────────────────────────────────────────────────────────

printSummary();
process.exit(results.every(r => r.ok) ? 0 : 1);

function printSummary() {
  const pass = results.filter(r => r.ok).length;
  const fail = results.filter(r => !r.ok).length;
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  FINAL: ${pass} suite(s) passed, ${fail} failed`);
  for (const r of results) {
    console.log(`    ${r.ok ? '✓' : '✗'} ${r.name}`);
  }
  console.log('═══════════════════════════════════════════════════════════');
}
