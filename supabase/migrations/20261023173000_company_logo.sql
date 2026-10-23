-- Optional company logo. The owner sets it after they are signed in.
-- companies_update_owner already lets the owner update their own company row,
-- and no screen updates any other column. The trigger keeps it that way:
-- name, id, and created_at stay put, and logo_path is null or this company's object.

alter table public.companies
  add column if not exists logo_path text;

comment on column public.companies.logo_path is
  'Object name in the private company-logos bucket: <company_id>/<file>. Null when the company has no logo.';

create or replace function private.companies_guard_logo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.name is distinct from old.name
     or new.created_at is distinct from old.created_at then
    raise exception 'not_authorized';
  end if;

  if new.logo_path is not distinct from old.logo_path then
    return new;
  end if;

  if new.logo_path is not null and new.logo_path !~ (
    '^' || old.id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
  ) then
    raise exception 'invalid_input';
  end if;

  return new;
end;
$$;

revoke all on function private.companies_guard_logo() from public, anon;
grant execute on function private.companies_guard_logo() to authenticated;

drop trigger if exists companies_guard_logo on public.companies;
create trigger companies_guard_logo
  before update on public.companies
  for each row execute function private.companies_guard_logo();

-- Private bucket. Path is <company_id>/<file>.
-- storage.foldername leaves out the filename, so that path has length 1.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'company-logos',
  'company-logos',
  false,
  1048576,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists company_logos_select on storage.objects;
drop policy if exists company_logos_insert on storage.objects;
drop policy if exists company_logos_update on storage.objects;
drop policy if exists company_logos_delete on storage.objects;

create policy company_logos_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'company-logos'
    and private.storage_company_id(name) = private.my_company_id()
    and coalesce(array_length(storage.foldername(name), 1), 0) = 1
    and position('..' in name) = 0
    and left(name, 1) <> '/'
  );

create policy company_logos_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'company-logos'
    and private.my_role() = 'owner'
    and private.storage_company_id(name) = private.my_company_id()
    and coalesce(array_length(storage.foldername(name), 1), 0) = 1
    and position('..' in name) = 0
    and left(name, 1) <> '/'
  );

create policy company_logos_update
  on storage.objects for update to authenticated
  using (
    bucket_id = 'company-logos'
    and private.my_role() = 'owner'
    and private.storage_company_id(name) = private.my_company_id()
    and coalesce(array_length(storage.foldername(name), 1), 0) = 1
    and position('..' in name) = 0
    and left(name, 1) <> '/'
  )
  with check (
    bucket_id = 'company-logos'
    and private.my_role() = 'owner'
    and private.storage_company_id(name) = private.my_company_id()
    and coalesce(array_length(storage.foldername(name), 1), 0) = 1
    and position('..' in name) = 0
    and left(name, 1) <> '/'
  );

create policy company_logos_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'company-logos'
    and private.my_role() = 'owner'
    and private.storage_company_id(name) = private.my_company_id()
    and coalesce(array_length(storage.foldername(name), 1), 0) = 1
    and position('..' in name) = 0
    and left(name, 1) <> '/'
  );
