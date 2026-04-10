/**
 * Sentinel SDK — Protocol / Message Builders
 *
 * Returns proper EncodeObject ({ typeUrl, value }) for each Sentinel message type.
 * These are ready for CosmJS signAndBroadcast() — no wrapping needed.
 *
 * The encodeMsg*() functions in encoding.js return raw Uint8Array (protobuf bytes).
 * These buildMsg*() functions return { typeUrl, value: object } that CosmJS can encode
 * via the Registry. Use these for all external/consumer usage.
 *
 * Usage:
 *   import { buildMsgStartSession } from './protocol/messages.js';
 *   const msg = buildMsgStartSession({ from, nodeAddress, gigabytes: 1, maxPrice });
 *   const result = await client.signAndBroadcast(address, [msg], fee);
 */

// ─── Type URL Constants ────────────────────────────────────────────────────

export const TYPE_URLS = {
  // Node sessions
  START_SESSION:          '/sentinel.node.v3.MsgStartSessionRequest',
  CANCEL_SESSION:         '/sentinel.session.v3.MsgCancelSessionRequest',
  UPDATE_SESSION:         '/sentinel.session.v3.MsgUpdateSessionRequest',
  // Subscriptions
  START_SUBSCRIPTION:     '/sentinel.subscription.v3.MsgStartSubscriptionRequest',
  CANCEL_SUBSCRIPTION:    '/sentinel.subscription.v3.MsgCancelSubscriptionRequest',
  RENEW_SUBSCRIPTION:     '/sentinel.subscription.v3.MsgRenewSubscriptionRequest',
  SHARE_SUBSCRIPTION:     '/sentinel.subscription.v3.MsgShareSubscriptionRequest',
  UPDATE_SUBSCRIPTION:    '/sentinel.subscription.v3.MsgUpdateSubscriptionRequest',
  SUB_START_SESSION:      '/sentinel.subscription.v3.MsgStartSessionRequest',
  // Plans
  PLAN_START_SESSION:     '/sentinel.plan.v3.MsgStartSessionRequest',
  CREATE_PLAN:            '/sentinel.plan.v3.MsgCreatePlanRequest',
  UPDATE_PLAN_DETAILS:    '/sentinel.plan.v3.MsgUpdatePlanDetailsRequest',
  UPDATE_PLAN_STATUS:     '/sentinel.plan.v3.MsgUpdatePlanStatusRequest',
  LINK_NODE:              '/sentinel.plan.v3.MsgLinkNodeRequest',
  UNLINK_NODE:            '/sentinel.plan.v3.MsgUnlinkNodeRequest',
  // Provider
  REGISTER_PROVIDER:      '/sentinel.provider.v3.MsgRegisterProviderRequest',
  UPDATE_PROVIDER:        '/sentinel.provider.v3.MsgUpdateProviderDetailsRequest',
  UPDATE_PROVIDER_STATUS: '/sentinel.provider.v3.MsgUpdateProviderStatusRequest',
  // Lease
  START_LEASE:            '/sentinel.lease.v1.MsgStartLeaseRequest',
  END_LEASE:              '/sentinel.lease.v1.MsgEndLeaseRequest',
  // Node operator
  REGISTER_NODE:          '/sentinel.node.v3.MsgRegisterNodeRequest',
  UPDATE_NODE_DETAILS:    '/sentinel.node.v3.MsgUpdateNodeDetailsRequest',
  UPDATE_NODE_STATUS:     '/sentinel.node.v3.MsgUpdateNodeStatusRequest',
};

// ─── Session Message Builders ──────────────────────────────────────────────

/**
 * Build MsgStartSessionRequest (direct node session).
 * @param {{ from: string, nodeAddress: string, gigabytes?: number, hours?: number, maxPrice?: { denom: string, amount: string } }} opts
 * @returns {{ typeUrl: string, value: object }}
 */
export function buildMsgStartSession({ from, nodeAddress, gigabytes = 1, hours = 0, maxPrice }) {
  return {
    typeUrl: TYPE_URLS.START_SESSION,
    value: {
      from,
      node_address: nodeAddress,
      gigabytes: gigabytes || 0,
      hours: hours || 0,
      max_price: maxPrice || undefined,
    },
  };
}

/**
 * Build MsgCancelSessionRequest (end/cancel a session).
 * @param {{ from: string, id: number|bigint }} opts
 * @returns {{ typeUrl: string, value: object }}
 */
export function buildMsgCancelSession({ from, id }) {
  return {
    typeUrl: TYPE_URLS.CANCEL_SESSION,
    value: { from, id: Number(id) },
  };
}

/** Alias for backwards compatibility. */
export const buildMsgEndSession = buildMsgCancelSession;

/**
 * Build MsgUpdateSessionRequest (node reports bandwidth).
 * @param {{ from: string, id: number|bigint, downloadBytes: number, uploadBytes: number }} opts
 * @returns {{ typeUrl: string, value: object }}
 */
