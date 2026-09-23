-- Seat shape: people.id is its own uuid. The login sits on auth_user_id.
-- Existing people.id values stay. auth_user_id is filled with that same id,
-- so sites, drawings, requests, and audit keep pointing at the same person.
-- Do not edit the shipped v0 or folders migrations.
-- The live replace_drawing is the folders function (with p_folder). This
-- redefines that signature. It does not bring the v0 signature back.

-- ---------------------------------------------------------------------------
-- people.id is generated. It is no longer a foreign key to auth.users.
-- ---------------------------------------------------------------------------

alter table public.people drop constraint people_id_fkey;

alter table public.people
  alter column id set default gen_random_uuid();

comment on column public.people.id is
  'Person id. Generated. Not the login. Existing rows keep the id they already had.';

-- ---------------------------------------------------------------------------
-- auth_user_id: unique, nullable, cleared when the auth user is deleted.
-- ---------------------------------------------------------------------------

alter table public.people
  add column auth_user_id uuid;

comment on column public.people.auth_user_id is
  'Login. Null means no login. This loop does not insert a null. Cleared when the auth user is deleted.';

update public.people
set auth_user_id = id
where auth_user_id is null;

alter table public.people
  add constraint people_auth_user_id_fkey
  foreign key (auth_user_id) references auth.users (id) on delete set null;

alter table public.people
  add constraint people_auth_user_id_key unique (auth_user_id);

-- ---------------------------------------------------------------------------
-- A missing email is null. Blank and whitespace are missing.
-- The company email unique index already skips null.
-- ---------------------------------------------------------------------------

update public.people
set email = null
where email is not null and btrim(email) = '';

alter table public.people
  add constraint people_email_not_blank
  check (email is null or btrim(email) <> '');

-- ---------------------------------------------------------------------------
-- Identity: a normal session, including an owner, cannot change the login link.
-- The invite function uses the service role and has no auth.uid(), so it
-- remains the only writer of auth_user_id.
-- ---------------------------------------------------------------------------

create or replace function private.protect_people_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'not_authorized';
  end if;
  if new.company_id is distinct from old.company_id then
    raise exception 'not_authorized';
  end if;
  if new.auth_user_id is distinct from old.auth_user_id and auth.uid() is not null then
    raise exception 'not_authorized';
  end if;
  if new.role is distinct from old.role and coalesce(private.my_role(), '') <> 'owner' then
    raise exception 'not_authorized';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Session helpers. The person id comes from the row found by auth_user_id.
-- ---------------------------------------------------------------------------

drop function if exists private.current_person();

create function private.current_person()
returns public.people
language sql
stable
security definer
set search_path = public
as $$
  select p.*
  from public.people p
  where p.auth_user_id = (select auth.uid());
$$;

create or replace function private.my_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.company_id
  from public.people p
  where p.auth_user_id = (select auth.uid());
$$;

create or replace function private.my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.people p
  where p.auth_user_id = (select auth.uid());
$$;

create or replace function private.is_assigned_to_site(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.site_assignments a
    where a.site_id = p_site_id
      and a.person_id = (
        select p.id from public.people p where p.auth_user_id = (select auth.uid())
      )
  );
$$;

-- Operative AND CM: assigned only. Owner: any site in company.
create or replace function private.can_access_site(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.sites s
    join public.people p on p.auth_user_id = (select auth.uid())
    where s.id = p_site_id
      and s.company_id = p.company_id
      and (
        p.role = 'owner'
        or exists (
          select 1
          from public.site_assignments a
          where a.site_id = s.id
            and a.person_id = p.id
        )
      )
  );
$$;

