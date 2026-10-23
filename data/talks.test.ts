import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fixtureRepo, resetFixtureStore } from './fixtureRepo.ts';
import {
  emptyTalks,
  fixtureAskTalk,
  fixtureCreateTalk,
  fixtureReviseTalk,
  fixtureSetTalkNote,
  fixtureSignPresenter,
  fixtureSignTalk,
  fixtureTalkDetail,
  fixtureVersionSignatures,
  type FixtureTalkBucket,
  type TalkActor,
  type TalkAssignment,
  type TalkPerson,
  type TalkSite,
} from './fixtureTalks.ts';
import { IDS, SEED_PASSWORD } from './ids.ts';
import { signaturePngOk, signedCountLabel, talkPlain, talkStoragePath } from './talks.ts';
import { formatDate } from '../lib/format.ts';
import { fixtureForceOffline, isFixtureOffline } from '../lib/fixtureOffline.ts';
import { talkMeaning } from '../lib/talkMeaning.ts';
import { pngDataUrl, solidPng } from '../lib/signaturePng.ts';

const png = pngDataUrl(solidPng(8, 8, [12, 12, 12]));
const session = 'session-abc-1';

function actor(person: TalkPerson, auth = person.id): TalkActor {
  return {
    id: person.id,
    role: person.role,
    company_id: person.company_id,
    display_name: person.display_name ?? '',
    auth_user_id: auth,
  };
}

function gang() {
  const company = '11111111-1111-4111-8111-111111111111';
  const site: TalkSite = { id: '66666666-6666-4666-8666-666666666666', company_id: company, name: 'Oak yard' };
  const owner: TalkPerson = { id: 'owner-1', role: 'owner', company_id: company, display_name: 'Jordan Hale' };
  const names = ['Sam Reed', 'Lee Costa', 'Nia Cole', 'Rio Kent', 'Kai Moss'];
  const lads: TalkPerson[] = names.map((name, index) => ({
    id: `lad-${index + 1}`,
    role: 'operative',
    company_id: company,
    display_name: name,
  }));
  const people = [owner, ...lads];
  const assignments: TalkAssignment[] = lads.map((lad) => ({ site_id: site.id, person_id: lad.id }));
  const bucket: FixtureTalkBucket = emptyTalks();
  const access = () => true;
  return { company, site, owner, lads, people, assignments, bucket, access, sites: [site] };
}

function sign(world: ReturnType<typeof gang>, who: TalkActor, personId: string, talkId: string, versionId: string) {
  return fixtureSignTalk(
    world.bucket,
    who,
    {
      talkId,
      versionId,
      personId,
      signaturePng: png,
      deviceAt: new Date(Date.now() - 60_000).toISOString(),
      sessionId: session,
    },
    world.sites,
    world.people,
    world.assignments,
    world.access
  );
}

