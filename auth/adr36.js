/**
 * Sentinel SDK — ADR-36 Signature Verification
 *
 * Verifies Keplr/Leap/Cosmostation `signArbitrary` signatures server-side.
 * Includes address-vs-pubkey derivation check (the part most consumers skip).
 *
 * Usage:
 *   import { verifyAdr36Signature } from './auth/adr36.js';
 *   const { ok, reason } = await verifyAdr36Signature({ addr, pubkeyB64, signatureB64, message });
 */

import { Secp256k1, sha256, ripemd160 } from '@cosmjs/crypto';
import { toBech32 } from '@cosmjs/encoding';

// ─── Canonical JSON ──────────────────────────────────────────────────────────

/**
 * Amino-compatible canonical JSON serialization (sorted keys, no whitespace).
 * Required for ADR-36 sign-doc hashing — standard JSON.stringify produces
 * non-deterministic key order, which breaks signature verification.
 */
export function sortedJsonStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(sortedJsonStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + sortedJsonStringify(value[k])).join(',') + '}';
}

// ─── ADR-36 Verifier ─────────────────────────────────────────────────────────

/**
 * Verify an ADR-36 `signArbitrary` signature produced by Keplr, Leap, or Cosmostation.
 *
 * Checks BOTH:
 *   1. That the pubkey derives to the claimed address (addr-pubkey-mismatch attack vector).
 *   2. That the secp256k1 signature over the canonical sign-doc is valid.
 *
 * @param {object} opts
 * @param {string} opts.addr        - Bech32 signer address (e.g. sent1abc...)
 * @param {string} opts.pubkeyB64   - Base64-encoded compressed secp256k1 pubkey (33 bytes)
 * @param {string} opts.signatureB64 - Base64-encoded 64-byte signature (r||s)
 * @param {string} opts.message     - The original UTF-8 message that was signed
 * @param {string} [opts.prefix]    - Bech32 prefix (default: 'sent')
 * @returns {Promise<{ ok: boolean, reason: string|null }>}
 */
export async function verifyAdr36Signature({ addr, pubkeyB64, signatureB64, message, prefix = 'sent' }) {
  const pubkey = Buffer.from(pubkeyB64, 'base64');

  // Step 1: derive bech32 address from pubkey and compare to claimed addr.
  // Skipping this check allows an attacker to substitute their own pubkey for
  // a victim's address and produce a valid-looking signature for any message.
  const derived = toBech32(prefix, ripemd160(sha256(pubkey)));
  if (derived !== addr) return { ok: false, reason: 'addr-pubkey-mismatch' };

  // Step 2: rebuild the canonical ADR-36 amino sign-doc and verify the signature.
  const signDoc = {
    chain_id: '',
    account_number: '0',
    sequence: '0',
    fee: { gas: '0', amount: [] },
    msgs: [{
      type: 'sign/MsgSignData',
      value: {
        signer: addr,
        data: Buffer.from(message, 'utf8').toString('base64'),
      },
    }],
    memo: '',
  };

  const hash = sha256(Buffer.from(sortedJsonStringify(signDoc), 'utf8'));
  const sig = Buffer.from(signatureB64, 'base64');

  const ok = await Secp256k1.verifySignature(
    { r: sig.slice(0, 32), s: sig.slice(32) },
    hash,
    pubkey,
  );

  return { ok, reason: ok ? null : 'sig-invalid' };
}
