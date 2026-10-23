import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SHARE_COMPANY_PLACEHOLDER,
  SHARE_SECTION_DEFAULTS,
  accessRemovedMessage,
  classifyShareFailure,
  droppedSharedSiteIds,
  forgetSharedSiteStorage,
  rememberSharedSiteIds,
  pendingInviteLabel,
  pendingShareInvites,
  pendingShareRequestLabel,
  shareCompanyKey,
  shareRenameNote,
  shareFailureNotice,
  shareFailureRetries,
  shareInviteText,
  shareWebOrigin,
  sharedSectionLine,
  stopSharingBody,
  withShareRetry,
} from './sharing.ts';
import {
  fixtureListSiteShares,
  fixtureRevokeSiteShareInvite,
  fixtureSharedDrawings,
  fixtureSharedInductions,
  fixtureSharedSignIn,
  fixtureSharedSiteView,
  fixtureSharedSnags,
  HARBOUR_SITE_ID,
  resetShareFixture,
  SECTION_ERROR_SITE_ID,
} from './shareFixture.ts';
import { IDS } from './ids.ts';
import fs from 'node:fs';

test('sections start off and the company placeholder names an example firm', () => {
  assert.deepEqual(SHARE_SECTION_DEFAULTS, {
    drawings: false,
    variations: false,
    snags: false,
    sign_in: false,
    inductions: false,
  });
  assert.equal(SHARE_COMPANY_PLACEHOLDER, 'e.g. Kerr Construction');
  assert.equal(SHARE_COMPANY_PLACEHOLDER.includes('[company]'), false);
});

test('a company key collapses spaces and lower-cases the name', () => {
  assert.equal(shareCompanyKey('  Firm   Y '), 'firm y');
  assert.equal(shareCompanyKey('  FIRM   y '), 'firm y');
  assert.equal(shareCompanyKey('  FIRM   y '), shareCompanyKey('Firm Y'));
  assert.notEqual(shareCompanyKey('Firm Y'), shareCompanyKey('Firm YY'));
  assert.notEqual(shareCompanyKey('Firm Y'), shareCompanyKey('Firm Z'));
});

test('an unused code can be cancelled and a used one cannot', () => {
  resetShareFixture();
  const now = Date.parse('2026-10-23T12:00:00.000Z');
  const pending = pendingShareInvites(fixtureListSiteShares(IDS.oak).invites);
  assert.equal(pending.length, 2);
  const unused = pending.find((row) => row.guest_company_name === 'Main Contractor Ltd');
  const expired = pending.find((row) => row.guest_company_name === 'Old Contractor Ltd');
  assert.ok(unused);
  assert.ok(expired);
  assert.match(pendingInviteLabel(unused, now), /^Unused/);
  assert.match(pendingInviteLabel(expired, now), /^Expired/);
  assert.match(pendingInviteLabel(unused, now), /Cancel it if you do not want it opened/);
  fixtureRevokeSiteShareInvite(unused.id);
  const left = pendingShareInvites(fixtureListSiteShares(IDS.oak).invites);
  assert.equal(left.length, 1);
  assert.equal(left[0]?.guest_company_name, 'Old Contractor Ltd');
  assert.throws(() => fixtureRevokeSiteShareInvite(unused.id), /not_authorized/);
});

test('a guest snag list shows the company and not the operative name', () => {
  const snags = fixtureSharedSnags(HARBOUR_SITE_ID);
  assert.equal(snags[0]?.raised_by_company, 'Host Build Ltd');
  assert.equal(snags[0]?.fixed_by_company, 'Northbuild');
  const packed = JSON.stringify(snags);
  assert.equal(packed.includes('Łukasz'), false);
  assert.equal(packed.includes('raised_by_name'), false);
  assert.equal(packed.includes('fixed_by_name'), false);
  assert.equal(packed.includes('person_id'), false);
});

test('a guest view includes the sign-in and induction registers without contact details', () => {
  const view = fixtureSharedSiteView(HARBOUR_SITE_ID);
  assert.equal(view.sections.sign_in, true);
  assert.equal(view.sections.inductions, true);
  const signIn = fixtureSharedSignIn(HARBOUR_SITE_ID);
  const inductions = fixtureSharedInductions(HARBOUR_SITE_ID);
  assert.equal(signIn[0]?.person_name, 'Łukasz Wójcik');
  assert.equal(signIn[0]?.company_name, 'Host Build Ltd');
  assert.equal('id' in (signIn[0] ?? {}), false);
  assert.equal(inductions[0]?.person_name, 'Łukasz Wójcik');
  assert.equal(inductions[0]?.company_name, 'Host Build Ltd');
  assert.equal(inductions[0]?.status, 'Signed');
  assert.equal('title' in (inductions[0] ?? {}), false);
  assert.equal('meaning' in (inductions[0] ?? {}), false);
  assert.equal('id' in (inductions[0] ?? {}), false);
  assert.equal('talk_id' in (inductions[0] ?? {}), false);
  const packed = JSON.stringify({ signIn, inductions, view });
  assert.equal(packed.includes('@'), false);
  assert.equal(packed.includes('0700'), false);
  assert.equal(packed.includes('person_id'), false);
  assert.equal(packed.includes('username'), false);
  assert.equal(fixtureSharedSiteView(SECTION_ERROR_SITE_ID).sections.drawings, true);
  assert.throws(() => fixtureSharedDrawings(SECTION_ERROR_SITE_ID), /Failed to fetch/);
});