test('three of five sign under their own names, and a question is not a signature', () => {
  assert.equal(signaturePngOk(png), true);
  const world = gang();
  const owner = actor(world.owner, 'auth-owner');
  const created = fixtureCreateTalk(
    world.bucket,
    owner,
    {
      siteId: world.site.id,
      kind: 'toolbox',
      delivery: 'in_person',
      title: 'Fire exits',
      body: 'Walk to the gate.',
      pdfPath: null,
      audience: 'all',
      personIds: [],
      presenterPersonId: world.owner.id,
      presenterRole: 'Owner',
      presentedAt: new Date().toISOString(),
    },
    world.sites,
    world.people,
    world.assignments,
    world.access
  );
  const [sam, lee, nia, rio, kai] = world.lads;
  assert.ok(sam && lee && nia && rio && kai);
  const samSigned = sign(world, actor(sam), sam.id, created.talk_id, created.version_id);
  const leeSigned = sign(world, owner, lee.id, created.talk_id, created.version_id);
  sign(world, actor(nia), nia.id, created.talk_id, created.version_id);
  assert.equal(samSigned.shared_device, false);
  assert.equal(samSigned.captured_by, sam.id);
  assert.equal(samSigned.content_hash, created.content_hash);
  assert.notEqual(samSigned.received_at, samSigned.device_at);
  assert.equal(leeSigned.shared_device, true);
  assert.equal(leeSigned.captured_by, owner.id);
  assert.equal(leeSigned.session_id, session);
  fixtureAskTalk(
    world.bucket,
    actor(rio),
    {
      talkId: created.talk_id,
      versionId: created.version_id,
      personId: rio.id,
      body: 'Where is the muster point?',
      deviceAt: new Date().toISOString(),
      sessionId: session,
    },
    world.sites,
    world.people,
    world.assignments,
    world.access
  );
  fixtureSetTalkNote(
    world.bucket,
    owner,
    created.talk_id,
    lee.id,
    true,
    true,
    world.sites,
    world.people,
    world.assignments,
    world.access
  );
  const detail = fixtureTalkDetail(
    world.bucket,
    owner,
    created.talk_id,
    world.sites,
    world.people,
    world.assignments,
    world.access,
    () => null
  );
  assert.ok(detail?.register);
  assert.equal(detail.register.required_count, 5);
  assert.equal(detail.register.signed_count, 3);
  assert.equal(signedCountLabel(detail.register.signed_count, detail.register.required_count), '3 of 5 signed');
  assert.deepEqual(
    detail.register.signed.map((row) => row.person_name),
    ['Sam Reed', 'Lee Costa', 'Nia Cole']
  );
  const shared = detail.register.signed.find((row) => row.person_id === lee.id);
  assert.equal(shared?.shared_device, true);
  assert.equal(shared?.explained_verbally, true);
  assert.equal(shared?.interpreter_used, true);
  assert.equal(shared?.meaning, leeSigned.meaning);
  const asking = detail.register.not_signed.find((row) => row.person_id === rio.id);
  assert.equal(asking?.has_question, true);
  assert.equal(asking?.question, 'Where is the muster point?');
  assert.equal(detail.register.not_signed.some((row) => row.person_id === kai.id), true);
  assert.equal(detail.register.questions.length, 1);
  assert.equal(detail.presenter_name, 'Jordan Hale');
  assert.equal(detail.presenter_role, 'Owner');
  assert.equal(detail.version_no, 1);

  const revised = fixtureReviseTalk(
    world.bucket,
    owner,
    created.talk_id,
    { title: 'Fire exits', body: 'Muster by the cabin.', pdfPath: null },
    world.sites,
    world.access
  );
  assert.equal(revised.version_no, 2);
  assert.notEqual(revised.version_id, created.version_id);
  assert.equal(fixtureVersionSignatures(world.bucket, created.version_id).length, 3);
  const current = fixtureTalkDetail(
    world.bucket,
    owner,
    created.talk_id,
    world.sites,
    world.people,
    world.assignments,
    world.access,
    () => null
  );
  assert.equal(current?.register?.signed_count, 0);
  assert.equal(current?.version_id, revised.version_id);
  assert.throws(
    () => sign(world, actor(kai), kai.id, created.talk_id, created.version_id),
    /version_locked/
  );
  const same = fixtureReviseTalk(
    world.bucket,
    owner,
    created.talk_id,
    { title: 'Fire exits', body: 'Muster by the cabin.', pdfPath: null },
    world.sites,
    world.access
  );
  assert.equal(same.version_id, revised.version_id);
});

