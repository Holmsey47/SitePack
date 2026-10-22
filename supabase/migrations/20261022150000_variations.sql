-- Extras and variations (6.1).
-- One current version per variation. A signed or sent version is locked:
-- content edits insert a new version and keep the old one, including its signature.
-- The £ amount is value_pence. Only an owner or contracts manager can set it.
-- Photos live in the private bucket site-photos at company_id/site_id/...
-- 6.3 reuses that bucket. This migration does not add snags.
-- Writes are SECURITY DEFINER with search_path pinned to empty.
-- Reads are the caller's role, so RLS applies.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.variation_counters (
  site_id uuid primary key references public.sites (id) on delete cascade,
  last_seq integer not null check (last_seq > 0)
);

comment on table public.variation_counters is
  'Per-site sequence for Variation VO-<seq>. Clients may read their own sites. Only definer functions advance it.';

create table public.variations (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  vo_seq integer not null check (vo_seq > 0),
  created_by uuid not null references public.people (id),
  created_at timestamptz not null default now(),
  unique (site_id, vo_seq)
);

create index variations_site_id_idx on public.variations (site_id);
create index variations_company_id_idx on public.variations (company_id);

comment on table public.variations is
  'One extras record for a site. vo_seq is the VO number and does not change when a new version is added.';

