/**
 * Sentinel SDK — Plan Ownership Pre-Flight
 *
 * Verifies the calling wallet owns a plan before broadcasting any mutating TX.
 * Saves ~0.005 P2P per rejected broadcast and gives a clean error instead of
 * a chain rejection.
 *
 * The sent <-> sentprov bech32 conversion is a footgun every plan-manager
 * consumer hits independently. This module is the single source of truth.
 *
 * Usage:
 *   import { assertPlanOwnership, PlanOwnershipError } from './operator/plan-ownership.js';
 *   const plan = await assertPlanOwnership({ planId, walletAddr, client });
 *   // throws PlanOwnershipError if not owner; returns plan object if ok
 */

import { fromBech32, toBech32 } from '@cosmjs/encoding';
import { rpcQueryPlan } from '../chain/rpc.js';
import { lcdQuery } from '../chain/lcd.js';

// ─── Error Type ──────────────────────────────────────────────────────────────

export class PlanOwnershipError extends Error {
  constructor({ planId, expected, actual }) {
    super(`Plan ${planId} is owned by ${expected}, not ${actual}`);
    this.code = 'PLAN_OWNERSHIP_ERROR';
    this.planId = planId;
    this.expected = expected;
    this.actual = actual;
  }
}

// ─── Address Conversion ──────────────────────────────────────────────────────

/**
 * Convert a sent1... wallet address to its sentprov... equivalent.
 * Plan `provider_address` fields use sentprov prefix; wallet addresses use sent.
 * The raw bytes are identical — only the prefix differs.
 */
export function walletToProviderAddr(sentAddr) {
  return toBech32('sentprov', fromBech32(sentAddr).data);
}

// ─── Plan Fetcher (RPC-first) ────────────────────────────────────────────────

async function fetchPlan(planId, client, preferRpc) {
  if (preferRpc && client?.tmClient) {
    try {
      return await rpcQueryPlan(client.tmClient, planId);
    } catch (_) {
      // fall through to LCD
    }
  }
  // LCD fallback
  const res = await lcdQuery(`/sentinel/plan/v3/plans/${planId}`);
  return res?.plan ?? null;
}

// ─── assertPlanOwnership ─────────────────────────────────────────────────────

/**
 * Assert that `walletAddr` owns plan `planId`. Throws `PlanOwnershipError`
 * if the plan exists but belongs to a different provider. Throws a generic
 * Error if the plan does not exist.
 *
 * @param {object} opts
 * @param {number|string} opts.planId    - Plan ID to check
 * @param {string}  opts.walletAddr      - Caller's sent1... wallet address
 * @param {object}  opts.client          - SentinelClient (needs .tmClient for RPC)
 * @param {boolean} [opts.preferRpc=true] - Try RPC first, fall back to LCD
 * @returns {Promise<object>} Plan object if ownership confirmed
 * @throws {PlanOwnershipError} If a different provider owns the plan
 * @throws {Error} If the plan is not found
 */
export async function assertPlanOwnership({ planId, walletAddr, client, preferRpc = true }) {
  const plan = await fetchPlan(planId, client, preferRpc);
  if (!plan) throw new Error(`Plan ${planId} not found`);

  const walletAsProv = walletToProviderAddr(walletAddr);
  if (plan.provider_address !== walletAsProv) {
    throw new PlanOwnershipError({
      planId,
      expected: plan.provider_address,
      actual: walletAsProv,
    });
  }

  return plan;
}
