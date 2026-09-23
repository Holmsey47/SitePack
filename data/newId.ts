/** Phone Hermes has no global `crypto`. Node tests do. Expo Go has expo-crypto. */
export function newId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === 'function') return randomUUID.call(globalThis.crypto);
  const native = require('expo-crypto') as typeof import('expo-crypto');
  return native.randomUUID();
}