test('the share screens show pending codes, both registers, a section retry, and one header', () => {
  const share = fs.readFileSync('app/(app)/sites/[siteId]/share.tsx', 'utf8');
  const shared = fs.readFileSync('app/(app)/sites/[siteId]/shared.tsx', 'utf8');
  const layout = fs.readFileSync('app/share/_layout.tsx', 'utf8');
  assert.match(share, /revokeSiteShareInvite/);
  assert.match(share, /Cancel code/);
  assert.match(share, /PENDING CODES/);
  assert.match(share, /pendingInviteLabel/);
  assert.match(share, /formatUkDateTime\(invite\.expires_at\)/);
  assert.match(share, /pendingShareRequestLabel/);
  assert.match(share, /WHO HAS ACCESS/);
  assert.match(share, /label="Approve"/);
  assert.match(share, /label="Decline"/);
  assert.match(share, /minHeight=\{56\}/);
  assert.match(share, /sharedSectionLine/);
  assert.match(share, /label="New share code"/);
  assert.match(share, /label="Stop sharing"/);
  assert.match(share, /stopSharingBody/);
  assert.match(share, /SHARE_COMPANY_PLACEHOLDER/);
  const openShare = fs.readFileSync('components/open-share-screen.tsx', 'utf8');
  assert.match(openShare, /history\.replaceState/);
  assert.match(openShare, /publicCodePath/);
  assert.match(openShare, /router\.replace\('\/share'\)/);
  assert.match(shared, /key=\{`\$\{row\.person_name\}\|\$\{row\.received_at\}`\}/);
  assert.equal(shared.includes('row.meaning'), false);
  assert.match(shared, /key=\{`\$\{row\.person_name\}\|\$\{row\.in_at\}`\}/);
  assert.equal(shared.includes('${row.talk_id}-${row.person_name}'), false);
  assert.equal(shared.includes('raised_by_name'), false);
  assert.equal(shared.includes('fixed_by_name'), false);
  assert.match(shared, /Raised by \$\{row\.raised_by_company/);
  assert.match(shared, /Fixed by \$\{row\.fixed_by_company\}/);
  assert.match(shared, /SIGN-IN/);
  assert.match(shared, /INDUCTIONS/);
  assert.match(shared, /label="Retry"/);
  assert.match(shared, /Shared by \$\{view\.host_company_name\}, view only/);
  assert.match(shared, /Trying again…/);
  assert.match(shared, /Still not loading, check signal/);
  const sites = fs.readFileSync('app/(app)/sites/index.tsx', 'utf8');
  assert.match(sites, />\s*Shared\s*</);
  assert.match(sites, /Their contracts manager:/);
  assert.match(openShare, /shared by \$\{preview\.host_company_name\}/);
  assert.match(openShare, /sharedSectionLine/);
  const notice = fs.readFileSync('components/ui.tsx', 'utf8');
  const reject = notice.slice(notice.indexOf('export function SeenRejectNotice'), notice.indexOf('export function GlanceRow'));
  assert.match(reject, /if \(!onDismiss\)/);
  assert.match(reject, /<View style=\{styles\.seenReject\}>/);
  assert.equal(shared.includes('.catch(() => [])'), false);
  assert.match(layout, /headerShown: false/);
  assert.equal(layout.includes("title: 'Open a share'"), false);
});

test('network, 408, 429, and 5xx retry, and a business code becomes a notice', async () => {
  assert.equal(shareFailureRetries(classifyShareFailure(new TypeError('Failed to fetch'))), true);
  assert.equal(shareFailureRetries(classifyShareFailure({ status: 408, message: 'timeout' })), true);
  assert.equal(shareFailureRetries(classifyShareFailure({ status: 429, message: 'slow down' })), true);
  assert.equal(shareFailureRetries(classifyShareFailure({ status: 503, message: 'down' })), true);
  const revoked = classifyShareFailure(new Error('share_revoked'));
  assert.deepEqual(revoked, { kind: 'business', code: 'share_revoked' });
  assert.equal(shareFailureRetries(revoked), false);
  assert.equal(shareFailureNotice(revoked), accessRemovedMessage());
  const same = 'That code could not be used.';
  for (const code of ['other_firm', 'code_used', 'code_expired', 'code_revoked', 'invalid_input', 'already_shared']) {
    assert.equal(shareFailureNotice(classifyShareFailure(new Error(code))), same);
  }
  assert.match(shareFailureNotice(classifyShareFailure(new Error('not_allowed'))), /owner or contracts manager/);
  assert.match(shareFailureNotice(classifyShareFailure(new Error('too_many_attempts'))), /Wait an hour/);
  assert.equal(shareFailureRetries(classifyShareFailure({ status: 400, message: 'bad' })), false);

  let calls = 0;
  const value = await withShareRetry(async () => {
    calls += 1;
    if (calls < 3) throw new TypeError('Failed to fetch');
    return 'ok';
  });
  assert.equal(value, 'ok');
  assert.equal(calls, 3);
  await assert.rejects(
    () => withShareRetry(async () => Promise.reject(new Error('code_used'))),
    /code_used/
  );
});

test('a pending approval names the pinned firm and flags a later rename', () => {
  const label = pendingShareRequestLabel({
    guest_company_name: 'Firm Z',
    redeemer_name: 'Owner Z',
    redeemer_email: 'ownerz@firmz.test',
    site_name: 'Plot 12 – Oak Estate',
  });
  assert.equal(label, 'Firm Z (Owner Z, ownerz@firmz.test) wants to see Plot 12 – Oak Estate');
  assert.equal(shareRenameNote({ renamed: false, current_company_name: 'Firm Z' }), null);
  assert.match(shareRenameNote({ renamed: true, current_company_name: 'Firm Z Renamed' }) ?? '', /Firm Z Renamed/);
});

test('a share link names the sections and uses the configured origin', () => {
  const sections = { ...SHARE_SECTION_DEFAULTS, drawings: true, snags: true };
  const text = shareInviteText({
    company: 'Northbuild',
    site: 'Harbour Point',
    code: 'ABCD2345',
    sections,
    origin: 'https://links.example',
  });
  assert.match(text, /Northbuild/);
  assert.match(text, /Harbour Point/);
  assert.match(text, /https:\/\/links\.example\/share\/ABCD2345/);
  assert.match(text, /ABCD-2345/);
  assert.equal(sharedSectionLine(sections), 'They will see: Drawings, Snags report');
  assert.match(text, /They will see: Drawings, Snags report/);
  assert.match(stopSharingBody(sections), /They will lose: Drawings, Snags report/);
  const source = fs.readFileSync('data/sharing.ts', 'utf8');
  assert.equal(source.includes('sitepack-preview.vercel.app'), false);
  assert.match(fs.readFileSync('app.json', 'utf8'), /"webOrigin": "https:\/\/sitepack-preview\.vercel\.app"/);
  const previous = process.env.EXPO_PUBLIC_WEB_ORIGIN;
  delete process.env.EXPO_PUBLIC_WEB_ORIGIN;
  try {
    assert.equal(shareWebOrigin(), 'https://sitepack-preview.vercel.app');
    process.env.EXPO_PUBLIC_WEB_ORIGIN = 'https://from-env.example/';
    assert.equal(shareWebOrigin(), 'https://from-env.example');
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_WEB_ORIGIN;
    else process.env.EXPO_PUBLIC_WEB_ORIGIN = previous;
  }
});

test('dropping a shared site wipes that site only', () => {
  const saved = new Map<string, string>();
  const storage = {
    get length() {
      return saved.size;
    },
    key(index: number) {
      return [...saved.keys()][index] ?? null;
    },
    getItem(key: string) {
      return saved.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      saved.set(key, value);
    },
    removeItem(key: string) {
      saved.delete(key);
    },
  };
  saved.set(
    'sitepack.offline.sites',
    JSON.stringify([
      { id: 'site-a', name: 'A' },
      { id: 'site-b', name: 'B' },
    ])
  );
  saved.set('sitepack.offline.pack.site-a', '{"siteId":"site-a"}');
  saved.set('sitepack.offline.pack.site-b', '{"siteId":"site-b"}');
  saved.set(
    'sitepack.snag.queue',
    JSON.stringify([
      { siteId: 'site-a', note: 'gone' },
      { siteId: 'site-b', note: 'stay' },
    ])
  );
  forgetSharedSiteStorage(storage, 'site-a');
  assert.equal(saved.has('sitepack.offline.pack.site-a'), false);
  assert.equal(saved.has('sitepack.offline.pack.site-b'), true);
  assert.deepEqual(JSON.parse(saved.get('sitepack.offline.sites') ?? '[]'), [{ id: 'site-b', name: 'B' }]);
  assert.deepEqual(JSON.parse(saved.get('sitepack.snag.queue') ?? '[]'), [{ siteId: 'site-b', note: 'stay' }]);
  assert.deepEqual(droppedSharedSiteIds(['site-a', 'site-b'], ['site-b']), ['site-a']);
  saved.set('sitepack.shared.ids', JSON.stringify(['site-a', 'site-b']));
  assert.deepEqual(rememberSharedSiteIds(storage, ['site-b']), ['site-a']);
  assert.deepEqual(JSON.parse(saved.get('sitepack.shared.ids') ?? '[]'), ['site-b']);
});
