/**
 * Sentinel SDK — Operator / Fee Grant History
 *
 * Query the historical record of MsgGrantAllowance and MsgRevokeAllowance
 * transactions for an address. Uses tmClient.txSearchAll() (RPC) for
 * reliable historical lookup without LCD indexer dependencies.
 *
 * Usage:
 *   import { queryFeeGrantHistory } from 'sentinel-dvpn-sdk/operator';
 *   const history = await queryFeeGrantHistory(tmClient, 'sent1...');
 */

import { ValidationError, ErrorCodes } from '../errors.js';

// ─── Attribute Decoder ───────────────────────────────────────────────────────
// Cosmos SDK v0.47+ sometimes JSON-quotes string attribute values: `"sent1..."`.
// We strip those quotes so callers always get plain strings.

/**
 * Read an event attribute value by key. Handles JSON-quoted values from v0.47+.
 * @param {ReadonlyArray<{key:string, value:string}>} attrs
 * @param {string} key
 * @returns {string|null}
 */
export function attr(attrs, key) {
  const found = attrs.find(a => a.key === key);
  if (!found) return null;
  const v = found.value;
  // Strip surrounding JSON quotes if present
  if (v.startsWith('"') && v.endsWith('"')) {
    try { return JSON.parse(v); } catch { /* fall through */ }
  }
  return v;
}

// ─── Event Decoder ───────────────────────────────────────────────────────────

/**
 * Decode a fee-grant event from a TX event list.
 * Returns null if the event doesn't match a grant or revoke action.
 *
 * @param {{ type: string, attributes: ReadonlyArray<{key:string, value:string}> }} ev
 * @param {string} hash - TX hash (hex)
 * @param {number} height - Block height
 * @returns {{ action: 'grant'|'revoke', granter: string, grantee: string, txHash: string, height: number }|null}
 */
export function decodeFeeGrantEvent(ev, hash, height) {
  // cosmos.feegrant events emit under 'cosmos.feegrant.v1beta1.EventGrantAllowance'
  // or 'cosmos.feegrant.v1beta1.EventRevokeAllowance', or under 'message' with
  // action='/cosmos.feegrant.v1beta1.MsgGrantAllowance'
  const type = ev.type;
  const attrs = ev.attributes;

  let action = null;
  if (type === 'cosmos.feegrant.v1beta1.EventGrantAllowance' ||
      type === 'grant_allowance') {
    action = 'grant';
  } else if (type === 'cosmos.feegrant.v1beta1.EventRevokeAllowance' ||
             type === 'revoke_allowance') {
    action = 'revoke';
  } else if (type === 'message') {
    const msgAction = attr(attrs, 'action');
    if (msgAction === '/cosmos.feegrant.v1beta1.MsgGrantAllowance') action = 'grant';
    else if (msgAction === '/cosmos.feegrant.v1beta1.MsgRevokeAllowance') action = 'revoke';
  }

  if (!action) return null;

  const granter = attr(attrs, 'granter');
  const grantee = attr(attrs, 'grantee');
  if (!granter || !grantee) return null;

  return { action, granter, grantee, txHash: hash, height };
}

// ─── Main Query ──────────────────────────────────────────────────────────────

/**
 * Query fee grant history (grants and revokes) for an address.
 *
 * Searches both as granter and grantee by default. Set opts.role to
 * 'granter' or 'grantee' to narrow the search.
 *
 * @param {import('@cosmjs/tendermint-rpc').Tendermint37Client} tmClient - From createRpcQueryClient().tmClient
 * @param {string} address - Address to search (sent1...)
 * @param {object} [opts]
 * @param {'granter'|'grantee'|'both'} [opts.role='both'] - Which role to search
 * @param {number} [opts.perPage=50] - Results per page
 * @param {'asc'|'desc'} [opts.order='desc'] - Sort order (newest first by default)
 * @returns {Promise<Array<{ action: 'grant'|'revoke', granter: string, grantee: string, txHash: string, height: number }>>}
 */
export async function queryFeeGrantHistory(tmClient, address, opts = {}) {
  if (!tmClient) throw new ValidationError(ErrorCodes.INVALID_OPTIONS, 'tmClient is required');
  if (!address) throw new ValidationError(ErrorCodes.INVALID_OPTIONS, 'address is required');

  const { role = 'both', perPage = 50, order = 'desc' } = opts;

  const queries = [];
  if (role === 'both' || role === 'granter') {
    queries.push(`message.action='/cosmos.feegrant.v1beta1.MsgGrantAllowance' AND message.sender='${address}'`);
    queries.push(`message.action='/cosmos.feegrant.v1beta1.MsgRevokeAllowance' AND message.sender='${address}'`);
  }
  if (role === 'both' || role === 'grantee') {
    queries.push(`message.action='/cosmos.feegrant.v1beta1.MsgGrantAllowance' AND cosmos.feegrant.v1beta1.EventGrantAllowance.grantee='${address}'`);
    queries.push(`message.action='/cosmos.feegrant.v1beta1.MsgRevokeAllowance' AND cosmos.feegrant.v1beta1.EventRevokeAllowance.grantee='${address}'`);
  }

  const seen = new Set();
  const results = [];

  for (const query of queries) {
    try {
      const resp = await tmClient.txSearchAll({ query, per_page: perPage, order_by: order });
      for (const tx of resp.txs) {
        const hash = Buffer.from(tx.hash).toString('hex').toUpperCase();
        if (seen.has(hash)) continue;

        for (const ev of tx.result.events) {
          const decoded = decodeFeeGrantEvent(ev, hash, tx.height);
          if (decoded) {
            results.push(decoded);
          }
        }
        seen.add(hash);
      }
    } catch { /* query may fail if node doesn't index — skip silently */ }
  }

  // Sort by height descending (newest first)
  results.sort((a, b) => b.height - a.height);

  return results;
}
