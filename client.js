/**
 * Sentinel SDK — Instantiable Client Class
 *
 * Wraps the functional API with per-instance state, dependency injection,
 * and EventEmitter. Addresses the "global singleton" finding from Meta/Telegram audits.
 *
 * v21 — 2026-03-09
 *
 * CHANGE LOG (for debugging — if bugs appear, check these changes):
 * - NEW FILE: Wraps connectDirect/connectViaPlan/disconnect/queryOnlineNodes
 * - Each instance has its own EventEmitter (independent from module-level `events`)
 * - Constructor accepts DI options: logger, rpcUrl, lcdUrl, tlsTrust, v2rayExePath
 * - Instance methods merge constructor defaults with per-call options
 * - State (connected, sessionId, etc.) tracked per-instance
 * - LIMITATION: WireGuard and V2Ray tunnels are OS-level singletons.
 *   Only one SentinelClient can have an active tunnel at a time.
 *   Multiple instances can query nodes, check balances, and broadcast TXs concurrently.
 *
 * Usage:
 *   import { SentinelClient } from './client.js';
 *   const client = new SentinelClient({ rpcUrl, lcdUrl, logger: myLogger });
 *   client.on('connected', ({ sessionId }) => updateUI());
 *   const conn = await client.connect({ mnemonic, nodeAddress });
 *   await client.disconnect();
 */

import { EventEmitter } from 'events';
import {
  connectDirect, connectViaPlan, connectAuto, queryOnlineNodes,
  disconnect as sdkDisconnect, disconnectState,
  disconnectAndEndSession as sdkDisconnectAndEndSession, disconnectStateAndEndSession,
  isConnected as sdkIsConnected, getStatus as sdkGetStatus,
  registerCleanupHandlers, setSystemProxy, clearSystemProxy,
  events as sdkEvents, ConnectionState,
} from './node-connect.js';
import {
  createWallet, privKeyFromMnemonic, createClient, broadcast,
  createSafeBroadcaster, getBalance, findExistingSession, fetchActiveNodes,
  discoverPlanIds, resolveNodeUrl, lcd, MSG_TYPES,
} from './cosmjs-setup.js';
import { nodeStatusV3 } from './v3protocol.js';
import { createNodeHttpsAgent, clearKnownNode, clearAllKnownNodes, getKnownNode } from './tls-trust.js';
import { SentinelError, ErrorCodes } from './errors.js';

export class SentinelClient extends EventEmitter {
  /**
   * Create a new SentinelClient instance.
   *
   * @param {object} opts - Default options applied to all operations
   * @param {string} opts.rpcUrl - Default RPC URL (overridable per-call)
   * @param {string} opts.lcdUrl - Default LCD URL (overridable per-call)
   * @param {string} opts.mnemonic - Default mnemonic (overridable per-call)
   * @param {object} opts.signer - Pre-built cosmjs OfflineDirectSigner (e.g. from
   *   PrivyCosmosSigner.fromRawSign). When provided, takes precedence over `mnemonic`
   *   for queries and broadcasts. NOTE: VPN connect/disconnect (tunnel handshake)
   *   currently still requires a mnemonic — see docs/PRIVY-INTEGRATION.md.
   * @param {string} opts.v2rayExePath - Default V2Ray binary path
   * @param {function} opts.logger - Logger function (default: console.log). Set to null to suppress.
   * @param {'tofu'|'none'} opts.tlsTrust - TLS trust mode (default: 'tofu')
   * @param {object} opts.timeouts - Default timeout overrides
   * @param {boolean} opts.fullTunnel - Default fullTunnel setting
   * @param {boolean} opts.systemProxy - Default systemProxy setting
   */
  constructor(opts = {}) {
    super();
    this._defaults = { ...opts };
    this._logger = opts.logger !== undefined ? opts.logger : console.log;
    this._connection = null; // last connection result
    this._wallet = null; // cached wallet
    this._client = null; // cached RPC client
    this._rpc = null; // which RPC the cached client is connected to
    this._state = new ConnectionState(); // per-instance tunnel state (v22)

    // Forward module-level events to this instance's emitter
    this._forwarder = (event) => (...args) => this.emit(event, ...args);
    this._boundForwarders = {};
    for (const event of ['connecting', 'connected', 'disconnected', 'error', 'progress']) {
      this._boundForwarders[event] = this._forwarder(event);
      sdkEvents.on(event, this._boundForwarders[event]);
    }
  }

  /**
   * Merge instance defaults with per-call options.
   * Per-call values override instance defaults.
   */
  _mergeOpts(callOpts = {}) {
    const merged = { ...this._defaults, ...callOpts };
    // Logger: use instance logger unless per-call provides one
    if (!callOpts.log && this._logger) merged.log = this._logger;
    // Inject per-instance state so tunnels are isolated
    merged._state = this._state;
    return merged;
  }

