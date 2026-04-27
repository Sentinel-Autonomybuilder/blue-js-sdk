/**
 * Sentinel SDK — Chain / Fee Grants Module
 *
 * FeeGrant message builders, queries, monitoring, and workflow helpers.
 * Gas-free UX: granter pays fees for grantee's transactions.
 *
 * Usage:
 *   import { buildFeeGrantMsg, queryFeeGrants, monitorFeeGrants } from './chain/fee-grants.js';
 *   const msg = buildFeeGrantMsg(serviceAddr, userAddr, { spendLimit: 5000000 });
 */

import { EventEmitter } from 'events';
import { protoString, protoInt64, protoEmbedded } from '../v3protocol.js';
import { LCD_ENDPOINTS } from '../defaults.js';
import { ValidationError, ErrorCodes } from '../errors.js';
import { lcdQuery, lcdPaginatedSafe } from './lcd.js';
import { isSameKey } from './wallet.js';
import { queryPlanSubscribers } from './queries.js';
import {
  createRpcQueryClientWithFallback,
  rpcQueryFeeGrant as _rpcQueryFeeGrant,
  rpcQueryFeeGrants as _rpcQueryFeeGrants,
  rpcQueryFeeGrantsIssued as _rpcQueryFeeGrantsIssued,
} from './rpc.js';

// ─── Protobuf Helpers for FeeGrant ──────────────────────────────────────────
// Uses the same manual protobuf encoding as Sentinel types — no codegen needed.

function encodeCoin(denom, amount) {
  return Buffer.concat([protoString(1, denom), protoString(2, String(amount))]);
}

function encodeTimestamp(date) {
  const ms = date.getTime();
  if (Number.isNaN(ms)) throw new ValidationError(ErrorCodes.INVALID_OPTIONS, 'encodeTimestamp(): invalid date', { date });
  const seconds = BigInt(Math.floor(ms / 1000));
  return Buffer.concat([protoInt64(1, seconds)]);
}

function encodeBasicAllowance(spendLimit, expiration) {
  const parts = [];
  if (spendLimit != null && spendLimit !== false) {
    const coins = Array.isArray(spendLimit) ? spendLimit : [{ denom: 'udvpn', amount: String(spendLimit) }];
    for (const coin of coins) {
      parts.push(protoEmbedded(1, encodeCoin(coin.denom || 'udvpn', coin.amount)));
    }
  }
  if (expiration) {
    parts.push(protoEmbedded(2, encodeTimestamp(expiration instanceof Date ? expiration : new Date(expiration))));
  }
  return Buffer.concat(parts);
}

function encodeAllowedMsgAllowance(innerTypeUrl, innerBytes, allowedMessages) {
  const parts = [protoEmbedded(1, encodeAny(innerTypeUrl, innerBytes))];
  for (const msg of allowedMessages) {
    parts.push(protoString(2, msg));
  }
  return Buffer.concat(parts);
}

function encodeAny(typeUrl, valueBytes) {
  return Buffer.concat([
    protoString(1, typeUrl),
    protoEmbedded(2, valueBytes),
  ]);
}

// ─── RPC Client Helper ─────────────────────────────────────────────────────

let _rpcClient = null;
let _rpcClientPromise = null;

async function getRpcClient() {
  if (_rpcClient) return _rpcClient;
  if (_rpcClientPromise) return _rpcClientPromise;
  _rpcClientPromise = createRpcQueryClientWithFallback()
    .then(client => { _rpcClient = client; return client; })
    .catch(() => { _rpcClient = null; return null; })
    .finally(() => { _rpcClientPromise = null; });
  return _rpcClientPromise;
}

// ─── FeeGrant (cosmos.feegrant.v1beta1) ─────────────────────────────────────

/**
 * Build a MsgGrantAllowance message.
 * @param {string} granter - Address paying fees (sent1...)
 * @param {string} grantee - Address receiving fee grant (sent1...)
 * @param {object} opts
 * @param {number|Array} opts.spendLimit - Max spend in udvpn (number) or [{denom, amount}]
 * @param {Date|string} opts.expiration - Optional expiry date
 * @param {string[]} opts.allowedMessages - Optional: restrict to specific msg types (uses AllowedMsgAllowance)
 */
