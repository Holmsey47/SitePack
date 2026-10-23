// Two-session races for sign-in, sign-out, and corrections.
// Run after the migrations, against the same local DATABASE_URL as the RLS probe.
// Nothing here is a hosted project. The rows are removed at the end.
import { spawn, spawnSync } from 'node:child_process';

const databaseUrl = process.env.DATABASE_URL ?? '';
if (!databaseUrl) {
  console.error('DATABASE_URL is required. Use a local Postgres database.');
  process.exit(1);
}
if (/supabase\.(co|com)|pooler\.supabase\.com/.test(databaseUrl)) {
  console.error('Refusing to run against a hosted Supabase URL.');
  process.exit(1);
}

const firm = 'c3333333-3333-4333-8333-333333333333';
const ownerUser = 'a3333333-3333-4333-8333-333333333331';
const opUser = 'a3333333-3333-4333-8333-333333333332';
const owner = 'a3333333-3333-4333-8333-333333333333';
const op = 'a3333333-3333-4333-8333-333333333334';
const site = '53333333-3333-4333-8333-333333333333';
const entry = '63333333-3333-4333-8333-333333333333';
const clock = '2026-10-21 12:00:00+00';
const inAt = '2026-10-21 07:00:00+00';
const outAt = '2026-10-21 08:00:00+00';

function once(sql) {
  const result = spawnSync(
    'psql',
    [databaseUrl, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', sql],
    { encoding: 'utf8' }
  );
  if (result.status !== 0) {
    throw new Error(`${(result.stderr || result.stdout || 'psql failed').trim()}\n${sql.trim()}`);
  }
  return result.stdout.trim();
}

function ok(cond, message) {
  if (!cond) throw new Error(`FAIL: ${message}`);
  console.log(`ok: ${message}`);
}

class Session {
  constructor() {
    this.child = spawn('psql', [databaseUrl, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.out = '';
    this.err = '';
    this.child.stdout.on('data', (chunk) => {
      this.out += chunk;
    });
    this.child.stderr.on('data', (chunk) => {
      this.err += chunk;
    });
  }

  exec(sql, timeoutMs = 20000) {
    const marker = `END_${Math.random().toString(16).slice(2)}`;
    const startOut = this.out.length;
    const startErr = this.err.length;
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        finish(new Error(`timeout\n${this.out.slice(startOut)}\n${this.err.slice(startErr)}`), undefined, true);
      }, timeoutMs);
      const finish = (error, value, force = false) => {
        if (settled) return;
        const errorText = this.err.slice(startErr);
        const ready = this.out.slice(startOut).includes(marker) || errorText.includes('ERROR') || errorText.includes('FATAL');
        if (error && !force && !ready) return;
        settled = true;
        clearTimeout(timer);
        this.child.stdout.off('data', onData);
        this.child.stderr.off('data', onData);
        this.child.off('exit', onExit);
        if (error) reject(error);
        else resolve(value);
      };
      const onData = () => {
        const text = this.out.slice(startOut);
        const errorText = this.err.slice(startErr);
        if (errorText.includes('ERROR') || errorText.includes('FATAL')) {
          finish(new Error(errorText.trim()), undefined, true);
          return;
        }
        if (text.includes(marker)) {
          finish(null, text.replace(marker, '').trim(), true);
        }
      };
      const onExit = () => finish(new Error(this.err.slice(startErr).trim() || 'psql closed'), undefined, true);
      this.child.stdout.on('data', onData);
      this.child.stderr.on('data', onData);
      this.child.on('exit', onExit);
      this.child.stdin.write(`${sql.trim()}\n\\echo ${marker}\n`);
    });
  }

  close() {
    this.child.stdin.end();
  }
}

function cleanup() {
  once(`
    delete from public.site_attendance where person_id in ('${op}'::uuid, '${owner}'::uuid);
    delete from public.site_assignments where site_id = '${site}'::uuid;
    delete from public.sites where id = '${site}'::uuid;
    delete from public.people where id in ('${owner}'::uuid, '${op}'::uuid);
    delete from auth.users where id in ('${ownerUser}'::uuid, '${opUser}'::uuid);
    delete from public.companies where id = '${firm}'::uuid;
  `);
}

