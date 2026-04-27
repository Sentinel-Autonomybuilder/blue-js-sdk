/**
 * Sentinel SDK — Operator / Auto Lease
 *
 * Lease multiple nodes onto a plan in optimistic batches.
 * The chain rejects more than ~20 MsgStartLeaseRequest messages per TX —
 * perTxLimit=20 is the empirically validated safe cap.
 *
 * Usage:
 *   import { batchLeaseNodes } from 'sentinel-dvpn-sdk/operator';
 *   const results = await batchLeaseNodes({
 *     client, providerAddress: 'sentprov1...', planId: 42,
 *     nodes: [{ nodeAddress: 'sentnode1...', hours: 720, maxPrice: { denom: 'udvpn', base_value: '...', quote_value: '...' } }],
 *     onProgress: (info) => console.log(info),
 *   });
 */

import { encodeMsgStartLease } from '../plan-operations.js';
import { broadcast } from '../chain/broadcast.js';
import { ValidationError, ErrorCodes } from '../errors.js';

const PER_TX_LIMIT = 20; // empirically validated chain cap for MsgStartLeaseRequest batch
const SLEEP_MS = 7000;   // 7s between TX batches (chain rate-limit safe)
const GAS_PER_MSG = 120_000;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Lease a single node onto a plan.
 *
 * @param {object} opts
 * @param {import('@cosmjs/stargate').SigningStargateClient} opts.client - Signed with provider's wallet
 * @param {string} opts.providerAddress - sentprov1... prefix (plan owner)
 * @param {{ nodeAddress: string, hours: number, maxPrice: { denom: string, base_value: string, quote_value: string } }} opts.node
 * @param {number} [opts.gasPerMsg] - Gas per MsgStartLeaseRequest (default: 120000)
 * @returns {Promise<{ ok: boolean, txHash?: string, error?: string }>}
 */
export async function autoLeaseNode(opts = {}) {
  const { client, providerAddress, node, gasPerMsg = GAS_PER_MSG } = opts;
  if (!client) throw new ValidationError(ErrorCodes.INVALID_OPTIONS, 'client is required');
  if (!providerAddress) throw new ValidationError(ErrorCodes.INVALID_OPTIONS, 'providerAddress is required');
  if (!node?.nodeAddress) throw new ValidationError(ErrorCodes.INVALID_OPTIONS, 'node.nodeAddress is required');
  if (!node?.hours || node.hours < 1) throw new ValidationError(ErrorCodes.INVALID_OPTIONS, 'node.hours must be >= 1');
  if (!node?.maxPrice) throw new ValidationError(ErrorCodes.INVALID_OPTIONS, 'node.maxPrice is required');

  const msg = {
    typeUrl: '/sentinel.lease.v1.MsgStartLeaseRequest',
    value: encodeMsgStartLease({
      from: providerAddress,
      nodeAddress: node.nodeAddress,
      hours: node.hours,
      maxPrice: node.maxPrice,
    }),
  };
  const fee = {
    amount: [{ denom: 'udvpn', amount: String(gasPerMsg) }],
    gas: String(gasPerMsg),
  };

  try {
    const result = await broadcast(client, providerAddress, [msg], fee);
    if (result.code === 0) {
      return { ok: true, txHash: result.transactionHash };
    }
    return { ok: false, error: result.rawLog || `code=${result.code}` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Lease multiple nodes onto a plan in batches.
 *
 * Splits nodes into chunks of `perTxLimit` (default: 20, the empirical
 * chain cap for MsgStartLeaseRequest per TX). Sleeps 7s between each
 * chunk broadcast to avoid sequence errors.
 *
 * @param {object} opts
 * @param {import('@cosmjs/stargate').SigningStargateClient} opts.client - Signed with provider's wallet
 * @param {string} opts.providerAddress - sentprov1... prefix (plan owner)
 * @param {Array<{ nodeAddress: string, hours: number, maxPrice: { denom: string, base_value: string, quote_value: string } }>} opts.nodes
 * @param {number} [opts.perTxLimit=20] - Max MsgStartLeaseRequest per TX
 * @param {number} [opts.gasPerMsg=120000] - Gas per message
 * @param {(info: { stage: string, batch: number, totalBatches: number, done: number, total: number, txHash?: string, error?: string }) => void} [opts.onProgress]
 * @returns {Promise<Array<{ nodeAddress: string, ok: boolean, txHash?: string, error?: string }>>}
 */
export async function batchLeaseNodes(opts = {}) {
  const {
    client,
    providerAddress,
    nodes,
    perTxLimit = PER_TX_LIMIT,
    gasPerMsg = GAS_PER_MSG,
    onProgress,
  } = opts;

  if (!client) throw new ValidationError(ErrorCodes.INVALID_OPTIONS, 'client is required');
  if (!providerAddress) throw new ValidationError(ErrorCodes.INVALID_OPTIONS, 'providerAddress is required');
  if (!Array.isArray(nodes) || nodes.length === 0) {
    throw new ValidationError(ErrorCodes.INVALID_OPTIONS, 'nodes must be a non-empty array');
  }

  const total = nodes.length;
  const totalBatches = Math.ceil(total / perTxLimit);
  const results = [];
  const report = (info) => { if (onProgress) onProgress({ done: results.length, total, totalBatches, ...info }); };

  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    const chunk = nodes.slice(batchIdx * perTxLimit, (batchIdx + 1) * perTxLimit);
    const batch = batchIdx + 1;

    report({ stage: 'batch_start', batch });

    const msgs = chunk.map(n => ({
      typeUrl: '/sentinel.lease.v1.MsgStartLeaseRequest',
      value: encodeMsgStartLease({
        from: providerAddress,
        nodeAddress: n.nodeAddress,
        hours: n.hours,
        maxPrice: n.maxPrice,
      }),
    }));

    const fee = {
      amount: [{ denom: 'udvpn', amount: String(gasPerMsg * chunk.length) }],
      gas: String(gasPerMsg * chunk.length),
    };

    try {
      const result = await broadcast(client, providerAddress, msgs, fee);
      if (result.code === 0) {
        for (const n of chunk) {
          results.push({ nodeAddress: n.nodeAddress, ok: true, txHash: result.transactionHash });
        }
        report({ stage: 'batch_ok', batch, txHash: result.transactionHash });
      } else {
        // Batch failed — record all in chunk as failed
        const error = result.rawLog || `code=${result.code}`;
        for (const n of chunk) {
          results.push({ nodeAddress: n.nodeAddress, ok: false, error });
        }
        report({ stage: 'batch_failed', batch, error });
      }
    } catch (e) {
      for (const n of chunk) {
        results.push({ nodeAddress: n.nodeAddress, ok: false, error: e.message });
      }
      report({ stage: 'batch_failed', batch, error: e.message });
    }

    // Sleep 7s between batches (not after last batch)
    if (batchIdx < totalBatches - 1) await sleep(SLEEP_MS);
  }

  return results;
}