export function buildFeeGrantMsg(granter, grantee, opts = {}) {
  const { spendLimit, expiration, allowedMessages } = opts;
  const basicBytes = encodeBasicAllowance(spendLimit, expiration);

  let allowanceTypeUrl, allowanceBytes;
  if (allowedMessages?.length) {
    allowanceTypeUrl = '/cosmos.feegrant.v1beta1.AllowedMsgAllowance';
    allowanceBytes = encodeAllowedMsgAllowance(
      '/cosmos.feegrant.v1beta1.BasicAllowance', basicBytes, allowedMessages
    );
  } else {
    allowanceTypeUrl = '/cosmos.feegrant.v1beta1.BasicAllowance';
    allowanceBytes = basicBytes;
  }

  // MsgGrantAllowance: field 1=granter, field 2=grantee, field 3=allowance(Any)
  return {
    typeUrl: '/cosmos.feegrant.v1beta1.MsgGrantAllowance',
    value: { granter, grantee, allowance: { typeUrl: allowanceTypeUrl, value: Uint8Array.from(allowanceBytes) } },
  };
}

/**
 * Build a MsgRevokeAllowance message.
 */
export function buildRevokeFeeGrantMsg(granter, grantee) {
  return {
    typeUrl: '/cosmos.feegrant.v1beta1.MsgRevokeAllowance',
    value: { granter, grantee },
  };
}

/**
 * Query fee grants given to a grantee.
 * RPC-first with LCD fallback.
 * @returns {Promise<Array>} Array of allowance objects
 */
export async function queryFeeGrants(lcdUrl, grantee) {
  // RPC-first
  try {
    const rpc = await getRpcClient();
    if (rpc) {
      return await _rpcQueryFeeGrants(rpc, grantee);
    }
  } catch { /* fall through to LCD */ }

  // LCD fallback
  const { items } = await lcdPaginatedSafe(lcdUrl, `/cosmos/feegrant/v1beta1/allowances/${grantee}`, 'allowances');
  return items;
}

/**
 * Query fee grants issued BY an address (where addr is the granter).
 * RPC-first with LCD fallback.
 * @param {string} lcdUrl
 * @param {string} granter - Address that issued the grants
 * @returns {Promise<Array>}
 */
export async function queryFeeGrantsIssued(lcdUrl, granter) {
  // RPC-first
  try {
    const rpc = await getRpcClient();
    if (rpc) {
      return await _rpcQueryFeeGrantsIssued(rpc, granter);
    }
  } catch { /* fall through to LCD */ }

  // LCD fallback
  const { items } = await lcdPaginatedSafe(lcdUrl, `/cosmos/feegrant/v1beta1/issued/${granter}`, 'allowances');
  return items;
}

/**
 * Query a specific fee grant between granter and grantee.
 * RPC-first with LCD fallback.
 * @returns {Promise<object|null>} Allowance object or null
 */
export async function queryFeeGrant(lcdUrl, granter, grantee) {
  // RPC-first
  try {
    const rpc = await getRpcClient();
    if (rpc) {
      return await _rpcQueryFeeGrant(rpc, granter, grantee);
    }
  } catch { /* fall through to LCD */ }

  // LCD fallback (with endpoint failover via lcdQuery)
  try {
    const data = await lcdQuery(`/cosmos/feegrant/v1beta1/allowance/${granter}/${grantee}`, { lcdUrl });
    return data.allowance || null;
  } catch { return null; } // 404 = no grant
}

// ─── Fee Grant Workflow Helpers (v25b) ────────────────────────────────────────

/**
 * Grant fee allowance to all plan subscribers who don't already have one.
 * Filters out self-grants (granter === grantee) and already-granted addresses.
 *
 * @param {number|string} planId
 * @param {object} opts
 * @param {string} opts.granterAddress - Who pays fees (typically plan owner)
 * @param {string} [opts.lcdUrl] - LCD endpoint (used as fallback when RPC unavailable)
 * @param {boolean} [opts.preferRpc=true] - Force RPC for all queries, skip LCD URL for grant lookup
 * @param {object} [opts.rpcClient] - Pre-built RPC client to inject (skips internal createRpcQueryClientWithFallback)
 * @param {object} [opts.grantOpts] - Options for buildFeeGrantMsg (spendLimit, expiration, allowedMessages)
 * @returns {Promise<{ msgs: Array, skipped: string[], newGrants: string[] }>} Messages ready for broadcast
 */
