// The client key is public. A secret key in either EXPO_PUBLIC name must fail the build.
// Messages name the variable only. They never include the key.

export function jwtRole(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  if (!parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part) && part.length > 0)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

/** Null when the value may be shipped in a client bundle. */
export function anonKeyProblem(key) {
  if (typeof key !== 'string' || key.trim() === '') return 'missing';
  const value = key.trim();
  if (value.startsWith('sb_publishable_')) return null;
  if (jwtRole(value) === 'anon') return null;
  return 'rejected';
}

const CLIENT_KEY_NAMES = ['EXPO_PUBLIC_SUPABASE_ANON_KEY', 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY'];

export function clientKeyMessage(env) {
  for (const name of CLIENT_KEY_NAMES) {
    const value = env?.[name];
    if (typeof value !== 'string' || value.trim() === '') continue;
    if (anonKeyProblem(value)) {
      return `${name} must start with sb_publishable_ or be a JWT whose role is anon.`;
    }
  }
  return null;
}
