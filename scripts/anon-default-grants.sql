-- Match hosted Supabase: new public objects are executable by anon until a migration revokes it.
-- This is the only anon-defaults stub. Every database CI job loads it from here.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