export async function grantPlanSubscribers(planId, opts = {}) {
  const { granterAddress, lcdUrl, preferRpc = true, rpcClient, grantOpts = {} } = opts;
  if (!granterAddress) throw new ValidationError(ErrorCodes.INVALID_OPTIONS, 'granterAddress is required');

  // Get subscribers — already RPC-first internally
  const { subscribers } = await queryPlanSubscribers(planId, { lcdUrl });

  // Get existing grants ISSUED BY granter.
  // preferRpc=true: pass null lcdUrl so internal getRpcClient() path is taken first.
  // preferRpc=false: pass lcdUrl so LCD is used (useful when RPC is blocked).
  const grantLcdUrl = preferRpc ? null : (lcdUrl || LCD_ENDPOINTS[0].url);
  const existingGrants = rpcClient
    ? await _rpcQueryFeeGrantsIssued(rpcClient, granterAddress).catch(() => queryFeeGrantsIssued(grantLcdUrl, granterAddress))
    : await queryFeeGrantsIssued(grantLcdUrl, granterAddress);
  const alreadyGranted = new Set(existingGrants.map(g => g.grantee));

  const msgs = [];
  const skipped = [];
  const newGrants = [];

  const now = new Date();
  // Deduplicate by address and filter active+non-expired
  const seen = new Set();
  for (const sub of subscribers) {
    const addr = sub.acc_address || sub.address;
    if (!addr || seen.has(addr)) continue;
    seen.add(addr);
    // Skip self-grant (chain rejects granter === grantee)
    if (addr === granterAddress || isSameKey(addr, granterAddress)) { skipped.push(addr); continue; }
    // Skip inactive or expired
    if (sub.status && sub.status !== 'active') { skipped.push(addr); continue; }
    if (sub.inactive_at && new Date(sub.inactive_at) <= now) { skipped.push(addr); continue; }
    // Skip already granted
    if (alreadyGranted.has(addr)) { skipped.push(addr); continue; }
    msgs.push(buildFeeGrantMsg(granterAddress, addr, grantOpts));
    newGrants.push(addr);
  }

  return { msgs, skipped, newGrants };
}

/**
 * Find fee grants expiring within N days.
 *
 * @param {string} lcdUrl - LCD endpoint
 * @param {string} granteeOrGranter - Address to check grants for
 * @param {number} withinDays - Check grants expiring within this many days (default: 7)
 * @param {'grantee'|'granter'} [role='grantee'] - Whether to check as grantee or granter
 * @returns {Promise<Array<{ granter: string, grantee: string, expiresAt: Date|null, daysLeft: number|null }>>}
 */
export async function getExpiringGrants(lcdUrl, granteeOrGranter, withinDays = 7, role = 'grantee') {
  const grants = role === 'grantee'
    ? await queryFeeGrants(lcdUrl, granteeOrGranter)
    : await queryFeeGrantsIssued(lcdUrl, granteeOrGranter);

  const now = Date.now();
  const cutoff = now + withinDays * 24 * 60 * 60_000;
  const expiring = [];

  for (const g of grants) {
    // Fee grant allowances have complex nested @type structures:
    // BasicAllowance: { expiration }
    // PeriodicAllowance: { basic: { expiration } }
    // AllowedMsgAllowance: { allowance: { expiration } or allowance: { basic: { expiration } } }
    const a = g.allowance || {};
    const inner = a.allowance || a; // unwrap AllowedMsgAllowance
    const expStr = inner.expiration || inner.basic?.expiration || a.expiration || a.basic?.expiration;
    if (!expStr) continue; // no expiry set
    const expiresAt = new Date(expStr);
    if (expiresAt.getTime() <= cutoff) {
      expiring.push({
        granter: g.granter,
        grantee: g.grantee,
        expiresAt,
        daysLeft: Math.max(0, Math.round((expiresAt.getTime() - now) / (24 * 60 * 60_000))),
      });
    }
  }
  return expiring;
}

