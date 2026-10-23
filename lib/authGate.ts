export type GateTarget = '/welcome' | '/set-password' | '/sites';

/**
 * Where the root gate sends the navigator.
 * Signed-out people may stay on welcome, start, login, join, and reset.
 * A person who still needs a password cannot stay on login.
 */
export function gateRedirect(input: {
  ready: boolean;
  hasPerson: boolean;
  needsPassword: boolean;
  segments: readonly string[];
}): GateTarget | null {
  if (!input.ready) return null;
  const parts = input.segments;
  const inAuth = parts[0] === '(auth)';
  const screen = parts[1] ?? '';
  const publicJoin = parts[0] === 'join' || parts[0] === 'reset';
  const person = input.hasPerson;
  const needsPassword = input.needsPassword;
  if (!person && screen !== 'login' && screen !== 'welcome' && screen !== 'start' && !publicJoin) {
    return '/welcome';
  }
  if (person && needsPassword && screen !== 'set-password') {
    return '/set-password';
  }
  if (person && !needsPassword && inAuth) {
    return '/sites';
  }
  return null;
}
