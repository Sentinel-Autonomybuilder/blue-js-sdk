/**
 * Sentinel SDK — Chain / Client Module
 *
 * CosmJS Registry building, SigningStargateClient creation,
 * and all MSG_TYPES constants.
 *
 * Usage:
 *   import { createClient, buildRegistry, MSG_TYPES } from './chain/client.js';
 *   const client = await createClient(rpcUrl, wallet);
 */

import { Registry } from '@cosmjs/proto-signing';
import { SigningStargateClient, GasPrice, defaultRegistryTypes } from '@cosmjs/stargate';

// Protobuf encoders from v3protocol.js
import {
  encodeMsgStartSession,
  encodeMsgEndSession,
  encodeMsgStartSubscription,
  encodeMsgSubStartSession,
  encodeMsgCancelSubscription,
  encodeMsgRenewSubscription,
  encodeMsgShareSubscription,
  encodeMsgUpdateSubscription,
  encodeMsgUpdateSession,
  encodeMsgRegisterNode,
  encodeMsgUpdateNodeDetails,
  encodeMsgUpdateNodeStatus,
  encodeMsgUpdatePlanDetails,
} from '../v3protocol.js';

// Plan/provider/lease encoders from plan-operations.js
import {
  encodeMsgRegisterProvider,
  encodeMsgUpdateProviderDetails,
  encodeMsgUpdateProviderStatus,
  encodeMsgCreatePlan,
  encodeMsgUpdatePlanStatus,
  encodeMsgLinkNode,
  encodeMsgUnlinkNode,
  encodeMsgPlanStartSession,
  encodeMsgStartLease,
  encodeMsgEndLease,
} from '../plan-operations.js';

import { GAS_PRICE, RPC_ENDPOINTS } from '../defaults.js';
import { ValidationError, ChainError, ErrorCodes } from '../errors.js';

// ─── CosmJS Registry ─────────────────────────────────────────────────────────

/**
 * Adapter that wraps a manual protobuf encoder for CosmJS's Registry.
 * CosmJS expects { fromPartial, encode, decode } — we only need encode.
 */
function makeMsgType(encodeFn) {
  return {
    fromPartial: (v) => v,
    encode: (inst) => ({ finish: () => encodeFn(inst) }),
    decode: () => ({}),
  };
}

/**
 * Build a CosmJS Registry with ALL 14 Sentinel message types registered.
 * This is required for signAndBroadcast to encode Sentinel-specific messages.
 */
