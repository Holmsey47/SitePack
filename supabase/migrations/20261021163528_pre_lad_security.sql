-- Pre-lad people visibility.
-- An operative reads themself and people on their sites, never another person's
-- email or phone. A contracts manager is limited to the same site set. The owner
-- still reads every person in the company. Contact columns stay off the table
-- grant so a direct select cannot bypass the directory.

-- ---------------------------------------------------------------------------
-- Shared-site check. Security definer so the people policy does not recurse
-- through site_assignments policies, which themselves read people.
-- ---------------------------------------------------------------------------

create or replace function private.shares_assigned_site(p_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.site_assignments mine
    join public.site_assignments theirs on theirs.site_id = mine.site_id
    where mine.person_id = (
      select p.id
      from public.people p
      where p.auth_user_id = (select auth.uid())
    )
      and theirs.person_id = p_person_id
  );
$$;

do $acl$
begin
  if to_regprocedure('private.shares_assigned_site(uuid)') is not null then
    revoke all on function private.shares_assigned_site(uuid) from public, anon;
    grant execute on function private.shares_assigned_site(uuid) to authenticated, service_role;
  end if;
end
$acl$;

-- ---------------------------------------------------------------------------
-- Row visibility. Owner: the company. Everyone else: self, plus people who
-- share an assigned site.
-- ---------------------------------------------------------------------------

drop policy if exists people_select_same_company on public.people;
drop policy if exists people_select_visible on public.people;

create policy people_select_visible
  on public.people for select to authenticated
  using (
    company_id = private.my_company_id()
    and (
      private.my_role() = 'owner'
      or auth_user_id = (select auth.uid())
      or private.shares_assigned_site(id)
    )
  );

-- Table-level select includes email and phone. Drop it, then grant the columns
-- the client may read. Authenticated cannot select email or phone on any row.
do $acl$
begin
  if to_regclass('public.people') is not null then
    revoke select on table public.people from public, anon, authenticated;
    grant select (
      id,
      auth_user_id,
      company_id,
      role,
      trade,
      display_name,
      created_at
    ) on table public.people to authenticated;
  end if;
end
$acl$;

-- ---------------------------------------------------------------------------
-- Client list surface. security_invoker so people_select_visible still applies.
-- ---------------------------------------------------------------------------

create or replace view public.people_directory
with (security_invoker = true, security_barrier = true)
as
select
  id,
  auth_user_id,
  company_id,
  role,
  trade,
  display_name,
  created_at
from public.people;

comment on view public.people_directory is
  'People the caller may list. No email or phone. Row visibility follows people_select_visible.';

do $acl$
begin
  if to_regclass('public.people_directory') is not null then
    revoke all on table public.people_directory from public, anon, authenticated;
    grant select on table public.people_directory to authenticated;
  end if;
end
$acl$;

-- ---------------------------------------------------------------------------
-- The signed-in user's own row, including email and phone. No argument, so it
-- cannot be pointed at someone else.
-- ---------------------------------------------------------------------------

create or replace function public.my_person()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'auth_user_id', p.auth_user_id,
    'company_id', p.company_id,
    'role', p.role,
    'trade', p.trade,
    'display_name', p.display_name,
    'email', p.email,
    'phone', p.phone,
    'created_at', p.created_at
  )
  from public.people p
  where p.auth_user_id = (select auth.uid());
$$;

comment on function public.my_person() is
  'The caller''s own people row, including email and phone. Null when the login has no row.';

do $acl$
begin
  if to_regprocedure('public.my_person()') is not null then
    revoke all on function public.my_person() from public, anon;
    grant execute on function public.my_person() to authenticated;
  end if;
end
$acl$;

-- ---------------------------------------------------------------------------
-- Labour list bypasses RLS. Apply the same site rule inside the function.
-- Site names stay text, including a site the contracts manager is not on,
-- but only for a person they are allowed to see.
-- ---------------------------------------------------------------------------