test('an operative cannot sign as someone else, and the presenter can on that site', () => {
  const world = gang();
  const owner = actor(world.owner);
  const created = fixtureCreateTalk(
    world.bucket,
    owner,
    {
      siteId: world.site.id,
      kind: 'toolbox',
      delivery: 'in_person',
      title: 'Fire exits',
      body: 'Walk to the gate.',
      pdfPath: null,
      audience: 'all',
      personIds: [],
      presenterPersonId: 'lad-1',
      presenterRole: 'Operative',
      presentedAt: '2026-10-22T12:00:00.000Z',
    },
    world.sites,
    world.people,
    world.assignments,
    world.access
  );
  const talk = world.bucket.talks[0];
  assert.ok(talk);
  const [sam, lee, nia] = world.lads;
  assert.ok(sam && lee && nia);
  assert.equal(talk.presenter_person_id, sam.id);
  assert.throws(
    () => sign(world, actor(lee), nia.id, created.talk_id, created.version_id),
    /not_authorized/
  );
  assert.throws(() => fixtureCreateTalk(
    world.bucket,
    actor(lee),
    {
      siteId: world.site.id,
      kind: 'induction',
      delivery: 'phone',
      title: 'Induction',
      body: 'Read this.',
      pdfPath: null,
      audience: 'all',
      personIds: [],
      presenterPersonId: 'lad-2',
      presenterRole: 'Operative',
      presentedAt: new Date().toISOString(),
    },
    world.sites,
    world.people,
    world.assignments,
    world.access
  ), /not_authorized/);
  const captured = sign(world, actor(sam), nia.id, created.talk_id, created.version_id);
  assert.equal(captured.shared_device, true);
  const on = formatDate('2026-10-22T12:00:00.000Z');
  assert.equal(
    captured.meaning,
    talkMeaning({
      kind: 'toolbox',
      delivery: 'in_person',
      signatureRole: 'attendee',
      siteName: 'Oak yard',
      title: 'Fire exits',
      presenterName: 'Sam Reed',
      presentedOn: on,
    })
  );
  assert.throws(
    () =>
      fixtureSignPresenter(
        world.bucket,
        actor(lee),
        {
          talkId: created.talk_id,
          versionId: created.version_id,
          signaturePng: png,
          deviceAt: new Date().toISOString(),
          sessionId: session,
        },
        world.sites,
        world.people,
        world.access
      ),
    /not_authorized/
  );
  const forThem = fixtureSignPresenter(
    world.bucket,
    owner,
    {
      talkId: created.talk_id,
      versionId: created.version_id,
      signaturePng: png,
      deviceAt: new Date().toISOString(),
      sessionId: session,
    },
    world.sites,
    world.people,
    world.access
  );
  assert.equal(
    forThem.meaning,
    talkMeaning({
      kind: 'toolbox',
      delivery: 'in_person',
      signatureRole: 'on_behalf',
      siteName: 'Oak yard',
      title: 'Fire exits',
      presenterName: 'Sam Reed',
      presentedOn: formatDate('2026-10-22T12:00:00.000Z'),
      managerName: 'Jordan Hale',
    })
  );
  const second = fixtureCreateTalk(
    world.bucket,
    owner,
    {
      siteId: world.site.id,
      kind: 'toolbox',
      delivery: 'in_person',
      title: 'Afternoon brief',
      body: 'Walk to the gate.',
      pdfPath: null,
      audience: 'all',
      personIds: [],
      presenterPersonId: 'lad-1',
      presenterRole: 'Operative',
      presentedAt: '2026-10-22T12:00:00.000Z',
    },
    world.sites,
    world.people,
    world.assignments,
    world.access
  );
  const presenter = fixtureSignPresenter(
    world.bucket,
    actor(sam),
    {
      talkId: second.talk_id,
      versionId: second.version_id,
      signaturePng: png,
      deviceAt: new Date().toISOString(),
      sessionId: session,
    },
    world.sites,
    world.people,
    world.access
  );
  assert.equal(presenter.meaning, 'I gave this talk to the people listed.');
  const detail = fixtureTalkDetail(
    world.bucket,
    actor(sam),
    created.talk_id,
    world.sites,
    world.people,
    world.assignments,
    world.access,
    () => null
  );
  assert.equal(detail?.register?.presenter_signature?.meaning, 'signed by Jordan Hale for Sam Reed');
  const hidden = fixtureTalkDetail(
    world.bucket,
    actor(lee),
    created.talk_id,
    world.sites,
    world.people,
    world.assignments,
    world.access,
    () => null
  );
  assert.equal(hidden?.register, null);
});

