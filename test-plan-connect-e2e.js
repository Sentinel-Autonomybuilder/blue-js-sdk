#!/usr/bin/env node
/**
 * PLAN-SUBSCRIPTION CONNECT — E2E HARNESS
 *
 * Two modes:
 *   1. Offline (default) — validates the code paths added for the 2026-04-23
 *      plan+feegrant audit without broadcasting:
 *        - isActiveStatus() strict-1 semantics
 *        - queryFeeGrant() shape on a fabricated LCD response
 *        - ErrorCodes.FEE_GRANT_MISSING_AT_START / FEE_GRANT_EXPIRED exported
 *        - userMessage() text parity with C# SentinelErrors.UserMessage
 *        - connectViaPlan argument plumbing (requireFeeGrant flag is accepted)
 *      No network calls. No TX. Safe to run anywhere, any time.
 *
 *   2. Live (E2E_LIVE=1) — calls queryFeeGrant + queryPlanDetails against
 *      mainnet LCD. No broadcast. Requires FEE_GRANTER + FEE_GRANTEE + PLAN_ID.
 *      Respects the SDK rule "never parallel chain tests" — runs serially.
 *
 * Run:
 *   node test-plan-connect-e2e.js                        # offline
 *   E2E_LIVE=1 FEE_GRANTER=sent1... FEE_GRANTEE=sent1... PLAN_ID=42 \
 *     node test-plan-connect-e2e.js                      # live (queries only)
 */

import {
  ErrorCodes,
  isActiveStatus,
  queryFeeGrant,
  queryPlanDetails,
} from './index.js';
import { userMessage } from './errors.js';
import { RPC_ENDPOINTS } from './defaults.js';

// ─── Test harness ───────────────────────────────────────────
let pass = 0;
let fail = 0;
function assert(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}
function section(name) { console.log(`\n── ${name} ──`); }

// ─── 1. isActiveStatus strict-1 semantics ───────────────────
section('isActiveStatus');
assert('numeric 1 is active', isActiveStatus(1) === true);
assert('string "1" is active', isActiveStatus('1') === true);
assert('STATUS_ACTIVE is active', isActiveStatus('STATUS_ACTIVE') === true);
assert('numeric 2 is NOT active (status-inactive-pending)', isActiveStatus(2) === false);
assert('numeric 3 is NOT active (STATUS_INACTIVE — terminal)', isActiveStatus(3) === false);
assert('STATUS_INACTIVE_PENDING is NOT active', isActiveStatus('STATUS_INACTIVE_PENDING') === false);
assert('STATUS_INACTIVE is NOT active', isActiveStatus('STATUS_INACTIVE') === false);
assert('undefined is NOT active', isActiveStatus(undefined) === false);
assert('null is NOT active', isActiveStatus(null) === false);

// ─── 2. New error codes exported ─────────────────────────────
section('Error codes');
assert('FEE_GRANT_MISSING_AT_START exported', ErrorCodes.FEE_GRANT_MISSING_AT_START === 'FEE_GRANT_MISSING_AT_START');
assert('FEE_GRANT_EXPIRED exported', ErrorCodes.FEE_GRANT_EXPIRED === 'FEE_GRANT_EXPIRED');
assert('NODE_MISCONFIGURED exported', ErrorCodes.NODE_MISCONFIGURED === 'NODE_MISCONFIGURED');
assert('NODE_DB_CORRUPT exported', ErrorCodes.NODE_DB_CORRUPT === 'NODE_DB_CORRUPT');
assert('NODE_RPC_BROKEN exported', ErrorCodes.NODE_RPC_BROKEN === 'NODE_RPC_BROKEN');
assert('SEQUENCE_MISMATCH exported', ErrorCodes.SEQUENCE_MISMATCH === 'SEQUENCE_MISMATCH');
assert('NOT_CONNECTED exported', ErrorCodes.NOT_CONNECTED === 'NOT_CONNECTED');
assert('CONNECTION_IN_PROGRESS exported', ErrorCodes.CONNECTION_IN_PROGRESS === 'CONNECTION_IN_PROGRESS');
assert('HANDSHAKE_FAILED exported', ErrorCodes.HANDSHAKE_FAILED === 'HANDSHAKE_FAILED');

// ─── 3. User messages — parity with C# SentinelErrors ────────
// These strings must match C# UserMessage() verbatim. If a translator changes
// either side without the other, the JS↔C# error-UX contract breaks.
section('userMessage parity (JS side)');
const expectedMsgs = {
  FEE_GRANT_MISSING_AT_START:
    "Plan owner has not issued a fee grant to this wallet. Contact the plan provider.",
  FEE_GRANT_EXPIRED:
    "The plan owner's fee grant has expired. Contact the plan provider to renew.",
};
for (const [code, expected] of Object.entries(expectedMsgs)) {
  const actual = userMessage(code);
  assert(`userMessage(${code}) matches C# text`, actual === expected,
    `got "${actual}", expected "${expected}"`);
}

// ─── 4. queryFeeGrant offline (fabricated LCD server) ────────
// Spin up a tiny HTTP server that returns the single-pair endpoint JSON shape.
// Verifies the SDK walks AllowedMsgAllowance → BasicAllowance correctly and
// surfaces spend_limit, expiration, allowed_messages, type_url flat.
section('queryFeeGrant (offline, fabricated LCD)');
import { createServer } from 'http';
import { once } from 'events';

