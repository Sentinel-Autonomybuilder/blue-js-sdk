/**
 * Sentinel SDK — Operator / Batch Fee Grant Revoke
 *
 * Revoke fee grants from multiple grantees in optimistic batches.
 * Tries all grantees in a single TX first; falls back to per-grantee
 * TXs if the batch fails (e.g. one grantee has no active grant).
 *
 * Usage:
 *   import { batchRevokeFeeGrants } from 'sentinel-dvpn-sdk/operator';
 *   const results = await batchRevokeFeeGrants({
 *     client, granter: 'sent1...', grantees: ['sent1...', 'sent1...'],
 *     onProgress: (info) => console.log(info),
 *   });
 */

import { buildRevokeFeeGrantMsg } from '../chain/fee-grants.js';
import { broadcast } from '../chain/broadcast.js';
import { ValidationError, ErrorCodes } from '../errors.js';

const SLEEP_MS = 7000;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Batch-revoke fee grants from a list of grantees.
 *
 * Attempts to revoke all grantees in a single TX (optimistic batch).
 * If the batch TX fails, falls back to one TX per grantee with 7s
 * sleep between each (chain rate-limit safe).
 *
 * @param {object} opts
 * @param {import('@cosmjs/stargate').SigningStargateClient} opts.client - Signed with granter's wallet
 * @param {string} opts.granter - Address revoking grants (sent1...)
 * @param {string[]} opts.grantees - Addresses to revoke
 * @param {number} [opts.gasPerMsg=80000] - Gas estimate per revoke message
 * @param {(info: {stage: string, grantee?: string, txHash?: string, error?: string, done: number, total: number}) => void} [opts.onProgress]
 * @returns {Promise<Array<{ grantee: string, ok: boolean, txHash?: string, error?: string }>>}
 */
export async function batchRevokeFeeGrants(opts = {}) {
  const { client, granter, grantees, gasPerMsg = 80_000, onProgress } = opts;

  if (!client) throw new ValidationError(ErrorCodes.INVALID_OPTIONS, 'client is required');
  if (!granter) throw new ValidationError(ErrorCodes.INVALID_OPTIONS, 'granter is required');
  if (!Array.isArray(grantees) || grantees.length === 0) {
    throw new ValidationError(ErrorCodes.INVALID_OPTIONS, 'grantees must be a non-empty array');
  }

  const unique = [...new Set(grantees.filter(g => g && g !== granter))];
  if (unique.length === 0) return [];

  const total = unique.length;
  const results = [];
  const report = (info) => { if (onProgress) onProgress({ done: results.length, total, ...info }); };

  // ── Optimistic batch attempt ────────────────────────────────────────────────
  const batchMsgs = unique.map(g => buildRevokeFeeGrantMsg(granter, g));
  report({ stage: 'batch_attempt' });

  try {
    const fee = {
      amount: [{ denom: 'udvpn', amount: String(gasPerMsg * unique.length) }],
      gas: String(gasPerMsg * unique.length),
    };
    const result = await broadcast(client, granter, batchMsgs, fee);
    if (result.code === 0) {
      // All succeeded in one TX
      for (const grantee of unique) {
        results.push({ grantee, ok: true, txHash: result.transactionHash });
        report({ stage: 'revoked', grantee, txHash: result.transactionHash });
      }
      return results;
    }
    // Non-zero code — fall through to per-grantee
    report({ stage: 'batch_failed', error: result.rawLog || `code=${result.code}` });
  } catch (batchErr) {
    report({ stage: 'batch_failed', error: batchErr.message });
  }

  // ── Per-grantee fallback ────────────────────────────────────────────────────
  report({ stage: 'fallback_start' });

  for (let i = 0; i < unique.length; i++) {
    const grantee = unique[i];
    const msg = buildRevokeFeeGrantMsg(granter, grantee);
    const fee = {
      amount: [{ denom: 'udvpn', amount: String(gasPerMsg) }],
      gas: String(gasPerMsg),
    };

    try {
      const result = await broadcast(client, granter, [msg], fee);
      if (result.code === 0) {
        results.push({ grantee, ok: true, txHash: result.transactionHash });
        report({ stage: 'revoked', grantee, txHash: result.transactionHash });
      } else {
        const error = result.rawLog || `code=${result.code}`;
        results.push({ grantee, ok: false, error });
        report({ stage: 'revoke_failed', grantee, error });
      }
    } catch (e) {
      results.push({ grantee, ok: false, error: e.message });
      report({ stage: 'revoke_failed', grantee, error: e.message });
    }

    // 7s gap between TXs (not needed after last one)
    if (i < unique.length - 1) await sleep(SLEEP_MS);
  }

  return results;
}
