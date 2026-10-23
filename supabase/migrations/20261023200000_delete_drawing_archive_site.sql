-- Owner-only drawing delete, and a soft archive that members cannot see or write.
-- Revisions are drawings rows (supersedes_id, same site + title + sheet_key).
-- Revisions stay on drawings. RAMS and induction tables are not in v1.
-- This file is the migration. Do not apply it to a hosted project from the app.

alter table public.sites
  add column if not exists archived_by uuid references public.people (id) on delete set null;

comment on column public.sites.archived_by is
  'people.id of the owner who archived the site. Cleared on restore.';

create index if not exists sites_archived_company_idx
  on public.sites (company_id)
  where archived_at is not null;

create index if not exists drawings_supersedes_id_idx
  on public.drawings (supersedes_id);

-- ---------------------------------------------------------------------------
-- Active site. False when archived, missing, or outside the caller company.
-- security definer so a member policy can read archived_at after SELECT is hidden.
-- ---------------------------------------------------------------------------

create or replace function private.site_is_active(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.sites s
    where s.id = p_site_id
      and s.archived_at is null
      and s.company_id = private.my_company_id()
  );
$$;

comment on function private.site_is_active(uuid) is
  'True when the site is in the caller company and archived_at is null.';

revoke all on function private.site_is_active(uuid) from public, anon;
grant execute on function private.site_is_active(uuid) to authenticated, service_role;

-- Owner still sees archived sites. Members only see assigned sites that are active.
create or replace function private.can_access_site(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.sites s
    join public.people p on p.auth_user_id = (select auth.uid())
    where s.id = p_site_id
      and s.company_id = p.company_id
      and (
        p.role = 'owner'
        or (
          s.archived_at is null
          and exists (
            select 1
            from public.site_assignments a
            where a.site_id = s.id
              and a.person_id = p.id
          )
        )
      )
  );
$$;

comment on function private.can_access_site(uuid) is
  'Owner: any company site, including archived. CM and operative: assigned sites with archived_at null.';

-- Site SELECT was switched off can_access_site so an owner insert can RETURNING.
-- Keep that owner branch. Members still have to be assigned to an active site.
drop policy if exists sites_select_accessible on public.sites;
create policy sites_select_accessible
  on public.sites for select to authenticated
  using (
    company_id = private.my_company_id()
    and (
      private.my_role() = 'owner'
      or (
        private.site_is_active(id)
        and private.is_assigned_to_site(id)
      )
    )
  );

-- Block a non-owner from setting either archive column, including a direct update.
create or replace function private.guard_site_archive()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (
    new.archived_at is distinct from old.archived_at
    or new.archived_by is distinct from old.archived_by
  ) and private.my_role() is distinct from 'owner' then
    raise exception 'not_authorized';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Insert freeze. Member policies already lose can_access_site once archived.
-- Security definer RPCs bypass those policies, so a trigger blocks the insert
-- for every role, including the owner. Existing snags, variations, photos,
-- signatures, and drawings are left in place.
-- ---------------------------------------------------------------------------

create or replace function private.reject_archived_site_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Seeds and migrations run as the table owner with no end-user session.
  -- Authenticated writes always have auth.uid(), including security definer RPCs.
  if auth.uid() is null then
    return new;
  end if;
  if not private.site_is_active(new.site_id) then
    raise exception 'site_archived';
  end if;
  return new;
end;
$$;

revoke all on function private.reject_archived_site_insert() from public, anon;
grant execute on function private.reject_archived_site_insert() to authenticated;

drop trigger if exists drawings_reject_archived on public.drawings;
create trigger drawings_reject_archived
  before insert on public.drawings
  for each row execute function private.reject_archived_site_insert();

drop trigger if exists drawing_requests_reject_archived on public.drawing_requests;
create trigger drawing_requests_reject_archived
  before insert on public.drawing_requests
  for each row execute function private.reject_archived_site_insert();

drop trigger if exists drawing_audit_reject_archived on public.drawing_audit;
create trigger drawing_audit_reject_archived
  before insert on public.drawing_audit
  for each row execute function private.reject_archived_site_insert();

drop trigger if exists site_assignments_reject_archived on public.site_assignments;
create trigger site_assignments_reject_archived
  before insert on public.site_assignments
  for each row execute function private.reject_archived_site_insert();

drop trigger if exists snags_reject_archived on public.snags;
create trigger snags_reject_archived
  before insert on public.snags
  for each row execute function private.reject_archived_site_insert();

drop trigger if exists snag_photos_reject_archived on public.snag_photos;
create trigger snag_photos_reject_archived
  before insert on public.snag_photos
  for each row execute function private.reject_archived_site_insert();

