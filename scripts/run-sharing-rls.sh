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
python3 - <<'PY'
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
if len(seen) != 26 or replaced - set(seen):
    raise SystemExit(f"expected 26 functions including the 2 replaced, found {len(seen)}")
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
Path("/tmp/share_funcs_expected.sql").write_text("\n".join(lines) + "\n")
PY
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /tmp/share_funcs_expected.sql

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/sharing-rls.sql
echo "sharing RLS ok"
