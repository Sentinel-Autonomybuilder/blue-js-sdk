/**
 * Sentinel SDK — Protocol / Typed Event Parsers
 *
 * Type-safe event parsers for Sentinel chain transaction events.
 * Replaces regex string matching with structured parsers that
 * guarantee field access and type correctness.
 *
 * Pattern matches TKD Alex's sentinel-js-sdk typed event approach.
 *
 * Usage:
 *   import { NodeEventCreateSession, searchEvent } from './protocol/events.js';
 *   const event = searchEvent(NodeEventCreateSession.type, txResult.events);
 *   if (event) {
 *     const parsed = NodeEventCreateSession.parse(event);
 *     console.log(parsed.sessionId);  // bigint, guaranteed
 *   }
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Decode an event attribute key or value.
 * Chain events may be base64-encoded (older CosmJS) or plain strings.
 */
function decodeAttr(raw) {
  if (typeof raw === 'string') return raw.replace(/^"|"$/g, '');
  if (raw instanceof Uint8Array || Buffer.isBuffer(raw)) return Buffer.from(raw).toString('utf8').replace(/^"|"$/g, '');
  try { return Buffer.from(String(raw), 'base64').toString('utf8').replace(/^"|"$/g, ''); } catch { return String(raw); }
}

/**
 * Parse event attributes into a key-value object.
 * Handles both base64-encoded and plain string attributes.
 */
function parseAttributes(attributes) {
  const result = {};
  for (const attr of (attributes || [])) {
    const key = decodeAttr(attr.key);
    const value = decodeAttr(attr.value);
    result[key] = value;
  }
  return result;
}

/**
 * Search transaction events for a specific event type.
 * @param {string} eventType - The event type URL to search for
 * @param {Array} events - Transaction result events array
 * @returns {object|null} The matched event or null
 */
export function searchEvent(eventType, events) {
  if (!events || !Array.isArray(events)) return null;
  for (const event of events) {
    if (event.type === eventType) return event;
  }
  return null;
}

/**
 * Search for ALL events matching a type.
 * @param {string} eventType - The event type URL
 * @param {Array} events - Transaction result events array
 * @returns {Array} All matching events
 */
export function searchEvents(eventType, events) {
  if (!events || !Array.isArray(events)) return [];
  return events.filter(e => e.type === eventType);
}

// ─── Node Events ────────────────────────────────────────────────────────────

/**
 * sentinel.node.v3.EventCreateSession — emitted when a direct node session starts.
 * Fields: session_id, acc_address, node_address, price (denom, base_value, quote_value), max_bytes, max_duration
 */
export const NodeEventCreateSession = {
  type: 'sentinel.node.v3.EventCreateSession',

  /**
   * @param {object} event - Raw chain event
   * @returns {{ sessionId: bigint, accAddress: string, nodeAddress: string, maxBytes: string, maxDuration: string, price: { denom: string, baseValue: string, quoteValue: string } }}
   */
  parse(event) {
    const attrs = parseAttributes(event.attributes);
    return {
      sessionId: BigInt(attrs.session_id || attrs.SessionID || attrs.id || '0'),
      accAddress: attrs.acc_address || attrs.address || '',
      nodeAddress: attrs.node_address || '',
      maxBytes: attrs.max_bytes || '0',
      maxDuration: attrs.max_duration || '0',
      price: {
        denom: attrs.price_denom || attrs.denom || '',
        baseValue: attrs.price_base_value || attrs.base_value || '0',
        quoteValue: attrs.price_quote_value || attrs.quote_value || '0',
      },
    };
  },

  /** Type guard. */
  is(event) { return event?.type === NodeEventCreateSession.type; },
};

/**
 * sentinel.node.v3.EventPay — emitted when session payment is settled.
 * Fields: session_id, acc_address, node_address, payment, staking_reward
 */
