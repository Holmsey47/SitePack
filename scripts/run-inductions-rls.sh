#!/usr/bin/env bash
# Apply the throwaway auth stand-in, every migration, and the induction RLS checks.
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
  if [[ "$base" == "20261022190000_inductions.sql" ]]; then
    echo "apply anon default grants"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/anon-default-grants.sql
    echo "snapshot functions before inductions"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
drop table if exists public.probe_funcs_before;
create table public.probe_funcs_before (
  schema_name text,
  func_name text,
  identity_args text
);
insert into public.probe_funcs_before (schema_name, func_name, identity_args)
select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'private');
SQL
  fi
  echo "apply ${migration}"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"
done

talk_file="supabase/migrations/20261022190000_inductions.sql"
talk_func_count="$(grep -cE '^create or replace function ' "$talk_file")"
talk_public_count="$(grep -cE '^create or replace function public\.' "$talk_file")"
talk_private_count="$(grep -cE '^create or replace function private\.' "$talk_file")"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v talk_func_count="$talk_func_count" \
  -v talk_public_count="$talk_public_count" \
  -v talk_private_count="$talk_private_count" \
  -f scripts/inductions-rls.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c 'drop table if exists public.probe_funcs_before'
echo "inductions RLS ok"
