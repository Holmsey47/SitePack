-- People groups: a named crew the owner keeps, and a speed tool for site assignments.
-- Visibility stays on site_assignments. A group does not grant site access by itself.
-- Owner creates, renames, deletes, and sets members. A contracts manager may only
-- assign or remove an existing group on a site they can already access as CM.
-- Writes go through these security definer functions. Authenticated can select
-- groups in their company when they are the owner or a contracts manager.
-- Operatives cannot read groups. There is no people or site audit table
-- (drawing_audit is drawings only), so assign and remove do not write an audit row.
-- Removing a group from a site deletes that site's assignments for every current
-- member, including a person who was also assigned on their own, and including
-- the owner if they are a member. Other sites are left alone. People rows stay.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.people_groups (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.people (id) on delete set null
);

create table if not exists public.people_group_members (
  group_id uuid not null references public.people_groups (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  primary key (group_id, person_id)
);

create index if not exists people_group_members_person_id_idx
  on public.people_group_members (person_id);

comment on table public.people_groups is
  'Named crew inside one company. Not a visibility model. Name is trimmed, 1 to 40 characters, unique per company ignoring case.';

comment on table public.people_group_members is
  'People in a group. person_id must belong to the same company as the group.';

alter table public.people_groups drop constraint if exists people_groups_name_len;
alter table public.people_groups
  add constraint people_groups_name_len
  check (char_length(name) between 1 and 40 and name = btrim(name));

drop index if exists public.people_groups_company_name_lower_idx;
create unique index people_groups_company_name_lower_idx
  on public.people_groups (company_id, lower(name));

-- ---------------------------------------------------------------------------
-- Same-company members. The RPC checks too. This blocks a direct insert.
-- ---------------------------------------------------------------------------

create or replace function private.people_group_member_same_company()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.people_groups g
    join public.people p on p.id = new.person_id
    where g.id = new.group_id
      and p.company_id = g.company_id
  ) then
    raise exception 'person_not_in_company';
  end if;
  return new;
end;
$$;

drop trigger if exists people_group_members_same_company on public.people_group_members;
create trigger people_group_members_same_company
  before insert or update on public.people_group_members
  for each row execute function private.people_group_member_same_company();

revoke all on function private.people_group_member_same_company() from public, anon;

-- ---------------------------------------------------------------------------
-- Read: owner and contracts manager, own company only. No client writes.
-- ---------------------------------------------------------------------------

alter table public.people_groups enable row level security;
alter table public.people_group_members enable row level security;

revoke all on table public.people_groups from public, anon, authenticated;
revoke all on table public.people_group_members from public, anon, authenticated;
grant select on table public.people_groups to authenticated;
grant select on table public.people_group_members to authenticated;

drop policy if exists people_groups_select on public.people_groups;
create policy people_groups_select
  on public.people_groups for select to authenticated
  using (
    company_id = private.my_company_id()
    and private.my_role() in ('owner', 'cm')
  );

drop policy if exists people_group_members_select on public.people_group_members;
create policy people_group_members_select
  on public.people_group_members for select to authenticated
  using (
    exists (
      select 1
      from public.people_groups g
      where g.id = people_group_members.group_id
        and g.company_id = private.my_company_id()
        and private.my_role() in ('owner', 'cm')
    )
  );

-- ---------------------------------------------------------------------------
-- Shared actor check. search_path is empty. auth.uid() is schema-qualified.
-- ---------------------------------------------------------------------------