export function buildMsgUpdateSession({ from, id, downloadBytes, uploadBytes }) {
  return {
    typeUrl: TYPE_URLS.UPDATE_SESSION,
    value: { from, id: Number(id), download_bytes: downloadBytes, upload_bytes: uploadBytes },
  };
}

// ─── Subscription Message Builders ─────────────────────────────────────────

/**
 * Build MsgStartSubscriptionRequest (subscribe to a plan).
 * @param {{ from: string, id: number|bigint, denom?: string, renewalPricePolicy?: number }} opts
 * @returns {{ typeUrl: string, value: object }}
 */
export function buildMsgStartSubscription({ from, id, denom = 'udvpn', renewalPricePolicy = 0 }) {
  return {
    typeUrl: TYPE_URLS.START_SUBSCRIPTION,
    value: { from, id: Number(id), denom, renewal_price_policy: renewalPricePolicy },
  };
}

/**
 * Build MsgStartSessionRequest via subscription.
 * @param {{ from: string, id: number|bigint, nodeAddress: string }} opts
 * @returns {{ typeUrl: string, value: object }}
 */
export function buildMsgSubStartSession({ from, id, nodeAddress }) {
  return {
    typeUrl: TYPE_URLS.SUB_START_SESSION,
    value: { from, id: Number(id), node_address: nodeAddress },
  };
}

/**
 * Build MsgCancelSubscriptionRequest.
 * @param {{ from: string, id: number|bigint }} opts
 * @returns {{ typeUrl: string, value: object }}
 */
export function buildMsgCancelSubscription({ from, id }) {
  return {
    typeUrl: TYPE_URLS.CANCEL_SUBSCRIPTION,
    value: { from, id: Number(id) },
  };
}

/**
 * Build MsgRenewSubscriptionRequest.
 * @param {{ from: string, id: number|bigint, denom?: string }} opts
 * @returns {{ typeUrl: string, value: object }}
 */
export function buildMsgRenewSubscription({ from, id, denom = 'udvpn' }) {
  return {
    typeUrl: TYPE_URLS.RENEW_SUBSCRIPTION,
    value: { from, id: Number(id), denom },
  };
}

/**
 * Build MsgShareSubscriptionRequest.
 * @param {{ from: string, id: number|bigint, accAddress: string, bytes: number }} opts
 * @returns {{ typeUrl: string, value: object }}
 */
export function buildMsgShareSubscription({ from, id, accAddress, bytes }) {
  return {
    typeUrl: TYPE_URLS.SHARE_SUBSCRIPTION,
    value: { from, id: Number(id), acc_address: accAddress, bytes },
  };
}

/**
 * Build MsgUpdateSubscriptionRequest.
 * @param {{ from: string, id: number|bigint, renewalPricePolicy: number }} opts
 * @returns {{ typeUrl: string, value: object }}
 */
export function buildMsgUpdateSubscription({ from, id, renewalPricePolicy }) {
  return {
    typeUrl: TYPE_URLS.UPDATE_SUBSCRIPTION,
    value: { from, id: Number(id), renewal_price_policy: renewalPricePolicy },
  };
}

// ─── Plan Message Builders ─────────────────────────────────────────────────

/**
 * Build MsgStartSessionRequest via plan (creates subscription + starts session).
 * @param {{ from: string, id: number|bigint, denom?: string, renewalPricePolicy?: number, nodeAddress: string }} opts
 * @returns {{ typeUrl: string, value: object }}
 */
export function buildMsgPlanStartSession({ from, id, denom = 'udvpn', renewalPricePolicy = 0, nodeAddress }) {
  return {
    typeUrl: TYPE_URLS.PLAN_START_SESSION,
    value: { from, id: Number(id), denom, renewal_price_policy: renewalPricePolicy, node_address: nodeAddress },
  };
}

/**
 * Build MsgCreatePlanRequest.
 * @param {{ from: string, bytes: string|number, duration: { seconds: number }, prices?: Array, private?: boolean }} opts
 * @returns {{ typeUrl: string, value: object }}
 */
export function buildMsgCreatePlan({ from, bytes, duration, prices = [], isPrivate = false }) {
  return {
    typeUrl: TYPE_URLS.CREATE_PLAN,
    value: { from, bytes: String(bytes), duration, prices, private: isPrivate },
  };
}

/**
 * Build MsgUpdatePlanDetailsRequest.
 * @param {{ from: string, id: number|bigint, bytes?: string|number, duration?: object, prices?: Array }} opts
 * @returns {{ typeUrl: string, value: object }}
 */
export function buildMsgUpdatePlanDetails({ from, id, bytes, duration, prices = [] }) {
  return {
    typeUrl: TYPE_URLS.UPDATE_PLAN_DETAILS,
    value: { from, id: Number(id), bytes: bytes ? String(bytes) : undefined, duration, prices },
  };
}

/**
 * Build MsgUpdatePlanStatusRequest.
 * @param {{ from: string, id: number|bigint, status: number }} opts
 * @returns {{ typeUrl: string, value: object }}
 */
