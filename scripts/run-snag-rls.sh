#!/usr/bin/env bash
# Apply the throwaway auth stand-in, every migration, and the snag RLS checks.
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

# Hosted Supabase already enables RLS on storage.objects and grants authenticated
# use of the storage schema and objects table. The table is owned by
# supabase_storage_admin there, so a migration must not repeat these.
# The variations migration creates a bucket, so the local stand-in needs this
# before migrations. It stays in this script, not in a migration.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant select, insert on table storage.objects to authenticated;
-- Hosted storage.objects already has these. The local stand-in may have been
-- created by an older script, so add them here rather than in a migration.
alter table storage.objects add column if not exists owner uuid;
alter table storage.objects add column if not exists owner_id text;
alter table storage.objects add column if not exists metadata jsonb;
SQL

for migration in supabase/migrations/*.sql; do
  echo "apply ${migration}"
  # Hosted Postgres grants EXECUTE to anon through default privileges, separately
  # from PUBLIC. Apply that grant only before the snag migration so the revoke
  # from anon is what the probe measures.
  if [[ "$migration" == *20261022170000_snags.sql ]]; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
alter default privileges in schema public grant execute on functions to anon;
alter default privileges in schema private grant execute on functions to anon;
drop table if exists public._snag_funcs_before;
create table public._snag_funcs_before as
select n.nspname, p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'private');
SQL
  fi
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"
  if [[ "$migration" == *20261022170000_snags.sql ]]; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
drop table if exists public._snag_funcs_after;
create table public._snag_funcs_after as
select n.nspname, p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'private');
SQL
  fi
done

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
drop table if exists public._snag_funcs_migration;
create table public._snag_funcs_migration (
  nspname text not null,
  proname text not null,
  primary key (nspname, proname)
);
SQL
awk '
  $0 ~ /create or replace function (public|private)\./ {
    if (match($0, /(public|private)\.[a-z0-9_]+/)) {
      name = substr($0, RSTART, RLENGTH)
      split(name, parts, ".")
      print "insert into public._snag_funcs_migration (nspname, proname) values ('\''" parts[1] "'\'', '\''" parts[2] "'\'') on conflict do nothing;"
    }
  }
' supabase/migrations/20261022170000_snags.sql | psql "$DATABASE_URL" -v ON_ERROR_STOP=1
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/snags-rls.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c 'drop table if exists public._snag_funcs_before; drop table if exists public._snag_funcs_after; drop table if exists public._snag_funcs_migration;'
echo "snag RLS ok"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/start-company.sql
echo "owner start grants ok"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/company-logo.sql
echo "company logo grants ok"
bash scripts/snag-signoff-race.sh
