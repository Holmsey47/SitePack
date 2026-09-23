-- Company people list, a no-login operative, and taking that operative off a site.
-- Client insert on people stays closed. The client still cannot set auth_user_id.
-- A row with no login stays on the labour list and does not count as a person on the app.

-- ---------------------------------------------------------------------------
-- Owner and contracts manager. Site names are text, including a site the
-- contracts manager is not on. No site id, drawing id, storage path, or email.
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
      ) q
    ),
    '[]'::jsonb
  );
end;
$$;

comment on function public.company_people() is
  'Labour list for the owner and contracts manager. has_login is auth_user_id is not null. Rows with no login do not move the price band. This function does not count them.';

revoke all on function public.company_people() from public, anon;
grant execute on function public.company_people() to authenticated;

-- ---------------------------------------------------------------------------
-- Checked create. Role, email, and auth_user_id are forced.
-- A contracts manager must pass only sites they are assigned to, and at least one.
-- The owner may pass any company site, or none.
-- ---------------------------------------------------------------------------

create or replace function public.add_no_login_operative(
  p_display_name text,
  p_trade text default null,
  p_site_ids uuid[] default array[]::uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := private.my_role();
  v_company uuid := private.my_company_id();
  v_actor uuid;
  v_name text := btrim(coalesce(p_display_name, ''));
  v_trade text := nullif(btrim(coalesce(p_trade, '')), '');
  v_site_ids uuid[] := coalesce(p_site_ids, array[]::uuid[]);
  v_seen uuid[] := array[]::uuid[];
  v_site uuid;
  v_person uuid;
begin
  if v_role is null or v_role not in ('cm', 'owner') or v_company is null then
    raise exception 'not_authorized';
  end if;

  v_actor := (
    select p.id from public.people p where p.auth_user_id = (select auth.uid())
  );
  if v_actor is null then
    raise exception 'not_authorized';
  end if;

  if v_name = '' then
    raise exception 'name_required';
  end if;

  if v_role = 'cm' and cardinality(v_site_ids) = 0 then
    raise exception 'not_authorized';
  end if;

  foreach v_site in array v_site_ids loop
    if v_site = any (v_seen) then
      continue;
    end if;

    if not exists (
      select 1
      from public.sites s
      where s.id = v_site
        and s.company_id = v_company
    ) then
      raise exception 'site_not_found';
    end if;

    if v_role = 'cm' and not private.is_assigned_to_site(v_site) then
      raise exception 'not_authorized';
    end if;

    v_seen := array_append(v_seen, v_site);
  end loop;

  insert into public.people (
    company_id,
    role,
    trade,
    display_name,
    email,
    auth_user_id
  ) values (
    v_company,
    'operative',
    v_trade,
    v_name,
    null,
    null
  )
  returning id into v_person;

  foreach v_site in array v_seen loop
    insert into public.site_assignments (site_id, person_id)
    values (v_site, v_person);
  end loop;

  return v_person;
end;
$$;

comment on function public.add_no_login_operative(text, text, uuid[]) is
  'Inserts one operative with email null and auth_user_id null. The caller cannot choose the role or the login.';

revoke all on function public.add_no_login_operative(text, text, uuid[]) from public, anon;
grant execute on function public.add_no_login_operative(text, text, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Take an operative off one site. The person row stays, including the last site.
-- ---------------------------------------------------------------------------

create or replace function public.remove_operative_from_site(
  p_person_id uuid,
  p_site_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := private.my_role();
  v_company uuid := private.my_company_id();
  v_person public.people;
begin
  if v_role is null or v_role not in ('cm', 'owner') or v_company is null then
    raise exception 'not_authorized';
  end if;

  select * into v_person
  from public.people p
  where p.id = p_person_id
    and p.company_id = v_company;

  if not found or v_person.role <> 'operative' then
    raise exception 'not_authorized';
  end if;

  if not exists (
    select 1
    from public.sites s
    where s.id = p_site_id
      and s.company_id = v_company
  ) then
    raise exception 'site_not_found';
  end if;

  if v_role = 'cm' and not private.is_assigned_to_site(p_site_id) then
    raise exception 'not_authorized';
  end if;

  delete from public.site_assignments
  where site_id = p_site_id
    and person_id = p_person_id;
end;
$$;

comment on function public.remove_operative_from_site(uuid, uuid) is
  'Removes one site assignment. Does not delete the person from the company.';

revoke all on function public.remove_operative_from_site(uuid, uuid) from public, anon;
grant execute on function public.remove_operative_from_site(uuid, uuid) to authenticated;

-- Keep client insert closed. Do not add an insert policy.
revoke insert on table public.people from authenticated, anon;
