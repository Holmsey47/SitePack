import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { levelFilterLabels } from './folders.ts';
import { fixtureRepo, resetFixtureStore } from './fixtureRepo.ts';
import { IDS, SEED_PASSWORD } from './ids.ts';

const securityMigration = '20261021163528';

test('replace carries level forward and leaves the superseded row alone', async () => {
  resetFixtureStore();
  await fixtureRepo.signIn('cm@sitepack.test', SEED_PASSWORD);

  const created = await fixtureRepo.replaceDrawing({
    siteId: IDS.oak,
    title: 'Grid line A',
    revision: 'A',
    storagePath: `${IDS.company}/${IDS.oak}/grid-a.pdf`,
    sheetNumber: 'SO-9',
    folder: 'Set out plans',
    level: '  L2  ',
  });
  assert.equal(created.level, 'L2');
  assert.equal(created.folder, 'Set out plans');
  assert.equal(created.is_current, true);

  const replaced = await fixtureRepo.replaceDrawing({
    siteId: IDS.oak,
    title: 'Grid line A',
    revision: 'B',
    storagePath: `${IDS.company}/${IDS.oak}/grid-b.pdf`,
    sheetNumber: 'SO-9',
    replaceDrawingId: created.id,
  });
  assert.equal(replaced.level, 'L2');
  assert.equal(replaced.folder, 'Set out plans');
  assert.equal(replaced.revision, 'B');
  assert.equal(replaced.is_current, true);
  assert.notEqual(replaced.id, created.id);

  const afterReplace = await fixtureRepo.listDrawings(IDS.oak);
  const superseded = afterReplace.find((row) => row.id === created.id);
  assert.equal(superseded?.is_current, false);
  assert.equal(superseded?.level, 'L2');
  assert.equal(afterReplace.filter((row) => row.sheet_number === 'SO-9' && row.is_current).length, 1);

  const cleared = await fixtureRepo.replaceDrawing({
    siteId: IDS.oak,
    title: 'Grid line A',
    revision: 'C',
    storagePath: `${IDS.company}/${IDS.oak}/grid-c.pdf`,
    sheetNumber: 'SO-9',
    replaceDrawingId: replaced.id,
    folder: 'Set out plans',
    level: '   ',
  });
  assert.equal(cleared.level, null);
  assert.equal(cleared.is_current, true);
  const kept = (await fixtureRepo.listDrawings(IDS.oak)).find((row) => row.id === replaced.id);
  assert.equal(kept?.is_current, false);
  assert.equal(kept?.level, 'L2');
});

test('fixture seed shows the level filter only when a folder has two current levels', async () => {
  resetFixtureStore();
  await fixtureRepo.signIn('cm@sitepack.test', SEED_PASSWORD);

  const oak = await fixtureRepo.listDrawings(IDS.oak);
  const setOut = oak.filter((row) => row.folder === 'Set out plans');
  assert.equal(setOut.filter((row) => row.is_current).length, 4);
  assert.deepEqual(levelFilterLabels(setOut), ['Ground', 'L1', 'L2', 'L3']);

  const ground = oak.filter((row) => row.folder === 'Ground floor');
  assert.equal(levelFilterLabels(ground), null);

  const warehouse = await fixtureRepo.listDrawings(IDS.warehouse);
  assert.equal(levelFilterLabels(warehouse), null);

  const manifest = await fixtureRepo.sitePackManifest(IDS.oak);
  assert.equal(manifest.some((item) => item.drawing_id === IDS.gfRevB), false);
  assert.equal(manifest.find((item) => item.drawing_id === IDS.gfRevC)?.level, 'Ground');
  assert.equal(manifest.find((item) => item.title === 'Set out L2')?.level, 'L2');
  assert.equal(
    manifest.filter((item) => item.title.startsWith('Set out')).length,
    4
  );
});

test('the level migration is only a nullable column and a narrower-or-same RPC', () => {
  const names = fs.readdirSync('supabase/migrations').filter((name) => name.endsWith('.sql'));
  const levelFiles = names.filter((name) => name.endsWith('_drawing_level.sql'));
  assert.deepEqual(levelFiles, ['20261021165402_drawing_level.sql']);
  const filename = levelFiles[0];
  assert.ok(filename);
  assert.ok(filename > securityMigration);

  const sql = fs.readFileSync(`supabase/migrations/${filename}`, 'utf8');
  assert.match(sql, /add column level text;/);
  assert.doesNotMatch(sql, /add column level text not null/i);
  assert.match(sql, /p_level text default null/);
  assert.match(sql, /p_folder text default null/);
  assert.match(sql, /if p_level is null then/);
  assert.match(sql, /nullif\(trim\(coalesce\(v_old\.level, ''\)\), ''\)/);
  assert.match(sql, /v_actor,\s*v_folder,\s*v_level/);
  assert.match(sql, /p\.auth_user_id = \(select auth\.uid\(\)\)/);
  assert.match(sql, /private\.is_cm_or_owner\(\)/);
  assert.match(sql, /private\.can_access_site\(p_site_id\)/);
  assert.match(sql, /'level', d\.level/);
  assert.match(sql, /and d\.is_current = true/);
  assert.match(
    sql,
    /drop function if exists public\.replace_drawing\(\s*uuid, text, text, text, text, date, bigint, text, uuid, uuid, text\s*\)/
  );
  assert.match(
    sql,
    /grant execute on function public\.replace_drawing\(\s*uuid, text, text, text, text, date, bigint, text, uuid, uuid, text, text\s*\) to authenticated/
  );
  assert.match(sql, /grant execute on function public\.site_pack_manifest\(uuid\) to authenticated/);
  assert.match(sql, /revoke all on function public\.replace_drawing\(/);
  assert.match(sql, /from public, anon/);
  assert.doesNotMatch(sql, /to anon/);
  assert.doesNotMatch(sql, /service_role/);
  assert.doesNotMatch(sql, /create policy/i);
  assert.doesNotMatch(sql, /create unique index|add constraint/i);
  assert.doesNotMatch(sql, /alter table public\.people/);
  assert.doesNotMatch(sql, /pre_lad|company_people/);
  assert.doesNotMatch(sql, /uploaded_by,\s*folder,\s*level\s*\) values \([\s\S]*\(select auth\.uid\(\)\)/);
});
