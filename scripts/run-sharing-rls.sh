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

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/sharing-rls.sql
echo "sharing RLS ok"
