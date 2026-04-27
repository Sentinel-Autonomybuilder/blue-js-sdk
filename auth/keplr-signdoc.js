/**
 * Sentinel SDK — Keplr Broadcast-Back Helpers
 *
 * Builds a SIGN_MODE_DIRECT signDoc for Keplr/Leap `signDirect`, then
 * reassembles the signed TxRaw for RPC broadcast. This is the only pattern
 * that works without leaking mnemonics or maintaining a long-lived signing
 * client in the browser.
 *
 * Flow:
 *   server: buildKeplrSignDoc(msgs, account, fee) → { bodyBytes, authInfoBytes, chainId, accountNumber }
 *   browser: keplr.signDirect(chainId, addr, signDoc) → { signed, signature }
 *   server: broadcastSignedKeplrTx(tmClient, signed, signature) → txHash
 *
 * Usage:
 *   import { buildKeplrSignDoc, broadcastSignedKeplrTx } from './auth/keplr-signdoc.js';
 */

import { TxBody, TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import { makeAuthInfoBytes } from '@cosmjs/proto-signing';
import Long from 'long';

// ─── SignDoc Builder ─────────────────────────────────────────────────────────

/**
 * Build a Direct-mode signDoc for Keplr's `signDirect`.
 *
 * Common traps avoided here:
 *   - `accountNumber` must be Long.toString(), not a JS Number — Keplr silently fails otherwise.
 *   - `SIGN_MODE_DIRECT` = 1 (not a named export in older cosmjs-types).
 *   - `pubkey.value` must be the raw 33-byte compressed pubkey bytes, NOT a protobuf wrapper.
 *
 * @param {object} opts
 * @param {Array}  opts.msgs           - Array of { typeUrl, value } EncodeObjects
 * @param {string} [opts.memo]         - TX memo (default: '')
 * @param {string} opts.pubkeyB64      - Base64-encoded compressed secp256k1 pubkey (33 bytes)
 * @param {number} opts.accountNumber  - Chain account number
 * @param {number} opts.sequence       - Account sequence
 * @param {number} opts.gasLimit       - Gas limit
 * @param {Array}  opts.feeAmount      - Array of { denom, amount } Coin objects
 * @param {string} opts.chainId        - Chain ID (e.g. 'sentinelhub-2')
 * @param {object} opts.registry       - CosmJS TypeRegistry (from buildRegistry())
 * @returns {{ bodyBytes: string, authInfoBytes: string, chainId: string, accountNumber: string }}
 *   All byte fields are base64-encoded for JSON transport to the browser.
 */
export function buildKeplrSignDoc({ msgs, memo = '', pubkeyB64, accountNumber, sequence, gasLimit, feeAmount, chainId, registry }) {
  const bodyBytes = TxBody.encode({
    messages: msgs.map(m => registry.encodeAsAny(m)),
    memo,
    timeoutHeight: Long.UZERO,
    extensionOptions: [],
    nonCriticalExtensionOptions: [],
  }).finish();

  const pubkeyBytes = Buffer.from(pubkeyB64, 'base64');
  const authInfoBytes = makeAuthInfoBytes(
    [{ pubkey: { typeUrl: '/cosmos.crypto.secp256k1.PubKey', value: pubkeyBytes }, sequence }],
    feeAmount,
    gasLimit,
    undefined,
    undefined,
    1, // SIGN_MODE_DIRECT
  );

  return {
    bodyBytes: Buffer.from(bodyBytes).toString('base64'),
    authInfoBytes: Buffer.from(authInfoBytes).toString('base64'),
    chainId,
    accountNumber: Long.fromNumber(accountNumber).toString(),
  };
}

// ─── Broadcast Reconstructor ─────────────────────────────────────────────────

/**
 * Reconstruct TxRaw from Keplr's `signDirect` response and broadcast via RPC.
 *
 * @param {object} opts
 * @param {object} opts.tmClient        - Tendermint37Client (from createRpcQueryClient)
 * @param {string} opts.bodyBytesB64    - `signed.bodyBytes` from Keplr (base64)
 * @param {string} opts.authInfoBytesB64 - `signed.authInfoBytes` from Keplr (base64)
 * @param {string} opts.signatureB64    - `signature.signature` from Keplr (base64)
 * @returns {Promise<{ transactionHash: string, code: number }>}
 */
export async function broadcastSignedKeplrTx({ tmClient, bodyBytesB64, authInfoBytesB64, signatureB64 }) {
  const txRaw = TxRaw.encode({
    bodyBytes: Buffer.from(bodyBytesB64, 'base64'),
    authInfoBytes: Buffer.from(authInfoBytesB64, 'base64'),
    signatures: [Buffer.from(signatureB64, 'base64')],
  }).finish();

  const result = await tmClient.broadcastTxSync({ tx: txRaw });
  return {
    transactionHash: Buffer.from(result.hash).toString('hex').toUpperCase(),
    code: result.code ?? 0,
    rawLog: result.log ?? '',
  };
}