export function buildRegistry() {
  return new Registry([
    ...defaultRegistryTypes,
    // Direct node session (v3protocol.js)
    ['/sentinel.node.v3.MsgStartSessionRequest', makeMsgType(encodeMsgStartSession)],
    // End session (v3protocol.js)
    ['/sentinel.session.v3.MsgCancelSessionRequest', makeMsgType(encodeMsgEndSession)],
    // Subscription (v3protocol.js)
    ['/sentinel.subscription.v3.MsgStartSubscriptionRequest', makeMsgType(encodeMsgStartSubscription)],
    ['/sentinel.subscription.v3.MsgStartSessionRequest', makeMsgType(encodeMsgSubStartSession)],
    // Plan (plan-operations.js)
    ['/sentinel.plan.v3.MsgStartSessionRequest', makeMsgType(encodeMsgPlanStartSession)],
    ['/sentinel.plan.v3.MsgCreatePlanRequest', makeMsgType(encodeMsgCreatePlan)],
    ['/sentinel.plan.v3.MsgLinkNodeRequest', makeMsgType(encodeMsgLinkNode)],
    ['/sentinel.plan.v3.MsgUnlinkNodeRequest', makeMsgType(encodeMsgUnlinkNode)],
    ['/sentinel.plan.v3.MsgUpdatePlanStatusRequest', makeMsgType(encodeMsgUpdatePlanStatus)],
    // Provider (plan-operations.js)
    ['/sentinel.provider.v3.MsgRegisterProviderRequest', makeMsgType(encodeMsgRegisterProvider)],
    ['/sentinel.provider.v3.MsgUpdateProviderDetailsRequest', makeMsgType(encodeMsgUpdateProviderDetails)],
    ['/sentinel.provider.v3.MsgUpdateProviderStatusRequest', makeMsgType(encodeMsgUpdateProviderStatus)],
    // Plan details update (v3 — NEW, from sentinel-go-sdk)
    ['/sentinel.plan.v3.MsgUpdatePlanDetailsRequest', makeMsgType(encodeMsgUpdatePlanDetails)],
    // Lease (plan-operations.js)
    ['/sentinel.lease.v1.MsgStartLeaseRequest', makeMsgType(encodeMsgStartLease)],
    ['/sentinel.lease.v1.MsgEndLeaseRequest', makeMsgType(encodeMsgEndLease)],
    // Subscription management (v3 — from sentinel-go-sdk)
    ['/sentinel.subscription.v3.MsgCancelSubscriptionRequest', makeMsgType(encodeMsgCancelSubscription)],
    ['/sentinel.subscription.v3.MsgRenewSubscriptionRequest', makeMsgType(encodeMsgRenewSubscription)],
    ['/sentinel.subscription.v3.MsgShareSubscriptionRequest', makeMsgType(encodeMsgShareSubscription)],
    ['/sentinel.subscription.v3.MsgUpdateSubscriptionRequest', makeMsgType(encodeMsgUpdateSubscription)],
    // Session management (v3)
    ['/sentinel.session.v3.MsgUpdateSessionRequest', makeMsgType(encodeMsgUpdateSession)],
    // Node operator (v3 — for node operators, NOT consumer apps)
    ['/sentinel.node.v3.MsgRegisterNodeRequest', makeMsgType(encodeMsgRegisterNode)],
    ['/sentinel.node.v3.MsgUpdateNodeDetailsRequest', makeMsgType(encodeMsgUpdateNodeDetails)],
    ['/sentinel.node.v3.MsgUpdateNodeStatusRequest', makeMsgType(encodeMsgUpdateNodeStatus)],
  ]);
}

// ─── Signing Client ──────────────────────────────────────────────────────────

/**
 * Create a SigningStargateClient connected to Sentinel RPC.
 * Gas price: from defaults.js GAS_PRICE (chain minimum).
 *
 * Signatures:
 *   createClient(rpcUrl, wallet)  — classic: connect to specific RPC with existing wallet
 *   createClient(mnemonic)        — convenience: create wallet from mnemonic, try RPC endpoints with failover
 *
 * @param {string} rpcUrlOrMnemonic - Either an RPC URL (https://...) or a BIP39 mnemonic
 * @param {DirectSecp256k1HdWallet} [wallet] - Wallet object (required when first arg is RPC URL)
 * @returns {Promise<SigningStargateClient>} Connected signing client with full Sentinel registry
 */
export async function createClient(rpcUrlOrMnemonic, wallet) {
  // Classic call: createClient(rpcUrl, wallet)
  if (wallet) {
    return SigningStargateClient.connectWithSigner(rpcUrlOrMnemonic, wallet, {
      gasPrice: GasPrice.fromString(GAS_PRICE),
      registry: buildRegistry(),
    });
  }

  // If first arg looks like a URL, it's a missing wallet — throw helpful error
  if (typeof rpcUrlOrMnemonic === 'string' && /^(https?|wss?):\/\//i.test(rpcUrlOrMnemonic)) {
    throw new ValidationError(ErrorCodes.INVALID_MNEMONIC,
      'createClient(rpcUrl, wallet): wallet parameter is required when passing an RPC URL. ' +
      'Use createClient(mnemonic) for convenience, or createClient(rpcUrl, wallet) with an existing wallet.',
      { value: rpcUrlOrMnemonic });
  }

  // Convenience call: createClient(mnemonic) — create wallet + try RPC endpoints
  // Lazy import to avoid circular dependency
  const { createWallet, validateMnemonic } = await import('./wallet.js');
  validateMnemonic(rpcUrlOrMnemonic, 'createClient');
  const { wallet: derivedWallet } = await createWallet(rpcUrlOrMnemonic);
  const registry = buildRegistry();
  const gasPrice = GasPrice.fromString(GAS_PRICE);

  // Try each RPC endpoint until one connects
  const errors = [];
  for (const ep of RPC_ENDPOINTS) {
    try {
      const client = await SigningStargateClient.connectWithSigner(ep.url, derivedWallet, {
        gasPrice,
        registry,
      });
      return client;
    } catch (err) {
      errors.push({ endpoint: ep.url, name: ep.name, error: err.message });
    }
  }

  // All endpoints failed
  const tried = errors.map(e => `  ${e.name} (${e.endpoint}): ${e.error}`).join('\n');
  throw new ChainError('ALL_ENDPOINTS_FAILED',
    `createClient(mnemonic): failed to connect to all ${RPC_ENDPOINTS.length} RPC endpoints:\n${tried}`,
    { endpoints: errors });
}