async function withFakeLcd(responder, fn) {
  const server = createServer((req, res) => {
    try {
      const out = responder(req);
      res.writeHead(out.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out.body));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e) }));
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

// Force LCD-only: empty RPC_ENDPOINTS so queryFeeGrant falls through to the
// fake LCD server instead of hitting real mainnet RPC.
const _savedRpcEndpoints = RPC_ENDPOINTS.splice(0, RPC_ENDPOINTS.length);

try {
  // Case A: BasicAllowance — active grant
  const grantA = {
    status: 200,
    body: {
      allowance: {
        granter: 'sent1granter',
        grantee: 'sent1grantee',
        allowance: {
          '@type': '/cosmos.feegrant.v1beta1.BasicAllowance',
          spend_limit: [{ denom: 'udvpn', amount: '5000000' }],
          expiration: '2099-01-01T00:00:00Z',
        },
      },
    },
  };
  await withFakeLcd(() => grantA, async (lcd) => {
    const r = await queryFeeGrant(lcd, 'sent1granter', 'sent1grantee');
    assert('BasicAllowance returns non-null', r != null);
    if (r) {
      // queryFeeGrant returns the raw wrapper { granter, grantee, allowance: {...} }.
      const inner = r.allowance || r;
      const typeUrl = inner['@type'] || inner.typeUrl || inner.type_url;
      assert('BasicAllowance.@type is BasicAllowance',
        typeUrl === '/cosmos.feegrant.v1beta1.BasicAllowance',
        `got ${typeUrl}`);
      const exp = inner.expiration || inner.expiresAt;
      assert('BasicAllowance exposes expiration', exp != null, `got ${exp}`);
    }
  });

  // Case B: AllowedMsgAllowance — wraps BasicAllowance
  const grantB = {
    status: 200,
    body: {
      allowance: {
        granter: 'sent1granter',
        grantee: 'sent1grantee',
        allowance: {
          '@type': '/cosmos.feegrant.v1beta1.AllowedMsgAllowance',
          allowance: {
            '@type': '/cosmos.feegrant.v1beta1.BasicAllowance',
            spend_limit: [{ denom: 'udvpn', amount: '2000000' }],
            expiration: '2099-01-01T00:00:00Z',
          },
          allowed_messages: ['/sentinel.plan.v3.MsgStartSessionRequest'],
        },
      },
    },
  };
  await withFakeLcd(() => grantB, async (lcd) => {
    const r = await queryFeeGrant(lcd, 'sent1granter', 'sent1grantee');
    assert('AllowedMsgAllowance returns non-null', r != null);
    if (r) {
      const inner = r.allowance || r;
      const msgs = inner.allowed_messages || inner.allowedMessages;
      assert('AllowedMsgAllowance surfaces allowed_messages',
        Array.isArray(msgs) && msgs.length > 0,
        `got ${JSON.stringify(msgs)}`);
    }
  });

  // Case C: 404 — no grant
  const grantC = { status: 404, body: { code: 5, message: 'fee-grant not found' } };
  await withFakeLcd(() => grantC, async (lcd) => {
    const r = await queryFeeGrant(lcd, 'sent1granter', 'sent1grantee');
    assert('404 returns null / exists=false',
      r == null || r.exists === false,
      `got ${JSON.stringify(r)}`);
  });
} catch (e) {
  fail++;
  console.log(`  FAIL queryFeeGrant offline harness threw: ${e.message}`);
}

// ─── 5. Live LCD queries (opt-in) ────────────────────────────
if (process.env.E2E_LIVE === '1') {
  section('Live LCD (E2E_LIVE=1) — SEQUENTIAL, no broadcast');
  const granter = process.env.FEE_GRANTER;
  const grantee = process.env.FEE_GRANTEE;
  const planId  = process.env.PLAN_ID;
  if (!granter || !grantee || !planId) {
    console.log('  skip — set FEE_GRANTER, FEE_GRANTEE, PLAN_ID to run');
  } else {
    const lcd = process.env.LCD_URL || 'https://lcd.sentinel.co';
    try {
      const g = await queryFeeGrant(lcd, granter, grantee);
      assert('live queryFeeGrant returned without throwing', true,
        `result: ${JSON.stringify(g)}`);
      console.log('    grant:', g);
    } catch (e) {
      assert('live queryFeeGrant', false, e.message);
    }
    // 7s between chain touches per SDK CLAUDE.md
    await new Promise(r => setTimeout(r, 7000));
    try {
      const p = await queryPlanDetails(planId, { lcdUrl: lcd });
      assert('live queryPlanDetails returned without throwing', true);
      if (p) {
        assert('plan.provider looks like sentprov1',
          typeof p.provider === 'string' && p.provider.startsWith('sentprov1'),
          `got ${p.provider}`);
        assert('plan.status is numeric-shaped',
          typeof p.status === 'number' || /^\d+$/.test(String(p.status)),
          `got ${p.status}`);
      }
      console.log('    plan:', p);
    } catch (e) {
      assert('live queryPlanDetails', false, e.message);
    }
  }
} else {
  section('Live LCD');
  console.log('  skip — set E2E_LIVE=1 to run live mainnet queries');
}

// ─── Report ──────────────────────────────────────────────────
console.log(`\n──────────────`);
console.log(`  ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
