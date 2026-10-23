#!/usr/bin/env bash
# Apply the throwaway auth stand-in, every migration, and the sharing RLS checks.
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

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/throwaway-auth.sql

# Hosted Supabase already enables RLS on storage.objects. The variations
# migration creates a bucket, so the local stand-in needs this before migrations.
# It stays in this script, not in a migration.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant select, insert on table storage.objects to authenticated;
SQL

for migration in supabase/migrations/*.sql; do
  base="$(basename "$migration")"
  if [[ "$base" == "20261022200000_main_contractor_sharing.sql" ]]; then
    echo "apply anon default grants"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/anon-default-grants.sql
    echo "snapshot pg_proc"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
drop table if exists public.proc_catalog_before;
create table public.proc_catalog_before as
select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'private');
SQL
  fi
  echo "apply ${migration}"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"
done

echo "load expected sharing functions"
funcs_sql="$(mktemp)"
SHARE_FUNCS_SQL="$funcs_sql" python3 - <<'PY'
import os
import re
from pathlib import Path
sql = Path("supabase/migrations/20261022200000_main_contractor_sharing.sql").read_text()
names = re.findall(
    r"create\s+(?:or\s+replace\s+)?function\s+((?:public|private)\.[a-z0-9_]+)\s*\(",
    sql,
    flags=re.I,
)
seen = []
for name in names:
    key = name.lower()
    if key not in seen:
        seen.append(key)
replaced = {"private.visible_variation_pence", "private.visible_shown_pence"}
if len(seen) != 29 or replaced - set(seen):
    raise SystemExit(f"expected 29 functions including the 2 replaced, found {len(seen)}")
lines = [
    "drop table if exists public.share_funcs_expected;",
    "create table public.share_funcs_expected (nspname text, proname text, replaced boolean);",
]
for name in seen:
    nsp, pron = name.split(".", 1)
    flag = "true" if name in replaced else "false"
    lines.append(
        f"insert into public.share_funcs_expected values ('{nsp}', '{pron}', {flag});"
    )
Path(os.environ["SHARE_FUNCS_SQL"]).write_text("\n".join(lines) + "\n")
PY
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$funcs_sql"
rm -f "$funcs_sql"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/sharing-rls.sql
echo "sharing RLS ok"

# Committed schema, separate sessions. The probe above rolls back, so this
# seed is the only rate-limit actor. The lock must leave 10 rows from 80 calls.
rate_actor='b4444444-4444-4444-8444-444444444441'
rate_company='c4444444-4444-4444-8444-444444444441'
cleanup_rate() {
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q <<SQL
delete from public.site_share_attempts where actor_id = '${rate_actor}';
delete from public.people where id = '${rate_actor}';
delete from auth.users where id = '${rate_actor}';
delete from public.companies where id = '${rate_company}';
SQL
}
cleanup_rate
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q <<SQL
insert into auth.users (id, email) values ('${rate_actor}', 'rate@parallel.test');
insert into public.companies (id, name) values ('${rate_company}', 'Parallel Firm');
insert into public.people (id, auth_user_id, company_id, role, display_name, email)
values ('${rate_actor}', '${rate_actor}', '${rate_company}', 'owner', 'Rate Owner', 'rate@parallel.test');
SQL
rate_dir="$(mktemp -d)"
rate_pids=()
for i in 1 2 3 4 5 6 7 8; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q >"${rate_dir}/${i}.out" 2>"${rate_dir}/${i}.err" <<SQL &
select set_config('request.jwt.claim.sub', '${rate_actor}', false);
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claims', json_build_object('sub', '${rate_actor}', 'role', 'authenticated')::text, false);
set role authenticated;
select public.redeem_site_share('abcd') from generate_series(1, 10);
SQL
  rate_pids+=("$!")
done
rate_fail=0
for pid in "${rate_pids[@]}"; do
  if ! wait "$pid"; then
    rate_fail=1
  fi
done
if [[ "$rate_fail" -ne 0 ]]; then
  echo "parallel redeem sessions failed" >&2
  cat "${rate_dir}"/*.err >&2 || true
  cleanup_rate
  exit 1
fi
rate_count="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tAc "select count(*) from public.site_share_attempts where actor_id = '${rate_actor}'")"
rate_count="$(echo "$rate_count" | tr -d '[:space:]')"
cleanup_rate
rm -rf "$rate_dir"
if [[ "$rate_count" != "10" ]]; then
  echo "parallel redeems left ${rate_count} attempt rows, expected 10" >&2
  exit 1
fi
echo "parallel rate limit ok"
