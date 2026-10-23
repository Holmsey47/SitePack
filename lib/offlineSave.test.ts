import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { claimSaveTap, releaseSaveTap, SAVED_OFFLINE, SAVING_LABEL, saveControl } from './offlineSave.ts';
import { flushSnagQueue, memorySnagQueue, persistThenSendSnag, type QueuedSnagCreate } from './snagQueue.ts';
import { sendQueuedSnag, type SnagSender } from './sendQueuedSnag.ts';
import { flushVariationQueue, memoryVariationQueue, persistThenSend, SAVED_ON_PHONE, type QueuedVariation } from './variationQueue.ts';

function snag(localId: string, note = 'Bead missing'): QueuedSnagCreate {
  return {
    kind: 'create',
    localId,
    ownerId: 'user-a',
    siteId: 'site',
    companyId: 'company',
    note,
    levelArea: 'Ground',
    tradeLabel: 'dryliner',
    photos: [{ id: 'p1', contentType: 'image/jpeg', bytes: Uint8Array.from([1, 2, 3]) }],
    raisedAt: '2026-10-22T08:15:00.000Z',
  };
}

function variation(localId: string, title = 'Extra beads'): QueuedVariation {
  return {
    localId,
    siteId: 'site',
    companyId: 'company',
    title,
    description: 'Note',
    levelArea: null,
    quantityText: null,
    valuePence: null,
    photos: [{ id: 'p1', contentType: 'image/jpeg', bytes: Uint8Array.from([4, 5, 6]) }],
    savedAt: '2026-10-22T13:00:00.000Z',
    ownerUserId: 'user-a',
    notice: SAVED_ON_PHONE,
  };
}

test('a double enqueue of one snag keeps a single outbox row and syncs it once', async () => {
  const memory = memorySnagQueue();
  const original = snag('snag-client-offline');
  const duplicate = { ...original, note: 'Second tap' };
  const queued = await Promise.all([
    persistThenSendSnag(original, false, async () => {
      throw new Error('offline');
    }, memory),
    persistThenSendSnag(duplicate, false, async () => {
      throw new Error('offline');
    }, memory),
  ]);
  assert.deepEqual(queued, ['queued', 'queued']);
  const stored = await memory.list();
  assert.equal(stored.length, 1);
  assert.equal(stored[0]?.kind === 'create' ? stored[0].note : '', 'Bead missing');

  const rows = new Set<string>();
  await flushSnagQueue(
    memory,
    async (item) => {
      if (item.kind !== 'create') return;
      assert.equal(rows.has(item.localId), false);
      rows.add(item.localId);
    },
    original.ownerId
  );
  assert.equal(rows.size, 1);
  assert.equal((await memory.list()).length, 0);
});

test('two online snag saves with one client id send a single row', async () => {
  const memory = memorySnagQueue();
  const original = snag('snag-client-online');
  let sends = 0;
  const send = async () => {
    sends += 1;
  };
  await Promise.all([
    persistThenSendSnag(original, true, send, memory),
    persistThenSendSnag({ ...original, note: 'Second tap' }, true, send, memory),
  ]);
  assert.equal(sends, 1);
  assert.equal((await memory.list()).length, 0);
  const again = await persistThenSendSnag({ ...original, note: 'Later tap' }, true, send, memory);
  assert.equal(again, 'sent');
  assert.equal(sends, 1);
});

test('a failed snag send leaves one queued row and the next enqueue does not send', async () => {
  const memory = memorySnagQueue();
  const original = snag('snag-client-fail');
  let sends = 0;
  const send = async () => {
    sends += 1;
    throw new Error('503');
  };
  assert.equal(await persistThenSendSnag(original, true, send, memory), 'queued');
  assert.equal(sends, 1);
  assert.equal(await persistThenSendSnag({ ...original, note: 'edited' }, true, send, memory), 'queued');
  assert.equal(sends, 1);
  const stored = await memory.list();
  assert.equal(stored.length, 1);
  assert.equal(stored[0]?.kind === 'create' ? stored[0].note : '', 'Bead missing');
});

test('a retried snag sync inserts on the client id so the row stays one', async () => {
  const queue = memorySnagQueue();
  const queued = snag('snag-client-retry');
  const rows = new Map<string, number>();
  const sender: SnagSender = {
    async upload(photo) {
      return { storagePath: 'co/site/a.jpg', contentType: photo.contentType, fileSizeBytes: photo.bytes.byteLength };
    },
    async create(input) {
      assert.equal(input.snagId, queued.localId);
      const count = (rows.get(input.snagId) ?? 0) + 1;
      rows.set(input.snagId, count);
      return { snagId: input.snagId, alreadyExisted: count > 1, photoPaths: ['co/site/a.jpg'] };
    },
    async fix() {},
    async signInternal() {
      return {} as never;
    },
    async signContractor() {
      return {} as never;
    },
  };
  await sendQueuedSnag(queued, sender, queue);
  await sendQueuedSnag({ ...queued }, sender, queue);
  assert.equal(rows.size, 1);
  assert.equal(rows.get(queued.localId), 2);
});