  /**
   * Throw a helpful error if a connect path is invoked without a mnemonic.
   * The WireGuard/V2Ray handshake currently signs locally with the cosmos privkey,
   * so a raw-sign-only signer (e.g. Privy custody) cannot complete the tunnel
   * handshake. Queries and broadcasts work without a mnemonic.
   */
  _requireMnemonicForTunnel(merged) {
    if (typeof merged.mnemonic === 'string' && merged.mnemonic.trim().length > 0) return;
    throw new SentinelError(ErrorCodes.INVALID_MNEMONIC,
      'VPN connect/disconnect requires a mnemonic. A signer-only client (e.g. ' +
      'Privy raw-sign Mode B) can broadcast TXs and query chain state, but the ' +
      'tunnel handshake signs with the raw secp256k1 privkey. Pass `mnemonic` to ' +
      'the constructor or to this call. See docs/PRIVY-INTEGRATION.md.');
  }

  // ─── Connection ──────────────────────────────────────────────────────────

  /**
   * Connect to a node by paying directly per GB.
   * @param {object} opts - Options (merged with constructor defaults)
   * @returns {Promise<object>} Connection result with cleanup()
   */
  async connect(opts = {}) {
    const merged = this._mergeOpts(opts);
    this._requireMnemonicForTunnel(merged);
    this._connection = await connectDirect(merged);
    return this._connection;
  }

  /**
   * Connect with auto-fallback: picks best node, retries on failure.
   * Recommended for most apps.
   * @param {object} opts - Options (merged with constructor defaults)
   * @returns {Promise<object>} Connection result with cleanup()
   */
  async autoConnect(opts = {}) {
    const merged = this._mergeOpts(opts);
    this._requireMnemonicForTunnel(merged);
    this._connection = await connectAuto(merged);
    return this._connection;
  }

  /**
   * Connect via a plan subscription.
   * @param {object} opts - Options including planId (merged with constructor defaults)
   * @returns {Promise<object>} Connection result with cleanup()
   */
  async connectPlan(opts = {}) {
    const merged = this._mergeOpts(opts);
    this._requireMnemonicForTunnel(merged);
    this._connection = await connectViaPlan(merged);
    return this._connection;
  }

  /**
   * Soft disconnect — tear down the tunnel, leave the on-chain session active.
   *
   * A subsequent connect() to the SAME node reuses the session (no new payment).
   * Use for pause / temporary disconnect / network-change recovery.
   * To settle the session and reclaim the deposit, use disconnectAndEndSession().
   */
  async disconnect() {
    await disconnectState(this._state);
    this._connection = null;
  }

  /**
   * Hard disconnect — tear down the tunnel AND broadcast MsgCancelSession on chain.
   *
   * Settles the session after the ~2h window and refunds the unused deposit.
   * Use when the user is done with this node (switching permanently or wants refund).
   */
  async disconnectAndEndSession() {
    await disconnectStateAndEndSession(this._state);
    this._connection = null;
  }

  /**
   * Check if a VPN tunnel is currently active.
   */
  isConnected() {
    return this._state.isConnected;
  }

