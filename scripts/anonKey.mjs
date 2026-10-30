// The client key is public, and it is not a JWT.
// Only an sb_publishable_ value may ship. Messages name the variable and never include the key.

const CLIENT_KEY_NAME = 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY';

/** Null when the value may be shipped in a client bundle. */
export function publishableKeyProblem(key) {
  if (typeof key !== 'string') return 'missing';
  const value = key.trim();
  if (value.startsWith('sb_publishable_')) return null;
  return value === '' ? 'missing' : 'rejected';
}

export function clientKeyMessage(env) {
  if (publishableKeyProblem(env?.[CLIENT_KEY_NAME])) {
    return `${CLIENT_KEY_NAME} must start with sb_publishable_.`;
  }
  return null;
}
