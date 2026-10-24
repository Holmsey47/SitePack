-- When this login last opened the snag, variation, or request list on a site.
-- The badge counts rows that login can already select, with a timestamp after seen_at.
-- Draft only. Do not apply this file to a hosted project from the app or CI.
-- This migration does not touch storage, auth, invites, drawings, or variations.

create table public.site_list_seen (
  user_id uuid not null references auth.users (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  kind text not null,
  seen_at timestamptz not null default now(),
  constraint site_list_seen_pkey primary key (user_id, site_id, kind),
  constraint site_list_seen_kind check (kind in ('snags', 'variations', 'requests'))
);

create index site_list_seen_site_idx on public.site_list_seen (site_id);

comment on table public.site_list_seen is
  'Per auth user, per site, when they last opened Snags, Variations, or Requests. No delete. Callers may only read and write their own row.';

comment on column public.site_list_seen.user_id is
  'auth.uid() of the person who opened the list. Not people.id.';

comment on column public.site_list_seen.seen_at is
  'Server or client time the list was opened. Items at or before this time are not new.';

alter table public.site_list_seen enable row level security;

revoke all on table public.site_list_seen from public, anon, authenticated;

grant select, insert, update on table public.site_list_seen to authenticated;

create policy site_list_seen_select
  on public.site_list_seen for select to authenticated
  using (user_id = (select auth.uid()));

create policy site_list_seen_insert
  on public.site_list_seen for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and private.can_access_site(site_id)
  );

create policy site_list_seen_update
  on public.site_list_seen for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and private.can_access_site(site_id)
  );

-- People on a site. Owner, CM, and operative can read assignments for a site
-- they can already open. Insert and delete stay on the existing owner/CM policies.
drop policy if exists site_assignments_select on public.site_assignments;
create policy site_assignments_select
  on public.site_assignments for select to authenticated
  using (private.can_access_site(site_id));
