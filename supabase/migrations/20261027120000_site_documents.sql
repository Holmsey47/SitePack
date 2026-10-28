-- Induction, toolbox talk, and RAMS PDFs for a site.
-- A new version is current and the previous one is superseded.
-- Signatures are one row per person per version, stamped with the database clock.
-- Draft only. Do not apply this file to a hosted project from the app or CI.

create table public.site_documents (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  kind text not null,
  title text not null,
  created_by uuid not null references public.people (id),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint site_documents_kind check (kind in ('induction', 'toolbox', 'rams')),
  constraint site_documents_title_len check (char_length(btrim(title)) between 1 and 120)
);

create index site_documents_site_idx on public.site_documents (site_id);

comment on table public.site_documents is
  'A site induction, toolbox talk, or RAMS. Versions and signatures hang off this row.';

comment on column public.site_documents.archived_at is
  'Set by the owner when the document has signatures. Members no longer see it. Rows and files stay.';

create table public.site_document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.site_documents (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  version_no integer not null check (version_no > 0),
  storage_path text not null,
  file_name text not null,
  is_current boolean not null default true,
  created_by uuid not null references public.people (id),
  created_at timestamptz not null default now(),
  unique (document_id, version_no),
  constraint site_document_versions_file_len check (char_length(btrim(file_name)) between 1 and 180),
  constraint site_document_versions_path check (
    storage_path = company_id::text || '/' || site_id::text || '/' || document_id::text || '/' || id::text || '.pdf'
  )
);

create unique index site_document_versions_one_current
  on public.site_document_versions (document_id)
  where is_current;

create index site_document_versions_site_idx on public.site_document_versions (site_id);

comment on table public.site_document_versions is
  'One PDF generation of a site document. Exactly one row per document is current.';

create table public.site_document_signatures (
  version_id uuid not null references public.site_document_versions (id) on delete cascade,
  document_id uuid not null references public.site_documents (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  signed_at timestamptz not null default now(),
  primary key (version_id, person_id)
);

create index site_document_signatures_site_idx on public.site_document_signatures (site_id);

comment on table public.site_document_signatures is
  'This person confirmed they read this version. A new version has no signatures.';

comment on column public.site_document_signatures.signed_at is
  'Database clock. The stamp trigger overwrites any client value.';

-- ---------------------------------------------------------------------------
-- The next insert becomes current and the previous current row steps down.
-- version_no is one higher than the latest row for this document.
-- ---------------------------------------------------------------------------

create or replace function private.supersede_site_document_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.site_documents d
    where d.id = new.document_id
      and d.site_id = new.site_id
      and d.company_id = new.company_id
  ) then
    raise exception 'invalid_input';
  end if;

  new.version_no := coalesce((
    select max(v.version_no)
    from public.site_document_versions v
    where v.document_id = new.document_id
  ), 0) + 1;
  new.is_current := true;
  new.created_at := now();

  update public.site_document_versions
  set is_current = false
  where document_id = new.document_id
    and is_current;

  return new;
end;
$$;

comment on function private.supersede_site_document_version() is
  'Makes the inserted version current and supersedes the previous one.';

revoke all on function private.supersede_site_document_version() from public, anon, authenticated;

drop trigger if exists site_document_versions_supersede on public.site_document_versions;
create trigger site_document_versions_supersede
  before insert on public.site_document_versions
  for each row execute function private.supersede_site_document_version();

create or replace function private.stamp_site_document_signature()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.signed_at := now();
  return new;
end;
$$;

comment on function private.stamp_site_document_signature() is
  'Sets signed_at to the database clock. The client clock is ignored.';

revoke all on function private.stamp_site_document_signature() from public, anon, authenticated;

create or replace function private.stamp_site_document_archive()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.archived_at is not null or new.archived_at is null then
    raise exception 'invalid_input';
  end if;
  new.archived_at := now();
  return new;
end;
$$;

comment on function private.stamp_site_document_archive() is
  'Sets archived_at to the database clock. A document is archived once.';