/**
 * Revoke and re-grant expiring fee grants.
 *
 * @param {string} lcdUrl
 * @param {string} granterAddress
 * @param {number} withinDays - Renew grants expiring within N days
 * @param {object} [grantOpts] - Options for new grants (spendLimit, expiration, allowedMessages)
 * @returns {Promise<{ msgs: Array, renewed: string[] }>} Messages ready for broadcast
 */
export async function renewExpiringGrants(lcdUrl, granterAddress, withinDays = 7, grantOpts = {}) {
  const expiring = await getExpiringGrants(lcdUrl, granterAddress, withinDays, 'granter');
  const msgs = [];
  const renewed = [];

  for (const g of expiring) {
    if (g.grantee === granterAddress) continue; // skip self
    msgs.push(buildRevokeFeeGrantMsg(granterAddress, g.grantee));
    msgs.push(buildFeeGrantMsg(granterAddress, g.grantee, grantOpts));
    renewed.push(g.grantee);
  }

  return { msgs, renewed };
}

// ─── Fee Grant Monitoring (v25b) ─────────────────────────────────────────────

/**
 * Monitor fee grants for expiry. Returns an EventEmitter that checks grants on interval.
 *
 * @param {object} opts
 * @param {string} opts.lcdUrl - LCD endpoint
 * @param {string} opts.address - Address to monitor (as granter)
 * @param {number} [opts.checkIntervalMs] - Check interval (default: 6 hours)
 * @param {number} [opts.warnDays] - Emit 'expiring' when grant expires within N days (default: 7)
 * @param {boolean} [opts.autoRenew] - Auto-revoke+re-grant expiring grants (default: false)
 * @param {object} [opts.grantOpts] - Options for renewed grants
 * @returns {EventEmitter} Emits 'expiring' and 'expired' events. Call .stop() to stop monitoring.
 */
export function monitorFeeGrants(opts = {}) {
  const { lcdUrl, address, checkIntervalMs = 6 * 60 * 60_000, warnDays = 7, autoRenew = false, grantOpts = {} } = opts;
  if (!lcdUrl || !address) throw new ValidationError(ErrorCodes.INVALID_OPTIONS, 'monitorFeeGrants requires lcdUrl and address');

  const emitter = new EventEmitter();
  let timer = null;

  const check = async () => {
    try {
      const expiring = await getExpiringGrants(lcdUrl, address, warnDays, 'granter');
      const now = Date.now();

      for (const g of expiring) {
        if (g.expiresAt.getTime() <= now) {
          emitter.emit('expired', g);
        } else {
          emitter.emit('expiring', g);
        }
      }

      if (autoRenew && expiring.length > 0) {
        const { msgs, renewed } = await renewExpiringGrants(lcdUrl, address, warnDays, grantOpts);
        if (msgs.length > 0) {
          emitter.emit('renew', { msgs, renewed });
        }
      }
    } catch (err) {
      emitter.emit('error', err);
    }
  };

  // Start checking
  check();
  timer = setInterval(check, checkIntervalMs);
  if (timer.unref) timer.unref(); // Don't prevent process exit

  emitter.stop = () => {
    if (timer) { clearInterval(timer); timer = null; }
  };

  return emitter;
}

// ─── Streaming Batch Grant (for SSE / progress UIs) ──────────────────────────