drop trigger if exists snag_signoffs_reject_archived on public.snag_signoffs;
create trigger snag_signoffs_reject_archived
  before insert on public.snag_signoffs
  for each row execute function private.reject_archived_site_insert();

drop trigger if exists snag_signatures_reject_archived on public.snag_signatures;
create trigger snag_signatures_reject_archived
  before insert on public.snag_signatures
  for each row execute function private.reject_archived_site_insert();

drop trigger if exists variations_reject_archived on public.variations;
create trigger variations_reject_archived
  before insert on public.variations
  for each row execute function private.reject_archived_site_insert();

drop trigger if exists variation_versions_reject_archived on public.variation_versions;
create trigger variation_versions_reject_archived
  before insert on public.variation_versions
  for each row execute function private.reject_archived_site_insert();

drop trigger if exists variation_photos_reject_archived on public.variation_photos;
create trigger variation_photos_reject_archived
  before insert on public.variation_photos
  for each row execute function private.reject_archived_site_insert();

drop trigger if exists variation_signatures_reject_archived on public.variation_signatures;
create trigger variation_signatures_reject_archived
  before insert on public.variation_signatures
  for each row execute function private.reject_archived_site_insert();

drop trigger if exists drawing_revision_opens_reject_archived on public.drawing_revision_opens;
create trigger drawing_revision_opens_reject_archived
  before insert on public.drawing_revision_opens
  for each row execute function private.reject_archived_site_insert();

drop trigger if exists drawing_seen_reject_archived on public.drawing_seen;
create trigger drawing_seen_reject_archived
  before insert on public.drawing_seen
  for each row execute function private.reject_archived_site_insert();

drop trigger if exists join_codes_reject_archived on public.join_codes;
create trigger join_codes_reject_archived
  before insert on public.join_codes
  for each row execute function private.reject_archived_site_insert();

drop trigger if exists join_events_reject_archived on public.join_events;
create trigger join_events_reject_archived
  before insert on public.join_events
  for each row execute function private.reject_archived_site_insert();

-- ---------------------------------------------------------------------------
-- Member write policies. can_access_site already drops members. site_is_active
-- also stops the owner, whose can_access_site stays true for an archived site.
-- ---------------------------------------------------------------------------

drop policy if exists drawings_insert_cm_owner on public.drawings;
create policy drawings_insert_cm_owner
  on public.drawings for insert to authenticated
  with check (
    private.is_cm_or_owner()
    and private.can_access_site(site_id)
    and private.site_is_active(site_id)
  );

drop policy if exists drawings_update_cm_owner on public.drawings;
create policy drawings_update_cm_owner
  on public.drawings for update to authenticated
  using (
    private.is_cm_or_owner()
    and private.can_access_site(site_id)
    and private.site_is_active(site_id)
  )
  with check (
    private.is_cm_or_owner()
    and private.can_access_site(site_id)
    and private.site_is_active(site_id)
  );

drop policy if exists drawings_delete_cm_owner on public.drawings;
drop policy if exists drawings_delete_owner on public.drawings;
create policy drawings_delete_owner
  on public.drawings for delete to authenticated
  using (
    private.my_role() = 'owner'
    and exists (
      select 1
      from public.sites s
      where s.id = site_id
        and s.company_id = private.my_company_id()
    )
  );

