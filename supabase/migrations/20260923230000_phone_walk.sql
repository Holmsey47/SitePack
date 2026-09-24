-- Phone walk. Owner can mark a site finished. That mark is manual, not a completion date.
-- The site card names the contracts manager and counts operatives. The owner is not an assignee on the card.
-- A finished drawing request can be deleted. Closing one takes it off the working list.

alter table public.sites
  add column if not exists archived_at timestamptz;

comment on column public.sites.archived_at is
  'Set by the owner when the job is done. Null means the site stays on the working list. Not a completion date.';

create or replace function private.guard_site_archive()
returns trigger
language plpgsql
as $$
begin
  if new.archived_at is distinct from old.archived_at and private.my_role() is distinct from 'owner' then
    raise exception 'not_authorized';
  end if;
  return new;
end;
$$;

drop trigger if exists sites_guard_archive on public.sites;
create trigger sites_guard_archive
  before update on public.sites
  for each row execute function private.guard_site_archive();

create or replace function public.archive_site(p_site_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := private.my_role();
  v_company uuid := private.my_company_id();
begin
  if v_role is distinct from 'owner' or v_company is null then
    raise exception 'not_authorized';
  end if;

  update public.sites
  set archived_at = case when p_archived then coalesce(archived_at, now()) else null end
  where id = p_site_id
    and company_id = v_company;

  if not found then
    raise exception 'site_not_found';
  end if;
end;
$$;

revoke all on function public.archive_site(uuid, boolean) from public, anon;
grant execute on function public.archive_site(uuid, boolean) to authenticated;

create or replace function public.company_sites_pulse()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := private.my_role();
  v_company uuid := private.my_company_id();
  v_actor uuid := (
    select p.id from public.people p where p.auth_user_id = (select auth.uid())
  );
begin
  if v_role is null or v_role not in ('cm', 'owner') then
    raise exception 'not_authorized';
  end if;

  return coalesce(
    (
      select jsonb_agg(row_data order by row_data->>'name')
      from (
        select jsonb_build_object(
          'site_id', s.id,
          'name', s.name,
          'address_line', s.address_line,
          'assignee_count', (
            select count(*)::int from public.site_assignments a where a.site_id = s.id
          ),
          'assignee_names_preview', (
            select coalesce(jsonb_agg(sub.display_name), '[]'::jsonb)
            from (
              select coalesce(nullif(p.display_name, ''), p.email, 'Unknown') as display_name
              from public.site_assignments a
              join public.people p on p.id = a.person_id
              where a.site_id = s.id
              order by p.display_name nulls last
              limit 3
            ) sub
          ),
          'contracts_manager_names', (
            select coalesce(jsonb_agg(sub.display_name order by sub.display_name), '[]'::jsonb)
            from (
              select coalesce(nullif(p.display_name, ''), 'Unknown') as display_name
              from public.site_assignments a
              join public.people p on p.id = a.person_id
              where a.site_id = s.id
                and p.role = 'cm'
            ) sub
          ),
          'operative_count', (
            select count(*)::int
            from public.site_assignments a
            join public.people p on p.id = a.person_id
            where a.site_id = s.id
              and p.role = 'operative'
          ),
          'archived_at', s.archived_at,
          'last_pack_update', s.updated_at,
          'open_request_count', (
            select count(*)::int
            from public.drawing_requests r
            where r.site_id = s.id
              and r.status = 'Open'
          )
        ) as row_data
        from public.sites s
        where s.company_id = v_company
          and (
            v_role = 'owner'
            or exists (
              select 1
              from public.site_assignments a
              where a.site_id = s.id
                and a.person_id = v_actor
            )
          )
        order by s.name
      ) q
    ),
    '[]'::jsonb
  );
end;
$$;

grant delete on table public.drawing_requests to authenticated;

drop policy if exists drawing_requests_delete_cm_owner on public.drawing_requests;
create policy drawing_requests_delete_cm_owner
  on public.drawing_requests for delete to authenticated
  using (
    (
      private.my_role() = 'owner'
      and exists (
        select 1 from public.sites s
        where s.id = site_id and s.company_id = private.my_company_id()
      )
    )
    or (private.my_role() = 'cm' and private.can_access_site(site_id))
  );
