let forced = false;

/** Capture switch. When on, talk signing stays on the phone and does not call the server. */
export function fixtureForceOffline(next = true): void {
  forced = next;
}

export function isFixtureOffline(): boolean {
  return forced;
}
