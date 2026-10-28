#!/usr/bin/env bash
# Apply the throwaway auth stand-in, every migration, and the site-document RLS checks.
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

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant select, insert, update, delete on table storage.objects to authenticated;
SQL

for migration in supabase/migrations/*.sql; do
  echo "apply ${migration}"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"
done

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/site-documents-rls.sql
echo "site document RLS ok"
