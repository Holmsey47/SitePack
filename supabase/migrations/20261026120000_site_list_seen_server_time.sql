-- Stamp site_list_seen.seen_at from the database clock.
-- The column default applies on insert only. An upsert that conflicts does not
-- reapply it, and a client-supplied seen_at would replace it either way.
-- Draft only. Do not apply this file to a hosted project from the app or CI.

create or replace function private.stamp_site_list_seen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.seen_at := now();
  return new;
end;
$$;

comment on function private.stamp_site_list_seen() is
  'Sets seen_at to the database clock on insert and update. The client clock is ignored.';

revoke all on function private.stamp_site_list_seen() from public, anon;
grant execute on function private.stamp_site_list_seen() to authenticated;

drop trigger if exists site_list_seen_stamp on public.site_list_seen;
create trigger site_list_seen_stamp
  before insert or update on public.site_list_seen
  for each row execute function private.stamp_site_list_seen();

comment on column public.site_list_seen.seen_at is
  'Database clock when this login opened the list. The stamp trigger overwrites any client value.';