export function buildMsgUpdatePlanStatus({ from, id, status }) {
  return {
    typeUrl: TYPE_URLS.UPDATE_PLAN_STATUS,
    value: { from, id: Number(id), status },
  };
}

/**
 * Build MsgLinkNodeRequest.
 * @param {{ from: string, id: number|bigint, nodeAddress: string }} opts
 * @returns {{ typeUrl: string, value: object }}
 */
export function buildMsgLinkNode({ from, id, nodeAddress }) {
  return {
    typeUrl: TYPE_URLS.LINK_NODE,
    value: { from, id: Number(id), node_address: nodeAddress },
  };
}

/**
 * Build MsgUnlinkNodeRequest.
 * @param {{ from: string, id: number|bigint, nodeAddress: string }} opts
 * @returns {{ typeUrl: string, value: object }}
 */
export function buildMsgUnlinkNode({ from, id, nodeAddress }) {
  return {
    typeUrl: TYPE_URLS.UNLINK_NODE,
    value: { from, id: Number(id), node_address: nodeAddress },
  };
}

// ─── Provider Message Builders ─────────────────────────────────────────────

/**
 * Build MsgRegisterProviderRequest.
 * @param {{ from: string, name: string, identity?: string, website?: string, description?: string }} opts
 * @returns {{ typeUrl: string, value: object }}
 */
export function buildMsgRegisterProvider({ from, name, identity = '', website = '', description = '' }) {
  return {
    typeUrl: TYPE_URLS.REGISTER_PROVIDER,
    value: { from, name, identity, website, description },
  };
}

/**
 * Build MsgUpdateProviderDetailsRequest.
 * @param {{ from: string, name?: string, identity?: string, website?: string, description?: string }} opts
 * @returns {{ typeUrl: string, value: object }}
 */
export function buildMsgUpdateProviderDetails({ from, name, identity, website, description }) {
  return {
    typeUrl: TYPE_URLS.UPDATE_PROVIDER,
    value: { from, name, identity, website, description },
  };
}

/**
 * Build MsgUpdateProviderStatusRequest.
 * @param {{ from: string, status: number }} opts
 * @returns {{ typeUrl: string, value: object }}
 */
export function buildMsgUpdateProviderStatus({ from, status }) {
  return {
    typeUrl: TYPE_URLS.UPDATE_PROVIDER_STATUS,
    value: { from, status },
  };
}

// ─── Lease Message Builders ────────────────────────────────────────────────

/**
 * Build MsgStartLeaseRequest.
 * @param {{ from: string, nodeAddress: string, hours: number, maxPrice: object, renewalPricePolicy?: number }} opts
 * @returns {{ typeUrl: string, value: object }}
 */
export function buildMsgStartLease({ from, nodeAddress, hours, maxPrice, renewalPricePolicy = 0 }) {
  return {
    typeUrl: TYPE_URLS.START_LEASE,
    value: { from, node_address: nodeAddress, hours, max_price: maxPrice, renewal_price_policy: renewalPricePolicy },
  };
}

/**
 * Build MsgEndLeaseRequest.
 * @param {{ from: string, id: number|bigint }} opts
 * @returns {{ typeUrl: string, value: object }}
 */
export function buildMsgEndLease({ from, id }) {
  return {
    typeUrl: TYPE_URLS.END_LEASE,
    value: { from, id: Number(id) },
  };
}

// ─── Node Operator Message Builders ────────────────────────────────────────

/**
 * Build MsgRegisterNodeRequest.
 * @param {{ from: string, gigabytePrices?: Array, hourlyPrices?: Array, remoteAddrs?: string[] }} opts
 * @returns {{ typeUrl: string, value: object }}
 */
export function buildMsgRegisterNode({ from, gigabytePrices = [], hourlyPrices = [], remoteAddrs = [] }) {
  return {
    typeUrl: TYPE_URLS.REGISTER_NODE,
    value: { from, gigabyte_prices: gigabytePrices, hourly_prices: hourlyPrices, remote_addrs: remoteAddrs },
  };
}

/**
 * Build MsgUpdateNodeDetailsRequest.
 * @param {{ from: string, gigabytePrices?: Array, hourlyPrices?: Array, remoteAddrs?: string[] }} opts
 * @returns {{ typeUrl: string, value: object }}
 */
export function buildMsgUpdateNodeDetails({ from, gigabytePrices = [], hourlyPrices = [], remoteAddrs = [] }) {
  return {
    typeUrl: TYPE_URLS.UPDATE_NODE_DETAILS,
    value: { from, gigabyte_prices: gigabytePrices, hourly_prices: hourlyPrices, remote_addrs: remoteAddrs },
  };
}

/**
 * Build MsgUpdateNodeStatusRequest.
 * @param {{ from: string, status: number }} opts
 * @returns {{ typeUrl: string, value: object }}
 */
export function buildMsgUpdateNodeStatus({ from, status }) {
  return {
    typeUrl: TYPE_URLS.UPDATE_NODE_STATUS,
    value: { from, status },
  };
}
