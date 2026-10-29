-- One read of the new snag, variation, and request counts for Home.
-- The rows are the ones the site bar already selects. A row this person
-- created is left out. A row counts when it is newer than site_list_seen.seen_at,
-- or when this login has not opened that list yet.
-- Security invoker, so each table's RLS decides what this role can see.
-- No arguments: the caller cannot ask for another user.
-- Function only. No new table, and no change to an existing table or policy.
-- Do not apply this file to a hosted project from the app or CI.

create or replace function public.home_site_new_counts()
returns table (
  site_id uuid,
  snags_new integer,
  variations_new integer,
  requests_new integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    s.id as site_id,
    (
      select count(*)::integer
      from public.snags g
      left join public.site_list_seen seen
        on seen.user_id = (select auth.uid())
       and seen.site_id = g.site_id
       and seen.kind = 'snags'
      where g.site_id = s.id
        and g.raised_by is distinct from me.id
        and (seen.seen_at is null or g.raised_at > seen.seen_at)
    ) as snags_new,
    (
      select count(*)::integer
      from public.variation_versions v
      left join public.site_list_seen seen
        on seen.user_id = (select auth.uid())
       and seen.site_id = v.site_id
       and seen.kind = 'variations'
      where v.site_id = s.id
        and v.is_current
        and v.created_by is distinct from me.id
        and (seen.seen_at is null or v.created_at > seen.seen_at)
    ) as variations_new,
    (
      select count(*)::integer
      from public.drawing_requests r
      left join public.site_list_seen seen
        on seen.user_id = (select auth.uid())
       and seen.site_id = r.site_id
       and seen.kind = 'requests'
      where r.site_id = s.id
        and r.requester_id is distinct from me.id
        and (seen.seen_at is null or r.created_at > seen.seen_at)
    ) as requests_new
  from public.sites s
  join public.people me
    on me.auth_user_id = (select auth.uid())
  order by s.id;
$$;

comment on function public.home_site_new_counts() is
  'New snag, variation, and request counts for every site this login can already open. Same rows as the site bar. Read-only. No arguments.';

revoke all on function public.home_site_new_counts() from public, anon;
grant execute on function public.home_site_new_counts() to authenticated;
