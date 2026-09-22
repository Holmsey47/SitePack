-- SitePack v0 drawings pack
-- Tables → private helpers → RLS → RPCs → storage.
-- Phase B snag/photo tables are intentionally absent.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.people (
  id uuid primary key references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  role text not null check (role in ('operative', 'cm', 'owner')),
  trade text,
  display_name text,
  email text,
  phone text,
  created_at timestamptz not null default now()
);

create index people_company_id_idx on public.people (company_id);
create index people_company_role_idx on public.people (company_id, role);
create unique index people_company_email_idx
  on public.people (company_id, lower(email))
  where email is not null;

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  address_line text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sites_company_id_idx on public.sites (company_id);

create table public.site_assignments (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (site_id, person_id)
);

create index site_assignments_person_id_idx on public.site_assignments (person_id);
create index site_assignments_site_id_idx on public.site_assignments (site_id);

create table public.drawings (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete cascade,
  title text not null,
  sheet_number text,
  revision text not null,
  dated date,
  is_current boolean not null default false,
  supersedes_id uuid references public.drawings (id),
  storage_path text not null,
  file_size_bytes bigint,
  content_type text not null default 'application/pdf',
  uploaded_by uuid references public.people (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sheet_key text generated always as (coalesce(nullif(trim(sheet_number), ''), '')) stored
);

create unique index drawings_one_current_per_sheet
  on public.drawings (site_id, title, sheet_key)
  where is_current;
create index drawings_site_current_idx on public.drawings (site_id, is_current);
create index drawings_site_id_idx on public.drawings (site_id);

create table public.drawing_requests (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete cascade,
  requester_id uuid not null references public.people (id),
  body text not null,
  sheet_hint text,
  photo_path text,
  status text not null check (status in ('Open', 'Sent', 'Closed')),
  fulfilled_drawing_id uuid references public.drawings (id),
  cm_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index drawing_requests_site_status_idx on public.drawing_requests (site_id, status);
create index drawing_requests_requester_id_idx on public.drawing_requests (requester_id);
create index drawing_requests_open_idx
  on public.drawing_requests (site_id)
  where status = 'Open';

create table public.drawing_audit (
  id uuid primary key default gen_random_uuid(),
  drawing_id uuid not null references public.drawings (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  actor_id uuid references public.people (id),
  action text not null check (action in ('upload', 'replace')),
  revision text,
  created_at timestamptz not null default now()
);

create index drawing_audit_site_created_idx on public.drawing_audit (site_id, created_at desc);
create index drawing_audit_drawing_id_idx on public.drawing_audit (drawing_id);

-- ---------------------------------------------------------------------------
-- Helpers (security definer, private schema — not in Data API)
-- Role lives in people.role. Never authorize from user_metadata.
-- ---------------------------------------------------------------------------

create or replace function private.current_person()
returns public.people
language sql
stable
security definer
set search_path = public
as $$
  select p.*
  from public.people p
  where p.id = (select auth.uid());
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
  where p.id = (select auth.uid());
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
  where p.id = (select auth.uid());
$$;

create or replace function private.is_cm_or_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(private.my_role() in ('cm', 'owner'), false);
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
      and a.person_id = (select auth.uid())
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
    join public.people p on p.id = (select auth.uid())
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

create or replace function private.try_uuid(p_text text)
returns uuid
language plpgsql
immutable
as $$
begin
  if p_text is null or length(trim(p_text)) = 0 then
    return null;
  end if;
  return trim(p_text)::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

grant execute on function private.current_person() to authenticated, service_role;
grant execute on function private.my_company_id() to authenticated, service_role;
grant execute on function private.my_role() to authenticated, service_role;
grant execute on function private.is_cm_or_owner() to authenticated, service_role;
grant execute on function private.is_assigned_to_site(uuid) to authenticated, service_role;
grant execute on function private.can_access_site(uuid) to authenticated, service_role;
grant execute on function private.try_uuid(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger sites_touch_updated_at
  before update on public.sites
  for each row execute function private.touch_updated_at();

create trigger drawings_touch_updated_at
  before update on public.drawings
  for each row execute function private.touch_updated_at();

create trigger drawing_requests_touch_updated_at
  before update on public.drawing_requests
  for each row execute function private.touch_updated_at();

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
  if new.role is distinct from old.role and coalesce(private.my_role(), '') <> 'owner' then
    raise exception 'not_authorized';
  end if;
  return new;
end;
$$;

create trigger people_protect_identity
  before update on public.people
  for each row execute function private.protect_people_identity();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.companies enable row level security;
alter table public.people enable row level security;
alter table public.sites enable row level security;
alter table public.site_assignments enable row level security;
alter table public.drawings enable row level security;
alter table public.drawing_requests enable row level security;
alter table public.drawing_audit enable row level security;

revoke all on table public.companies from anon, authenticated;
revoke all on table public.people from anon, authenticated;
revoke all on table public.sites from anon, authenticated;
revoke all on table public.site_assignments from anon, authenticated;
revoke all on table public.drawings from anon, authenticated;
revoke all on table public.drawing_requests from anon, authenticated;
revoke all on table public.drawing_audit from anon, authenticated;

grant select, insert, update on table public.companies to authenticated;
grant select, insert, update on table public.people to authenticated;
grant select, insert, update, delete on table public.sites to authenticated;
grant select, insert, delete on table public.site_assignments to authenticated;
grant select, insert, update, delete on table public.drawings to authenticated;
grant select, insert, update on table public.drawing_requests to authenticated;
grant select, insert on table public.drawing_audit to authenticated;

-- companies
create policy companies_select_same_company
  on public.companies for select to authenticated
  using (id = private.my_company_id());

create policy companies_update_owner
  on public.companies for update to authenticated
  using (id = private.my_company_id() and private.my_role() = 'owner')
  with check (id = private.my_company_id() and private.my_role() = 'owner');

create policy companies_insert_owner
  on public.companies for insert to authenticated
  with check (private.my_role() = 'owner');

-- people
create policy people_select_same_company
  on public.people for select to authenticated
  using (company_id = private.my_company_id());

create policy people_update_self_or_owner
  on public.people for update to authenticated
  using (
    id = (select auth.uid())
    or (private.my_role() = 'owner' and company_id = private.my_company_id())
  )
  with check (company_id = private.my_company_id());

create policy people_insert_owner
  on public.people for insert to authenticated
  with check (
    private.my_role() = 'owner'
    and company_id = private.my_company_id()
  );

-- sites: operative AND CM assigned-only; Owner all company sites
create policy sites_select_accessible
  on public.sites for select to authenticated
  using (private.can_access_site(id));

create policy sites_insert_owner
  on public.sites for insert to authenticated
  with check (
    private.my_role() = 'owner'
    and company_id = private.my_company_id()
  );

create policy sites_update_owner_or_assigned_cm
  on public.sites for update to authenticated
  using (
    company_id = private.my_company_id()
    and (
      private.my_role() = 'owner'
      or (private.my_role() = 'cm' and private.can_access_site(id))
    )
  )
  with check (company_id = private.my_company_id());

create policy sites_delete_owner
  on public.sites for delete to authenticated
  using (private.my_role() = 'owner' and company_id = private.my_company_id());

-- site_assignments
create policy site_assignments_select
  on public.site_assignments for select to authenticated
  using (
    person_id = (select auth.uid())
    or (
      private.my_role() = 'owner'
      and exists (
        select 1 from public.sites s
        where s.id = site_id and s.company_id = private.my_company_id()
      )
    )
    or (private.my_role() = 'cm' and private.can_access_site(site_id))
  );

create policy site_assignments_write_cm_owner
  on public.site_assignments for insert to authenticated
  with check (
    private.is_cm_or_owner()
    and private.can_access_site(site_id)
    and exists (
      select 1
      from public.people p
      join public.sites s on s.id = site_id
      where p.id = person_id
        and p.company_id = s.company_id
        and p.company_id = private.my_company_id()
    )
  );

create policy site_assignments_delete_cm_owner
  on public.site_assignments for delete to authenticated
  using (
    private.is_cm_or_owner()
    and private.can_access_site(site_id)
  );

-- drawings
create policy drawings_select_accessible
  on public.drawings for select to authenticated
  using (private.can_access_site(site_id));

create policy drawings_insert_cm_owner
  on public.drawings for insert to authenticated
  with check (private.is_cm_or_owner() and private.can_access_site(site_id));

create policy drawings_update_cm_owner
  on public.drawings for update to authenticated
  using (private.is_cm_or_owner() and private.can_access_site(site_id))
  with check (private.is_cm_or_owner() and private.can_access_site(site_id));

create policy drawings_delete_cm_owner
  on public.drawings for delete to authenticated
  using (private.is_cm_or_owner() and private.can_access_site(site_id));

-- drawing_requests
create policy drawing_requests_select
  on public.drawing_requests for select to authenticated
  using (
    requester_id = (select auth.uid())
    or (
      private.my_role() = 'owner'
      and exists (
        select 1 from public.sites s
        where s.id = site_id and s.company_id = private.my_company_id()
      )
    )
    or (private.my_role() = 'cm' and private.can_access_site(site_id))
  );

create policy drawing_requests_insert_on_site
  on public.drawing_requests for insert to authenticated
  with check (
    requester_id = (select auth.uid())
    and private.can_access_site(site_id)
    and status = 'Open'
  );

create policy drawing_requests_update_cm_owner
  on public.drawing_requests for update to authenticated
  using (
    (private.my_role() = 'owner' and exists (
      select 1 from public.sites s
      where s.id = site_id and s.company_id = private.my_company_id()
    ))
    or (private.my_role() = 'cm' and private.can_access_site(site_id))
  )
  with check (
    (private.my_role() = 'owner' and exists (
      select 1 from public.sites s
      where s.id = site_id and s.company_id = private.my_company_id()
    ))
    or (private.my_role() = 'cm' and private.can_access_site(site_id))
  );

-- drawing_audit (append-only for clients)
create policy drawing_audit_select
  on public.drawing_audit for select to authenticated
  using (
    (
      private.my_role() = 'owner'
      and exists (
        select 1 from public.sites s
        where s.id = site_id and s.company_id = private.my_company_id()
      )
    )
    or private.can_access_site(site_id)
  );

create policy drawing_audit_insert_cm_owner
  on public.drawing_audit for insert to authenticated
  with check (private.is_cm_or_owner() and private.can_access_site(site_id));

-- ---------------------------------------------------------------------------
-- RPCs
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
  p_id uuid default null
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
begin
  if not private.is_cm_or_owner() or not private.can_access_site(p_site_id) then
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
    uploaded_by
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
    (select auth.uid())
  )
  returning * into v_new;

  update public.sites
  set updated_at = now()
  where id = p_site_id;

  insert into public.drawing_audit (drawing_id, site_id, actor_id, action, revision)
  values (v_new.id, p_site_id, (select auth.uid()), v_action, v_new.revision);

  return to_jsonb(v_new);
end;
$$;

create or replace function public.site_pack_manifest(p_site_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.sites s where s.id = p_site_id) then
    raise exception 'site_not_found';
  end if;
  if not private.can_access_site(p_site_id) then
    raise exception 'not_authorized';
  end if;

  return coalesce(
    (
      select jsonb_agg(item order by item->>'title', item->>'sheet_number')
      from (
        select jsonb_build_object(
          'drawing_id', d.id,
          'title', d.title,
          'sheet_number', d.sheet_number,
          'revision', d.revision,
          'dated', d.dated,
          'file_size_bytes', d.file_size_bytes,
          'content_type', d.content_type,
          'storage_path', d.storage_path
        ) as item
        from public.drawings d
        where d.site_id = p_site_id
          and d.is_current = true
        order by d.title, d.sheet_number nulls last
      ) q
    ),
    '[]'::jsonb
  );
end;
$$;

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
                and a.person_id = (select auth.uid())
            )
          )
        order by s.name
      ) q
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.replace_drawing(
  uuid, text, text, text, text, date, bigint, text, uuid, uuid
) from public, anon;
revoke all on function public.site_pack_manifest(uuid) from public, anon;
revoke all on function public.company_sites_pulse() from public, anon;

