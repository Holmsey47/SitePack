import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  FORBIDDEN_PROJECT_REFS,
  assertCompanyName,
  assertHostedArgs,
  assertInviteRedirect,
  assertLinkedRef,
  assertLiveProjectRef,
  assertNoFixtures,
  assertShaunEmail,
  configPushArgs,
  createProjectArgs,
  dbPushArgs,
  deployArgs,
  dollarQuote,
  inviteRedirect,
  ownerBootstrapSql,
  pickClientKey,
  pickOrgId,
  pickServiceKey,
  renderEnvLocal,
  resolveProjectRef,
} from './live-company.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const toml = fs.readFileSync(path.join(root, 'supabase/config.toml'), 'utf8');
const liveRef = 'abcdefghijabcdefghij';
const otherRef = [...FORBIDDEN_PROJECT_REFS][0];

test('refuses the existing hosted project', () => {
  assert.throws(() => assertLiveProjectRef(otherRef), /existing hosted project/);
  assert.throws(() => assertLinkedRef(otherRef, liveRef), /existing hosted project/);
  assert.throws(
    () => resolveProjectRef([{ id: otherRef, name: 'sitepack-live' }], otherRef),
    /existing hosted project/,
  );
});

test('only resolves a project named sitepack-live', () => {
  assert.equal(resolveProjectRef([{ id: liveRef, name: 'sitepack-live' }], ''), liveRef);
  assert.equal(resolveProjectRef([{ id: 'zzzzzzzzzzzzzzzzzzzz', name: 'Other' }], ''), null);
  assert.throws(
    () => resolveProjectRef([{ id: liveRef, name: 'Other' }], liveRef),
    /only touches sitepack-live/,
  );
});

test('rejects fixture identities for the owner', () => {
  assert.throws(() => assertShaunEmail('amy@sitepack.test'), /fixture/);
  assert.throws(() => assertShaunEmail('person@sitepack.test'), /fixture/);
  assert.equal(assertShaunEmail('Shaun@Example.com'), 'shaun@example.com');
  assert.throws(() => assertCompanyName('Ashfield Finishes'), /fixture company/);
});

test('hosted commands never load seed.sql', () => {
  const password = 'a-database-secret';
  const commands = [
    createProjectArgs({ orgId: 'org', region: 'eu-west-2', password }),
    configPushArgs(liveRef),
    dbPushArgs(password),
    deployArgs(liveRef),
  ];
  for (const args of commands) {
    assertHostedArgs(args);
    assert.equal(args.includes('--include-seed'), false);
    assert.equal(args.includes('seed'), false);
    assert.equal(args.includes('reset'), false);
    assert.equal(args.join(' ').includes('seed.sql'), false);
  }
  assert.throws(() => assertHostedArgs(['db', 'push', '--include-seed']), /seed\.sql/);
  assert.throws(() => assertHostedArgs(['db', 'reset']), /seed\.sql/);
  assert.throws(() => assertHostedArgs(['--project-ref', otherRef, 'db', 'push']), /existing hosted project/);
});

test('owner SQL is one company and one owner, with no fixture rows', () => {
  const sql = ownerBootstrapSql({
    userId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    email: 'shaun@example.com',
    displayName: 'Shaun',
    companyName: "Shaun's Drylining",
  });
  assert.match(sql, /'owner'/);
  assert.equal(sql.includes(';'), false);
  assert.doesNotMatch(sql, /sitepack\.test|Ashfield|Amy|seed\.sql|SitePack123|insert into public\.sites/i);
  assert.equal(dollarQuote("has $sp$ in it").includes('$spx$'), true);
});

test('stops when fixture rows are already present', () => {
  assert.doesNotThrow(() => assertNoFixtures([{ fixture_people: 0, fixture_companies: 0 }]));
  assert.throws(() => assertNoFixtures([{ fixture_people: 4, fixture_companies: 1 }]), /seed\.sql/);
  assert.throws(() => assertNoFixtures([{}]), /free of fixture rows/);
});

test('env file keeps the anon key and drops fixture mode', () => {
  const rendered = renderEnvLocal('EXPO_PUBLIC_USE_FIXTURES=1\nOTHER=1\n', {
    url: `https://${liveRef}.supabase.co`,
    anonKey: 'eyJ-anon',
  });
  assert.match(rendered, new RegExp(`EXPO_PUBLIC_SUPABASE_URL=https://${liveRef}\\.supabase\\.co`));
  assert.match(rendered, /EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ-anon/);
  assert.match(rendered, /OTHER=1/);
  assert.doesNotMatch(rendered, /USE_FIXTURES|service_role|sb_secret_|password/i);
  assert.throws(
    () => renderEnvLocal('', { url: `https://${otherRef}.supabase.co`, anonKey: 'eyJ-anon' }),
    /existing hosted project/,
  );
  assert.throws(
    () => renderEnvLocal('', { url: `https://${liveRef}.supabase.co`, anonKey: 'sb_secret_live' }),
    /secret key/,
  );
});

test('client key is the anon key, not the service role', () => {
  const keys = [
    { name: 'service_role', api_key: 'service-secret' },
    { name: 'anon', api_key: 'anon-public' },
  ];
  assert.equal(pickClientKey(keys), 'anon-public');
  assert.equal(pickServiceKey(keys), 'service-secret');
  assert.equal(pickOrgId([{ id: 'org-1' }], ''), 'org-1');
  assert.equal(pickOrgId([], 'org-explicit'), 'org-explicit');
});

test('invite redirect is the web set-password URL already allowed', () => {
  assert.equal(inviteRedirect('http://127.0.0.1:8081/'), 'http://127.0.0.1:8081/set-password');
  assertInviteRedirect('http://127.0.0.1:8081/set-password', toml);
  const auth = toml.split('[auth.email]')[0];
  assert.match(auth, /enable_signup = false/);
});