/**
 * Stream progress as we grant fee allowances to all plan subscribers in batches.
 *
 * Async generator. Yields events with `{ type, ...payload }`:
 *   - status      { msg }                                  — human-readable status line
 *   - batch_start { batch, total, count, addresses }       — about to broadcast a batch
 *   - batch_ok    { batch, total, granted, totalGranted, txHash, elapsed }
 *   - batch_error { batch, total, error, elapsed }
 *   - done        { granted, skipped, total, errors? }
 *   - error       { msg }
 *
 * The caller passes a `broadcast(msgs, memo)` function — any safe-broadcaster
 * with the Plan Manager's mutex + sequence-retry semantics works. Consumer
 * routes layer SSE (`res.write('data: ...\n\n')`) on top of these events.
 *
 * @param {number|string} planId
 * @param {object} opts
 * @param {string} opts.granterAddress - Plan owner paying fees
 * @param {string} [opts.lcdUrl] - LCD endpoint (used as fallback when RPC unavailable)
 * @param {boolean} [opts.preferRpc=true] - Force RPC for all queries, skip LCD URL for grant lookup
 * @param {object} [opts.rpcClient] - Pre-built RPC client to inject (skips internal createRpcQueryClientWithFallback)
 * @param {(msgs: Array, memo: string) => Promise<{code:number, rawLog?:string, transactionHash?:string}>} opts.broadcast
 * @param {object} [opts.grantOpts] - { spendLimit, expiration } for BasicAllowance
 * @param {number} [opts.batchSize=5] - Msgs per TX
 * @param {() => boolean} [opts.isCancelled] - Return true to abort between batches
 * @yields {{type: string, [key: string]: any}}
 */
export async function* streamGrantPlanSubscribers(planId, opts = {}) {
  const {
    granterAddress,
    lcdUrl,
    preferRpc = true,
    rpcClient,
    broadcast,
    grantOpts = {},
    batchSize = 5,
    isCancelled = () => false,
  } = opts;

  if (!granterAddress) throw new ValidationError(ErrorCodes.INVALID_OPTIONS, 'granterAddress is required');
  if (typeof broadcast !== 'function') throw new ValidationError(ErrorCodes.INVALID_OPTIONS, 'broadcast function is required');

  try {
    yield { type: 'status', msg: 'Fetching plan subscribers...' };
    const { subscribers } = await queryPlanSubscribers(planId, { lcdUrl });

    const now = new Date();
    const activeSubs = subscribers.filter(s => {
      if (s.status && s.status !== 'active') return false;
      if (s.inactive_at && new Date(s.inactive_at) <= now) return false;
      return true;
    });
    const uniqueAddrs = [...new Set(activeSubs.map(s => s.acc_address || s.address))]
      .filter(a => a && a !== granterAddress && !isSameKey(a, granterAddress));

    yield { type: 'status', msg: `Found ${activeSubs.length} active subscribers (${uniqueAddrs.length} unique, excl. self)` };

    if (uniqueAddrs.length === 0) {
      yield { type: 'done', granted: 0, skipped: 0, total: 0, msg: 'No active subscribers (excluding self)' };
      return;
    }

    yield { type: 'status', msg: 'Checking existing grants...' };
    const streamLcdUrl = preferRpc ? null : (lcdUrl || LCD_ENDPOINTS[0].url);
    const existing = rpcClient
      ? await _rpcQueryFeeGrantsIssued(rpcClient, granterAddress).catch(() => queryFeeGrantsIssued(streamLcdUrl, granterAddress))
      : await queryFeeGrantsIssued(streamLcdUrl, granterAddress);
    const existingGrantees = new Set(existing.map(g => g.grantee));
    const needGrant = uniqueAddrs.filter(a => !existingGrantees.has(a));
    const skipped = uniqueAddrs.length - needGrant.length;

    yield { type: 'status', msg: `${existingGrantees.size} existing grants found. ${needGrant.length} need granting, ${skipped} already covered.` };

    if (needGrant.length === 0) {
      yield { type: 'done', granted: 0, skipped, total: 0, msg: 'All subscribers already have grants' };
      return;
    }

    const totalBatches = Math.ceil(needGrant.length / batchSize);
    let granted = 0;
    const errors = [];

    for (let i = 0; i < needGrant.length; i += batchSize) {
      if (isCancelled()) break;

      const batchNum = Math.floor(i / batchSize) + 1;
      const batch = needGrant.slice(i, i + batchSize);
      const shortAddrs = batch.map(a => a.slice(0, 12) + '...' + a.slice(-6)).join(', ');

      yield { type: 'batch_start', batch: batchNum, total: totalBatches, count: batch.length, addresses: shortAddrs };

      const msgs = batch.map(grantee => buildFeeGrantMsg(granterAddress, grantee, grantOpts));

      const t0 = Date.now();
      try {
        const result = await broadcast(msgs, `Fee grant batch ${batchNum}/${totalBatches}`);
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

        if (result.code !== 0) {
          const errMsg = result.rawLog || `TX failed code=${result.code}`;
          yield { type: 'batch_error', batch: batchNum, total: totalBatches, error: errMsg, elapsed };
          errors.push(`Batch ${batchNum}: ${errMsg}`);
        } else {
          granted += batch.length;
          yield {
            type: 'batch_ok',
            batch: batchNum,
            total: totalBatches,
            granted: batch.length,
            totalGranted: granted,
            txHash: result.transactionHash,
            elapsed,
          };
        }
      } catch (e) {
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        yield { type: 'batch_error', batch: batchNum, total: totalBatches, error: e.message, elapsed };
        errors.push(`Batch ${batchNum}: ${e.message}`);
      }
    }

    yield {
      type: 'done',
      granted,
      skipped,
      total: needGrant.length,
      errors: errors.length ? errors : undefined,
    };
  } catch (e) {
    yield { type: 'error', msg: e.message };
  }
}

