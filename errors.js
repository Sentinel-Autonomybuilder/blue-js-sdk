/**
 * Sentinel SDK — Typed Error Classes
 *
 * Machine-readable error codes for programmatic error handling.
 * All SDK errors extend SentinelError with a .code property.
 *
 * Usage:
 *   import { SentinelError, ErrorCodes } from './errors.js';
 *   try { await connect(opts); }
 *   catch (e) {
 *     if (e.code === ErrorCodes.V2RAY_ALL_FAILED) trySwitchNode();
 *     if (e instanceof ValidationError) showFormError(e.message);
 *   }
 */

export class SentinelError extends Error {
  /**
   * @param {string} code - Machine-readable error code (e.g. 'NODE_NO_UDVPN')
   * @param {string} message - Human-readable description
   * @param {object} details - Structured context for programmatic handling
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SentinelError';
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return { name: this.name, code: this.code, message: this.message, details: this.details };
  }
}

/** Input validation failures (bad mnemonic, invalid address, etc.) */
export class ValidationError extends SentinelError {
  constructor(code, message, details) {
    super(code, message, details);
    this.name = 'ValidationError';
  }
}

/** Node-level failures (offline, no udvpn, clock drift, etc.) */
export class NodeError extends SentinelError {
  constructor(code, message, details) {
    super(code, message, details);
    this.name = 'NodeError';
  }
}

/** Chain/transaction failures (broadcast failed, extract failed, etc.) */
export class ChainError extends SentinelError {
  constructor(code, message, details) {
    super(code, message, details);
    this.name = 'ChainError';
  }
}

/** Tunnel setup failures (V2Ray all failed, WG no connectivity, etc.) */
export class TunnelError extends SentinelError {
  constructor(code, message, details) {
    super(code, message, details);
    this.name = 'TunnelError';
  }
}

/** Security failures (TLS cert changed, etc.) */
export class SecurityError extends SentinelError {
  constructor(code, message, details) {
    super(code, message, details);
    this.name = 'SecurityError';
  }
}

/** Error code constants — use these for switch/if checks instead of string parsing */
export const ErrorCodes = {
  // Validation
  INVALID_OPTIONS: 'INVALID_OPTIONS',
  INVALID_MNEMONIC: 'INVALID_MNEMONIC',
  INVALID_NODE_ADDRESS: 'INVALID_NODE_ADDRESS',
  INVALID_GIGABYTES: 'INVALID_GIGABYTES',
  INVALID_URL: 'INVALID_URL',
  INVALID_PLAN_ID: 'INVALID_PLAN_ID',

  // Node
  NODE_OFFLINE: 'NODE_OFFLINE',
  NODE_NO_UDVPN: 'NODE_NO_UDVPN',
  NODE_NOT_FOUND: 'NODE_NOT_FOUND',
  NODE_CLOCK_DRIFT: 'NODE_CLOCK_DRIFT',
  NODE_INACTIVE: 'NODE_INACTIVE',

  // Chain
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  BROADCAST_FAILED: 'BROADCAST_FAILED',
  TX_FAILED: 'TX_FAILED',
  LCD_ERROR: 'LCD_ERROR',
  UNKNOWN_MSG_TYPE: 'UNKNOWN_MSG_TYPE',
  ALL_ENDPOINTS_FAILED: 'ALL_ENDPOINTS_FAILED',

  // Session
  SESSION_EXISTS: 'SESSION_EXISTS',
  SESSION_EXTRACT_FAILED: 'SESSION_EXTRACT_FAILED',
  SESSION_POISONED: 'SESSION_POISONED',

  // Tunnel
  V2RAY_NOT_FOUND: 'V2RAY_NOT_FOUND',
  V2RAY_ALL_FAILED: 'V2RAY_ALL_FAILED',
  WG_NOT_AVAILABLE: 'WG_NOT_AVAILABLE',
  WG_NO_CONNECTIVITY: 'WG_NO_CONNECTIVITY',
  TUNNEL_SETUP_FAILED: 'TUNNEL_SETUP_FAILED',

  // Security
  TLS_CERT_CHANGED: 'TLS_CERT_CHANGED',

  // Node (additional)
  INVALID_ASSIGNED_IP: 'INVALID_ASSIGNED_IP',
  NODE_DATABASE_CORRUPT: 'NODE_DATABASE_CORRUPT',

  // Connection
  ABORTED: 'ABORTED',
  ALL_NODES_FAILED: 'ALL_NODES_FAILED',
  ALREADY_CONNECTED: 'ALREADY_CONNECTED',
  PARTIAL_CONNECTION_FAILED: 'PARTIAL_CONNECTION_FAILED',

  // Chain timing
  CHAIN_LAG: 'CHAIN_LAG',

  // Fee grant
  FEE_GRANT_MISSING_AT_START: 'FEE_GRANT_MISSING_AT_START',
  FEE_GRANT_EXPIRED: 'FEE_GRANT_EXPIRED',

  // Node extended
  NODE_MISCONFIGURED: 'NODE_MISCONFIGURED',
  NODE_DB_CORRUPT: 'NODE_DB_CORRUPT',
  NODE_RPC_BROKEN: 'NODE_RPC_BROKEN',

  // Chain extended
  SEQUENCE_MISMATCH: 'SEQUENCE_MISMATCH',

  // Connection lifecycle
  NOT_CONNECTED: 'NOT_CONNECTED',
  CONNECTION_IN_PROGRESS: 'CONNECTION_IN_PROGRESS',
  HANDSHAKE_FAILED: 'HANDSHAKE_FAILED',
};

// ─── Error Severity Classification ───────────────────────────────────────────

/** Severity levels for each error code. Apps use this for retry/UX logic. */
export const ERROR_SEVERITY = {
  // Fatal — don't retry, user action needed
  [ErrorCodes.INVALID_MNEMONIC]: 'fatal',
  [ErrorCodes.INSUFFICIENT_BALANCE]: 'fatal',
  [ErrorCodes.INVALID_NODE_ADDRESS]: 'fatal',
  [ErrorCodes.INVALID_OPTIONS]: 'fatal',
  [ErrorCodes.INVALID_GIGABYTES]: 'fatal',
  [ErrorCodes.INVALID_URL]: 'fatal',
  [ErrorCodes.INVALID_PLAN_ID]: 'fatal',
  [ErrorCodes.UNKNOWN_MSG_TYPE]: 'fatal',
  [ErrorCodes.SESSION_POISONED]: 'fatal',
  [ErrorCodes.WG_NOT_AVAILABLE]: 'fatal',
  [ErrorCodes.NODE_DATABASE_CORRUPT]: 'retryable',

  // Retryable — node-level
  [ErrorCodes.NODE_NOT_FOUND]: 'retryable',

  // Retryable — try again, possibly different node
  [ErrorCodes.NODE_OFFLINE]: 'retryable',
  [ErrorCodes.NODE_NO_UDVPN]: 'retryable',
  [ErrorCodes.NODE_CLOCK_DRIFT]: 'retryable',
  [ErrorCodes.NODE_INACTIVE]: 'retryable',
  [ErrorCodes.V2RAY_ALL_FAILED]: 'retryable',
  [ErrorCodes.BROADCAST_FAILED]: 'retryable',
  [ErrorCodes.TX_FAILED]: 'retryable',
  [ErrorCodes.LCD_ERROR]: 'retryable',
  [ErrorCodes.ALL_ENDPOINTS_FAILED]: 'retryable',
  [ErrorCodes.ALL_NODES_FAILED]: 'retryable',
  [ErrorCodes.WG_NO_CONNECTIVITY]: 'retryable',
  [ErrorCodes.TUNNEL_SETUP_FAILED]: 'retryable',
  [ErrorCodes.CHAIN_LAG]: 'retryable',

  // Recoverable — can resume with recoverSession()
  [ErrorCodes.SESSION_EXTRACT_FAILED]: 'recoverable',
  [ErrorCodes.PARTIAL_CONNECTION_FAILED]: 'recoverable',
  [ErrorCodes.SESSION_EXISTS]: 'recoverable',

  // Infrastructure — check system state
  [ErrorCodes.TLS_CERT_CHANGED]: 'infrastructure',
  [ErrorCodes.V2RAY_NOT_FOUND]: 'infrastructure',

  // Fee grant
  [ErrorCodes.FEE_GRANT_MISSING_AT_START]: 'fatal',
  [ErrorCodes.FEE_GRANT_EXPIRED]: 'fatal',

  // Node extended
  [ErrorCodes.NODE_MISCONFIGURED]: 'retryable',
  [ErrorCodes.NODE_DB_CORRUPT]: 'retryable',
  [ErrorCodes.NODE_RPC_BROKEN]: 'retryable',

  // Chain extended
  [ErrorCodes.SEQUENCE_MISMATCH]: 'retryable',

  // Connection lifecycle
  [ErrorCodes.NOT_CONNECTED]: 'fatal',
  [ErrorCodes.CONNECTION_IN_PROGRESS]: 'recoverable',
  [ErrorCodes.HANDSHAKE_FAILED]: 'retryable',
};

/** Check if an error should be retried. */
export function isRetryable(error) {
  const code = error?.code || error;
  return ERROR_SEVERITY[code] === 'retryable';
}

/** Map SDK error to user-friendly message. */
export function userMessage(error) {
  const code = error?.code || error;
  const map = {
    [ErrorCodes.INSUFFICIENT_BALANCE]: 'Not enough P2P tokens. Fund your wallet to continue.',
    [ErrorCodes.NODE_OFFLINE]: 'This node is offline. Try a different server.',
    [ErrorCodes.NODE_NO_UDVPN]: 'This node does not accept P2P tokens.',
    [ErrorCodes.NODE_CLOCK_DRIFT]: 'Node clock is out of sync. Try a different server.',
    [ErrorCodes.NODE_INACTIVE]: 'Node went inactive. Try a different server.',
    [ErrorCodes.V2RAY_ALL_FAILED]: 'Could not establish tunnel. Node may be overloaded.',
    [ErrorCodes.V2RAY_NOT_FOUND]: 'V2Ray binary not found. Check your installation.',
    [ErrorCodes.WG_NOT_AVAILABLE]: 'WireGuard is not available. Install it or use V2Ray nodes.',
    [ErrorCodes.WG_NO_CONNECTIVITY]: 'VPN tunnel has no internet connectivity.',
    [ErrorCodes.TUNNEL_SETUP_FAILED]: 'Tunnel setup failed. Try again or pick another server.',
    [ErrorCodes.TLS_CERT_CHANGED]: 'Node certificate changed unexpectedly. This could indicate a security issue.',
    [ErrorCodes.BROADCAST_FAILED]: 'Transaction failed. Check your balance and try again.',
    [ErrorCodes.TX_FAILED]: 'Chain transaction rejected. Check balance and gas.',
    [ErrorCodes.ALREADY_CONNECTED]: 'Already connected. Disconnect first.',
    [ErrorCodes.ALL_NODES_FAILED]: 'All servers failed. Check your network connection.',
    [ErrorCodes.ALL_ENDPOINTS_FAILED]: 'All chain endpoints are unreachable. Try again later.',
    [ErrorCodes.INVALID_MNEMONIC]: 'Invalid wallet phrase. Must be 12 or 24 words.',
    [ErrorCodes.INVALID_NODE_ADDRESS]: 'Invalid node address.',
    [ErrorCodes.INVALID_OPTIONS]: 'Invalid connection options provided.',
    [ErrorCodes.INVALID_GIGABYTES]: 'Invalid bandwidth amount. Must be a positive number.',
    [ErrorCodes.INVALID_URL]: 'Invalid URL format.',
    [ErrorCodes.INVALID_PLAN_ID]: 'Invalid plan ID.',
    [ErrorCodes.UNKNOWN_MSG_TYPE]: 'Unknown message type. Check SDK version compatibility.',
    [ErrorCodes.SESSION_POISONED]: 'Session is poisoned (previously failed). Start a new session.',
    [ErrorCodes.NODE_NOT_FOUND]: 'Node not found on chain. It may be inactive.',
    [ErrorCodes.LCD_ERROR]: 'Chain query failed. Try again later.',
    [ErrorCodes.SESSION_EXISTS]: 'An active session already exists. Use recoverSession() to resume.',
    [ErrorCodes.SESSION_EXTRACT_FAILED]: 'Session creation succeeded but ID extraction failed. Use recoverSession().',
    [ErrorCodes.PARTIAL_CONNECTION_FAILED]: 'Payment succeeded but connection failed. Use recoverSession() to retry.',
    [ErrorCodes.ABORTED]: 'Connection was cancelled.',
    [ErrorCodes.CHAIN_LAG]: 'Session not yet confirmed on node. Wait a moment and try again.',
    [ErrorCodes.NODE_DATABASE_CORRUPT]: 'Node has a corrupted database. Try a different server.',
    [ErrorCodes.INVALID_ASSIGNED_IP]: 'Node returned an invalid IP address during handshake. Try a different server.',
    [ErrorCodes.FEE_GRANT_MISSING_AT_START]: 'Plan owner has not issued a fee grant to this wallet. Contact the plan provider.',
    [ErrorCodes.FEE_GRANT_EXPIRED]: "The plan owner's fee grant has expired. Contact the plan provider to renew.",
    [ErrorCodes.NODE_MISCONFIGURED]: 'Node is misconfigured. Try a different server.',
    [ErrorCodes.NODE_DB_CORRUPT]: 'Node has a corrupted database. Try a different server.',
    [ErrorCodes.NODE_RPC_BROKEN]: "Node's RPC endpoint is not responding. Try a different server.",
    [ErrorCodes.SEQUENCE_MISMATCH]: 'Transaction sequence mismatch. Wait a moment and retry.',
    [ErrorCodes.NOT_CONNECTED]: 'Not connected to any VPN node.',
    [ErrorCodes.CONNECTION_IN_PROGRESS]: 'A connection attempt is already in progress.',
    [ErrorCodes.HANDSHAKE_FAILED]: 'VPN handshake failed. The node may be overloaded or misconfigured.',
  };
  return map[code] || error?.message || 'An unexpected error occurred.';
}