test('a double enqueue of one variation keeps a single outbox row and syncs it once', async () => {
  const memory = memoryVariationQueue();
  const original = variation('variation-client-offline');
  const duplicate = { ...original, title: 'Second tap' };
  const queued = await Promise.all([
    persistThenSend(original, false, async () => {
      throw new Error('offline');
    }, memory),
    persistThenSend(duplicate, false, async () => {
      throw new Error('offline');
    }, memory),
  ]);
  assert.deepEqual(queued, ['queued', 'queued']);
  const stored = await memory.list();
  assert.equal(stored.length, 1);
  assert.equal(stored[0]?.title, 'Extra beads');

  const rows = new Map<string, string>();
  await flushVariationQueue(original.ownerUserId, original.siteId, true, async (item) => {
    assert.equal(rows.has(item.localId), false);
    rows.set(item.localId, item.title);
  }, memory);
  assert.equal(rows.size, 1);
  assert.equal((await memory.list()).length, 0);
});

test('two online variation saves with one client id send a single row', async () => {
  const memory = memoryVariationQueue();
  const original = variation('variation-client-online');
  const rows = new Map<string, string>();
  const send = async (item: QueuedVariation) => {
    if (rows.has(item.localId)) throw new Error('duplicate row');
    rows.set(item.localId, item.title);
  };
  await Promise.all([
    persistThenSend(original, true, send, memory),
    persistThenSend({ ...original, title: 'Second tap' }, true, send, memory),
  ]);
  assert.equal(rows.size, 1);
  assert.equal(rows.get(original.localId), 'Extra beads');
  assert.equal((await memory.list()).length, 0);
  const again = await persistThenSend({ ...original, title: 'Later tap' }, true, send, memory);
  assert.equal(again, 'sent');
  assert.equal(rows.size, 1);
});

test('a failed save turns the button back on and a second tap cannot start another save', () => {
  assert.equal(saveControl('error', 'Save snag').enabled, true);
  assert.equal(saveControl('error', 'Save variation').label, 'Save variation');
  assert.deepEqual(saveControl('saving', 'Save snag'), { label: SAVING_LABEL, enabled: false });
  assert.deepEqual(saveControl('saved', 'Save snag'), { label: SAVED_OFFLINE, enabled: false });
  assert.equal(SAVING_LABEL, 'Saving…');
  assert.equal(SAVED_OFFLINE, 'Saved offline, will sync');

  const lock = { current: false };
  assert.equal(claimSaveTap(lock), true);
  assert.equal(claimSaveTap(lock), false);
  releaseSaveTap(lock);
  assert.equal(claimSaveTap(lock), true);

  for (const file of ['app/(app)/sites/[siteId]/snags/new.tsx', 'app/(app)/sites/[siteId]/variations/new.tsx']) {
    const source = fs.readFileSync(file, 'utf8');
    assert.match(source, /useState\(newId\)/);
    assert.doesNotMatch(source, /newId\(\)/);
    assert.match(source, /claimSaveTap\(saveLock\)/);
    assert.match(source, /localId: clientId/);
    assert.match(source, /SAVED_OFFLINE/);
    assert.match(source, /disabled=\{!control\.enabled\}/);
    assert.doesNotMatch(source, /setSaving\(false\)/);
    const saveFn = source.slice(source.indexOf('async function onSave'), source.indexOf('\n  return ('));
    assert.ok(saveFn.indexOf('claimSaveTap(saveLock)') > saveFn.indexOf('setError('));
    const queued = saveFn.slice(saveFn.indexOf("=== 'queued'"), saveFn.indexOf('catch (err)'));
    assert.match(queued, /setNotice\(SAVED_OFFLINE\)/);
    assert.match(queued, /router\.back\(\)/);
    const caught = saveFn.slice(saveFn.indexOf('catch (err)'));
    assert.match(caught, /releaseSaveTap\(saveLock\)/);
    assert.match(caught, /setPhase\('error'\)/);
    assert.doesNotMatch(saveFn, /finally/);
  }

  const revise = fs.readFileSync('app/(app)/sites/[siteId]/variations/[variationId].tsx', 'utf8');
  const handler = revise.slice(revise.indexOf("label={revising ? SAVING_LABEL : 'Edit as new version'}"));
  const button = handler.slice(0, handler.indexOf('/>'));
  assert.match(button, /if \(reviseLock\.current\) return/);
  assert.match(button, /reviseLock\.current = false/);
  assert.match(button, /setRevising\(false\)/);
  assert.match(button, /disabled=\{revising\}/);
  assert.doesNotMatch(button, /\.finally\(/);
});