create or replace function public.company_people()
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
  if v_role is null or v_role not in ('cm', 'owner') or v_company is null then
    raise exception 'not_authorized';
  end if;

  return coalesce(
    (
      select jsonb_agg(row_data order by row_data->>'display_name', row_data->>'id')
      from (
        select jsonb_build_object(
          'id', p.id,
          'display_name', p.display_name,
          'role', p.role,
          'trade', p.trade,
          'has_login', p.auth_user_id is not null,
          'site_names', coalesce(
            (
              select jsonb_agg(s.name order by s.name)
              from public.site_assignments a
              join public.sites s on s.id = a.site_id
              where a.person_id = p.id
                and s.company_id = p.company_id
            ),
            '[]'::jsonb
          )
        ) as row_data
        from public.people p
        where p.company_id = v_company
          and (
            v_role = 'owner'
            or p.id = v_actor
            or private.shares_assigned_site(p.id)
          )
      ) q
    ),
    '[]'::jsonb
  );
end;
$$;

comment on function public.company_people() is
  'Labour list. The owner sees the company. A contracts manager sees themself and people on their sites. has_login is auth_user_id is not null. No email.';

-- ---------------------------------------------------------------------------
-- M10. Postgres grants execute to public by default. anon was callable.
-- Authenticated keeps the app RPC.
-- ---------------------------------------------------------------------------

do $acl$
begin
  if to_regprocedure('public.site_contracts_manager_names(uuid)') is not null then
    revoke all on function public.site_contracts_manager_names(uuid) from public, anon;
    grant execute on function public.site_contracts_manager_names(uuid) to authenticated;
  end if;
end
$acl$;

-- ---------------------------------------------------------------------------
-- Site pulse. A blank display name is Unknown. It never falls back to email:
-- anyone can clear their own name, and a contracts manager can read the pulse.
-- ---------------------------------------------------------------------------

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
              select coalesce(nullif(btrim(p.display_name), ''), 'Unknown') as display_name
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
              select coalesce(nullif(btrim(p.display_name), ''), 'Unknown') as display_name
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

comment on function public.company_sites_pulse() is
  'Site list for the owner and contracts managers. Assignee names use the display name, or Unknown. Never email.';

do $acl$
begin
  if to_regprocedure('public.company_sites_pulse()') is not null then
    revoke all on function public.company_sites_pulse() from public, anon;
    grant execute on function public.company_sites_pulse() to authenticated;
  end if;
end
$acl$;

-- ---------------------------------------------------------------------------
-- Owner contact list. Column grants hide email and phone from every direct
-- select, including the owner's. This is the only read of other people's
-- contact fields, and only for the owner of that company.
-- ---------------------------------------------------------------------------

create or replace function public.company_contacts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := private.my_role();
  v_company uuid := private.my_company_id();
begin
  if v_role is distinct from 'owner' or v_company is null then
    raise exception 'not_authorized';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'email', p.email,
          'phone', p.phone
        )
        order by p.id
      )
      from public.people p
      where p.company_id = v_company
    ),
    '[]'::jsonb
  );
end;
$$;

comment on function public.company_contacts() is
  'Email and phone for people in the caller''s company. Owner only. Contracts managers and operatives get not_authorized.';

do $acl$
begin
  if to_regprocedure('public.company_contacts()') is not null then
    revoke all on function public.company_contacts() from public, anon;
    grant execute on function public.company_contacts() to authenticated;
  end if;
end
$acl$;

-- ---------------------------------------------------------------------------
-- Pin search_path. Bodies already schema-qualify storage.* and private.*.
-- pg_catalog stays on the implicit path, so trim, now, and casts still resolve.
-- ---------------------------------------------------------------------------

alter function private.try_uuid(text) set search_path = '';
alter function private.touch_updated_at() set search_path = '';
alter function private.storage_site_id(text) set search_path = '';
alter function private.storage_company_id(text) set search_path = '';
alter function private.guard_site_archive() set search_path = '';