export const NodeEventPay = {
  type: 'sentinel.node.v3.EventPay',

  parse(event) {
    const attrs = parseAttributes(event.attributes);
    return {
      sessionId: BigInt(attrs.session_id || '0'),
      accAddress: attrs.acc_address || '',
      nodeAddress: attrs.node_address || '',
      payment: attrs.payment || '0',
      stakingReward: attrs.staking_reward || '0',
    };
  },

  is(event) { return event?.type === NodeEventPay.type; },
};

/**
 * sentinel.node.v3.EventRefund — emitted when unused session deposit is refunded.
 */
export const NodeEventRefund = {
  type: 'sentinel.node.v3.EventRefund',

  parse(event) {
    const attrs = parseAttributes(event.attributes);
    return {
      sessionId: BigInt(attrs.session_id || '0'),
      accAddress: attrs.acc_address || '',
      amount: attrs.amount || attrs.value || '0',
    };
  },

  is(event) { return event?.type === NodeEventRefund.type; },
};

/**
 * sentinel.node.v3.EventUpdateStatus — emitted when node status changes.
 */
export const NodeEventUpdateStatus = {
  type: 'sentinel.node.v3.EventUpdateStatus',

  parse(event) {
    const attrs = parseAttributes(event.attributes);
    return {
      address: attrs.address || '',
      status: parseInt(attrs.status || '0', 10),
    };
  },

  is(event) { return event?.type === NodeEventUpdateStatus.type; },
};

// ─── Session Events ─────────────────────────────────────────────────────────

/**
 * sentinel.session.v3.EventEnd — emitted when any session ends.
 */
export const SessionEventEnd = {
  type: 'sentinel.session.v3.EventEnd',

  parse(event) {
    const attrs = parseAttributes(event.attributes);
    return {
      sessionId: BigInt(attrs.session_id || attrs.id || '0'),
      accAddress: attrs.acc_address || '',
      nodeAddress: attrs.node_address || '',
    };
  },

  is(event) { return event?.type === SessionEventEnd.type; },
};

/**
 * sentinel.session.v3.EventUpdateDetails — emitted when session bandwidth is updated.
 */
export const SessionEventUpdateDetails = {
  type: 'sentinel.session.v3.EventUpdateDetails',

  parse(event) {
    const attrs = parseAttributes(event.attributes);
    return {
      sessionId: BigInt(attrs.session_id || attrs.id || '0'),
      accAddress: attrs.acc_address || '',
      nodeAddress: attrs.node_address || '',
      downloadBytes: attrs.download_bytes || '0',
      uploadBytes: attrs.upload_bytes || '0',
      duration: attrs.duration || '0',
    };
  },

  is(event) { return event?.type === SessionEventUpdateDetails.type; },
};

// ─── Subscription Events ────────────────────────────────────────────────────

/**
 * sentinel.subscription.v3.EventCreate — emitted when a subscription is created.
 */
export const SubscriptionEventCreate = {
  type: 'sentinel.subscription.v3.EventCreate',

  parse(event) {
    const attrs = parseAttributes(event.attributes);
    return {
      subscriptionId: BigInt(attrs.subscription_id || attrs.id || '0'),
      planId: BigInt(attrs.plan_id || '0'),
      accAddress: attrs.acc_address || '',
      price: {
        denom: attrs.price_denom || attrs.denom || '',
        baseValue: attrs.price_base_value || '0',
        quoteValue: attrs.price_quote_value || '0',
      },
    };
  },

  is(event) { return event?.type === SubscriptionEventCreate.type; },
};

/**
 * sentinel.subscription.v3.EventCreateSession — emitted when a session starts via subscription.
 */
export const SubscriptionEventCreateSession = {
  type: 'sentinel.subscription.v3.EventCreateSession',

  parse(event) {
    const attrs = parseAttributes(event.attributes);
    return {
      sessionId: BigInt(attrs.session_id || attrs.id || '0'),
      subscriptionId: BigInt(attrs.subscription_id || '0'),
      accAddress: attrs.acc_address || '',
      nodeAddress: attrs.node_address || '',
    };
  },

  is(event) { return event?.type === SubscriptionEventCreateSession.type; },
};

