import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDate } from './format.ts';
import { talkMeaning } from './talkMeaning.ts';

const site = 'Oak yard';
const title = 'Fire exits';
const presenter = 'Jordan Hale';
const on = formatDate('2026-10-22T12:00:00.000Z');

test('induction, phone, in person, and presenter each have one sentence', () => {
  assert.equal(on, '22 Oct 2026');
  assert.equal(
    talkMeaning({
      kind: 'induction',
      delivery: 'in_person',
      signatureRole: 'attendee',
      siteName: site,
      title,
      presenterName: presenter,
      presentedOn: on,
    }),
    "I've read and understood the site induction for Oak yard and I'll follow it. If anything's unclear, I'll ask the site manager before starting work."
  );
  assert.equal(
    talkMeaning({
      kind: 'toolbox',
      delivery: 'phone',
      signatureRole: 'attendee',
      siteName: ` ${site} `,
      title: ` ${title} `,
      presenterName: presenter,
      presentedOn: on,
    }),
    "I've read and understood the toolbox talk 'Fire exits' for Oak yard."
  );
  assert.equal(
    talkMeaning({
      kind: 'toolbox',
      delivery: 'in_person',
      signatureRole: 'attendee',
      siteName: site,
      title,
      presenterName: presenter,
      presentedOn: on,
    }),
    "I was at the toolbox talk 'Fire exits' given by Jordan Hale at Oak yard on 22 Oct 2026, and I understood it."
  );
  assert.equal(
    talkMeaning({
      kind: 'toolbox',
      delivery: 'phone',
      signatureRole: 'presenter',
      siteName: site,
      title,
      presenterName: presenter,
      presentedOn: on,
    }),
    'I gave this talk to the people listed.'
  );
  assert.equal(
    talkMeaning({
      kind: 'rams',
      delivery: 'phone',
      signatureRole: 'attendee',
      siteName: site,
      title,
      presenterName: presenter,
      presentedOn: on,
    }),
    "I've read and understood the RAMS 'Fire exits' for Oak yard."
  );
  assert.equal(
    talkMeaning({
      kind: 'rams',
      delivery: 'phone',
      signatureRole: 'presenter',
      siteName: site,
      title,
      presenterName: presenter,
      presentedOn: on,
    }),
    'I issued this RAMS to the people listed.'
  );
});