function setup() {
  cleanup();
  once(`
    insert into auth.users (id, email) values
      ('${ownerUser}', 'race-owner@firm.test'),
      ('${opUser}', 'race-op@firm.test');
    insert into public.companies (id, name) values ('${firm}', 'Race Firm');
    insert into public.people (id, auth_user_id, company_id, role, display_name, email) values
      ('${owner}', '${ownerUser}', '${firm}', 'owner', 'Race Owner', 'race-owner@firm.test'),
      ('${op}', '${opUser}', '${firm}', 'operative', 'Race Op', 'race-op@firm.test');
    insert into public.sites (id, company_id, name) values ('${site}', '${firm}', 'Race Site');
    insert into public.site_assignments (site_id, person_id) values ('${site}', '${op}');
  `);
}

async function become(session, userId) {
  await session.exec(`
    select set_config('request.jwt.claim.sub', '${userId}', false);
    select set_config('request.jwt.claim.role', 'authenticated', false);
    select set_config('request.jwt.claims', json_build_object('sub', '${userId}', 'role', 'authenticated')::text, false);
    select set_config('sitepack.attendance_now', '${clock}', false);
    set role authenticated;
  `);
}

function insertShift(open) {
  if (open) {
    once(`
      delete from public.site_attendance_audit where entry_id = '${entry}'::uuid;
      delete from public.site_attendance where id = '${entry}'::uuid;
      insert into public.site_attendance (
        id, site_id, company_id, person_id, person_name,
        in_device_at, in_received_at, in_at, in_gap
      ) values (
        '${entry}', '${site}', '${firm}', '${op}', 'Race Op',
        '${inAt}', '${inAt}', '${inAt}', false
      );
    `);
    return;
  }
  once(`
    delete from public.site_attendance_audit where entry_id = '${entry}'::uuid;
    delete from public.site_attendance where id = '${entry}'::uuid;
    insert into public.site_attendance (
      id, site_id, company_id, person_id, person_name,
      in_device_at, in_received_at, in_at, in_gap,
      out_device_at, out_received_at, out_at, out_gap, forgot_sign_out
    ) values (
      '${entry}', '${site}', '${firm}', '${op}', 'Race Op',
      '${inAt}', '${inAt}', '${inAt}', false,
      '${outAt}', '${outAt}', '${outAt}', false, false
    );
  `);
}

async function waitUntilLocked(pid) {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    const state = once(
      `select coalesce(wait_event_type, '') from pg_stat_activity where pid = ${Number(pid)}`
    );
    if (state === 'Lock') return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`session ${pid} did not wait on a lock`);
}

function audits() {
  const text = once(`
    select coalesce(before_entry->>'out_at', '') || '|' || coalesce(after_entry->>'out_at', '')
    from public.site_attendance_audit
    where entry_id = '${entry}'::uuid
    order by created_at, id
  `);
  return text
    ? text.split('\n').map((line) => {
        const [before, after] = line.split('|');
        return { before: before ? Date.parse(before) : null, after: after ? Date.parse(after) : null };
      })
    : [];
}

function rowOut() {
  const text = once(`select coalesce(out_at::text, '') from public.site_attendance where id = '${entry}'::uuid`);
  return text ? Date.parse(text) : null;
}

async function untilLocked(pid, pending) {
  let failure = null;
  const done = pending.then(
    () => 'finished',
    (error) => {
      failure = error;
      return 'failed';
    }
  );
  const locked = waitUntilLocked(pid).then(() => 'locked');
  const which = await Promise.race([done, locked]);
  if (which === 'failed') throw failure;
  if (which === 'finished') throw new Error('the second session finished before the first one committed');
}