drop policy if exists drawing_requests_select on public.drawing_requests;
create policy drawing_requests_select
  on public.drawing_requests for select to authenticated
  using (
    (
      requester_id = (
        select p.id from public.people p where p.auth_user_id = (select auth.uid())
      )
      and private.site_is_active(site_id)
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
    and private.site_is_active(site_id)
    and status = 'Open'
  );

drop policy if exists drawing_audit_insert_cm_owner on public.drawing_audit;
create policy drawing_audit_insert_cm_owner
  on public.drawing_audit for insert to authenticated
  with check (
    private.is_cm_or_owner()
    and private.can_access_site(site_id)
    and private.site_is_active(site_id)
  );

drop policy if exists site_assignments_select on public.site_assignments;
create policy site_assignments_select
  on public.site_assignments for select to authenticated
  using (
    (
      person_id = (
        select p.id from public.people p where p.auth_user_id = (select auth.uid())
      )
      and private.site_is_active(site_id)
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

drop policy if exists site_assignments_write_cm_owner on public.site_assignments;
create policy site_assignments_write_cm_owner
  on public.site_assignments for insert to authenticated
  with check (
    private.is_cm_or_owner()
    and private.can_access_site(site_id)
    and private.site_is_active(site_id)
    and exists (
      select 1
      from public.people p
      join public.sites s on s.id = site_id
      where p.id = person_id
        and p.company_id = s.company_id
        and p.company_id = private.my_company_id()
    )
  );

-- ---------------------------------------------------------------------------
-- Storage. Inserts require an active site. Deletes are owner-only and match
-- the company folder, including files whose drawing row is already gone.
-- ---------------------------------------------------------------------------

drop policy if exists drawings_storage_insert on storage.objects;
create policy drawings_storage_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'drawings'
    and private.storage_company_id(name) = private.my_company_id()
    and private.can_access_site(private.storage_site_id(name))
    and private.site_is_active(private.storage_site_id(name))
    and (
      (storage.foldername(name))[3] = 'requests'
      or private.is_cm_or_owner()
    )
  );

drop policy if exists drawings_storage_update on storage.objects;
create policy drawings_storage_update
  on storage.objects for update to authenticated
  using (
    bucket_id = 'drawings'
    and private.is_cm_or_owner()
    and private.storage_company_id(name) = private.my_company_id()
    and private.can_access_site(private.storage_site_id(name))
    and private.site_is_active(private.storage_site_id(name))
  )
  with check (
    bucket_id = 'drawings'
    and private.is_cm_or_owner()
    and private.storage_company_id(name) = private.my_company_id()
    and private.can_access_site(private.storage_site_id(name))
    and private.site_is_active(private.storage_site_id(name))
  );

drop policy if exists drawings_storage_delete on storage.objects;
create policy drawings_storage_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'drawings'
    and private.my_role() = 'owner'
    and private.storage_company_id(name) = private.my_company_id()
  );

drop policy if exists site_photos_insert on storage.objects;
create policy site_photos_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'site-photos'
    and private.storage_company_id(name) = private.my_company_id()
    and private.can_access_site(private.storage_site_id(name))
    and private.site_is_active(private.storage_site_id(name))
    and position('..' in name) = 0
    and left(name, 1) <> '/'
  );

-- ---------------------------------------------------------------------------
-- Paths whose storage delete did not finish. The drawing rows are already
-- gone in the same transaction as these inserts, so a failed bucket delete
-- cannot leave half of a revision family behind. The client removes the
-- objects, then clear_drawing_orphans. Company open retries whatever remains.
-- ---------------------------------------------------------------------------

create table if not exists public.drawing_file_orphans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  storage_path text not null,
  created_at timestamptz not null default now(),
  constraint drawing_file_orphans_path unique (company_id, storage_path)
);

create index if not exists drawing_file_orphans_company_idx
  on public.drawing_file_orphans (company_id);

comment on table public.drawing_file_orphans is
  'Drawing files still in the drawings bucket after delete_drawing committed. Owner RPCs only.';

alter table public.drawing_file_orphans enable row level security;
revoke all on table public.drawing_file_orphans from public, anon, authenticated;

