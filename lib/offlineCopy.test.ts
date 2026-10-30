import assert from 'node:assert/strict';
import test from 'node:test';
import { peopleFailureMessage } from '../data/companyPeople.ts';
import { snagError } from '../data/snags.ts';
import { variationError } from '../data/variations.ts';
import { OFFLINE_SHOWING_SAVED, friendlyNetworkMessage, shownFailure } from './offlineCopy.ts';

test('the friendly offline line is mapped from the raw fetch error', () => {
  assert.equal(snagError('TypeError: Failed to fetch'), OFFLINE_SHOWING_SAVED);
  assert.equal(snagError('Failed to fetch'), OFFLINE_SHOWING_SAVED);
  assert.equal(snagError('Network request failed'), OFFLINE_SHOWING_SAVED);
  assert.equal(variationError('TypeError: Failed to fetch'), OFFLINE_SHOWING_SAVED);
  assert.equal(friendlyNetworkMessage('Failed to fetch'), OFFLINE_SHOWING_SAVED);
  assert.equal(shownFailure(new TypeError('Failed to fetch'), 'Could not load folder'), OFFLINE_SHOWING_SAVED);
  assert.equal(peopleFailureMessage('TypeError: Failed to fetch'), OFFLINE_SHOWING_SAVED);
  assert.equal(OFFLINE_SHOWING_SAVED, 'No signal. Showing what’s saved on this phone.');
  assert.equal(snagError('not_authorized'), 'You cannot open this snag.');
  assert.equal(snagError('unknown'), 'Could not save the snag.');
  assert.equal(variationError('not_authorized'), 'You cannot open this variation.');
  assert.equal(friendlyNetworkMessage('Could not load the pack.'), 'Could not load the pack.');
});