grant execute on function private.current_person() to authenticated, service_role;
grant execute on function private.my_company_id() to authenticated, service_role;
grant execute on function private.my_role() to authenticated, service_role;
grant execute on function private.is_assigned_to_site(uuid) to authenticated, service_role;
grant execute on function private.can_access_site(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Authenticated sessions lose insert. Self-update matches auth_user_id.
-- Assignment read and drawing-request read/insert use people.id.
-- ---------------------------------------------------------------------------

revoke insert on table public.people from authenticated;

drop policy if exists people_insert_owner on public.people;

drop policy if exists people_update_self_or_owner on public.people;
create policy people_update_self_or_owner
  on public.people for update to authenticated
  using (
    auth_user_id = (select auth.uid())
    or (private.my_role() = 'owner' and company_id = private.my_company_id())
  )
  with check (company_id = private.my_company_id());

drop policy if exists site_assignments_select on public.site_assignments;
create policy site_assignments_select
  on public.site_assignments for select to authenticated
  using (
    person_id = (
      select p.id from public.people p where p.auth_user_id = (select auth.uid())
    )
    or (
      private.my_role() = 'owner'
      and exists (
        select 1 from public.sites s
        where s.id = site_id and s.company_id = private.my_company_id()
      )
    )
    or (private.my_role() = 'cm' and private.can_access_site(site_id))
  );

drop policy if exists drawing_requests_select on public.drawing_requests;
create policy drawing_requests_select
  on public.drawing_requests for select to authenticated
  using (
    requester_id = (
      select p.id from public.people p where p.auth_user_id = (select auth.uid())
    )
    or (
      private.my_role() = 'owner'
      and exists (
        select 1 from public.sites s
        where s.id = site_id and s.company_id = private.my_company_id()
      )
    )
    or (private.my_role() = 'cm' and private.can_access_site(site_id))
  );

drop policy if exists drawing_requests_insert_on_site on public.drawing_requests;
create policy drawing_requests_insert_on_site
  on public.drawing_requests for insert to authenticated
  with check (
    requester_id = (
      select p.id from public.people p where p.auth_user_id = (select auth.uid())
    )
    and private.can_access_site(site_id)
    and status = 'Open'
  );

-- ---------------------------------------------------------------------------
-- Live replace_drawing (folders signature). uploaded_by and the audit actor
-- are people.id, not the login.
-- ---------------------------------------------------------------------------

create or replace function public.replace_drawing(
  p_site_id uuid,
  p_title text,
  p_revision text,
  p_storage_path text,
  p_sheet_number text default null,
  p_dated date default null,
  p_file_size_bytes bigint default null,
  p_content_type text default 'application/pdf',
  p_replace_drawing_id uuid default null,
  p_id uuid default null,
  p_folder text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.drawings;
  v_new public.drawings;
  v_sheet_key text;
  v_action text;
  v_folder text;
  v_actor uuid;
begin
  if not private.is_cm_or_owner() or not private.can_access_site(p_site_id) then
    raise exception 'not_authorized';
  end if;

  v_actor := (
    select p.id from public.people p where p.auth_user_id = (select auth.uid())
  );
  if v_actor is null then
    raise exception 'not_authorized';
  end if;

  if not exists (select 1 from public.sites s where s.id = p_site_id) then
    raise exception 'site_not_found';
  end if;

  if p_storage_path is null or length(trim(p_storage_path)) = 0 then
    raise exception 'storage_path_required';
  end if;

  if p_title is null or length(trim(p_title)) = 0 or p_revision is null or length(trim(p_revision)) = 0 then
    raise exception 'title_and_revision_required';
  end if;

  v_sheet_key := coalesce(nullif(trim(coalesce(p_sheet_number, '')), ''), '');

  if p_replace_drawing_id is not null then
    select * into v_old
    from public.drawings d
    where d.id = p_replace_drawing_id
      and d.site_id = p_site_id
    for update;

    if not found or v_old.is_current is not true then
      raise exception 'replace_target_not_current';
    end if;
  else
    select * into v_old
    from public.drawings d
    where d.site_id = p_site_id
      and d.title = trim(p_title)
      and d.sheet_key = v_sheet_key
      and d.is_current = true
    for update;
  end if;

  -- Null p_folder copies the previous current folder. Blank becomes Other.
  -- A sent name moves only the new current row. The superseded row keeps its folder.
  if p_folder is null then
    v_folder := coalesce(nullif(trim(coalesce(v_old.folder, '')), ''), 'Other');
  else
    v_folder := coalesce(nullif(trim(p_folder), ''), 'Other');
  end if;

  -- Flip old current first so the unique partial index never sees two currents.
  if v_old.id is not null then
    update public.drawings
    set is_current = false
    where id = v_old.id;
    v_action := 'replace';
  else
    v_action := 'upload';
  end if;

  insert into public.drawings (
    id,
    site_id,
    title,
    sheet_number,
    revision,
    dated,
    is_current,
    supersedes_id,
    storage_path,
    file_size_bytes,
    content_type,
    uploaded_by,
    folder
  ) values (
    coalesce(p_id, gen_random_uuid()),
    p_site_id,
    trim(p_title),
    nullif(trim(coalesce(p_sheet_number, '')), ''),
    trim(p_revision),
    p_dated,
    true,
    v_old.id,
    trim(p_storage_path),
    p_file_size_bytes,
    coalesce(nullif(trim(coalesce(p_content_type, '')), ''), 'application/pdf'),
    v_actor,
    v_folder
  )
  returning * into v_new;

  update public.sites
  set updated_at = now()
  where id = p_site_id;

  insert into public.drawing_audit (drawing_id, site_id, actor_id, action, revision)
  values (v_new.id, p_site_id, v_actor, v_action, v_new.revision);

  return to_jsonb(v_new);
end;
$$;

revoke all on function public.replace_drawing(
  uuid, text, text, text, text, date, bigint, text, uuid, uuid, text
) from public, anon;

grant execute on function public.replace_drawing(
  uuid, text, text, text, text, date, bigint, text, uuid, uuid, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- Pulse scope stays: owner sees the company, a contracts manager sees
-- assigned sites. The contracts manager match uses people.id.
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
              select coalesce(nullif(p.display_name, ''), p.email, 'Unknown') as display_name
              from public.site_assignments a
              join public.people p on p.id = a.person_id
              where a.site_id = s.id
              order by p.display_name nulls last
              limit 3
            ) sub
          ),
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