create or replace function private.people_group_actor()
returns table (person_id uuid, company_id uuid, role text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.company_id, p.role
  from public.people p
  where p.auth_user_id = (select auth.uid());
$$;

revoke all on function private.people_group_actor() from public, anon;

-- ---------------------------------------------------------------------------
-- Owner: create, rename, delete, replace members.
-- ---------------------------------------------------------------------------

create or replace function public.create_people_group(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
begin
  select * into v_actor from private.people_group_actor();
  if not found or v_actor.role is distinct from 'owner' or v_actor.company_id is null then
    raise exception 'not_authorized';
  end if;

  if v_name = '' then
    raise exception 'name_required';
  end if;
  if char_length(v_name) > 40 then
    raise exception 'name_too_long';
  end if;

  begin
    insert into public.people_groups (company_id, name, created_by)
    values (v_actor.company_id, v_name, v_actor.person_id)
    returning id into v_id;
  exception
    when unique_violation then
      raise exception 'name_in_use';
  end;

  return v_id;
end;
$$;

create or replace function public.rename_people_group(p_group_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_name text := btrim(coalesce(p_name, ''));
begin
  select * into v_actor from private.people_group_actor();
  if not found or v_actor.role is distinct from 'owner' or v_actor.company_id is null then
    raise exception 'not_authorized';
  end if;

  if v_name = '' then
    raise exception 'name_required';
  end if;
  if char_length(v_name) > 40 then
    raise exception 'name_too_long';
  end if;

  begin
    update public.people_groups
    set name = v_name
    where id = p_group_id
      and company_id = v_actor.company_id;
    if not found then
      raise exception 'not_authorized';
    end if;
  exception
    when unique_violation then
      raise exception 'name_in_use';
  end;
end;
$$;

create or replace function public.delete_people_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
begin
  select * into v_actor from private.people_group_actor();
  if not found or v_actor.role is distinct from 'owner' or v_actor.company_id is null then
    raise exception 'not_authorized';
  end if;

  delete from public.people_groups
  where id = p_group_id
    and company_id = v_actor.company_id;
  if not found then
    raise exception 'not_authorized';
  end if;
end;
$$;

create or replace function public.set_people_group_members(p_group_id uuid, p_person_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_ids uuid[];
begin
  select * into v_actor from private.people_group_actor();
  if not found or v_actor.role is distinct from 'owner' or v_actor.company_id is null then
    raise exception 'not_authorized';
  end if;

  if not exists (
    select 1
    from public.people_groups g
    where g.id = p_group_id
      and g.company_id = v_actor.company_id
  ) then
    raise exception 'not_authorized';
  end if;

  if p_person_ids is not null and exists (
    select 1 from unnest(p_person_ids) as wanted (id) where wanted.id is null
  ) then
    raise exception 'person_not_in_company';
  end if;

  select coalesce(array_agg(distinct wanted.id), array[]::uuid[])
  into v_ids
  from unnest(coalesce(p_person_ids, array[]::uuid[])) as wanted (id);

  if exists (
    select 1
    from unnest(v_ids) as wanted (id)
    where not exists (
      select 1
      from public.people p
      where p.id = wanted.id
        and p.company_id = v_actor.company_id
    )
  ) then
    raise exception 'person_not_in_company';
  end if;

  delete from public.people_group_members
  where group_id = p_group_id
    and not (person_id = any (v_ids));

  insert into public.people_group_members (group_id, person_id)
  select p_group_id, wanted.id
  from unnest(v_ids) as wanted (id)
  on conflict (group_id, person_id) do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- Assign and remove. Owner: any site in the company. CM: can_access_site only.
-- Every site and every member is checked against the caller's company.
-- Assign inserts missing site_assignments and is safe to repeat.
-- Remove deletes this site's assignments for current members only.
-- ---------------------------------------------------------------------------

create or replace function public.assign_group_to_sites(p_group_id uuid, p_site_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_site uuid;
  v_seen uuid[] := array[]::uuid[];
  v_added int := 0;
  v_batch int := 0;
begin
  select * into v_actor from private.people_group_actor();
  if not found
    or v_actor.company_id is null
    or v_actor.role is null
    or v_actor.role not in ('owner', 'cm') then
    raise exception 'not_authorized';
  end if;

  if not exists (
    select 1
    from public.people_groups g
    where g.id = p_group_id
      and g.company_id = v_actor.company_id
  ) then
    raise exception 'not_authorized';
  end if;

  if exists (
    select 1
    from public.people_group_members m
    left join public.people p
      on p.id = m.person_id
     and p.company_id = v_actor.company_id
    where m.group_id = p_group_id
      and p.id is null
  ) then
    raise exception 'person_not_in_company';
  end if;

  if p_site_ids is null or cardinality(p_site_ids) = 0 then
    raise exception 'site_required';
  end if;

  foreach v_site in array p_site_ids loop
    if v_site is null then
      raise exception 'site_not_found';
    end if;
    if v_site = any (v_seen) then
      continue;
    end if;

    if not exists (
      select 1
      from public.sites s
      where s.id = v_site
        and s.company_id = v_actor.company_id
    ) then
      raise exception 'site_not_found';
    end if;

    if v_actor.role = 'cm' and not private.can_access_site(v_site) then
      raise exception 'not_authorized';
    end if;

    v_seen := array_append(v_seen, v_site);
  end loop;

  if cardinality(v_seen) = 0 then
    raise exception 'site_required';
  end if;

  foreach v_site in array v_seen loop
    insert into public.site_assignments (site_id, person_id)
    select v_site, m.person_id
    from public.people_group_members m
    where m.group_id = p_group_id
    on conflict (site_id, person_id) do nothing;
    get diagnostics v_batch = row_count;
    v_added := v_added + v_batch;
  end loop;

  return jsonb_build_object('added', v_added);
end;
$$;

create or replace function public.remove_group_from_site(p_group_id uuid, p_site_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_removed int := 0;
begin
  select * into v_actor from private.people_group_actor();
  if not found
    or v_actor.company_id is null
    or v_actor.role is null
    or v_actor.role not in ('owner', 'cm') then
    raise exception 'not_authorized';
  end if;

  if not exists (
    select 1
    from public.people_groups g
    where g.id = p_group_id
      and g.company_id = v_actor.company_id
  ) then
    raise exception 'not_authorized';
  end if;

  if p_site_id is null or not exists (
    select 1
    from public.sites s
    where s.id = p_site_id
      and s.company_id = v_actor.company_id
  ) then
    raise exception 'site_not_found';
  end if;

  if v_actor.role = 'cm' and not private.can_access_site(p_site_id) then
    raise exception 'not_authorized';
  end if;

  if exists (
    select 1
    from public.people_group_members m
    left join public.people p
      on p.id = m.person_id
     and p.company_id = v_actor.company_id
    where m.group_id = p_group_id
      and p.id is null
  ) then
    raise exception 'person_not_in_company';
  end if;

  delete from public.site_assignments a
  using public.people_group_members m
  where a.site_id = p_site_id
    and m.group_id = p_group_id
    and a.person_id = m.person_id;
  get diagnostics v_removed = row_count;

  return jsonb_build_object('removed', v_removed);
end;
$$;

revoke all on function public.create_people_group(text) from public, anon;
revoke all on function public.rename_people_group(uuid, text) from public, anon;
revoke all on function public.delete_people_group(uuid) from public, anon;
revoke all on function public.set_people_group_members(uuid, uuid[]) from public, anon;
revoke all on function public.assign_group_to_sites(uuid, uuid[]) from public, anon;
revoke all on function public.remove_group_from_site(uuid, uuid) from public, anon;

grant execute on function public.create_people_group(text) to authenticated;
grant execute on function public.rename_people_group(uuid, text) to authenticated;
grant execute on function public.delete_people_group(uuid) to authenticated;
grant execute on function public.set_people_group_members(uuid, uuid[]) to authenticated;
grant execute on function public.assign_group_to_sites(uuid, uuid[]) to authenticated;
grant execute on function public.remove_group_from_site(uuid, uuid) to authenticated;

comment on function public.create_people_group(text) is
  'Owner creates a group in their company. Name is trimmed, 1 to 40 characters.';

comment on function public.rename_people_group(uuid, text) is
  'Owner renames a group in their company.';

comment on function public.delete_people_group(uuid) is
  'Owner deletes a group and its members. Site assignments are not removed.';

comment on function public.set_people_group_members(uuid, uuid[]) is
  'Owner replaces the member list. Every person must be in the group company.';

comment on function public.assign_group_to_sites(uuid, uuid[]) is
  'Inserts site_assignments for members not already on each site. Returns {added}. Owner: company sites. CM: sites they can access.';

comment on function public.remove_group_from_site(uuid, uuid) is
  'Deletes this site''s assignments for current group members. Other sites stay. Returns {removed}.';
