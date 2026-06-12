/**
 * Redact sensitive data from strings before logging.
 * Prevents accidental exposure of tokens, emails, and keys in debug output.
 */

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const TOKEN_PATTERNS = [
  /sk-ant-oat01-[A-Za-z0-9_-]+/g, // Claude access tokens
  /sk-ant-ort01-[A-Za-z0-9_-]+/g, // Claude refresh tokens
  /Bearer\s+[A-Za-z0-9._-]+/g, // Bearer tokens
];

/**
 * Redact sensitive information from a string.
 * Replaces emails with [REDACTED_EMAIL] and tokens with [REDACTED_TOKEN].
 */
export function redact(input: string): string {
  let result = input;

  for (const pattern of TOKEN_PATTERNS) {
    result = result.replace(pattern, "[REDACTED_TOKEN]");
  }

  result = result.replace(EMAIL_REGEX, "[REDACTED_EMAIL]");

  return result;
}