test('a presenter sees only their own signature image', () => {
  const world = gang();
  const owner = actor(world.owner, 'auth-owner');
  const sam = world.lads[0];
  const lee = world.lads[1];
  const nia = world.lads[2];
  const rio = world.lads[3];
  if (!sam || !lee || !nia || !rio) throw new Error('missing gang');
  const created = fixtureCreateTalk(
    world.bucket,
    owner,
    {
      siteId: world.site.id,
      kind: 'toolbox',
      delivery: 'in_person',
      title: 'Fire exits',
      body: 'Walk to the gate.',
      pdfPath: null,
      audience: 'all',
      personIds: [],
      presenterPersonId: 'lad-1',
      presenterRole: 'Operative',
      presentedAt: new Date().toISOString(),
    },
    world.sites,
    world.people,
    world.assignments,
    world.access
  );
  fixtureSignPresenter(
    world.bucket,
    actor(sam),
    {
      talkId: created.talk_id,
      versionId: created.version_id,
      signaturePng: png,
      deviceAt: new Date().toISOString(),
      sessionId: session,
    },
    world.sites,
    world.people,
    world.access
  );
  sign(world, actor(sam), lee.id, created.talk_id, created.version_id);
  sign(world, owner, nia.id, created.talk_id, created.version_id);
  fixtureAskTalk(
    world.bucket,
    actor(sam),
    {
      talkId: created.talk_id,
      versionId: created.version_id,
      personId: lee.id,
      body: 'Where is the muster point?',
      deviceAt: new Date().toISOString(),
      sessionId: session,
    },
    world.sites,
    world.people,
    world.assignments,
    world.access
  );
  const detail = fixtureTalkDetail(
    world.bucket,
    actor(sam),
    created.talk_id,
    world.sites,
    world.people,
    world.assignments,
    world.access,
    () => null
  );
  const signed = detail?.register?.signed ?? [];
  assert.equal(detail?.register?.presenter_signature?.signature_png, png);
  assert.equal(signed.find((row) => row.person_id === lee.id)?.person_name, 'Lee Costa');
  assert.equal(signed.find((row) => row.person_id === lee.id)?.signature_png, null);
  assert.equal(signed.find((row) => row.person_id === lee.id)?.session_id, null);
  assert.equal(signed.find((row) => row.person_id === lee.id)?.captured_by, null);
  assert.equal(signed.find((row) => row.person_id === lee.id)?.question, null);
  assert.equal(signed.find((row) => row.person_id === lee.id)?.has_question, true);
  assert.ok(signed.find((row) => row.person_id === lee.id)?.received_at);
  assert.equal(signed.find((row) => row.person_id === nia.id)?.signature_png, null);
  assert.equal(signed.filter((row) => row.signature_png).length, 0);
  assert.equal(detail?.register?.questions.length, 0);
  const manager = fixtureTalkDetail(
    world.bucket,
    owner,
    created.talk_id,
    world.sites,
    world.people,
    world.assignments,
    world.access,
    () => null
  );
  assert.equal(manager?.register?.signed.filter((row) => row.signature_png === png).length, 2);
  assert.equal(manager?.register?.signed.find((row) => row.person_id === lee.id)?.question, 'Where is the muster point?');
  assert.equal(manager?.register?.signed.find((row) => row.person_id === lee.id)?.session_id, session);
  assert.equal(manager?.register?.presenter_signature?.signature_png, png);
  const other = fixtureTalkDetail(
    world.bucket,
    actor(rio),
    created.talk_id,
    world.sites,
    world.people,
    world.assignments,
    world.access,
    () => null
  );
  assert.equal(other?.register, null);
});

test('revising the words keeps the current PDF, and a used path is rejected', () => {
  const world = gang();
  const owner = actor(world.owner, 'auth-owner');
  const file = `${world.company}/${world.site.id}/talks/brief.pdf`;
  const created = fixtureCreateTalk(
    world.bucket,
    owner,
    {
      siteId: world.site.id,
      kind: 'toolbox',
      delivery: 'phone',
      title: 'Fire exits',
      body: 'Walk to the gate.',
      pdfPath: file,
      audience: 'all',
      personIds: [],
      presenterPersonId: world.owner.id,
      presenterRole: 'Owner',
      presentedAt: new Date().toISOString(),
    },
    world.sites,
    world.people,
    world.assignments,
    world.access
  );
  const revised = fixtureReviseTalk(
    world.bucket,
    owner,
    created.talk_id,
    { title: 'Fire exits', body: 'Muster by the cabin.', pdfPath: null },
    world.sites,
    world.access
  );
  assert.equal(revised.version_no, 2);
  assert.equal(world.bucket.versions.find((row) => row.id === revised.version_id)?.pdf_path, file);
  const kept = fixtureReviseTalk(
    world.bucket,
    owner,
    created.talk_id,
    { title: 'Fire exits', body: 'An empty path keeps the file.', pdfPath: '' },
    world.sites,
    world.access
  );
  assert.equal(world.bucket.versions.find((row) => row.id === kept.version_id)?.pdf_path, file);
  const next = `${world.company}/${world.site.id}/talks/next.pdf`;
  const replaced = fixtureReviseTalk(
    world.bucket,
    owner,
    created.talk_id,
    { title: 'Fire exits', body: 'Read the new file.', pdfPath: next },
    world.sites,
    world.access
  );
  assert.equal(world.bucket.versions.find((row) => row.id === replaced.version_id)?.pdf_path, next);
  assert.throws(
    () =>
      fixtureReviseTalk(
        world.bucket,
        owner,
        created.talk_id,
        { title: 'Fire exits', body: 'Nope.', pdfPath: file },
        world.sites,
        world.access
      ),
    /invalid_path/
  );
});

