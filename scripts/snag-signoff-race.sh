#!/usr/bin/env bash
# Two sessions sign the same client id at once. Both must get the stored row.
# Never point DATABASE_URL at a hosted Supabase project.
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required. Use a local Postgres database." >&2
  exit 1
fi

case "$DATABASE_URL" in
  *supabase.co*|*supabase.com*|*pooler.supabase.com*)
    echo "Refusing to run against a hosted Supabase URL." >&2
    exit 1
    ;;
esac

migration="supabase/migrations/20261022170000_snags.sql"
grep -q 'pg_advisory_xact_lock' "$migration"
grep -q 'unique_violation' "$migration"

user_id='a3333333-3333-4333-8333-333333333301'
company_id='c3333333-3333-4333-8333-333333333302'
site_id='53333333-3333-4333-8333-333333333303'
snag_id='e3333333-3333-4333-8333-333333333304'
signoff_id='c3333333-3333-4333-8333-333333333305'
before_path="${company_id}/${site_id}/snags/${snag_id}/before.jpg"
after_path="${company_id}/${site_id}/snags/${snag_id}/after.jpg"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
insert into auth.users (id, email) values ('${user_id}', 'race@firm.test');
insert into public.companies (id, name) values ('${company_id}', 'Race Firm');
insert into public.people (id, auth_user_id, company_id, role, display_name, email, trade)
values ('${user_id}', '${user_id}', '${company_id}', 'operative', 'Race Op', 'race@firm.test', 'dryliner');
insert into public.sites (id, company_id, name) values ('${site_id}', '${company_id}', 'Race Site');
insert into public.site_assignments (site_id, person_id) values ('${site_id}', '${user_id}');
insert into storage.objects (bucket_id, name, owner, metadata) values
  ('site-photos', '${before_path}', '${user_id}', '{"mimetype":"image/jpeg","size":1200}'::jsonb),
  ('site-photos', '${after_path}', '${user_id}', '{"mimetype":"image/jpeg","size":1200}'::jsonb);
drop table if exists public._snag_race_barrier;
create table public._snag_race_barrier (n integer not null);
insert into public._snag_race_barrier (n) values (0);
select set_config('request.jwt.claim.sub', '${user_id}', false);
select set_config('request.jwt.claim.role', 'authenticated', false);
set role authenticated;
select public.create_snag(
  '${snag_id}'::uuid,
  '${site_id}'::uuid,
  'Race crack',
  'Ground',
  'dryliner',
  now(),
  jsonb_build_array(jsonb_build_object(
    'storage_path', '${before_path}',
    'content_type', 'image/jpeg',
    'file_size_bytes', 1
  ))
);
select public.fix_snag(
  '${snag_id}'::uuid,
  now(),
  jsonb_build_array(jsonb_build_object(
    'storage_path', '${after_path}',
    'content_type', 'image/jpeg',
    'file_size_bytes', 1
  ))
);
reset role;
SQL

sign_once() {
  local out="$1"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -t -A >"$out" <<SQL
set statement_timeout = '20s';
begin;
update public._snag_race_barrier set n = n + 1;
commit;
do \$\$
begin
  while (select n from public._snag_race_barrier) < 2 loop
    perform pg_sleep(0.02);
  end loop;
end
\$\$;
select set_config('request.jwt.claim.sub', '${user_id}', false);
select set_config('request.jwt.claim.role', 'authenticated', false);
set role authenticated;
select public.sign_off_snags_contractor(
  '${signoff_id}'::uuid,
  '${site_id}'::uuid,
  now(),
  'Dave Moran',
  'Site manager',
  'Northbuild',
  'data:image/png;base64,' || repeat('QUFB', 20),
  array['${snag_id}'::uuid],
  '{}'::uuid[]
) ->> 'signoff_id';
SQL
}

tmp_a="$(mktemp)"
tmp_b="$(mktemp)"
sign_once "$tmp_a" &
pid_a=$!
sign_once "$tmp_b" &
pid_b=$!
status=0
wait "$pid_a" || status=$?
wait "$pid_b" || status=$?
if [[ "$status" -ne 0 ]]; then
  echo "sign-off race failed" >&2
  echo "--- session a ---" >&2
  cat "$tmp_a" >&2 || true
  echo "--- session b ---" >&2
  cat "$tmp_b" >&2 || true
  exit "$status"
fi

grep -q "$signoff_id" "$tmp_a"
grep -q "$signoff_id" "$tmp_b"
if grep -E -q 'duplicate key|unique_violation' "$tmp_a" "$tmp_b"; then
  echo "sign-off race returned a duplicate-key error" >&2
  cat "$tmp_a" "$tmp_b" >&2
  exit 1
fi

count="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -t -A -c "select count(*) from public.snag_signoffs where id = '${signoff_id}'::uuid")"
signatures="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -t -A -c "select count(*) from public.snag_signatures where signoff_id = '${signoff_id}'::uuid")"
snag_status="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -t -A -c "select status from public.snags where id = '${snag_id}'::uuid")"
if [[ "$count" != "1" || "$signatures" != "1" || "$snag_status" != "Signed off" ]]; then
  echo "expected one stored sign-off, got signoffs=${count} signatures=${signatures} status=${snag_status}" >&2
  exit 1
fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c 'drop table if exists public._snag_race_barrier;' >/dev/null
rm -f "$tmp_a" "$tmp_b"
echo "snag sign-off race ok"