  /**
   * Get current connection status (null if not connected).
   * v29: Cross-checks tunnel liveness to prevent phantom connected state.
   */
  getStatus() {
    if (!this._state.connection) return null;
    // v29: If connection object exists but tunnel handles are gone, state is phantom.
    // Clear it and return disconnected to prevent IP leak.
    if (!this._state.wgTunnel && !this._state.v2rayProc) {
      const stale = this._state.connection;
      this._state.connection = null;
      this.emit('disconnected', { nodeAddress: stale.nodeAddress, serviceType: stale.serviceType, reason: 'phantom_state' });
      return null;
    }
    const uptimeMs = Date.now() - this._state.connection.connectedAt;
    const secs = Math.floor(uptimeMs / 1000);
    const m = Math.floor(secs / 60), s = secs % 60, h = Math.floor(m / 60);
    const uptimeFormatted = h > 0 ? `${h}h ${m % 60}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;
    return {
      connected: this._state.isConnected,
      ...this._state.connection,
      uptimeMs,
      uptimeFormatted,
    };
  }

  // ─── Node Discovery ──────────────────────────────────────────────────────

  /**
   * List online nodes, sorted by quality score.
   * Uses node cache (5min TTL) for instant results on repeat calls.
   * @param {object} options - Query options (merged with constructor defaults for lcdUrl)
   */
  async listNodes(options = {}) {
    const merged = { ...options };
    if (!merged.lcdUrl && this._defaults.lcdUrl) merged.lcdUrl = this._defaults.lcdUrl;
    return queryOnlineNodes(merged);
  }

  /**
   * Get status of a specific node.
   * @param {string} remoteUrl - Node's remote URL (https://...)
   * @param {string} nodeAddress - sentnode1... address (for TOFU TLS)
   */
  async nodeStatus(remoteUrl, nodeAddress) {
    const agent = nodeAddress
      ? createNodeHttpsAgent(nodeAddress, this._defaults.tlsTrust || 'tofu')
      : undefined;
    return nodeStatusV3(remoteUrl, agent);
  }

  // ─── Wallet & Chain ──────────────────────────────────────────────────────

  /**
   * Create or return cached wallet/signer.
   *
   * Resolution order:
   *   1. `mnemonic` arg (per-call override) → derive a DirectSecp256k1HdWallet
   *   2. `this._defaults.signer` (constructor-supplied OfflineDirectSigner) → use as-is
   *   3. `this._defaults.mnemonic` → derive once, cache by mnemonic SHA
   *
   * Returned shape: `{ wallet, account }` — `wallet` is a cosmjs OfflineDirectSigner
   * (DirectSecp256k1HdWallet OR a PrivyRawSignDirectSigner OR any equivalent), and
   * `account` is the first entry from `wallet.getAccounts()`.
   *
   * @param {string} [mnemonic] - Optional per-call mnemonic override
   */
  async getWallet(mnemonic) {
    // Per-call mnemonic always wins (override path).
    if (mnemonic) {
      if (this._wallet && this._walletMnemonic !== mnemonic) {
        this._wallet = null;
        this._client = null;
      }
      if (this._wallet) return this._wallet;
      this._wallet = await createWallet(mnemonic);
      this._walletMnemonic = mnemonic;
      return this._wallet;
    }
    // Constructor-supplied signer (Privy raw-sign, Keplr offline signer, etc.).
    if (this._defaults.signer) {
      if (this._wallet) return this._wallet;
      const accounts = await this._defaults.signer.getAccounts();
      if (!accounts || accounts.length === 0) {
        throw new SentinelError(ErrorCodes.INVALID_OPTIONS,
          'signer.getAccounts() returned no accounts');
      }
      this._wallet = { wallet: this._defaults.signer, account: accounts[0] };
      this._walletMnemonic = null;
      return this._wallet;
    }
    // Constructor-supplied mnemonic (the original path).
    const m = this._defaults.mnemonic;
    if (!m) throw new SentinelError(ErrorCodes.INVALID_MNEMONIC,
      'No mnemonic or signer provided. Pass `mnemonic` or `signer` to the SentinelClient constructor.');
    if (this._wallet && this._walletMnemonic !== m) {
      this._wallet = null;
      this._client = null;
    }
    if (this._wallet) return this._wallet;
    this._wallet = await createWallet(m);
    this._walletMnemonic = m;
    return this._wallet;
  }

  /**
   * Get or create a cached RPC client.
   * @param {string} rpcUrl - Override RPC URL (or uses instance default)
   */
  async getClient(rpcUrl) {
    const url = rpcUrl || this._defaults.rpcUrl;
    if (!url) throw new SentinelError(ErrorCodes.INVALID_URL, 'No rpcUrl provided');
    if (this._client && this._rpc === url) return this._client;
    const { wallet } = await this.getWallet();
    this._client = await createClient(url, wallet);
    this._rpc = url;
    return this._client;
  }

  /**
   * Get P2P balance for the instance wallet.
   */
  async getBalance() {
    const { account } = await this.getWallet();
    const client = await this.getClient();
    return getBalance(client, account.address);
  }

  // ─── TLS Trust Management ────────────────────────────────────────────────

  /** Clear stored TLS fingerprint for a node */
  clearKnownNode(nodeAddress) { clearKnownNode(nodeAddress); }

  /** Clear all stored TLS fingerprints */
  clearAllKnownNodes() { clearAllKnownNodes(); }

  /** Get stored cert info for a node */
  getKnownNode(nodeAddress) { return getKnownNode(nodeAddress); }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  /**
   * Register process exit handlers for clean tunnel shutdown.
   * Call once at app startup.
   */
  registerCleanup() {
    registerCleanupHandlers();
  }

  /**
   * Clean up event forwarding. Call when discarding the instance.
   */
  destroy() {
    for (const [event, fn] of Object.entries(this._boundForwarders)) {
      sdkEvents.removeListener(event, fn);
    }
    this._boundForwarders = {};
    this._connection = null;
    this._wallet = null;
    this._client = null;
    this._state.destroy(); // remove from global cleanup registry
    this.removeAllListeners();
  }
}
