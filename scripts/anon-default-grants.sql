-- Hosted Supabase grants EXECUTE on new functions to anon, authenticated, and
-- service_role. Stock Postgres only grants EXECUTE to PUBLIC, so a migration
-- that forgets `revoke ... from anon` still looks safe here.
-- Apply this immediately before the attendance migration. Older migrations
-- revoke PUBLIC and not anon; applying it first would fail their probes.
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema private grant execute on functions to anon, authenticated, service_role;