create or replace function public.delete_drawing(p_drawing_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person public.people;
  v_site public.sites;
  v_ids uuid[] := array[p_drawing_id];
  v_next uuid[];
  v_paths text[] := '{}';
  v_guard integer := 0;
begin
  select * into v_person
  from public.people
  where auth_user_id = (select auth.uid());

  if not found or v_person.role is distinct from 'owner' then
    raise exception 'not_authorized';
  end if;

  select s.* into v_site
  from public.drawings d
  join public.sites s on s.id = d.site_id
  where d.id = p_drawing_id
    and s.company_id = v_person.company_id;

  if not found then
    raise exception 'drawing_not_found';
  end if;

  -- Grow until the supersedes chain and the sheet identity are both included.
  loop
    v_guard := v_guard + 1;
    if v_guard > 50 then
      raise exception 'invalid_input';
    end if;

    select coalesce(array_agg(distinct d.id), '{}')
    into v_next
    from public.drawings d
    where d.site_id = v_site.id
      and (
        d.id = any(v_ids)
        or d.supersedes_id = any(v_ids)
        or d.id in (
          select older.supersedes_id
          from public.drawings older
          where older.id = any(v_ids)
            and older.supersedes_id is not null
        )
        or (d.title, d.sheet_key) in (
          select known.title, known.sheet_key
          from public.drawings known
          where known.id = any(v_ids)
        )
      );

    exit when v_next <@ v_ids and v_ids <@ v_next;
    v_ids := v_next;
  end loop;

  select coalesce(array_agg(distinct d.storage_path), '{}')
  into v_paths
  from public.drawings d
  where d.id = any(v_ids)
    and d.storage_path is not null
    and split_part(d.storage_path, '/', 1) = v_site.company_id::text;

  insert into public.drawing_file_orphans (company_id, storage_path)
  select v_site.company_id, path
  from unnest(v_paths) as path
  on conflict (company_id, storage_path) do nothing;

  -- Requests stay. The fulfilled sheet is gone, so the link cannot remain.
  update public.drawing_requests
  set fulfilled_drawing_id = null
  where fulfilled_drawing_id = any(v_ids);

  -- supersedes_id has no ON DELETE action. Seen, opens, and audit cascade.
  update public.drawings
  set supersedes_id = null
  where supersedes_id = any(v_ids);

  delete from public.drawings
  where id = any(v_ids);

  return v_paths;
end;
$$;

comment on function public.delete_drawing(uuid) is
  'Owner deletes every revision row of the sheet and returns drawings-bucket paths. Files are removed by the client. Dependent seen, open, and audit rows cascade. Requests are kept with fulfilled_drawing_id cleared.';

revoke all on function public.delete_drawing(uuid) from public, anon;
grant execute on function public.delete_drawing(uuid) to authenticated;

create or replace function public.list_drawing_orphans()
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_person public.people;
  v_paths text[];
begin
  select * into v_person
  from public.people
  where auth_user_id = (select auth.uid());

  if not found or v_person.role is distinct from 'owner' then
    raise exception 'not_authorized';
  end if;

  select coalesce(array_agg(o.storage_path order by o.created_at), '{}')
  into v_paths
  from public.drawing_file_orphans o
  where o.company_id = v_person.company_id
    and split_part(o.storage_path, '/', 1) = v_person.company_id::text;

  return v_paths;
end;
$$;

comment on function public.list_drawing_orphans() is
  'Owner paths still waiting for a drawings-bucket delete.';

revoke all on function public.list_drawing_orphans() from public, anon;
grant execute on function public.list_drawing_orphans() to authenticated;

create or replace function public.clear_drawing_orphans(p_paths text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person public.people;
begin
  select * into v_person
  from public.people
  where auth_user_id = (select auth.uid());

  if not found or v_person.role is distinct from 'owner' then
    raise exception 'not_authorized';
  end if;

  delete from public.drawing_file_orphans o
  where o.company_id = v_person.company_id
    and o.storage_path = any(coalesce(p_paths, '{}'));
end;
$$;

comment on function public.clear_drawing_orphans(text[]) is
  'Owner drops orphan rows after those objects have left the drawings bucket.';

revoke all on function public.clear_drawing_orphans(text[]) from public, anon;
grant execute on function public.clear_drawing_orphans(text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Archive and restore. The two-argument function stays so older callers work.
-- ---------------------------------------------------------------------------

create or replace function public.archive_site(p_site_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person public.people;
begin
  select * into v_person
  from public.people
  where auth_user_id = (select auth.uid());

  if not found or v_person.role is distinct from 'owner' then
    raise exception 'not_authorized';
  end if;

  update public.sites
  set
    archived_at = coalesce(archived_at, now()),
    archived_by = coalesce(archived_by, v_person.id)
  where id = p_site_id
    and company_id = v_person.company_id;

  if not found then
    raise exception 'site_not_found';
  end if;
end;
$$;

comment on function public.archive_site(uuid) is
  'Owner soft-archive. Child rows stay. Members lose select and insert.';

revoke all on function public.archive_site(uuid) from public, anon;
grant execute on function public.archive_site(uuid) to authenticated;

create or replace function public.restore_site(p_site_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person public.people;
begin
  select * into v_person
  from public.people
  where auth_user_id = (select auth.uid());

  if not found or v_person.role is distinct from 'owner' then
    raise exception 'not_authorized';
  end if;

  update public.sites
  set archived_at = null,
      archived_by = null
  where id = p_site_id
    and company_id = v_person.company_id;

  if not found then
    raise exception 'site_not_found';
  end if;
end;
$$;

comment on function public.restore_site(uuid) is
  'Owner puts an archived site back on the working list.';

revoke all on function public.restore_site(uuid) from public, anon;
grant execute on function public.restore_site(uuid) to authenticated;

create or replace function public.archive_site(p_site_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_archived then
    perform public.archive_site(p_site_id);
  else
    perform public.restore_site(p_site_id);
  end if;
end;
$$;

comment on function public.archive_site(uuid, boolean) is
  'Owner archive when true, restore when false. Same checks as the one-argument functions.';

revoke all on function public.archive_site(uuid, boolean) from public, anon;
grant execute on function public.archive_site(uuid, boolean) to authenticated;

-- Contracts managers no longer receive archived sites. The owner still does.
create or replace function public.company_sites_pulse()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
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
          'new_joiner_count', (
            select count(*)::int
            from public.join_events e
            where e.site_id = s.id
              and e.removed_at is null
              and e.joined_at > now() - interval '7 days'
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
            or (
              s.archived_at is null
              and exists (
                select 1
                from public.site_assignments a
                where a.site_id = s.id
                  and a.person_id = v_actor
              )
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
  'Site list for the owner and contracts managers. Archived sites are owner-only. Includes a 7-day new joiner count. Never email.';

revoke all on function public.company_sites_pulse() from public, anon;
grant execute on function public.company_sites_pulse() to authenticated;