revoke all on function private.stamp_site_document_archive() from public, anon, authenticated;

drop trigger if exists site_documents_archive_stamp on public.site_documents;
create trigger site_documents_archive_stamp
  before update of archived_at on public.site_documents
  for each row execute function private.stamp_site_document_archive();

create or replace function private.site_document_has_signatures(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.site_document_signatures s
    where s.document_id = p_document_id
  );
$$;

comment on function private.site_document_has_signatures(uuid) is
  'True when any signature row exists for the document. Bypasses signature RLS.';

revoke all on function private.site_document_has_signatures(uuid) from public, anon;
grant execute on function private.site_document_has_signatures(uuid) to authenticated;

create or replace function private.site_photo_is_orphan(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.my_role() = 'owner'
    and private.storage_company_id(p_name) = private.my_company_id()
    and not exists (
      select 1 from public.snag_photos sp where sp.storage_path = p_name
    )
    and not exists (
      select 1 from public.variation_photos vp where vp.storage_path = p_name
    );
$$;

comment on function private.site_photo_is_orphan(text) is
  'True when the owner is deleting a site photo in their company that no snag or variation still uses.';

revoke all on function private.site_photo_is_orphan(text) from public, anon;
grant execute on function private.site_photo_is_orphan(text) to authenticated;

drop trigger if exists site_document_signatures_stamp on public.site_document_signatures;
create trigger site_document_signatures_stamp
  before insert on public.site_document_signatures
  for each row execute function private.stamp_site_document_signature();

-- ---------------------------------------------------------------------------
-- RLS. Read follows private.can_access_site. The owner uploads, replaces, and
-- deletes. A signature insert is yourself, on the current version only.
-- ---------------------------------------------------------------------------

alter table public.site_documents enable row level security;
alter table public.site_document_versions enable row level security;
alter table public.site_document_signatures enable row level security;

revoke all on table public.site_documents from public, anon, authenticated;
revoke all on table public.site_document_versions from public, anon, authenticated;
revoke all on table public.site_document_signatures from public, anon, authenticated;

grant select, insert, delete on table public.site_documents to authenticated;
grant update (archived_at) on table public.site_documents to authenticated;
grant select, insert, update on table public.site_document_versions to authenticated;
grant select, insert on table public.site_document_signatures to authenticated;

create policy site_documents_select
  on public.site_documents for select to authenticated
  using (
    private.can_access_site(site_id)
    and (archived_at is null or private.my_role() = 'owner')
  );

create policy site_documents_insert
  on public.site_documents for insert to authenticated
  with check (
    private.my_role() = 'owner'
    and company_id = private.my_company_id()
    and private.can_access_site(site_id)
    and private.site_is_active(site_id)
    and created_by = (
      select p.id from public.people p where p.auth_user_id = (select auth.uid())
    )
  );

create policy site_documents_delete
  on public.site_documents for delete to authenticated
  using (
    private.my_role() = 'owner'
    and company_id = private.my_company_id()
    and private.can_access_site(site_id)
    and not private.site_document_has_signatures(id)
  );

create policy site_documents_archive
  on public.site_documents for update to authenticated
  using (
    private.my_role() = 'owner'
    and company_id = private.my_company_id()
    and private.can_access_site(site_id)
    and archived_at is null
  )
  with check (
    private.my_role() = 'owner'
    and company_id = private.my_company_id()
    and private.can_access_site(site_id)
    and archived_at is not null
  );

create policy site_document_versions_select
  on public.site_document_versions for select to authenticated
  using (
    private.can_access_site(site_id)
    and exists (
      select 1
      from public.site_documents d
      where d.id = site_document_versions.document_id
    )
  );

create policy site_document_versions_insert
  on public.site_document_versions for insert to authenticated
  with check (
    private.my_role() = 'owner'
    and company_id = private.my_company_id()
    and private.can_access_site(site_id)
    and private.site_is_active(site_id)
    and is_current
    and created_by = (
      select p.id from public.people p where p.auth_user_id = (select auth.uid())
    )
    and exists (
      select 1
      from public.site_documents d
      where d.id = site_document_versions.document_id
        and d.site_id = site_document_versions.site_id
        and d.company_id = site_document_versions.company_id
        and d.archived_at is null
    )
  );

create policy site_document_versions_update
  on public.site_document_versions for update to authenticated
  using (
    private.my_role() = 'owner'
    and company_id = private.my_company_id()
    and private.can_access_site(site_id)
  )
  with check (
    private.my_role() = 'owner'
    and company_id = private.my_company_id()
    and private.can_access_site(site_id)
  );

create policy site_document_signatures_select
  on public.site_document_signatures for select to authenticated
  using (
    private.can_access_site(site_id)
    and exists (
      select 1
      from public.site_documents d
      where d.id = site_document_signatures.document_id
    )
    and (
      private.my_role() = 'owner'
      or person_id = (
        select p.id from public.people p where p.auth_user_id = (select auth.uid())
      )
    )
  );

create policy site_document_signatures_insert
  on public.site_document_signatures for insert to authenticated
  with check (
    person_id = (
      select p.id from public.people p where p.auth_user_id = (select auth.uid())
    )
    and private.can_access_site(site_id)
    and private.site_is_active(site_id)
    and exists (
      select 1
      from public.site_document_versions v
      where v.id = site_document_signatures.version_id
        and v.is_current
        and v.site_id = site_document_signatures.site_id
        and v.document_id = site_document_signatures.document_id
        and v.company_id = private.my_company_id()
    )
    and exists (
      select 1
      from public.site_documents d
      where d.id = site_document_signatures.document_id
        and d.site_id = site_document_signatures.site_id
        and d.archived_at is null
    )
  );

-- ---------------------------------------------------------------------------
-- Private PDFs. Path is company_id/site_id/document_id/version_id.pdf.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'site-documents',
  'site-documents',
  false,
  20971520,
  array['application/pdf']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Folder [3] is the document id. It has to be that document's own site and company.
-- Definer so the check reads the real row, not a path that merely names a visible id.
create or replace function private.site_document_path_matches(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.site_documents d
    where d.id = private.try_uuid((storage.foldername(p_name))[3])
      and d.site_id = private.storage_site_id(p_name)
      and d.company_id = private.storage_company_id(p_name)
  );
$$;

comment on function private.site_document_path_matches(text) is
  'True when folder 3 is a site document whose site and company are the path folders.';

revoke all on function private.site_document_path_matches(text) from public, anon;
grant execute on function private.site_document_path_matches(text) to authenticated;

create policy site_documents_storage_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'site-documents'
    and private.storage_company_id(name) = private.my_company_id()
    and private.can_access_site(private.storage_site_id(name))
    and coalesce(array_length(storage.foldername(name), 1), 0) = 3
    and position('..' in name) = 0
    and left(name, 1) <> '/'
    and exists (
      select 1
      from public.site_documents d
      where d.id = private.try_uuid((storage.foldername(name))[3])
        and d.site_id = private.storage_site_id(name)
        and d.company_id = private.storage_company_id(name)
    )
    and private.site_document_path_matches(name)
  );

create policy site_documents_storage_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'site-documents'
    and private.my_role() = 'owner'
    and private.storage_company_id(name) = private.my_company_id()
    and private.can_access_site(private.storage_site_id(name))
    and private.site_is_active(private.storage_site_id(name))
    and coalesce(array_length(storage.foldername(name), 1), 0) = 3
    and position('..' in name) = 0
    and left(name, 1) <> '/'
    and right(name, 4) = '.pdf'
  );

create policy site_documents_storage_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'site-documents'
    and private.my_role() = 'owner'
    and private.storage_company_id(name) = private.my_company_id()
  );

-- Owner-only delete for site photos, limited to that owner's company folder.
drop policy if exists site_photos_delete on storage.objects;
create policy site_photos_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'site-photos'
    and private.site_photo_is_orphan(name)
  );