test('a presenter role with a line break or a spreadsheet formula is rejected', () => {
  assert.throws(() => talkPlain('Site\nlead'), /invalid_input/);
  assert.throws(() => talkPlain('Site\rlead'), /invalid_input/);
  assert.throws(() => talkPlain('=HYPERLINK("x")\r'), /invalid_input/);
  assert.throws(() => talkPlain('Lead\u0085'), /invalid_input/);
  assert.throws(() => talkPlain('Lead\u2028'), /invalid_input/);
  assert.throws(() => talkPlain('Lead\u202e'), /invalid_input/);
  assert.equal(talkPlain('Site lead'), 'Site lead');
});

test('a talk file path stays inside company/site/talks', () => {
  const company = '11111111-1111-4111-8111-111111111111';
  const site = '66666666-6666-4666-8666-666666666666';
  assert.throws(() => talkStoragePath(company, site, `/${company}/${site}/talks/brief.pdf`), /invalid_path/);
  assert.throws(() => talkStoragePath(company, site, `${company}/../${site}/talks/brief.pdf`), /invalid_path/);
  assert.throws(() => talkStoragePath(company, site, `${company}/${site}/drawings/brief.pdf`), /invalid_path/);
  assert.equal(
    talkStoragePath(company, site, `${company.toUpperCase()}/${site}/talks/brief.pdf`),
    `${company}/${site}/talks/brief.pdf`
  );
});

test('a presenter who is not assigned to the site is rejected', () => {
  const world = gang();
  const owner = actor(world.owner, 'auth-owner');
  const visitor: TalkPerson = { id: 'visitor-1', role: 'operative', company_id: world.company, display_name: 'Pat Cole' };
  assert.throws(
    () =>
      fixtureCreateTalk(
        world.bucket,
        owner,
        {
          siteId: world.site.id,
          kind: 'toolbox',
          delivery: 'phone',
          title: 'Fire exits',
          body: 'Walk to the gate.',
          pdfPath: null,
          audience: 'all',
          personIds: [],
          presenterPersonId: visitor.id,
          presenterRole: 'Operative',
          presentedAt: new Date().toISOString(),
        },
        world.sites,
        [...world.people, visitor],
        world.assignments,
        world.access
      ),
    /invalid_input/
  );
});

test('a signer who renames after signing keeps the signed name, identifier, and a rename flag', async () => {
  const world = gang();
  const owner = actor(world.owner, 'auth-owner');
  const sam = world.lads[0];
  const lee = world.lads[1];
  if (!sam || !lee) throw new Error('missing gang');
  const created = fixtureCreateTalk(
    world.bucket,
    owner,
    {
      siteId: world.site.id,
      kind: 'toolbox',
      delivery: 'in_person',
      title: 'Fire exits',
      body: 'Walk to the gate.',
      pdfPath: null,
      audience: 'all',
      personIds: [],
      presenterPersonId: sam.id,
      presenterRole: 'Operative',
      presentedAt: new Date().toISOString(),
    },
    world.sites,
    world.people,
    world.assignments,
    world.access
  );
  sign(world, actor(sam), sam.id, created.talk_id, created.version_id);
  sam.display_name = lee.display_name;
  const detail = fixtureTalkDetail(
    world.bucket,
    owner,
    created.talk_id,
    world.sites,
    world.people,
    world.assignments,
    world.access,
    () => null
  );
  const row = detail?.register?.signed.find((item) => item.person_id === sam.id);
  assert.equal(row?.person_name, 'Sam Reed');
  assert.equal(row?.person_ref, sam.id.slice(0, 6));
  assert.equal(row?.name_changed, true);
  assert.notEqual(row?.person_id, lee.id);
  const { buildTalkPdf } = await import('../lib/talkPdf.ts');
  const { decodedPdfText } = await import('../lib/pdfDecode.ts');
  const { bytes } = await buildTalkPdf({
    companyName: 'Ashfield Finishes',
    siteName: world.site.name,
    title: 'Fire exits',
    kind: 'toolbox',
    delivery: 'in_person',
    versionNo: 1,
    presenterName: 'Sam Reed',
    presenterRole: 'Operative',
    presentedAt: created.content_hash ? new Date().toISOString() : new Date().toISOString(),
    notSigned: [],
    signed: [
      {
        name: row?.person_name ?? '',
        personRef: row?.person_ref,
        nameChanged: row?.name_changed,
        hasQuestion: false,
        question: null,
        explained: false,
        interpreter: false,
        receivedAt: row?.received_at ?? new Date().toISOString(),
        meaning: row?.meaning ?? '',
        signaturePng: null,
        sharedDevice: false,
      },
    ],
    presenterSignature: null,
  });
  const text = decodedPdfText(bytes);
  assert.match(text, /Sam Reed · lad-1/);
  assert.match(text, /name changed since signing/);
  assert.equal(text.includes('Lee Costa'), false);
});

