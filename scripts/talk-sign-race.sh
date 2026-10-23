#!/usr/bin/env bash
# Two sessions sign the same person and version at once.
# Both must get the stored row. Never point DATABASE_URL at a hosted Supabase project.
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

migration="supabase/migrations/20261022190000_inductions.sql"
grep -q 'pg_advisory_xact_lock' "$migration"
grep -q 'unique_violation' "$migration"
grep -q 'for update' "$migration"

owner_id='a4444444-4444-4444-8444-444444444401'
user_id='a4444444-4444-4444-8444-444444444404'
company_id='c4444444-4444-4444-8444-444444444402'
site_id='54444444-4444-4444-8444-444444444403'
png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
insert into auth.users (id, email) values
  ('${owner_id}', 'race-owner@firm.test'),
  ('${user_id}', 'race-talk@firm.test');
insert into public.companies (id, name) values ('${company_id}', 'Race Talks');
insert into public.people (id, auth_user_id, company_id, role, display_name, email, trade)
values
  ('${owner_id}', '${owner_id}', '${company_id}', 'owner', 'Race Owner', 'race-owner@firm.test', null),
  ('${user_id}', '${user_id}', '${company_id}', 'operative', 'Race Op', 'race-talk@firm.test', 'dryliner');
insert into public.sites (id, company_id, name) values ('${site_id}', '${company_id}', 'Race Site');
insert into public.site_assignments (site_id, person_id) values ('${site_id}', '${user_id}');
drop table if exists public._talk_race_barrier;
create table public._talk_race_barrier (n integer not null);
insert into public._talk_race_barrier (n) values (0);
select set_config('request.jwt.claim.sub', '${owner_id}', false);
select set_config('request.jwt.claim.role', 'authenticated', false);
set role authenticated;
select public.create_site_talk(
  '${site_id}'::uuid,
  'toolbox',
  'phone',
  'Race brief',
  'Stay on the boards.',
  null,
  'all',
  array[]::uuid[],
  '${owner_id}'::uuid,
  'Owner',
  now()
);
reset role;
SQL

talk_id="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -t -A -c "select id from public.site_talks where site_id = '${site_id}'::uuid")"
version_id="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -t -A -c "select id from public.site_talk_versions where talk_id = '${talk_id}'::uuid and is_current")"

sign_once() {
  local out="$1"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -t -A >"$out" <<SQL
set statement_timeout = '20s';
begin;
update public._talk_race_barrier set n = n + 1;
commit;
do \$\$
begin
  while (select n from public._talk_race_barrier) < 2 loop
    perform pg_sleep(0.02);
  end loop;
end
\$\$;
select set_config('request.jwt.claim.sub', '${user_id}', false);
select set_config('request.jwt.claim.role', 'authenticated', false);
set role authenticated;
select public.sign_site_talk(
  '${talk_id}'::uuid,
  '${version_id}'::uuid,
  '${user_id}'::uuid,
  true,
  '${png}',
  now(),
  'session-race-1'
) ->> 'signature_id';
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
  echo "talk sign race failed" >&2
  echo "--- session a ---" >&2
  cat "$tmp_a" >&2 || true
  echo "--- session b ---" >&2
  cat "$tmp_b" >&2 || true
  exit "$status"
fi

sig_a="$(tr -d '[:space:]' <"$tmp_a")"
sig_b="$(tr -d '[:space:]' <"$tmp_b")"
if [[ -z "$sig_a" || "$sig_a" != "$sig_b" ]]; then
  echo "talk sign race returned different rows" >&2
  echo "a=$sig_a" >&2
  echo "b=$sig_b" >&2
  exit 1
fi
if grep -E -q 'duplicate key|unique_violation' "$tmp_a" "$tmp_b"; then
  echo "talk sign race returned a duplicate-key error" >&2
  cat "$tmp_a" "$tmp_b" >&2
  exit 1
fi

count="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -t -A -c "select count(*) from public.site_talk_signatures where version_id = '${version_id}'::uuid and signature_role = 'attendee'")"
if [[ "$count" != "1" ]]; then
  echo "expected one stored signature, got ${count}" >&2
  exit 1
fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c 'drop table if exists public._talk_race_barrier;' >/dev/null
rm -f "$tmp_a" "$tmp_b"
echo "talk sign race ok"
