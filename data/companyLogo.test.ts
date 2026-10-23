import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fixtureRepo, logoPathForTests, resetFixtureStore } from './fixtureRepo.ts';
import { IDS, SEED_PASSWORD } from './ids.ts';
import {
  assertLogoUpload,
  LOGO_MAX_BYTES,
  LOGO_MAX_EDGE,
  logoExtension,
  logoObjectPath,
} from './companyLogo.ts';
import { fittedSize } from '../lib/photoBytes.ts';

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

test('a logo is jpeg, png, or webp and at most 1 MiB', () => {
  assert.equal(LOGO_MAX_BYTES, 1_048_576);
  assert.equal(LOGO_MAX_EDGE, 512);
  assert.equal(logoExtension('image/jpeg'), 'jpg');
  assert.equal(logoExtension('image/png'), 'png');
  assert.equal(logoExtension('image/webp'), 'webp');
  assert.equal(logoExtension('image/gif'), null);
  assert.equal(logoExtension('text/plain'), null);
  assert.equal(assertLogoUpload(jpeg, 'image/jpeg'), 'jpg');
  assert.equal(assertLogoUpload(new Uint8Array(LOGO_MAX_BYTES), 'image/png'), 'png');
  assert.throws(() => assertLogoUpload(jpeg, 'image/gif'), /invalid_input/);
  assert.throws(() => assertLogoUpload(new Uint8Array(0), 'image/jpeg'), /invalid_input/);
  assert.throws(() => assertLogoUpload(new Uint8Array(LOGO_MAX_BYTES + 1), 'image/webp'), /photo_too_large/);
  assert.deepEqual(fittedSize(4000, 2000, LOGO_MAX_EDGE), { width: 512, height: 256 });
  assert.ok(Math.max(fittedSize(8000, 100, LOGO_MAX_EDGE).width, fittedSize(8000, 100, LOGO_MAX_EDGE).height) <= 512);
});

test('a logo path is the company id, then a file, and nothing deeper', () => {
  const fileId = 'd1111111-1111-4111-8111-111111111111';
  assert.equal(logoObjectPath(IDS.company, fileId, 'jpg'), `${IDS.company}/${fileId}.jpg`);
  assert.throws(() => logoObjectPath('not-a-uuid', fileId, 'jpg'), /invalid_input/);
  assert.throws(() => logoObjectPath('../other', fileId, 'png'), /invalid_input/);
});

test('the owner can set, replace, and remove a logo; a member cannot', async () => {
  resetFixtureStore();
  const empty = await (async () => {
    await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
    return fixtureRepo.companyMark();
  })();
  assert.equal(empty.name, 'Ashfield Finishes');
  assert.equal(empty.logoUrl, null);

  const first = await fixtureRepo.setCompanyLogo({ bytes: jpeg, contentType: 'image/jpeg' });
  const firstPath = logoPathForTests(IDS.company);
  assert.match(firstPath ?? '', new RegExp(`^${IDS.company}/[0-9a-f-]{36}\\.jpg$`));
  assert.match(first.logoUrl ?? '', /^data:image\/jpeg;base64,/);

  const replaced = await fixtureRepo.setCompanyLogo({ bytes: jpeg, contentType: 'image/png' });
  const secondPath = logoPathForTests(IDS.company);
  assert.notEqual(secondPath, firstPath);
  assert.match(secondPath ?? '', /\.png$/);
  assert.match(replaced.logoUrl ?? '', /^data:image\/png;base64,/);

  await assert.rejects(
    () => fixtureRepo.setCompanyLogo({ bytes: jpeg, contentType: 'image/gif' }),
    /invalid_input/
  );
  assert.equal(logoPathForTests(IDS.company), secondPath);
  await assert.rejects(
    () => fixtureRepo.setCompanyLogo({ bytes: new Uint8Array(LOGO_MAX_BYTES + 1), contentType: 'image/jpeg' }),
    /photo_too_large/
  );

  const cleared = await fixtureRepo.setCompanyLogo(null);
  assert.equal(cleared.logoUrl, null);
  assert.equal(logoPathForTests(IDS.company), null);
  await fixtureRepo.signOut();

  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  assert.equal((await fixtureRepo.companyMark()).name, 'Ashfield Finishes');
  await assert.rejects(() => fixtureRepo.setCompanyLogo({ bytes: jpeg, contentType: 'image/jpeg' }), /not_authorized/);
  await fixtureRepo.signOut();
  resetFixtureStore();
});

test('company logo policies stay on the private bucket and the owner column', () => {
  const sql = fs.readFileSync('supabase/migrations/20261023173000_company_logo.sql', 'utf8');
  assert.match(sql, /add column if not exists logo_path text/);
  assert.match(sql, /'company-logos'/);
  assert.match(sql, /false,\s*1048576/);
  assert.match(sql, /array\['image\/jpeg', 'image\/png', 'image\/webp'\]/);
  assert.match(sql, /company_logos_select/);
  assert.match(sql, /company_logos_insert/);
  assert.match(sql, /company_logos_update/);
  assert.match(sql, /company_logos_delete/);
  assert.match(sql, /private\.my_company_id\(\)/);
  assert.match(sql, /private\.my_role\(\) = 'owner'/);
  assert.match(sql, /for select to authenticated/);
  assert.match(sql, /for insert to authenticated/);
  assert.match(sql, /for update to authenticated/);
  assert.match(sql, /for delete to authenticated/);
  assert.match(sql, /companies_guard_logo/);
  assert.equal(sql.match(/array_length\(storage\.foldername\(name\), 1\), 0\) = 1/g)?.length, 5);
  assert.doesNotMatch(sql, /foldername\(name\), 1\), 0\) = 2/);
  const stub = fs.readFileSync('scripts/throwaway-auth.sql', 'utf8');
  assert.match(stub, /storage\.foldername returns the folders only/);
  assert.match(stub, /\[1:coalesce\(array_length\(string_to_array\(name, '\/'\), 1\), 0\) - 1\]/);
  assert.doesNotMatch(sql, /to anon/);
  assert.doesNotMatch(sql, /service_role/);

  const repo = fs.readFileSync('data/supabaseRepo.ts', 'utf8');
  assert.match(repo, /storage\.from\('company-logos'\)/);
  assert.match(repo, /createSignedUrl/);
  assert.match(repo, /\.remove\(\[current\.logo_path\]\)/);
  assert.match(repo, /\.remove\(\[path\]\)/);
  assert.equal(repo.includes('service_role'), false);

  const screen = fs.readFileSync('components/CompanyLogo.tsx', 'utf8');
  assert.match(screen, /Add logo/);
  assert.match(screen, /Change logo/);
  assert.match(screen, /Remove logo/);
  assert.match(screen, /PhotoPicker/);
  assert.match(screen, /maxEdge=\{LOGO_MAX_EDGE\}/);
  assert.match(screen, /source=\{\{ uri: logoUrl/);
  assert.match(fs.readFileSync('app/(app)/sites/index.tsx', 'utf8'), /<CompanyLogo \/>/);
  assert.match(fs.readFileSync('scripts/run-snag-rls.sh', 'utf8'), /scripts\/company-logo\.sql/);
  assert.match(fs.readFileSync('scripts/company-logo.sql', 'utf8'), /anon and public have no company logo policy/);
});