async function main() {
  setup();
  const ownerA = new Session();
  const ownerB = new Session();
  const opA = new Session();
  const opB = new Session();
  const sessions = [ownerA, ownerB, opA, opB];
  try {
    await become(ownerA, ownerUser);
    await become(ownerB, ownerUser);
    await become(opA, opUser);
    await become(opB, opUser);
    const ownerAPid = await ownerA.exec('select pg_backend_pid();');
    const ownerBPid = await ownerB.exec('select pg_backend_pid();');
    const opAPid = await opA.exec('select pg_backend_pid();');
    const opBPid = await opB.exec('select pg_backend_pid();');

    insertShift(false);
    await ownerA.exec(`
      reset role;
      begin;
      select id from public.site_attendance where id = '${entry}'::uuid for update;
      set role authenticated;
    `);
    const secondCorrection = ownerB.exec(`
      select public.correct_attendance(
        '${entry}'::uuid,
        '${inAt}'::timestamptz,
        '2026-10-21 10:00:00+00'::timestamptz,
        'Second'
      );
    `);
    await untilLocked(ownerBPid, secondCorrection);
    await ownerA.exec(`
      select public.correct_attendance(
        '${entry}'::uuid,
        '${inAt}'::timestamptz,
        '2026-10-21 09:00:00+00'::timestamptz,
        'First'
      );
      commit;
    `);
    await secondCorrection;
    const both = audits();
    ok(both.length === 2, 'two corrections at once write two audit rows');
    ok(both[0].before === Date.parse(outAt), 'the first correction starts from the locked row');
    ok(both[1].before === both[0].after, 'the second correction starts from the first correction');
    ok(rowOut() === both[1].after, 'the row matches the last correction');

    insertShift(true);
    await ownerA.exec(`
      reset role;
      begin;
      select id from public.site_attendance where id = '${entry}'::uuid for update;
      set role authenticated;
    `);
    const racingSignOut = opA.exec(`
      do $$
      begin
        perform public.sign_out_site('${site}'::uuid, '${clock}'::timestamptz);
        raise exception 'FAIL: sign-out replaced the correction';
      exception
        when others then
          if sqlerrm = 'FAIL: sign-out replaced the correction' then
            raise;
          end if;
          if sqlerrm <> 'not_signed_in' then
            raise exception 'FAIL: sign-out race %', sqlerrm;
          end if;
      end $$;
    `);
    await untilLocked(opAPid, racingSignOut);
    await ownerA.exec(`
      select public.correct_attendance(
        '${entry}'::uuid,
        '${inAt}'::timestamptz,
        '2026-10-21 09:00:00+00'::timestamptz,
        'While signing out'
      );
      commit;
    `);
    await racingSignOut;
    const corrected = audits();
    ok(corrected.length === 1, 'a sign-out racing a correction does not add its own audit');
    ok(corrected[0].after === Date.parse('2026-10-21 09:00:00+00'), 'the correction after-value is the corrected time');
    ok(rowOut() === corrected[0].after, 'the row still matches that correction');

    insertShift(true);
    await opA.exec(`
      reset role;
      begin;
      select id from public.site_attendance where id = '${entry}'::uuid for update;
      set role authenticated;
    `);
    const during = ownerA.exec(`
      select public.correct_attendance(
        '${entry}'::uuid,
        '${inAt}'::timestamptz,
        '2026-10-21 10:00:00+00'::timestamptz,
        'After the sign-out'
      );
    `);
    await untilLocked(ownerAPid, during);
    await opA.exec(`
      select public.sign_out_site('${site}'::uuid, '${clock}'::timestamptz);
      commit;
    `);
    await during;
    const afterSignOut = audits();
    ok(afterSignOut.length === 1, 'a correction during a sign-out writes one audit');
    ok(afterSignOut[0].before === Date.parse(clock), 'the correction before-value is the signed-out row');
    ok(afterSignOut[0].after === Date.parse('2026-10-21 10:00:00+00'), 'the correction after-value follows that row');
    ok(rowOut() === afterSignOut[0].after, 'the row matches the correction that followed the sign-out');

    once(`delete from public.site_attendance where person_id = '${op}'::uuid;`);
    await opA.exec(`
      begin;
      select public.sign_in_site('${site}'::uuid, '${clock}'::timestamptz);
    `);
    const duplicate = opB.exec(`
      do $$
      declare
        v_message text;
        v_detail text;
      begin
        begin
          perform public.sign_in_site('${site}'::uuid, '${clock}'::timestamptz);
          raise exception 'FAIL: second sign-in saved';
        exception
          when others then
            if sqlerrm = 'FAIL: second sign-in saved' then
              raise;
            end if;
            get stacked diagnostics v_message = message_text, v_detail = pg_exception_detail;
            if v_message <> 'already_signed_in' or v_detail is distinct from 'Race Site' then
              raise exception 'FAIL: sign-in race % / %', v_message, v_detail;
            end if;
        end;
      end $$;
    `);
    await untilLocked(opBPid, duplicate);
    await opA.exec('commit;');
    await duplicate;
    const openCount = Number(
      once(`select count(*) from public.site_attendance where person_id = '${op}'::uuid and out_at is null`)
    );
    ok(openCount === 1, 'two sign-ins at once leave one open shift and already_signed_in');
  } finally {
    for (const session of sessions) session.close();
    await new Promise((resolve) => setTimeout(resolve, 200));
    cleanup();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