// ─── All Type URL Constants ──────────────────────────────────────────────────

export const MSG_TYPES = {
  // Direct node session
  START_SESSION:          '/sentinel.node.v3.MsgStartSessionRequest',
  END_SESSION:            '/sentinel.session.v3.MsgCancelSessionRequest',
  // Subscription
  START_SUBSCRIPTION:     '/sentinel.subscription.v3.MsgStartSubscriptionRequest',
  SUB_START_SESSION:      '/sentinel.subscription.v3.MsgStartSessionRequest',
  // Plan
  PLAN_START_SESSION:     '/sentinel.plan.v3.MsgStartSessionRequest',
  CREATE_PLAN:            '/sentinel.plan.v3.MsgCreatePlanRequest',
  UPDATE_PLAN_STATUS:     '/sentinel.plan.v3.MsgUpdatePlanStatusRequest',
  LINK_NODE:              '/sentinel.plan.v3.MsgLinkNodeRequest',
  UNLINK_NODE:            '/sentinel.plan.v3.MsgUnlinkNodeRequest',
  // Provider
  REGISTER_PROVIDER:      '/sentinel.provider.v3.MsgRegisterProviderRequest',
  UPDATE_PROVIDER:        '/sentinel.provider.v3.MsgUpdateProviderDetailsRequest',
  UPDATE_PROVIDER_STATUS: '/sentinel.provider.v3.MsgUpdateProviderStatusRequest',
  // Plan details update (v3 — NEW)
  UPDATE_PLAN_DETAILS:    '/sentinel.plan.v3.MsgUpdatePlanDetailsRequest',
  // Lease
  START_LEASE:            '/sentinel.lease.v1.MsgStartLeaseRequest',
  END_LEASE:              '/sentinel.lease.v1.MsgEndLeaseRequest',
  // Subscription management (v3)
  CANCEL_SUBSCRIPTION:    '/sentinel.subscription.v3.MsgCancelSubscriptionRequest',
  RENEW_SUBSCRIPTION:     '/sentinel.subscription.v3.MsgRenewSubscriptionRequest',
  SHARE_SUBSCRIPTION:     '/sentinel.subscription.v3.MsgShareSubscriptionRequest',
  UPDATE_SUBSCRIPTION:    '/sentinel.subscription.v3.MsgUpdateSubscriptionRequest',
  // Session management (v3)
  UPDATE_SESSION:         '/sentinel.session.v3.MsgUpdateSessionRequest',
  // Node operator (v3)
  REGISTER_NODE:          '/sentinel.node.v3.MsgRegisterNodeRequest',
  UPDATE_NODE_DETAILS:    '/sentinel.node.v3.MsgUpdateNodeDetailsRequest',
  UPDATE_NODE_STATUS:     '/sentinel.node.v3.MsgUpdateNodeStatusRequest',
  // Cosmos FeeGrant
  GRANT_FEE_ALLOWANCE:    '/cosmos.feegrant.v1beta1.MsgGrantAllowance',
  REVOKE_FEE_ALLOWANCE:   '/cosmos.feegrant.v1beta1.MsgRevokeAllowance',
  // Cosmos Authz
  AUTHZ_GRANT:            '/cosmos.authz.v1beta1.MsgGrant',
  AUTHZ_REVOKE:           '/cosmos.authz.v1beta1.MsgRevoke',
  AUTHZ_EXEC:             '/cosmos.authz.v1beta1.MsgExec',
};