grant execute on function public.replace_drawing(
  uuid, text, text, text, text, date, bigint, text, uuid, uuid
) to authenticated;
grant execute on function public.site_pack_manifest(uuid) to authenticated;
grant execute on function public.company_sites_pulse() to authenticated;

-- ---------------------------------------------------------------------------
-- Storage bucket + RLS
-- Path: {company_id}/{site_id}/{drawing_id}.pdf
--        {company_id}/{site_id}/requests/{id}.jpg
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'drawings',
  'drawings',
  false,
  52428800,
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.storage_site_id(p_name text)
returns uuid
language sql
stable
as $$
  select private.try_uuid((storage.foldername(p_name))[2]);
$$;

create or replace function private.storage_company_id(p_name text)
returns uuid
language sql
stable
as $$
  select private.try_uuid((storage.foldername(p_name))[1]);
$$;

grant execute on function private.storage_site_id(text) to authenticated, service_role;
grant execute on function private.storage_company_id(text) to authenticated, service_role;

drop policy if exists drawings_storage_select on storage.objects;
drop policy if exists drawings_storage_insert on storage.objects;
drop policy if exists drawings_storage_update on storage.objects;
drop policy if exists drawings_storage_delete on storage.objects;

create policy drawings_storage_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'drawings'
    and private.storage_company_id(name) = private.my_company_id()
    and private.can_access_site(private.storage_site_id(name))
  );

create policy drawings_storage_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'drawings'
    and private.storage_company_id(name) = private.my_company_id()
    and private.can_access_site(private.storage_site_id(name))
    and (
      -- Request photos: anyone with site access
      (storage.foldername(name))[3] = 'requests'
      or private.is_cm_or_owner()
    )
  );

create policy drawings_storage_update
  on storage.objects for update to authenticated
  using (
    bucket_id = 'drawings'
    and private.is_cm_or_owner()
    and private.storage_company_id(name) = private.my_company_id()
    and private.can_access_site(private.storage_site_id(name))
  )
  with check (
    bucket_id = 'drawings'
    and private.is_cm_or_owner()
    and private.storage_company_id(name) = private.my_company_id()
    and private.can_access_site(private.storage_site_id(name))
  );

create policy drawings_storage_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'drawings'
    and private.is_cm_or_owner()
    and private.can_access_site(private.storage_site_id(name))
  );
