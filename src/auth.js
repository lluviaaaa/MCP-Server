// Token authentication. Tokens are compared as SHA-256 digests with timingSafeEqual so the
// comparison time does not reveal how many leading characters were right.
import crypto from "node:crypto";

function digest(value) {
  return crypto.createHash("sha256").update(value).digest();
}

export function createAuth({ tokens }) {
  const entries = Object.entries(tokens)
    .filter(([, token]) => token)
    .map(([role, token]) => ({ role, digest: digest(token) }));

  /** Returns the role for a token, or null. Always checks every entry (no early exit). */
  function roleForToken(candidate) {
    if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > 512) return null;
    const d = digest(candidate);
    let match = null;
    for (const entry of entries) {
      if (crypto.timingSafeEqual(d, entry.digest)) match = entry.role;
    }
    return match;
  }

  function roleForAuthorizationHeader(header) {
    if (typeof header !== "string") return null;
    const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
    return m ? roleForToken(m[1]) : null;
  }

  return { roleForToken, roleForAuthorizationHeader, roles: entries.map((e) => e.role) };
}
