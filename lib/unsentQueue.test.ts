import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { memoryDrawingSeenQueue } from './drawingSeenQueue.ts';
import { memorySnagQueue, type QueuedSnag } from './snagQueue.ts';
import { clearOwnedQueues, countUnsentForUser, signOutConfirmCopy } from './unsentQueue.ts';
import { memoryVariationQueue, type QueuedVariation } from './variationQueue.ts';

function snag(localId: string, ownerId: string): QueuedSnag {
  return {
    kind: 'create',
    localId,
    ownerId,
    siteId: 'site',
    companyId: 'co',
    note: 'Crack',
    levelArea: null,
    tradeLabel: 'Plaster',
    photos: [],
    raisedAt: '2026-10-30T12:00:00.000Z',
  };
}

function variation(localId: string, ownerUserId: string): QueuedVariation {
  return {
    localId,
    siteId: 'site',
    companyId: 'co',
    title: 'Extra',
    description: 'More work',
    levelArea: null,
    quantityText: null,
    valuePence: null,
    photos: [],
    savedAt: '2026-10-30T12:00:00.000Z',
    ownerUserId,
    notice: '',
  };
}

test('sign-out clears this person’s queue and warns when something is unsent', async () => {
  const snagQueue = memorySnagQueue();
  const variationQueue = memoryVariationQueue();
  const seenQueue = memoryDrawingSeenQueue();
  await snagQueue.put(snag('mine', 'user-a'));
  await snagQueue.put(snag('theirs', 'user-b'));
  await snagQueue.putNotice({
    id: 'notice-a',
    ownerId: 'user-a',
    siteId: 'site',
    message: 'This snag was not saved',
    photos: [],
  });
  await variationQueue.put(variation('var-a', 'user-a'));
  await variationQueue.put(variation('var-b', 'user-b'));
  await seenQueue.put({
    id: 'seen-a',
    ownerId: 'user-a',
    kind: 'confirm',
    drawingId: 'drawing',
    siteId: 'site',
    revision: 'C',
    at: '2026-10-30T12:00:00.000Z',
  });
  await seenQueue.put({
    id: 'seen-b',
    ownerId: 'user-b',
    kind: 'open',
    drawingId: 'drawing',
    siteId: 'site',
    revision: 'C',
    at: '2026-10-30T12:00:00.000Z',
  });
  const stores = { snagQueue, variationQueue, seenQueue };
  assert.equal(await countUnsentForUser('user-a', stores), 3);
  assert.equal(await countUnsentForUser(null, stores), 0);
  const warned = signOutConfirmCopy(true);
  const plain = signOutConfirmCopy(false);
  assert.equal(warned.title, 'Sign out of SitePack?');
  assert.match(warned.body, /have not been sent/);
  assert.match(warned.body, /This phone only/);
  assert.match(plain.body, /Other phones stay signed in/);
  assert.equal(plain.body.includes('have not been sent'), false);

  await clearOwnedQueues('user-a', stores);
  assert.equal(await countUnsentForUser('user-a', stores), 0);
  assert.deepEqual(
    (await snagQueue.list()).map((item) => item.localId),
    ['theirs']
  );
  assert.equal((await snagQueue.listNotices()).length, 0);
  assert.deepEqual(
    (await variationQueue.list()).map((item) => item.localId),
    ['var-b']
  );
  assert.deepEqual(
    (await seenQueue.list()).map((item) => item.id),
    ['seen-b']
  );

  const auth = fs.readFileSync('context/AuthContext.tsx', 'utf8');
  const company = fs.readFileSync('app/(app)/company.tsx', 'utf8');
  const repo = fs.readFileSync('data/supabaseRepo.ts', 'utf8');
  assert.match(auth, /clearArchivedDocuments\(\)/);
  assert.match(auth, /clearOwnedQueues\(ownerId\)/);
  assert.match(auth, /signOut\(\{ scope: 'local' \}\)/);
  assert.match(auth, /signOut: async \(\) => \{[\s\S]*bindCache\(null\)/);
  assert.match(company, /signOutConfirmCopy/);
  assert.match(company, /countUnsentForUser/);
  assert.match(company, /label="Sign out"/);
  assert.match(company, /label="Cancel"/);
  assert.match(repo, /signOut\(\{ scope: 'local' \}\)/);
});
