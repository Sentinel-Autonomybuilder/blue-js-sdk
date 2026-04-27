/**
 * Redacting logger wrapper — defense-in-depth against accidental mnemonic leaks
 * in SDK log output.
 *
 * The SDK's default logger is `console.log`. Any future bug that interpolates
 * a mnemonic into a log template string (e.g. `log(`opts: ${JSON.stringify(opts)}`)`)
 * would leak the BIP-39 phrase to stdout/stderr — and from there to terminal
 * scrollback, CI logs, log-aggregation tools (Datadog, Loki, Sentry breadcrumbs),
 * and shell history.
 *
 * This module wraps any logger function with a regex-based redactor that matches
 * BIP-39 word sequences and replaces them with `[REDACTED MNEMONIC]` before the
 * underlying logger sees them. It is NOT a substitute for the rule "do not log
 * the mnemonic" — it is a safety net so that violation does not produce a leak.
 *
 * Performance: the regex runs only on string arguments and short-circuits if the
 * argument has fewer than ~60 characters (a 12-word mnemonic is ~80 characters).
 * Negligible overhead on the SDK's hot path (a few connect-time progress logs).
 */

/**
 * Match 12 / 15 / 18 / 21 / 24 lowercase BIP-39-shaped words separated by single
 * spaces. We deliberately don't try to validate against the full 2048-word list
 * here — the goal is to catch anything that *looks* like a mnemonic and redact
 * it. False positives (e.g. a long lowercase sentence) are acceptable since the
 * SDK's own log strings never contain 12+ consecutive lowercase-only ASCII words.
 *
 * BIP-39 words are 3–8 lowercase ASCII letters (a–z), no digits, no diacritics.
 */
const MNEMONIC_REGEX = /\b(?:[a-z]{3,8}\s+){11,23}[a-z]{3,8}\b/g;

const REDACTED = '[REDACTED MNEMONIC]';

/**
 * Redact mnemonic-shaped substrings from a single value. Strings are scanned;
 * everything else is returned unchanged. We do NOT recurse into objects — the
 * SDK's loggers are called with scalar args, and walking arbitrary objects
 * would risk triggering custom getters that have side effects.
 *
 * @param {*} value
 * @returns {*}
 */
function redactValue(value) {
  if (typeof value !== 'string') return value;
  if (value.length < 60) return value; // shortest plausible 12-word phrase ~ 60 chars
  return value.replace(MNEMONIC_REGEX, REDACTED);
}

/**
 * Wrap a logger function so that mnemonic-shaped strings in its arguments are
 * replaced with `[REDACTED MNEMONIC]` before they reach the wrapped logger.
 * Pass-through for non-function input (returns it unchanged) so callers can
 * disable logging by passing `null`.
 *
 * @param {Function|null|undefined} logFn - underlying logger (typically console.log)
 * @returns {Function|null|undefined}
 */
export function withMnemonicRedaction(logFn) {
  if (typeof logFn !== 'function') return logFn;
  return function redactedLog(...args) {
    return logFn(...args.map(redactValue));
  };
}

// Exported for tests.
export const _internal = { MNEMONIC_REGEX, redactValue };