test('a joiner sees the induction, sign-in is not blocked, and the manager sees the gap', async () => {
  resetFixtureStore();
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  const created = await fixtureRepo.createTalk({
    siteId: IDS.oak,
    kind: 'induction',
    delivery: 'phone',
    title: 'Site induction',
    body: 'Muster by the cabin.',
    pdfPath: null,
    audience: 'all',
    personIds: [],
    presenterPersonId: IDS.owner,
    presenterRole: 'Owner',
    presentedAt: new Date().toISOString(),
  });
  const code = await fixtureRepo.createJoinCode({ siteId: IDS.oak, label: 'Oak', maxUses: 2, hours: 4 });
  const joined = await fixtureRepo.joinWithCode({
    code: code.code,
    displayName: 'Sam Reed',
    trade: 'fixer',
    username: 'samreed65',
    password: 'fixer123',
  });
  assert.equal(joined.siteId, IDS.oak);
  const outstanding = await fixtureRepo.myOutstandingTalks();
  assert.equal(outstanding.some((row) => row.talk_id === created.talk_id), true);
  const signedIn = await fixtureRepo.signInSite(IDS.oak, new Date().toISOString());
  assert.equal(signedIn.person_id, joined.person.id);
  assert.equal(await fixtureRepo.inductionSignInGaps(IDS.oak), null);
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  await assert.rejects(
    () =>
      fixtureRepo.signTalk({
        talkId: created.talk_id,
        versionId: created.version_id,
        personId: IDS.ben,
        signaturePng: png,
        deviceAt: new Date().toISOString(),
        sessionId: session,
      }),
    /not_authorized/
  );
  await fixtureRepo.signInSite(IDS.oak, new Date().toISOString());
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  const gaps = await fixtureRepo.inductionSignInGaps(IDS.oak);
  assert.ok(gaps);
  assert.equal(gaps.some((row) => row.person_name === 'Sam Reed'), true);
  assert.equal(gaps.some((row) => row.person_name === 'Amy Keane'), true);
  await fixtureRepo.askTalk({
    talkId: created.talk_id,
    versionId: created.version_id,
    personId: IDS.amy,
    body: 'Which gate?',
    deviceAt: new Date().toISOString(),
    sessionId: session,
  });
  const badges = await fixtureRepo.myTalkBadges();
  assert.ok((badges.find((row) => row.site_id === IDS.oak)?.questions ?? 0) >= 1);
  const detail = await fixtureRepo.getTalk(created.talk_id);
  assert.equal(detail?.register?.not_signed.some((row) => row.person_name === 'Amy Keane' && row.has_question), true);
});

test('talk copy and the register do not say compliant', () => {
  const files = [
    'components/TalkRows.tsx',
    'lib/talkMeaning.ts',
    'lib/talkPdf.ts',
    'lib/talkQueue.ts',
    'lib/talkSync.ts',
    'data/talks.ts',
    'data/fixtureTalks.ts',
    'supabase/migrations/20261022190000_inductions.sql',
  ];
  const talks = 'app/(app)/sites/[siteId]/talks';
  for (const name of fs.readdirSync(talks, { recursive: true })) {
    const full = path.join(talks, String(name));
    if (fs.statSync(full).isFile() && full.endsWith('.tsx')) files.push(full);
  }
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    assert.equal(/compliant/i.test(text), false, file);
    assert.equal(/\bRAMS\b/.test(text), false, file);
    assert.equal(/template library/i.test(text), false, file);
  }
  const sign = fs.readFileSync('app/(app)/sites/[siteId]/talks/[talkId]/sign.tsx', 'utf8');
  assert.match(sign, /userId: person\.auth_user_id/);
  assert.match(sign, /signerPersonId: signerId/);
  assert.match(sign, /I have a question/);
  assert.doesNotMatch(sign, /select all|batch/i);
  const home = fs.readFileSync('app/(app)/sites/index.tsx', 'utf8');
  assert.match(home, /TalkReadRow/);
  assert.match(home, /TalkQuestionRow/);
  fixtureForceOffline(true);
  assert.equal(isFixtureOffline(), true);
  fixtureForceOffline(false);
  assert.equal(isFixtureOffline(), false);
});