// ─── Gas Cost Analytics ──────────────────────────────────────────────────────

/**
 * Compute how many udvpn the granter has spent on fee-granted transactions
 * for a plan's subscribers. Iterates each subscriber, pulls their outgoing
 * TXs via LCD, and sums fees where `fee.granter === granterAddress`.
 *
 * @param {number|string} planId
 * @param {object} opts
 * @param {string} opts.granterAddress - Address that paid the fees (plan owner)
 * @param {string} opts.lcdUrl - LCD endpoint
 * @param {number} [opts.txLimit=100] - Max TXs to inspect per subscriber
 * @param {(info: {processed:number, total:number, address:string}) => void} [opts.onProgress]
 * @returns {Promise<{ totalUdvpn: number, txCount: number, byAddress: Record<string, {udvpn:number, txCount:number}>, subscriberCount: number }>}
 */
export async function computeFeeGrantGasCosts(planId, opts = {}) {
  const { granterAddress, lcdUrl, txLimit = 100, onProgress } = opts;
  if (!granterAddress) throw new ValidationError(ErrorCodes.INVALID_OPTIONS, 'granterAddress is required');

  const { subscribers } = await queryPlanSubscribers(planId, { lcdUrl });
  const subscriberAddrs = [...new Set(subscribers.map(s => s.acc_address || s.address))]
    .filter(a => a && a !== granterAddress);

  if (subscriberAddrs.length === 0) {
    return { totalUdvpn: 0, txCount: 0, byAddress: {}, subscriberCount: 0 };
  }

  let totalUdvpn = 0;
  let txCount = 0;
  const byAddress = {};

  const base = lcdUrl || LCD_ENDPOINTS[0].url;
  for (let idx = 0; idx < subscriberAddrs.length; idx++) {
    const addr = subscriberAddrs[idx];
    try {
      const path =
        `/cosmos/tx/v1beta1/txs?events=${encodeURIComponent("message.sender='" + addr + "'")}` +
        `&pagination.limit=${txLimit}&order_by=2`;
      const txData = await lcdQuery(path, { lcdUrl: base });
      const rawTxs = txData.txs || [];

      let addrGas = 0;
      let addrTxCount = 0;

      for (const tx of rawTxs) {
        const fee = tx?.auth_info?.fee;
        if (fee?.granter === granterAddress) {
          const udvpnFee = (fee.amount || []).find(f => f.denom === 'udvpn');
          if (udvpnFee) {
            addrGas += parseInt(udvpnFee.amount, 10);
            addrTxCount++;
          }
        }
      }

      if (addrTxCount > 0) {
        byAddress[addr] = { udvpn: addrGas, txCount: addrTxCount };
        totalUdvpn += addrGas;
        txCount += addrTxCount;
      }
    } catch { /* skip this subscriber on LCD failure */ }

    if (onProgress) onProgress({ processed: idx + 1, total: subscriberAddrs.length, address: addr });
  }

  return { totalUdvpn, txCount, byAddress, subscriberCount: subscriberAddrs.length };
}