create table public.variation_versions (
  id uuid primary key default gen_random_uuid(),
  variation_id uuid not null references public.variations (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  version_no integer not null check (version_no > 0),
  title text not null,
  description text not null default '',
  level_area text,
  quantity_text text,
  value_pence integer,
  status text not null check (status in ('Draft', 'Signed', 'Sent')),
  is_current boolean not null default true,
  created_by uuid not null references public.people (id),
  created_at timestamptz not null default now(),
  locked_at timestamptz,
  unique (variation_id, version_no),
  constraint variation_versions_title_len check (char_length(btrim(title)) between 1 and 120),
  constraint variation_versions_description_len check (char_length(description) <= 2000),
  constraint variation_versions_level_len check (level_area is null or char_length(level_area) <= 80),
  constraint variation_versions_quantity_len check (quantity_text is null or char_length(quantity_text) <= 80),
  constraint variation_versions_value_range check (value_pence is null or (value_pence >= 0 and value_pence <= 100000000))
);

create unique index variation_versions_one_current
  on public.variation_versions (variation_id)
  where is_current;

create index variation_versions_site_status_idx
  on public.variation_versions (site_id, status);

comment on column public.variation_versions.value_pence is
  'Optional amount in pence for the main contractor. Not a pay rate. Owner or contracts manager only.';

comment on column public.variation_versions.locked_at is
  'Set when the version is signed. Signed and sent versions are not edited in place.';

create table public.variation_photos (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.variation_versions (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  storage_path text not null,
  sort_order integer not null check (sort_order between 1 and 10),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  file_size_bytes bigint not null check (file_size_bytes > 0 and file_size_bytes <= 1572864),
  created_at timestamptz not null default now(),
  unique (version_id, sort_order),
  unique (version_id, storage_path)
);

create index variation_photos_site_id_idx on public.variation_photos (site_id);

comment on table public.variation_photos is
  '1 to 10 photos on a version. Bytes are in site-photos. A signed version does not gain or change photos.';

create table public.variation_signatures (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null unique references public.variation_versions (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  signer_name text not null,
  signer_role_company text not null,
  signature_png text not null,
  signed_at timestamptz not null,
  recorded_by uuid not null references public.people (id),
  created_at timestamptz not null default now(),
  constraint variation_signatures_name_len check (char_length(btrim(signer_name)) between 1 and 120),
  constraint variation_signatures_role_len check (char_length(btrim(signer_role_company)) between 1 and 160),
  constraint variation_signatures_png_len check (char_length(signature_png) between 40 and 300000)
);

create index variation_signatures_site_id_idx on public.variation_signatures (site_id);

comment on table public.variation_signatures is
  'Hand-the-phone sign-off for one version. Typed name, role or company, drawn PNG, server timestamp. Kept when a later version is added.';

-- ---------------------------------------------------------------------------
-- Actor and guards. search_path is empty. Names are schema-qualified.
-- ---------------------------------------------------------------------------

create or replace function private.variation_actor()
returns table (person_id uuid, company_id uuid, role text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select p.id, p.company_id, p.role
  from public.people p
  where p.auth_user_id = (select auth.uid());
$fn$;

revoke all on function private.variation_actor() from public;
grant execute on function private.variation_actor() to authenticated;

create or replace function private.variation_content_same(
  p_old public.variation_versions,
  p_new public.variation_versions
)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select p_old.id is not distinct from p_new.id
    and p_old.variation_id is not distinct from p_new.variation_id
    and p_old.site_id is not distinct from p_new.site_id
    and p_old.version_no is not distinct from p_new.version_no
    and p_old.title is not distinct from p_new.title
    and p_old.description is not distinct from p_new.description
    and p_old.level_area is not distinct from p_new.level_area
    and p_old.quantity_text is not distinct from p_new.quantity_text
    and p_old.value_pence is not distinct from p_new.value_pence
    and p_old.created_by is not distinct from p_new.created_by
    and p_old.created_at is not distinct from p_new.created_at
    and p_old.locked_at is not distinct from p_new.locked_at;
$fn$;

revoke all on function private.variation_content_same(public.variation_versions, public.variation_versions) from public;

create or replace function private.guard_variation_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_manager boolean;
begin
  v_manager := coalesce(private.is_cm_or_owner(), false);

  if tg_op = 'INSERT' then
    if new.status is distinct from 'Draft' then
      raise exception 'invalid_status';
    end if;
    if new.value_pence is not null and not v_manager then
      raise exception 'value_not_allowed';
    end if;
    return new;
  end if;

  if old.status in ('Signed', 'Sent') then
    if private.variation_content_same(old, new)
       and old.is_current is not distinct from new.is_current
       and old.status = 'Signed'
       and new.status = 'Sent' then
      if not v_manager then
        raise exception 'not_authorized';
      end if;
      if not exists (
        select 1 from public.variation_signatures s where s.version_id = new.id
      ) then
        raise exception 'signature_required';
      end if;
      return new;
    end if;

    if private.variation_content_same(old, new)
       and old.status is not distinct from new.status
       and old.is_current = true
       and new.is_current = false then
      return new;
    end if;

    raise exception 'variation_locked';
  end if;

  if new.status is distinct from old.status
     and not (old.status = 'Draft' and new.status = 'Signed') then
    raise exception 'invalid_status';
  end if;

  if new.value_pence is distinct from old.value_pence and not v_manager then
    raise exception 'value_not_allowed';
  end if;

  if new.status in ('Signed', 'Sent') and not exists (
    select 1 from public.variation_signatures s where s.version_id = new.id
  ) then
    raise exception 'signature_required';
  end if;

  return new;
end;
$fn$;

revoke all on function private.guard_variation_version() from public;

create trigger variation_versions_guard
  before insert or update on public.variation_versions
  for each row execute function private.guard_variation_version();

create or replace function private.guard_variation_photo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text;
begin
  if tg_op = 'UPDATE' then
    raise exception 'variation_locked';
  end if;

  select v.status into v_status
  from public.variation_versions v
  where v.id = new.version_id;

  if v_status is null or v_status <> 'Draft' then
    raise exception 'variation_locked';
  end if;

  return new;
end;
$fn$;

revoke all on function private.guard_variation_photo() from public;

create trigger variation_photos_guard
  before insert or update on public.variation_photos
  for each row execute function private.guard_variation_photo();

create or replace function private.guard_variation_signature()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text;
begin
  if tg_op = 'UPDATE' then
    raise exception 'variation_locked';
  end if;

  select v.status into v_status
  from public.variation_versions v
  where v.id = new.version_id;

  if v_status is null or v_status <> 'Draft' then
    raise exception 'variation_locked';
  end if;

  if left(new.signature_png, 22) <> 'data:image/png;base64,' then
    raise exception 'invalid_input';
  end if;

  return new;
end;
$fn$;

revoke all on function private.guard_variation_signature() from public;

create trigger variation_signatures_guard
  before insert or update on public.variation_signatures
  for each row execute function private.guard_variation_signature();

create or replace function private.variation_version_needs_photos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.variation_photos p
  where p.version_id = new.id;

  if v_count < 1 or v_count > 10 then
    raise exception 'photo_count';
  end if;

  return null;
end;
$fn$;

revoke all on function private.variation_version_needs_photos() from public;

create constraint trigger variation_versions_need_photos
  after insert on public.variation_versions
  deferrable initially deferred
  for each row execute function private.variation_version_needs_photos();

-- ---------------------------------------------------------------------------
-- RLS. Operative: assigned sites only. Owner and CM: can_access_site
-- (owner = company, CM = assigned). No client insert, update, or delete.
-- ---------------------------------------------------------------------------

alter table public.variation_counters enable row level security;
alter table public.variations enable row level security;
alter table public.variation_versions enable row level security;
alter table public.variation_photos enable row level security;
alter table public.variation_signatures enable row level security;

revoke all on table public.variation_counters from public, anon, authenticated;
revoke all on table public.variations from public, anon, authenticated;
revoke all on table public.variation_versions from public, anon, authenticated;
revoke all on table public.variation_photos from public, anon, authenticated;
revoke all on table public.variation_signatures from public, anon, authenticated;

grant select on table public.variation_counters to authenticated;
grant select on table public.variations to authenticated;
grant select on table public.variation_versions to authenticated;
grant select on table public.variation_photos to authenticated;
grant select on table public.variation_signatures to authenticated;

create policy variation_counters_select
  on public.variation_counters for select to authenticated
  using (private.can_access_site(site_id));

create policy variations_select
  on public.variations for select to authenticated
  using (
    company_id = private.my_company_id()
    and private.can_access_site(site_id)
  );

create policy variation_versions_select
  on public.variation_versions for select to authenticated
  using (private.can_access_site(site_id));

create policy variation_photos_select
  on public.variation_photos for select to authenticated
  using (private.can_access_site(site_id));

create policy variation_signatures_select
  on public.variation_signatures for select to authenticated
  using (private.can_access_site(site_id));

-- ---------------------------------------------------------------------------
-- Photo rows. Path must be company_id/site_id/...
-- ---------------------------------------------------------------------------

create or replace function private.variation_take_photos(
  p_version_id uuid,
  p_site_id uuid,
  p_company_id uuid,
  p_photos jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_len integer;
  v_item jsonb;
  v_path text;
  v_type text;
  v_size bigint;
  v_prefix text;
  i integer;
begin
  if p_photos is null or jsonb_typeof(p_photos) <> 'array' then
    raise exception 'photo_count';
  end if;

  v_len := jsonb_array_length(p_photos);
  if v_len < 1 or v_len > 10 then
    raise exception 'photo_count';
  end if;

  v_prefix := p_company_id::text || '/' || p_site_id::text || '/';

  for i in 0..v_len - 1 loop
    v_item := p_photos -> i;
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'invalid_input';
    end if;

    v_path := btrim(coalesce(v_item ->> 'storage_path', ''));
    v_type := btrim(coalesce(v_item ->> 'content_type', ''));

    begin
      v_size := (v_item ->> 'file_size_bytes')::bigint;
    exception
      when others then
        raise exception 'invalid_input';
    end;

    if char_length(v_path) < char_length(v_prefix) + 1
       or left(v_path, char_length(v_prefix)) <> v_prefix
       or strpos(v_path, '..') > 0
       or strpos(v_path, chr(92)) > 0
       or strpos(v_path, '//') > 0
       or v_path ~ '[[:space:]]' then
      raise exception 'invalid_path';
    end if;

    if v_type not in ('image/jpeg', 'image/png', 'image/webp') then
      raise exception 'invalid_input';
    end if;

    if v_size is null or v_size < 1 or v_size > 1572864 then
      raise exception 'photo_too_large';
    end if;

    insert into public.variation_photos (
      version_id, site_id, storage_path, sort_order, content_type, file_size_bytes
    ) values (
      p_version_id, p_site_id, v_path, i + 1, v_type, v_size
    );
  end loop;
end;
$fn$;

revoke all on function private.variation_take_photos(uuid, uuid, uuid, jsonb) from public;

create or replace function private.variation_text(
  p_title text,
  p_description text,
  p_level_area text,
  p_quantity_text text,
  out title text,
  out description text,
  out level_area text,
  out quantity_text text
)
language plpgsql
immutable
set search_path = ''
as $fn$
begin
  title := btrim(coalesce(p_title, ''));
  description := btrim(coalesce(p_description, ''));
  level_area := nullif(btrim(coalesce(p_level_area, '')), '');
  quantity_text := nullif(btrim(coalesce(p_quantity_text, '')), '');

  if char_length(title) < 1 or char_length(title) > 120
     or char_length(description) > 2000
     or (level_area is not null and char_length(level_area) > 80)
     or (quantity_text is not null and char_length(quantity_text) > 80) then
    raise exception 'invalid_input';
  end if;
end;
$fn$;

revoke all on function private.variation_text(text, text, text, text) from public;

create or replace function private.next_vo_seq(p_site_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_seq integer;
begin
  insert into public.variation_counters (site_id, last_seq)
  values (p_site_id, 1)
  on conflict (site_id) do update
  set last_seq = public.variation_counters.last_seq + 1
  returning last_seq into v_seq;

  return v_seq;
end;
$fn$;

revoke all on function private.next_vo_seq(uuid) from public;

create or replace function private.variation_require_site(p_site_id uuid)
returns table (person_id uuid, company_id uuid, role text)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_person uuid;
  v_company uuid;
  v_role text;
  v_site_company uuid;
begin
  select a.person_id, a.company_id, a.role
  into v_person, v_company, v_role
  from private.variation_actor() a;

  if v_person is null or not private.can_access_site(p_site_id) then
    raise exception 'not_authorized';
  end if;

  select s.company_id into v_site_company
  from public.sites s
  where s.id = p_site_id;

  if v_site_company is null or v_site_company <> v_company then
    raise exception 'not_authorized';
  end if;

  person_id := v_person;
  company_id := v_company;
  role := v_role;
  return next;
end;
$fn$;

revoke all on function private.variation_require_site(uuid) from public;

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------

create or replace function public.create_variation(
  p_site_id uuid,
  p_title text,
  p_description text,
  p_level_area text,
  p_quantity_text text,
  p_value_pence integer,
  p_photos jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_text record;
  v_variation_id uuid;
  v_version_id uuid;
  v_seq integer;
begin
  select * into v_actor from private.variation_require_site(p_site_id);
  select * into v_text
  from private.variation_text(p_title, p_description, p_level_area, p_quantity_text);

  if p_value_pence is not null and v_actor.role not in ('owner', 'cm') then
    raise exception 'value_not_allowed';
  end if;

  if p_value_pence is not null and (p_value_pence < 0 or p_value_pence > 100000000) then
    raise exception 'invalid_input';
  end if;

  v_seq := private.next_vo_seq(p_site_id);
  v_variation_id := gen_random_uuid();
  v_version_id := gen_random_uuid();

  insert into public.variations (id, site_id, company_id, vo_seq, created_by)
  values (v_variation_id, p_site_id, v_actor.company_id, v_seq, v_actor.person_id);

  insert into public.variation_versions (
    id, variation_id, site_id, version_no, title, description, level_area, quantity_text,
    value_pence, status, is_current, created_by
  ) values (
    v_version_id, v_variation_id, p_site_id, 1, v_text.title, v_text.description,
    v_text.level_area, v_text.quantity_text, p_value_pence, 'Draft', true, v_actor.person_id
  );

  perform private.variation_take_photos(v_version_id, p_site_id, v_actor.company_id, p_photos);

  return jsonb_build_object(
    'variation_id', v_variation_id,
    'version_id', v_version_id,
    'vo_seq', v_seq,
    'status', 'Draft'
  );
end;
$fn$;

create or replace function public.update_variation_draft(
  p_version_id uuid,
  p_title text,
  p_description text,
  p_level_area text,
  p_quantity_text text,
  p_photos jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.variation_versions;
  v_company uuid;
  v_actor record;
  v_text record;
begin
  select * into v_row
  from public.variation_versions
  where id = p_version_id;

  if v_row.id is null then
    raise exception 'not_authorized';
  end if;

  select * into v_actor from private.variation_require_site(v_row.site_id);

  if v_row.status <> 'Draft' or v_row.is_current is not true then
    raise exception 'variation_locked';
  end if;

  select s.company_id into v_company
  from public.sites s
  where s.id = v_row.site_id;

  select * into v_text
  from private.variation_text(p_title, p_description, p_level_area, p_quantity_text);

  update public.variation_versions
  set title = v_text.title,
      description = v_text.description,
      level_area = v_text.level_area,
      quantity_text = v_text.quantity_text
  where id = v_row.id;

  delete from public.variation_photos where version_id = v_row.id;
  perform private.variation_take_photos(v_row.id, v_row.site_id, v_company, p_photos);

  return jsonb_build_object('version_id', v_row.id, 'status', 'Draft');
end;
$fn$;

create or replace function public.set_variation_value(
  p_version_id uuid,
  p_value_pence integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.variation_versions;
  v_actor record;
begin
  select * into v_row from public.variation_versions where id = p_version_id;
  if v_row.id is null then
    raise exception 'not_authorized';
  end if;

  select * into v_actor from private.variation_require_site(v_row.site_id);

  if v_actor.role not in ('owner', 'cm') then
    raise exception 'value_not_allowed';
  end if;

  if v_row.status <> 'Draft' or v_row.is_current is not true then
    raise exception 'variation_locked';
  end if;

  if p_value_pence is not null and (p_value_pence < 0 or p_value_pence > 100000000) then
    raise exception 'invalid_input';
  end if;

  update public.variation_versions
  set value_pence = p_value_pence
  where id = v_row.id;

  return jsonb_build_object('version_id', v_row.id, 'value_pence', p_value_pence);
end;
$fn$;

create or replace function public.sign_variation(
  p_version_id uuid,
  p_signer_name text,
  p_role_company text,
  p_signature_png text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.variation_versions;
  v_actor record;
  v_name text;
  v_role text;
  v_signed_at timestamptz;
begin
  select * into v_row from public.variation_versions where id = p_version_id;
  if v_row.id is null then
    raise exception 'not_authorized';
  end if;

  select * into v_actor from private.variation_require_site(v_row.site_id);

  if v_row.status <> 'Draft' or v_row.is_current is not true then
    raise exception 'variation_locked';
  end if;

  v_name := btrim(coalesce(p_signer_name, ''));
  v_role := btrim(coalesce(p_role_company, ''));
  if char_length(v_name) < 1 or char_length(v_name) > 120
     or char_length(v_role) < 1 or char_length(v_role) > 160
     or p_signature_png is null
     or left(p_signature_png, 22) <> 'data:image/png;base64,'
     or char_length(p_signature_png) < 40
     or char_length(p_signature_png) > 300000 then
    raise exception 'invalid_input';
  end if;

  v_signed_at := now();

  insert into public.variation_signatures (
    version_id, site_id, signer_name, signer_role_company, signature_png, signed_at, recorded_by
  ) values (
    v_row.id, v_row.site_id, v_name, v_role, p_signature_png, v_signed_at, v_actor.person_id
  );

  update public.variation_versions
  set status = 'Signed',
      locked_at = v_signed_at
  where id = v_row.id;

  return jsonb_build_object(
    'version_id', v_row.id,
    'status', 'Signed',
    'signed_at', v_signed_at
  );
end;
$fn$;

create or replace function public.send_variation(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.variation_versions;
  v_actor record;
begin
  select * into v_row from public.variation_versions where id = p_version_id;
  if v_row.id is null then
    raise exception 'not_authorized';
  end if;

  select * into v_actor from private.variation_require_site(v_row.site_id);

  if v_actor.role not in ('owner', 'cm') then
    raise exception 'not_authorized';
  end if;

  if v_row.status <> 'Signed' or v_row.is_current is not true then
    raise exception 'variation_locked';
  end if;

  update public.variation_versions
  set status = 'Sent'
  where id = v_row.id;

  return jsonb_build_object('version_id', v_row.id, 'status', 'Sent');
end;
$fn$;

create or replace function public.revise_variation(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.variation_versions;
  v_actor record;
  v_company uuid;
  v_new_id uuid;
  v_value integer;
  v_photos jsonb;
begin
  select * into v_row from public.variation_versions where id = p_version_id;
  if v_row.id is null then
    raise exception 'not_authorized';
  end if;

  select * into v_actor from private.variation_require_site(v_row.site_id);

  if v_row.is_current is not true or v_row.status not in ('Signed', 'Sent') then
    raise exception 'variation_locked';
  end if;

  select s.company_id into v_company from public.sites s where s.id = v_row.site_id;

  v_value := case when v_actor.role in ('owner', 'cm') then v_row.value_pence else null end;
  v_new_id := gen_random_uuid();

  update public.variation_versions
  set is_current = false
  where id = v_row.id;

  insert into public.variation_versions (
    id, variation_id, site_id, version_no, title, description, level_area, quantity_text,
    value_pence, status, is_current, created_by
  ) values (
    v_new_id, v_row.variation_id, v_row.site_id, v_row.version_no + 1,
    v_row.title, v_row.description, v_row.level_area, v_row.quantity_text,
    v_value, 'Draft', true, v_actor.person_id
  );

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'storage_path', p.storage_path,
      'content_type', p.content_type,
      'file_size_bytes', p.file_size_bytes
    )
    order by p.sort_order
  ), '[]'::jsonb)
  into v_photos
  from public.variation_photos p
  where p.version_id = v_row.id;

  perform private.variation_take_photos(v_new_id, v_row.site_id, v_company, v_photos);

  return jsonb_build_object(
    'variation_id', v_row.variation_id,
    'version_id', v_new_id,
    'version_no', v_row.version_no + 1,
    'status', 'Draft'
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Reads. Invoker, so RLS hides other sites and other firms.
-- ---------------------------------------------------------------------------

create or replace function public.list_variations(p_site_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_rows jsonb;
  v_open integer;
  v_signed integer;
begin
  if p_site_id is null or not private.can_access_site(p_site_id) then
    raise exception 'not_authorized';
  end if;

  select
    coalesce(jsonb_agg(item order by vo_seq), '[]'::jsonb),
    coalesce(sum(case when status = 'Draft' then 1 else 0 end), 0)::integer,
    coalesce(sum(case when status in ('Signed', 'Sent') then 1 else 0 end), 0)::integer
  into v_rows, v_open, v_signed
  from (
    select
      v.vo_seq,
      ver.status,
      jsonb_build_object(
        'variation_id', v.id,
        'version_id', ver.id,
        'vo_seq', v.vo_seq,
        'version_no', ver.version_no,
        'title', ver.title,
        'status', ver.status,
        'photo_count', (
          select count(*) from public.variation_photos p where p.version_id = ver.id
        ),
        'value_pence', ver.value_pence,
        'created_at', ver.created_at
      ) as item
    from public.variations v
    join public.variation_versions ver
      on ver.variation_id = v.id
     and ver.is_current
    where v.site_id = p_site_id
  ) listed;

  return jsonb_build_object(
    'open_count', v_open,
    'signed_count', v_signed,
    'rows', v_rows
  );
end;
$fn$;

create or replace function private.variation_version_json(p_version_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $fn$
  select jsonb_build_object(
    'version_id', ver.id,
    'version_no', ver.version_no,
    'title', ver.title,
    'description', ver.description,
    'level_area', ver.level_area,
    'quantity_text', ver.quantity_text,
    'value_pence', ver.value_pence,
    'status', ver.status,
    'is_current', ver.is_current,
    'created_at', ver.created_at,
    'locked_at', ver.locked_at,
    'photo_count', (select count(*) from public.variation_photos p where p.version_id = ver.id),
    'photos', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'storage_path', p.storage_path,
          'content_type', p.content_type,
          'file_size_bytes', p.file_size_bytes,
          'sort_order', p.sort_order
        )
        order by p.sort_order
      )
      from public.variation_photos p
      where p.version_id = ver.id
    ), '[]'::jsonb),
    'signature', (
      select jsonb_build_object(
        'signer_name', s.signer_name,
        'signer_role_company', s.signer_role_company,
        'signature_png', s.signature_png,
        'signed_at', s.signed_at
      )
      from public.variation_signatures s
      where s.version_id = ver.id
    )
  )
  from public.variation_versions ver
  where ver.id = p_version_id;
$fn$;

revoke all on function private.variation_version_json(uuid) from public;
grant execute on function private.variation_version_json(uuid) to authenticated;

create or replace function public.variation_detail(p_variation_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_site uuid;
  v_seq integer;
  v_current uuid;
  v_history jsonb;
begin
  select v.site_id, v.vo_seq into v_site, v_seq
  from public.variations v
  where v.id = p_variation_id;

  if v_site is null or not private.can_access_site(v_site) then
    raise exception 'not_authorized';
  end if;

  select ver.id into v_current
  from public.variation_versions ver
  where ver.variation_id = p_variation_id
    and ver.is_current;

  if v_current is null then
    raise exception 'not_authorized';
  end if;

  select coalesce(jsonb_agg(private.variation_version_json(ver.id) order by ver.version_no desc), '[]'::jsonb)
  into v_history
  from public.variation_versions ver
  where ver.variation_id = p_variation_id
    and ver.is_current = false;

  return jsonb_build_object(
    'variation_id', p_variation_id,
    'site_id', v_site,
    'vo_seq', v_seq,
    'current', private.variation_version_json(v_current),
    'history', v_history
  );
end;
$fn$;

revoke all on function public.create_variation(uuid, text, text, text, text, integer, jsonb) from public;
revoke all on function public.update_variation_draft(uuid, text, text, text, text, jsonb) from public;
revoke all on function public.set_variation_value(uuid, integer) from public;
revoke all on function public.sign_variation(uuid, text, text, text) from public;
revoke all on function public.send_variation(uuid) from public;
revoke all on function public.revise_variation(uuid) from public;
revoke all on function public.list_variations(uuid) from public;
revoke all on function public.variation_detail(uuid) from public;

grant execute on function public.create_variation(uuid, text, text, text, text, integer, jsonb) to authenticated;
grant execute on function public.update_variation_draft(uuid, text, text, text, text, jsonb) to authenticated;
grant execute on function public.set_variation_value(uuid, integer) to authenticated;
grant execute on function public.sign_variation(uuid, text, text, text) to authenticated;
grant execute on function public.send_variation(uuid) to authenticated;
grant execute on function public.revise_variation(uuid) to authenticated;
grant execute on function public.list_variations(uuid) to authenticated;
grant execute on function public.variation_detail(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Private bucket. Path company_id/site_id/... RLS uses can_access_site.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'site-photos',
  'site-photos',
  false,
  1572864,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table storage.objects enable row level security;

grant usage on schema storage to authenticated;
grant select, insert on table storage.objects to authenticated;

drop policy if exists site_photos_select on storage.objects;
drop policy if exists site_photos_insert on storage.objects;

create policy site_photos_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'site-photos'
    and private.storage_company_id(name) = private.my_company_id()
    and private.can_access_site(private.storage_site_id(name))
  );

create policy site_photos_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'site-photos'
    and private.storage_company_id(name) = private.my_company_id()
    and private.can_access_site(private.storage_site_id(name))
  );
