import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { peopleFailureMessage } from '../data/companyPeople.ts';
import { snagError } from '../data/snags.ts';
import { variationError } from '../data/variations.ts';
import {
  OFFLINE_COME_BACK,
  OFFLINE_SHOWING_SAVED,
  OFFLINE_SNAGS_LATER,
  friendlyNetworkMessage,
  offlineStatusLine,
  shownFailure,
} from './offlineCopy.ts';

test('the friendly offline line is mapped from the raw fetch error', () => {
  assert.equal(snagError('TypeError: Failed to fetch'), OFFLINE_COME_BACK);
  assert.equal(snagError('Failed to fetch'), OFFLINE_COME_BACK);
  assert.equal(snagError('Network request failed'), OFFLINE_COME_BACK);
  assert.equal(variationError('TypeError: Failed to fetch'), OFFLINE_COME_BACK);
  assert.equal(friendlyNetworkMessage('Failed to fetch'), OFFLINE_COME_BACK);
  assert.equal(friendlyNetworkMessage('Failed to fetch', true), OFFLINE_SHOWING_SAVED);
  assert.equal(shownFailure(new TypeError('Failed to fetch'), 'Could not load folder'), OFFLINE_COME_BACK);
  assert.equal(peopleFailureMessage('TypeError: Failed to fetch'), OFFLINE_COME_BACK);
  assert.equal(offlineStatusLine(true), OFFLINE_SHOWING_SAVED);
  assert.equal(offlineStatusLine(false, OFFLINE_SNAGS_LATER), OFFLINE_SNAGS_LATER);
  assert.equal(offlineStatusLine(false), OFFLINE_COME_BACK);
  assert.equal(OFFLINE_SHOWING_SAVED, 'No signal. Showing what’s saved on this phone.');
  assert.equal(OFFLINE_SNAGS_LATER, 'No signal. Snags will show when you’re back online.');
  assert.equal(snagError('not_authorized'), 'You cannot open this snag.');
  assert.equal(snagError('unknown'), 'Could not save the snag.');
  assert.equal(variationError('not_authorized'), 'You cannot open this variation.');
  assert.equal(friendlyNetworkMessage('Could not load the pack.'), 'Could not load the pack.');
});

test('snags offline shows a cached list and does not offer an empty share', () => {
  const screen = fs.readFileSync('app/(app)/sites/[siteId]/snags/index.tsx', 'utf8');
  assert.match(screen, /readCachedSnagList/);
  assert.match(screen, /cacheSnagList/);
  assert.match(screen, /offlineStatusLine\(saved, OFFLINE_SNAGS_LATER\)/);
  assert.match(screen, /rows\.length > 0 \?/);
  assert.match(screen, /label="Share report"/);
  const offline = fs.readFileSync('lib/offline.ts', 'utf8');
  assert.match(offline, /sitepack\.offline\.snags\./);
  assert.match(offline, /function clearLocalMetadata\(\) \{[\s\S]*SNAG_LIST_PREFIX/);
});
