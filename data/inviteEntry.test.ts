import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  COPY_FAILED_TEXT,
  COPIED_CONFIRMATION_MS,
  SHARE_FAILED_TEXT,
  copyJoinLink,
  inviteActionsForRole,
  inviteSiteChoice,
  inviteSitesFromPulse,
  joinCodeLink,
  openJoinWhatsApp,
  showShareAction,
  whatsAppJoinMessage,
  whatsAppShareUrl,
} from './inviteEntry.ts';
import { canManageSite } from './repo.ts';

test('join-code routing is none, one, or several, and archived sites are excluded', () => {
  const archived = { id: 'old', name: 'Old yard', archived_at: '2026-01-01T00:00:00.000Z' };
  const oak = { id: 'oak', name: 'Oak', archived_at: null };
  const river = { id: 'river', name: 'Riverside', archived_at: null };
  const yard = { id: 'yard', name: 'North yard', archived_at: null };

  assert.deepEqual(inviteSiteChoice([]), { kind: 'none' });
  assert.deepEqual(inviteSiteChoice([archived]), { kind: 'none' });
  assert.deepEqual(inviteSiteChoice([archived, oak]), { kind: 'one', site: oak });
  assert.deepEqual(inviteSiteChoice([oak, archived, river]), { kind: 'many', sites: [oak, river] });
  assert.equal(inviteSiteChoice([oak, river, yard]).kind, 'many');

  const fromPulse = inviteSitesFromPulse([
    { site_id: 'oak', name: 'Oak', archived_at: null },
    { site_id: 'old', name: 'Old yard', archived_at: '2026-01-01T00:00:00.000Z' },
  ]);
  assert.deepEqual(inviteSiteChoice(fromPulse), { kind: 'one', site: fromPulse[0] });
});

test('the WhatsApp URL encodes newlines, ampersands, and the join link', () => {
  const message = whatsAppJoinMessage({ site: 'Oak & Yard\nNorth', code: 'K7QM-4XPR' });
  const url = whatsAppShareUrl(message);
  assert.equal(message.includes('\n'), true);
  assert.equal(message.includes('&'), true);
  assert.equal(
    whatsAppJoinMessage({ site: 'Morpeth', code: 'K7QM-4XPR' }),
    'Join Morpeth on SitePack to see the drawings: https://sitepack-preview.vercel.app/join/K7QM4XPR  Code: K7QM-4XPR',
  );
  assert.equal(url, `https://wa.me/?text=${encodeURIComponent(message)}`);
  assert.equal(url.startsWith('https://wa.me/?text='), true);
  assert.equal(url.includes('\n'), false);
  assert.equal(url.includes('Oak & Yard'), false);
  assert.match(url, /%0A/);
  assert.match(url, /%26/);
  assert.match(url, /https%3A%2F%2Fsitepack-preview\.vercel\.app%2Fjoin%2FK7QM4XPR/);
  assert.equal(url.includes('https://sitepack-preview.vercel.app/join/'), false);
  assert.equal(decodeURIComponent(url.slice('https://wa.me/?text='.length)), message);
  assert.equal(joinCodeLink('k7qm-4xpr'), 'https://sitepack-preview.vercel.app/join/K7QM4XPR');
});

test('web opens WhatsApp in a new tab and native uses openURL', async () => {
  let opened = '';
  let linked = '';
  await openJoinWhatsApp('https://wa.me/?text=hi%0A', 'web', {
    openWindow: (url) => {
      opened = url;
      return true;
    },
    openURL: async (url) => {
      linked = url;
    },
  });
  assert.equal(opened, 'https://wa.me/?text=hi%0A');
  assert.equal(linked, '');

  await openJoinWhatsApp('https://wa.me/?text=blocked', 'web', {
    openWindow: () => false,
    openURL: async (url) => {
      linked = url;
    },
  });
  assert.equal(linked, 'https://wa.me/?text=blocked');

  linked = '';
  await openJoinWhatsApp('https://wa.me/?text=native', 'native', {
    openWindow: () => {
      throw new Error('native must not use window.open');
    },
    openURL: async (url) => {
      linked = url;
    },
  });
  assert.equal(linked, 'https://wa.me/?text=native');
});

test('copy puts the join link on the clipboard and falls back on the web', async () => {
  const link = joinCodeLink('K7QM-4XPR');
  let written = '';
  await copyJoinLink(link, {
    setString: async () => false,
    writeText: async (value) => {
      written = value;
    },
  });
  assert.equal(written, 'https://sitepack-preview.vercel.app/join/K7QM4XPR');

  written = '';
  await copyJoinLink(link, {
    setString: async () => {
      throw new Error('denied');
    },
    writeText: async (value) => {
      written = value;
    },
  });
  assert.equal(written, link);

  let viaModule = '';
  await copyJoinLink(link, {
    setString: async (value) => {
      viaModule = value;
      return true;
    },
    writeText: async () => {
      throw new Error('web fallback must not run when the module succeeds');
    },
  });
  assert.equal(viaModule, link);
  await assert.rejects(() => copyJoinLink(link, { setString: async () => false }), /copy_failed/);
});