/**
 * sentinel.subscription.v3.EventPay — emitted when subscription payment processed.
 */
export const SubscriptionEventPay = {
  type: 'sentinel.subscription.v3.EventPay',

  parse(event) {
    const attrs = parseAttributes(event.attributes);
    return {
      subscriptionId: BigInt(attrs.subscription_id || attrs.id || '0'),
      planId: BigInt(attrs.plan_id || '0'),
      accAddress: attrs.acc_address || '',
      provAddress: attrs.prov_address || '',
      payment: attrs.payment || '0',
      stakingReward: attrs.staking_reward || '0',
    };
  },

  is(event) { return event?.type === SubscriptionEventPay.type; },
};

/**
 * sentinel.subscription.v3.EventEnd — emitted when subscription ends.
 */
export const SubscriptionEventEnd = {
  type: 'sentinel.subscription.v3.EventEnd',

  parse(event) {
    const attrs = parseAttributes(event.attributes);
    return {
      subscriptionId: BigInt(attrs.subscription_id || attrs.id || '0'),
      planId: BigInt(attrs.plan_id || '0'),
      accAddress: attrs.acc_address || '',
    };
  },

  is(event) { return event?.type === SubscriptionEventEnd.type; },
};

// ─── Lease Events ───────────────────────────────────────────────────────────

/**
 * sentinel.lease.v1.EventCreate — emitted when a lease starts.
 */
export const LeaseEventCreate = {
  type: 'sentinel.lease.v1.EventCreate',

  parse(event) {
    const attrs = parseAttributes(event.attributes);
    return {
      leaseId: BigInt(attrs.lease_id || attrs.id || '0'),
      nodeAddress: attrs.node_address || '',
      provAddress: attrs.prov_address || '',
      maxHours: parseInt(attrs.max_hours || '0', 10),
    };
  },

  is(event) { return event?.type === LeaseEventCreate.type; },
};

/**
 * sentinel.lease.v1.EventEnd — emitted when a lease ends.
 */
export const LeaseEventEnd = {
  type: 'sentinel.lease.v1.EventEnd',

  parse(event) {
    const attrs = parseAttributes(event.attributes);
    return {
      leaseId: BigInt(attrs.lease_id || attrs.id || '0'),
      nodeAddress: attrs.node_address || '',
      provAddress: attrs.prov_address || '',
    };
  },

  is(event) { return event?.type === LeaseEventEnd.type; },
};

// ─── Utility: Extract Session ID (typed replacement for old extractSessionId) ──

/**
 * Extract session ID from a transaction result using typed event parsers.
 * Checks both node.v3.EventCreateSession and subscription.v3.EventCreateSession.
 *
 * @param {{ events?: Array }} txResult - Transaction broadcast result
 * @returns {bigint|null} Session ID or null
 */
export function extractSessionIdTyped(txResult) {
  const events = txResult?.events || [];

  // Try node direct session event
  const nodeEvent = searchEvent(NodeEventCreateSession.type, events);
  if (nodeEvent) {
    const parsed = NodeEventCreateSession.parse(nodeEvent);
    if (parsed.sessionId > 0n) return parsed.sessionId;
  }

  // Try subscription session event
  const subEvent = searchEvent(SubscriptionEventCreateSession.type, events);
  if (subEvent) {
    const parsed = SubscriptionEventCreateSession.parse(subEvent);
    if (parsed.sessionId > 0n) return parsed.sessionId;
  }

  // Fallback: scan all events for session_id attribute (handles edge cases)
  for (const event of events) {
    if (/session/i.test(event.type)) {
      const attrs = parseAttributes(event.attributes);
      const id = attrs.session_id || attrs.SessionID || attrs.id;
      if (id) {
        const parsed = BigInt(String(id).replace(/"/g, ''));
        if (parsed > 0n) return parsed;
      }
    }
  }

  return null;
}