test('operatives never see the invite buttons', () => {
  assert.equal(inviteActionsForRole('operative'), false);
  assert.equal(inviteActionsForRole(null), false);
  assert.equal(inviteActionsForRole(undefined), false);
  assert.equal(inviteActionsForRole('owner'), true);
  assert.equal(inviteActionsForRole('cm'), true);
  assert.equal(showShareAction('web', false), false);
  assert.equal(showShareAction('web', true), true);
  assert.equal(showShareAction('native', false), true);

  const sites = fs.readFileSync(new URL('../app/(app)/sites/index.tsx', import.meta.url), 'utf8');
  const operativeStart = sites.indexOf('if (!manager)');
  const managerReturn = sites.lastIndexOf('return (');
  const operativeBlock = sites.slice(operativeStart, managerReturn);
  assert.equal(operativeStart > 0 && managerReturn > operativeStart, true);
  assert.doesNotMatch(operativeBlock, /Invite to a site|Invite by email|Create code|JoinSharePanel/);
  assert.doesNotMatch(sites, /Invite to a site|Invite by email|Create code|JoinSharePanel/);
  assert.match(sites, /canManageSite/);

  const invite = fs.readFileSync(new URL('../app/(app)/invite.tsx', import.meta.url), 'utf8');
  assert.match(invite, /canManageSite/);
  assert.match(invite, /Redirect href="\/sites"/);
  assert.match(invite, /JoinSharePanel/);
  assert.match(invite, /Invite by email instead/);
  assert.match(invite, /Make a site first/);
  assert.doesNotMatch(invite, /console\.(log|debug|info|warn)/);

  const site = fs.readFileSync(new URL('../app/(app)/sites/[siteId]/index.tsx', import.meta.url), 'utf8');
  assert.equal(site.includes('Invite to this site'), false);
  assert.equal(site.includes('Who joined'), false);
  assert.match(site, /label="People"/);
  const people = fs.readFileSync(new URL('../app/(app)/sites/[siteId]/people.tsx', import.meta.url), 'utf8');
  assert.match(people, /\{manage \? \([\s\S]*Invite to this site/);
  assert.doesNotMatch(people.slice(0, people.indexOf('const manage')), /Invite to this site/);

  const panel = fs.readFileSync(new URL('../components/JoinSharePanel.tsx', import.meta.url), 'utf8');
  const whatsAppAt = panel.indexOf('Share on WhatsApp');
  const shareAt = panel.indexOf('Share…');
  const copyAt = panel.indexOf('Copy link');
  assert.equal(whatsAppAt > 0 && shareAt > whatsAppAt && copyAt > shareAt, true);
  assert.match(panel, /minHeight: 56/);
  assert.match(panel, /minHeight=\{48\}/);
  assert.match(panel, /whatsAppShareUrl/);
  assert.match(panel, /Copied/);
  assert.match(panel, /SHARE_FAILED_TEXT/);
  assert.doesNotMatch(panel, /console\.(log|debug|info|warn)/);
  assert.doesNotMatch(panel, /analytics/);
  assert.equal(SHARE_FAILED_TEXT.includes('Copy the message below'), false);
  assert.equal(COPY_FAILED_TEXT, 'Could not copy the link.');
  assert.equal(COPIED_CONFIRMATION_MS, 2000);

  const perSite = fs.readFileSync(new URL('../app/(app)/sites/[siteId]/invite-code.tsx', import.meta.url), 'utf8');
  assert.match(perSite, /JoinSharePanel/);
  assert.match(perSite, /createJoinCode[\s\S]*revokeJoinCode\(row\.id\)/);
  assert.match(perSite, /canManageSite/);
  assert.doesNotMatch(perSite, /Copy the message below/);
  assert.doesNotMatch(perSite, /console\.(log|debug|info|warn)/);
});

test('Home has no invite controls, and People opens /invite for owners and CMs only', () => {
  assert.equal(canManageSite('owner'), true);
  assert.equal(canManageSite('cm'), true);
  assert.equal(canManageSite('operative'), false);

  const home = fs.readFileSync(new URL('../app/(app)/home.tsx', import.meta.url), 'utf8');
  const sites = fs.readFileSync(new URL('../app/(app)/sites/index.tsx', import.meta.url), 'utf8');
  const inviteControls = /Invite to a site|Invite by email|label="Invite"|Create code|JoinSharePanel|invite-code/;
  assert.doesNotMatch(home, inviteControls);
  assert.doesNotMatch(sites, inviteControls);
  assert.match(sites, /label="Create site"/);
  assert.match(sites, /label="Sign out"/);

  const people = fs.readFileSync(new URL('../app/(app)/people.tsx', import.meta.url), 'utf8');
  const titleAt = people.lastIndexOf('<Title>People</Title>');
  const groupsAt = people.indexOf('href="/groups"', titleAt);
  const top = people.slice(titleAt, groupsAt);
  assert.equal(titleAt > 0 && groupsAt > titleAt, true);
  assert.match(top, /canManageSite\(person\.role\)/);
  assert.match(top, /label="Invite"/);
  assert.match(top, /minHeight=\{56\}/);
  assert.match(top, /router\.push\('\/invite'\)/);
  assert.doesNotMatch(top, /variant=/);

  const redirectAt = people.indexOf("if (person?.role === 'operative') return <Redirect href=\"/sites\" />");
  assert.equal(redirectAt > 0 && redirectAt < titleAt, true);
  assert.doesNotMatch(people.slice(0, redirectAt), /router\.push\('\/invite'\)/);
  assert.equal(people.match(/router\.push\('\/invite'\)/g)?.length, 1);
});
