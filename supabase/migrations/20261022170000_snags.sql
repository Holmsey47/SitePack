-- Snags with photos and a sign-off (6.3).
-- Photos reuse the private bucket site-photos from 6.1 (company_id/site_id/...).
-- This migration does not alter storage, auth, or any Supabase-managed object.
-- Writes are SECURITY DEFINER with search_path pinned to empty.
-- Reads run as the caller, so RLS applies.
-- Device times are stored as sent when they fall inside the sanity window.
-- received_at is the server clock for that request and is never taken from the client.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.snag_counters (
  site_id uuid primary key references public.sites (id) on delete cascade,
  last_seq integer not null check (last_seq > 0)
);

comment on table public.snag_counters is
  'Per-site sequence for S-<seq>. Clients may read their own sites. Only definer functions advance it.';

create table public.snags (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  snag_seq integer not null check (snag_seq > 0),
  note text not null,
  level_area text,
  trade_label text not null,
  raised_by uuid not null references public.people (id),
  raised_by_name text not null,
  raised_at timestamptz not null,
  raised_received_at timestamptz not null default now(),
  status text not null check (status in ('Open', 'Fixed', 'Signed off')),
  fixed_by uuid references public.people (id),
  fixed_by_name text,
  fixed_at timestamptz,
  fixed_received_at timestamptz,
  fixed_client_id uuid,
  created_at timestamptz not null default now(),
  unique (site_id, snag_seq),
  constraint snags_note_len check (char_length(btrim(note)) between 1 and 2000),
  constraint snags_level_len check (level_area is null or char_length(level_area) <= 80),
  constraint snags_trade_len check (char_length(btrim(trade_label)) between 1 and 80),
  constraint snags_raised_name_len check (char_length(btrim(raised_by_name)) between 1 and 120),
  constraint snags_fixed_name_len check (fixed_by_name is null or char_length(btrim(fixed_by_name)) between 1 and 120),
  constraint snags_fixed_pair check (
    (status = 'Open' and fixed_by is null and fixed_at is null and fixed_received_at is null)
    or (status in ('Fixed', 'Signed off') and fixed_by is not null and fixed_at is not null and fixed_received_at is not null)
  )
);

create index snags_site_status_idx on public.snags (site_id, status);
create index snags_company_id_idx on public.snags (company_id);

comment on table public.snags is
  'A site snag. Open, then Fixed with an after photo, then Signed off. raised_at and fixed_at are device times.';

comment on column public.snags.raised_at is
  'When the phone raised the snag. Kept if it is within 30 days past and 24 hours ahead of the server.';

comment on column public.snags.raised_received_at is
  'Server clock when create_snag ran. Not supplied by the client.';

create table public.snag_photos (
  id uuid primary key default gen_random_uuid(),
  snag_id uuid not null references public.snags (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  kind text not null check (kind in ('before', 'after')),
  storage_path text not null,
  sort_order integer not null check (sort_order between 1 and 10),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  file_size_bytes bigint not null check (file_size_bytes > 0 and file_size_bytes <= 1572864),
  created_at timestamptz not null default now(),
  unique (snag_id, kind, sort_order),
  unique (snag_id, storage_path)
);

create index snag_photos_site_id_idx on public.snag_photos (site_id);

comment on table public.snag_photos is
  'Before photos on raise, after photos when the snag is marked Fixed. Bytes live in site-photos.';

create table public.snag_signoffs (
  id uuid primary key,
  site_id uuid not null references public.sites (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  kind text not null check (kind in ('internal', 'contractor')),
  signer_name text not null,
  signer_role text not null,
  signer_company text not null,
  confirmation_text text not null,
  signature_png text,
  signed_at timestamptz not null,
  signed_received_at timestamptz not null default now(),
  covered jsonb not null,
  outstanding jsonb not null,
  recorded_by uuid not null references public.people (id),
  created_at timestamptz not null default now(),
  constraint snag_signoffs_name_len check (char_length(btrim(signer_name)) between 1 and 120),
  constraint snag_signoffs_role_len check (char_length(btrim(signer_role)) between 1 and 80),
  constraint snag_signoffs_company_len check (char_length(btrim(signer_company)) between 1 and 120),
  constraint snag_signoffs_confirmation_len check (char_length(btrim(confirmation_text)) between 1 and 400),
  constraint snag_signoffs_png_len check (signature_png is null or char_length(signature_png) between 40 and 300000),
  constraint snag_signoffs_png_kind check (
    (kind = 'internal' and signature_png is null)
    or (kind = 'contractor' and signature_png is not null)
  ),
  constraint snag_signoffs_covered_array check (jsonb_typeof(covered) = 'array' and jsonb_array_length(covered) >= 1),
  constraint snag_signoffs_outstanding_array check (jsonb_typeof(outstanding) = 'array')
);

create index snag_signoffs_site_id_idx on public.snag_signoffs (site_id);

comment on table public.snag_signoffs is
  'One sign-off of the snags that were Fixed at that moment. The row is immutable. A later fix needs a new row.';

comment on column public.snag_signoffs.confirmation_text is
  'The sentence the server built from the typed company. The PDF prints this text, not a client copy.';

comment on column public.snag_signoffs.covered is
  'Snapshot of covered snag ids, notes, levels, statuses and photo paths at signing.';

comment on column public.snag_signoffs.outstanding is
  'Snapshot of snags still Open at signing. Not part of this signature.';

create table public.snag_signatures (
  id uuid primary key default gen_random_uuid(),
  snag_id uuid not null unique references public.snags (id) on delete cascade,
  signoff_id uuid not null references public.snag_signoffs (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  kind text not null check (kind in ('internal', 'contractor')),
  signer_name text not null,
  signer_role text not null,
  signer_company text not null,
  confirmation_text text not null,
  signature_png text,
  signed_at timestamptz not null,
  signed_received_at timestamptz not null default now(),
  recorded_by uuid not null references public.people (id),
  created_at timestamptz not null default now(),
  constraint snag_signatures_name_len check (char_length(btrim(signer_name)) between 1 and 120),
  constraint snag_signatures_role_len check (char_length(btrim(signer_role)) between 1 and 80),
  constraint snag_signatures_company_len check (char_length(btrim(signer_company)) between 1 and 120),
  constraint snag_signatures_confirmation_len check (char_length(btrim(confirmation_text)) between 1 and 400),
  constraint snag_signatures_png_len check (signature_png is null or char_length(signature_png) between 40 and 300000),
  constraint snag_signatures_png_kind check (
    (kind = 'internal' and signature_png is null)
    or (kind = 'contractor' and signature_png is not null)
  )
);

create index snag_signatures_site_id_idx on public.snag_signatures (site_id);

comment on table public.snag_signatures is
  'The per-snag link to one immutable sign-off. signed_at is the device time.';

comment on column public.snag_signatures.signed_at is
  'When the phone recorded the sign-off. Sanity-checked the same way as raised_at.';

comment on column public.snag_signatures.signed_received_at is
  'Server clock when the sign-off was received.';

-- ---------------------------------------------------------------------------
-- Actor, device time, guards. search_path is empty.
-- ---------------------------------------------------------------------------

create or replace function private.snag_actor()
returns table (person_id uuid, company_id uuid, role text, display_name text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select p.id, p.company_id, p.role, p.display_name
  from public.people p
  where p.auth_user_id = (select auth.uid());
$fn$;

revoke all on function private.snag_actor() from public, anon, authenticated;

create or replace function private.snag_device_time(p_at timestamptz)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $fn$
begin
  if p_at is null
     or p_at > now() + interval '24 hours'
     or p_at < now() - interval '30 days' then
    raise exception 'invalid_time';
  end if;
  return p_at;
end;
$fn$;

revoke all on function private.snag_device_time(timestamptz) from public, anon, authenticated;

create or replace function private.snag_require_site(p_site_id uuid)
returns table (person_id uuid, company_id uuid, role text, display_name text)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_person uuid;
  v_company uuid;
  v_role text;
  v_name text;
  v_site_company uuid;
begin
  select a.person_id, a.company_id, a.role, a.display_name
  into v_person, v_company, v_role, v_name
  from private.snag_actor() a;

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
  display_name := v_name;
  return next;
end;
$fn$;

revoke all on function private.snag_require_site(uuid) from public, anon, authenticated;

create or replace function private.snag_person_label(p_name text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select left(coalesce(nullif(btrim(coalesce(p_name, '')), ''), 'Someone on site'), 120);
$fn$;

revoke all on function private.snag_person_label(text) from public, anon, authenticated;

create or replace function private.guard_snag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_after integer;
begin
  if tg_op = 'INSERT' then
    if new.status is distinct from 'Open' then
      raise exception 'invalid_status';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if old.status = 'Signed off' then
    raise exception 'snag_locked';
  end if;

  if new.site_id is distinct from old.site_id
     or new.company_id is distinct from old.company_id
     or new.snag_seq is distinct from old.snag_seq
     or new.note is distinct from old.note
     or new.level_area is distinct from old.level_area
     or new.trade_label is distinct from old.trade_label
     or new.raised_by is distinct from old.raised_by
     or new.raised_by_name is distinct from old.raised_by_name
     or new.raised_at is distinct from old.raised_at
     or new.raised_received_at is distinct from old.raised_received_at then
    raise exception 'snag_locked';
  end if;

  if old.status = 'Open' and new.status = 'Fixed' then
    if new.fixed_by is null or new.fixed_at is null or new.fixed_received_at is null then
      raise exception 'invalid_status';
    end if;
    select count(*) into v_after
    from public.snag_photos p
    where p.snag_id = new.id and p.kind = 'after';
    if v_after < 1 then
      raise exception 'after_photo_required';
    end if;
    return new;
  end if;

  if old.status = 'Fixed' and new.status = 'Signed off' then
    if new.fixed_by is distinct from old.fixed_by
       or new.fixed_by_name is distinct from old.fixed_by_name
       or new.fixed_at is distinct from old.fixed_at
       or new.fixed_received_at is distinct from old.fixed_received_at then
      raise exception 'snag_locked';
    end if;
    if not exists (
      select 1 from public.snag_signatures s where s.snag_id = new.id
    ) then
      raise exception 'signature_required';
    end if;
    return new;
  end if;

  raise exception 'invalid_status';
end;
$fn$;

revoke all on function private.guard_snag() from public, anon, authenticated;

create trigger snags_guard
  before insert or update on public.snags
  for each row execute function private.guard_snag();

create or replace function private.guard_snag_photo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text;
begin
  if tg_op = 'UPDATE' then
    raise exception 'snag_locked';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;

  select s.status into v_status
  from public.snags s
  where s.id = new.snag_id;

  if v_status is null or v_status <> 'Open' then
    raise exception 'snag_locked';
  end if;

  if new.kind = 'before' and exists (
    select 1 from public.snag_photos p where p.snag_id = new.snag_id and p.kind = 'after'
  ) then
    raise exception 'snag_locked';
  end if;

  return new;
end;
$fn$;

revoke all on function private.guard_snag_photo() from public, anon, authenticated;

create trigger snag_photos_guard
  before insert or update on public.snag_photos
  for each row execute function private.guard_snag_photo();

create or replace function private.guard_snag_signature()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text;
begin
  if tg_op = 'UPDATE' then
    raise exception 'snag_locked';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;

  select s.status into v_status
  from public.snags s
  where s.id = new.snag_id;

  if v_status is null or v_status <> 'Fixed' then
    raise exception 'snag_locked';
  end if;

  if new.kind = 'contractor' and left(coalesce(new.signature_png, ''), 22) <> 'data:image/png;base64,' then
    raise exception 'invalid_input';
  end if;

  return new;
end;
$fn$;

revoke all on function private.guard_snag_signature() from public, anon, authenticated;

create trigger snag_signatures_guard
  before insert or update on public.snag_signatures
  for each row execute function private.guard_snag_signature();

-- ---------------------------------------------------------------------------
-- RLS. Operative and CM: assigned sites. Owner: company sites.
-- No client insert, update, or delete.
-- ---------------------------------------------------------------------------

alter table public.snag_counters enable row level security;
alter table public.snags enable row level security;
alter table public.snag_photos enable row level security;
alter table public.snag_signatures enable row level security;
alter table public.snag_signoffs enable row level security;

revoke all on table public.snag_counters from public, anon, authenticated;
revoke all on table public.snags from public, anon, authenticated;
revoke all on table public.snag_photos from public, anon, authenticated;
revoke all on table public.snag_signatures from public, anon, authenticated;
revoke all on table public.snag_signoffs from public, anon, authenticated;

grant select on table public.snag_counters to authenticated;
grant select on table public.snags to authenticated;
grant select on table public.snag_photos to authenticated;
grant select on table public.snag_signatures to authenticated;
grant select on table public.snag_signoffs to authenticated;

create policy snag_counters_select
  on public.snag_counters for select to authenticated
  using (private.can_access_site(site_id));

create policy snags_select
  on public.snags for select to authenticated
  using (
    company_id = private.my_company_id()
    and private.can_access_site(site_id)
  );

create policy snag_photos_select
  on public.snag_photos for select to authenticated
  using (private.can_access_site(site_id));

create policy snag_signatures_select
  on public.snag_signatures for select to authenticated
  using (private.can_access_site(site_id));

create policy snag_signoffs_select
  on public.snag_signoffs for select to authenticated
  using (
    company_id = private.my_company_id()
    and private.can_access_site(site_id)
  );

-- ---------------------------------------------------------------------------
-- Photos and text
-- ---------------------------------------------------------------------------

create or replace function private.snag_take_photos(
  p_snag_id uuid,
  p_site_id uuid,
  p_company_id uuid,
  p_kind text,
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
  v_tail text;
  v_type text;
  v_size bigint;
  v_prefix text;
  v_seen text[] := '{}';
  v_owner uuid;
  v_owner_id text;
  v_meta jsonb;
  i integer;
begin
  if p_kind not in ('before', 'after') then
    raise exception 'invalid_input';
  end if;

  if p_photos is null or jsonb_typeof(p_photos) <> 'array' then
    raise exception 'photo_count';
  end if;

  v_len := jsonb_array_length(p_photos);
  if v_len < 1 or v_len > 10 then
    raise exception 'photo_count';
  end if;

  -- company/site/snags/<this snag>/<file>. Another snag's key cannot be reused.
  v_prefix := p_company_id::text || '/' || p_site_id::text || '/snags/' || p_snag_id::text || '/';

  for i in 0..v_len - 1 loop
    v_item := p_photos -> i;
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'invalid_input';
    end if;

    v_path := btrim(coalesce(v_item ->> 'storage_path', ''));
    v_tail := case
      when char_length(v_path) > char_length(v_prefix) then substr(v_path, char_length(v_prefix) + 1)
      else ''
    end;

    if char_length(v_path) < char_length(v_prefix) + 1
       or left(v_path, 1) = '/'
       or left(v_path, char_length(v_prefix)) <> v_prefix
       or v_tail = ''
       or strpos(v_tail, '/') > 0
       or strpos(v_path, '..') > 0
       or strpos(v_path, chr(92)) > 0
       or strpos(v_path, '//') > 0
       or v_path ~ '[[:space:]]'
       or v_path = any(v_seen) then
      raise exception 'invalid_path';
    end if;
    v_seen := v_seen || v_path;

    -- The snag's own before photo cannot be filed again as the after photo.
    if exists (
      select 1
      from public.snag_photos existing
      where existing.snag_id = p_snag_id
        and existing.storage_path = v_path
    ) then
      raise exception 'invalid_path';
    end if;

    -- Read-only. The object's owner and metadata are the source of truth, not the client.
    select objects.owner, objects.owner_id, objects.metadata
    into v_owner, v_owner_id, v_meta
    from storage.objects objects
    where objects.bucket_id = 'site-photos'
      and objects.name = v_path;

    if v_owner is distinct from auth.uid() and v_owner_id is distinct from auth.uid()::text then
      raise exception 'invalid_path';
    end if;

    v_type := lower(btrim(coalesce(v_meta ->> 'mimetype', '')));
    begin
      v_size := (v_meta ->> 'size')::bigint;
    exception
      when others then
        raise exception 'invalid_input';
    end;

    if v_type not in ('image/jpeg', 'image/png', 'image/webp') then
      raise exception 'invalid_input';
    end if;

    if v_size is null or v_size < 1 or v_size > 1572864 then
      raise exception 'photo_too_large';
    end if;

    insert into public.snag_photos (
      snag_id, site_id, kind, storage_path, sort_order, content_type, file_size_bytes
    ) values (
      p_snag_id, p_site_id, p_kind, v_path, i + 1, v_type, v_size
    );
  end loop;
end;
$fn$;

revoke all on function private.snag_take_photos(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;

create or replace function private.snag_text(
  p_note text,
  p_level_area text,
  p_trade_label text,
  out note text,
  out level_area text,
  out trade_label text
)
language plpgsql
immutable
set search_path = ''
as $fn$
begin
  note := btrim(coalesce(p_note, ''));
  level_area := nullif(btrim(coalesce(p_level_area, '')), '');
  trade_label := btrim(coalesce(p_trade_label, ''));

  if char_length(note) < 1 or char_length(note) > 2000
     or (level_area is not null and char_length(level_area) > 80)
     or char_length(trade_label) < 1 or char_length(trade_label) > 80 then
    raise exception 'invalid_input';
  end if;
end;
$fn$;

revoke all on function private.snag_text(text, text, text) from public, anon, authenticated;

create or replace function private.next_snag_seq(p_site_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_seq integer;
begin
  insert into public.snag_counters (site_id, last_seq)
  values (p_site_id, 1)
  on conflict (site_id) do update
  set last_seq = public.snag_counters.last_seq + 1
  returning last_seq into v_seq;

  return v_seq;
end;
$fn$;

revoke all on function private.next_snag_seq(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------

create or replace function private.snag_confirmation(p_kind text, p_company text)
returns text
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_company text;
begin
  v_company := btrim(coalesce(p_company, ''));
  if char_length(v_company) < 1 or char_length(v_company) > 120 then
    raise exception 'invalid_input';
  end if;
  if p_kind = 'contractor' then
    return 'I confirm the snags marked complete below have been put right to my satisfaction, on behalf of ' || v_company || '.';
  end if;
  if p_kind = 'internal' then
    return 'I''ve checked the snags marked complete below and I''m satisfied they''ve been put right. This is an internal check for ' || v_company || ', not sign-off by the main contractor.';
  end if;
  raise exception 'invalid_input';
end;
$fn$;

revoke all on function private.snag_confirmation(text, text) from public, anon, authenticated;

create or replace function private.guard_snag_signoff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'UPDATE' or tg_op = 'DELETE' then
    raise exception 'closed';
  end if;
  return new;
end;
$fn$;

revoke all on function private.guard_snag_signoff() from public, anon, authenticated;

create trigger snag_signoffs_guard
  before update or delete on public.snag_signoffs
  for each row execute function private.guard_snag_signoff();

create or replace function private.snag_signoff_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select jsonb_build_object(
    'signoff_id', s.id,
    'site_id', s.site_id,
    'kind', s.kind,
    'signer_name', s.signer_name,
    'signer_role', s.signer_role,
    'signer_company', s.signer_company,
    'confirmation_text', s.confirmation_text,
    'signature_png', s.signature_png,
    'signed_at', s.signed_at,
    'signed_received_at', s.signed_received_at,
    'covered', s.covered,
    'outstanding', s.outstanding
  )
  from public.snag_signoffs s
  where s.id = p_id;
$fn$;

revoke all on function private.snag_signoff_json(uuid) from public, anon, authenticated;

-- One immutable sign-off of the snag ids the signer was shown.
-- A retry of the same id returns the stored row. A later fix needs a new id.
create or replace function private.apply_snag_signoff(
  p_signoff_id uuid,
  p_site_id uuid,
  p_signed_at timestamptz,
  p_kind text,
  p_signer_name text,
  p_signer_role text,
  p_company text,
  p_signature_png text,
  p_covered_ids uuid[],
  p_outstanding_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_existing public.snag_signoffs;
  v_signed timestamptz;
  v_received timestamptz;
  v_confirmation text;
  v_covered jsonb;
  v_outstanding jsonb;
  v_item jsonb;
  v_snag_id uuid;
  v_fixed_ids uuid[];
  v_open_ids uuid[];
  v_given_fixed uuid[];
  v_given_open uuid[];
begin
  if p_signoff_id is null or p_site_id is null or p_kind not in ('internal', 'contractor') then
    raise exception 'invalid_input';
  end if;

  -- Same client id from two phones waits, then reads the stored row.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_signoff_id::text, 0));

  select * into v_actor from private.snag_require_site(p_site_id);

  select * into v_existing from public.snag_signoffs where id = p_signoff_id;
  if v_existing.id is not null then
    if v_existing.site_id = p_site_id
       and v_existing.company_id = v_actor.company_id
       and v_existing.kind = p_kind then
      return private.snag_signoff_json(v_existing.id);
    end if;
    raise exception 'not_authorized';
  end if;

  v_confirmation := private.snag_confirmation(p_kind, p_company);
  v_signed := private.snag_device_time(p_signed_at);
  v_received := now();

  perform 1
  from public.snags s
  where s.site_id = p_site_id
    and s.company_id = v_actor.company_id
    and s.status in ('Fixed', 'Open')
  order by s.snag_seq
  for update;

  select coalesce(array_agg(s.id order by s.id), '{}'::uuid[])
  into v_fixed_ids
  from public.snags s
  where s.site_id = p_site_id
    and s.company_id = v_actor.company_id
    and s.status = 'Fixed';

  select coalesce(array_agg(s.id order by s.id), '{}'::uuid[])
  into v_open_ids
  from public.snags s
  where s.site_id = p_site_id
    and s.company_id = v_actor.company_id
    and s.status = 'Open';

  select coalesce(array_agg(distinct x order by x), '{}'::uuid[])
  into v_given_fixed
  from unnest(coalesce(p_covered_ids, '{}'::uuid[])) as x;

  select coalesce(array_agg(distinct x order by x), '{}'::uuid[])
  into v_given_open
  from unnest(coalesce(p_outstanding_ids, '{}'::uuid[])) as x;

  if v_fixed_ids is distinct from v_given_fixed
     or v_open_ids is distinct from v_given_open then
    raise exception 'snag_list_changed';
  end if;

  if coalesce(array_length(v_fixed_ids, 1), 0) < 1 then
    raise exception 'closed';
  end if;

  select coalesce(jsonb_agg(item order by snag_seq), '[]'::jsonb)
  into v_covered
  from (
    select
      s.snag_seq,
      jsonb_build_object(
        'snag_id', s.id,
        'snag_seq', s.snag_seq,
        'note', s.note,
        'level_area', s.level_area,
        'status', s.status,
        'photo_paths', coalesce((
          select jsonb_agg(p.storage_path order by case p.kind when 'before' then 0 else 1 end, p.sort_order)
          from public.snag_photos p
          where p.snag_id = s.id
        ), '[]'::jsonb)
      ) as item
    from public.snags s
    where s.id = any(v_fixed_ids)
  ) covered_rows;

  select coalesce(jsonb_agg(item order by snag_seq), '[]'::jsonb)
  into v_outstanding
  from (
    select
      s.snag_seq,
      jsonb_build_object(
        'snag_id', s.id,
        'snag_seq', s.snag_seq,
        'note', s.note,
        'level_area', s.level_area
      ) as item
    from public.snags s
    where s.id = any(v_open_ids)
  ) open_rows;

  begin
    insert into public.snag_signoffs (
      id, site_id, company_id, kind, signer_name, signer_role, signer_company,
      confirmation_text, signature_png, signed_at, signed_received_at,
      covered, outstanding, recorded_by
    ) values (
      p_signoff_id, p_site_id, v_actor.company_id, p_kind,
      p_signer_name, p_signer_role, btrim(p_company),
      v_confirmation, p_signature_png, v_signed, v_received,
      v_covered, v_outstanding, v_actor.person_id
    );
  exception
    when unique_violation then
      select * into v_existing from public.snag_signoffs where id = p_signoff_id;
      if v_existing.id is not null
         and v_existing.site_id = p_site_id
         and v_existing.company_id = v_actor.company_id
         and v_existing.kind = p_kind then
        return private.snag_signoff_json(v_existing.id);
      end if;
      raise;
  end;

  for v_item in select value from jsonb_array_elements(v_covered) loop
    v_snag_id := (v_item ->> 'snag_id')::uuid;
    insert into public.snag_signatures (
      snag_id, signoff_id, site_id, kind, signer_name, signer_role, signer_company,
      confirmation_text, signature_png, signed_at, signed_received_at, recorded_by
    ) values (
      v_snag_id, p_signoff_id, p_site_id, p_kind,
      p_signer_name, p_signer_role, btrim(p_company),
      v_confirmation, p_signature_png, v_signed, v_received, v_actor.person_id
    );
    update public.snags
    set status = 'Signed off'
    where id = v_snag_id;
  end loop;

  return private.snag_signoff_json(p_signoff_id);
end;
$fn$;

revoke all on function private.apply_snag_signoff(uuid, uuid, timestamptz, text, text, text, text, text, uuid[], uuid[]) from public, anon, authenticated;

create or replace function public.create_snag(
  p_id uuid,
  p_site_id uuid,
  p_note text,
  p_level_area text,
  p_trade_label text,
  p_raised_at timestamptz,
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
  v_existing public.snags;
  v_seq integer;
  v_raised timestamptz;
  v_received timestamptz;
begin
  if p_id is null then
    raise exception 'invalid_input';
  end if;

  select * into v_actor from private.snag_require_site(p_site_id);
  select * into v_existing from public.snags where id = p_id;
  if v_existing.id is not null then
    if v_existing.site_id = p_site_id and v_existing.company_id = v_actor.company_id then
      return jsonb_build_object(
        'snag_id', v_existing.id,
        'snag_seq', v_existing.snag_seq,
        'status', v_existing.status,
        'raised_at', v_existing.raised_at,
        'raised_received_at', v_existing.raised_received_at,
        'already_existed', true,
        'photo_paths', coalesce((
          select jsonb_agg(p.storage_path order by case p.kind when 'before' then 0 else 1 end, p.sort_order)
          from public.snag_photos p
          where p.snag_id = v_existing.id
        ), '[]'::jsonb)
      );
    end if;
    raise exception 'not_authorized';
  end if;

  select * into v_text from private.snag_text(p_note, p_level_area, p_trade_label);
  v_raised := private.snag_device_time(p_raised_at);
  v_received := now();
  v_seq := private.next_snag_seq(p_site_id);

  insert into public.snags (
    id, site_id, company_id, snag_seq, note, level_area, trade_label,
    raised_by, raised_by_name, raised_at, raised_received_at, status
  ) values (
    p_id, p_site_id, v_actor.company_id, v_seq, v_text.note, v_text.level_area, v_text.trade_label,
    v_actor.person_id, private.snag_person_label(v_actor.display_name), v_raised, v_received, 'Open'
  );

  perform private.snag_take_photos(p_id, p_site_id, v_actor.company_id, 'before', p_photos);

  return jsonb_build_object(
    'snag_id', p_id,
    'snag_seq', v_seq,
    'status', 'Open',
    'raised_at', v_raised,
    'raised_received_at', v_received,
    'already_existed', false,
    'photo_paths', coalesce((
      select jsonb_agg(p.storage_path order by p.sort_order)
      from public.snag_photos p
      where p.snag_id = p_id
    ), '[]'::jsonb)
  );
end;
$fn$;

create or replace function public.fix_snag(
  p_snag_id uuid,
  p_fixed_at timestamptz,
  p_photos jsonb,
  p_fix_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.snags;
  v_actor record;
  v_fixed timestamptz;
  v_received timestamptz;
  v_name text;
  v_same_paths boolean;
begin
  select * into v_row from public.snags where id = p_snag_id for update;
  if v_row.id is null then
    raise exception 'not_authorized';
  end if;

  select * into v_actor from private.snag_require_site(v_row.site_id);

  if v_row.company_id <> v_actor.company_id then
    raise exception 'not_authorized';
  end if;

  -- A lost response retries the same client id, or the same after-photo paths.
  if v_row.status in ('Fixed', 'Signed off') then
    select (
      select coalesce(jsonb_agg(p.storage_path order by p.sort_order), '[]'::jsonb)
      from public.snag_photos p
      where p.snag_id = v_row.id and p.kind = 'after'
    ) = (
      select coalesce(jsonb_agg(item ->> 'storage_path' order by ord), '[]'::jsonb)
      from jsonb_array_elements(coalesce(p_photos, '[]'::jsonb)) with ordinality as t(item, ord)
    )
    into v_same_paths;

    if (p_fix_id is not null and v_row.fixed_client_id = p_fix_id) or v_same_paths then
      return jsonb_build_object(
        'snag_id', v_row.id,
        'status', v_row.status,
        'fixed_at', v_row.fixed_at,
        'fixed_received_at', v_row.fixed_received_at,
        'already_fixed', true
      );
    end if;
    raise exception 'snag_locked';
  end if;

  if v_row.status <> 'Open' then
    raise exception 'snag_locked';
  end if;

  v_fixed := private.snag_device_time(p_fixed_at);
  v_received := now();
  v_name := private.snag_person_label(v_actor.display_name);

  perform private.snag_take_photos(v_row.id, v_row.site_id, v_actor.company_id, 'after', p_photos);

  update public.snags
  set status = 'Fixed',
      fixed_by = v_actor.person_id,
      fixed_by_name = v_name,
      fixed_at = v_fixed,
      fixed_received_at = v_received,
      fixed_client_id = p_fix_id
  where id = v_row.id;

  return jsonb_build_object(
    'snag_id', v_row.id,
    'status', 'Fixed',
    'fixed_at', v_fixed,
    'fixed_received_at', v_received,
    'already_fixed', false
  );
end;
$fn$;

create or replace function public.sign_off_snags_internal(
  p_signoff_id uuid,
  p_site_id uuid,
  p_signed_at timestamptz,
  p_company text,
  p_covered_ids uuid[],
  p_outstanding_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_role text;
begin
  select * into v_actor from private.snag_require_site(p_site_id);
  if v_actor.role not in ('owner', 'cm') then
    raise exception 'not_authorized';
  end if;
  v_role := case v_actor.role when 'owner' then 'Owner' else 'Contracts manager' end;
  return private.apply_snag_signoff(
    p_signoff_id,
    p_site_id,
    p_signed_at,
    'internal',
    private.snag_person_label(v_actor.display_name),
    v_role,
    p_company,
    null,
    p_covered_ids,
    p_outstanding_ids
  );
end;
$fn$;

create or replace function public.sign_off_snags_contractor(
  p_signoff_id uuid,
  p_site_id uuid,
  p_signed_at timestamptz,
  p_signer_name text,
  p_signer_role text,
  p_company text,
  p_signature_png text,
  p_covered_ids uuid[],
  p_outstanding_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_name text;
  v_role text;
begin
  v_name := btrim(coalesce(p_signer_name, ''));
  v_role := btrim(coalesce(p_signer_role, ''));
  if char_length(v_name) < 1 or char_length(v_name) > 120
     or char_length(v_role) < 1 or char_length(v_role) > 80
     or p_signature_png is null
     or left(p_signature_png, 22) <> 'data:image/png;base64,'
     or char_length(p_signature_png) < 40
     or char_length(p_signature_png) > 300000 then
    raise exception 'invalid_input';
  end if;
  return private.apply_snag_signoff(
    p_signoff_id,
    p_site_id,
    p_signed_at,
    'contractor',
    v_name,
    v_role,
    p_company,
    p_signature_png,
    p_covered_ids,
    p_outstanding_ids
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Reads. Invoker, so RLS hides other sites and other firms.
-- ---------------------------------------------------------------------------

create or replace function public.list_snags(p_site_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_rows jsonb;
  v_open integer;
  v_fixed integer;
  v_signed integer;
begin
  if p_site_id is null or not private.can_access_site(p_site_id) then
    raise exception 'not_authorized';
  end if;

  select
    coalesce(jsonb_agg(item order by snag_seq), '[]'::jsonb),
    coalesce(sum(case when status = 'Open' then 1 else 0 end), 0)::integer,
    coalesce(sum(case when status = 'Fixed' then 1 else 0 end), 0)::integer,
    coalesce(sum(case when status = 'Signed off' then 1 else 0 end), 0)::integer
  into v_rows, v_open, v_fixed, v_signed
  from (
    select
      s.snag_seq,
      s.status,
      jsonb_build_object(
        'snag_id', s.id,
        'snag_seq', s.snag_seq,
        'note', s.note,
        'level_area', s.level_area,
        'trade_label', s.trade_label,
        'status', s.status,
        'raised_by_name', s.raised_by_name,
        'raised_at', s.raised_at,
        'before_count', (
          select count(*) from public.snag_photos p where p.snag_id = s.id and p.kind = 'before'
        ),
        'after_count', (
          select count(*) from public.snag_photos p where p.snag_id = s.id and p.kind = 'after'
        )
      ) as item
    from public.snags s
    where s.site_id = p_site_id
  ) listed;

  return jsonb_build_object(
    'open_count', v_open,
    'fixed_count', v_fixed,
    'signed_off_count', v_signed,
    'rows', v_rows
  );
end;
$fn$;

create or replace function private.snag_json(p_snag_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $fn$
  select jsonb_build_object(
    'snag_id', s.id,
    'site_id', s.site_id,
    'snag_seq', s.snag_seq,
    'note', s.note,
    'level_area', s.level_area,
    'trade_label', s.trade_label,
    'status', s.status,
    'raised_by_name', s.raised_by_name,
    'raised_at', s.raised_at,
    'raised_received_at', s.raised_received_at,
    'fixed_by_name', s.fixed_by_name,
    'fixed_at', s.fixed_at,
    'fixed_received_at', s.fixed_received_at,
    'photos', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'kind', p.kind,
          'storage_path', p.storage_path,
          'content_type', p.content_type,
          'file_size_bytes', p.file_size_bytes,
          'sort_order', p.sort_order
        )
        order by case p.kind when 'before' then 0 else 1 end, p.sort_order
      )
      from public.snag_photos p
      where p.snag_id = s.id
    ), '[]'::jsonb),
    'signature', (
      select jsonb_build_object(
        'kind', g.kind,
        'signer_name', g.signer_name,
        'signer_role', g.signer_role,
        'signer_company', g.signer_company,
        'confirmation_text', g.confirmation_text,
        'signature_png', g.signature_png,
        'signed_at', g.signed_at,
        'signed_received_at', g.signed_received_at,
        'signoff_id', g.signoff_id
      )
      from public.snag_signatures g
      where g.snag_id = s.id
    )
  )
  from public.snags s
  where s.id = p_snag_id;
$fn$;

revoke all on function private.snag_json(uuid) from public, anon;
grant execute on function private.snag_json(uuid) to authenticated;

create or replace function public.snag_detail(p_snag_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_site uuid;
  v_row jsonb;
begin
  select s.site_id into v_site
  from public.snags s
  where s.id = p_snag_id;

  if v_site is null or not private.can_access_site(v_site) then
    raise exception 'not_authorized';
  end if;

  v_row := private.snag_json(p_snag_id);
  if v_row is null then
    raise exception 'not_authorized';
  end if;
  return v_row;
end;
$fn$;

create or replace function public.snag_report(p_site_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_rows jsonb;
begin
  if p_site_id is null or not private.can_access_site(p_site_id) then
    raise exception 'not_authorized';
  end if;

  select coalesce(jsonb_agg(private.snag_json(s.id) order by s.snag_seq), '[]'::jsonb)
  into v_rows
  from public.snags s
  where s.site_id = p_site_id;

  return jsonb_build_object('rows', v_rows);
end;
$fn$;

-- Definer on purpose. An operative can read a coworker's trade on people,
-- but site_assignments RLS only shows their own row, so an invoker join
-- would suggest a single trade. This returns trade text only, after the site check.
create or replace function public.snag_trade_labels(p_site_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_labels jsonb;
begin
  select * into v_actor from private.snag_require_site(p_site_id);

  select coalesce(jsonb_agg(label order by label), '[]'::jsonb)
  into v_labels
  from (
    select distinct btrim(p.trade) as label
    from public.people p
    join public.site_assignments a on a.person_id = p.id
    where a.site_id = p_site_id
      and p.company_id = v_actor.company_id
      and p.trade is not null
      and btrim(p.trade) <> ''
  ) labels;

  return v_labels;
end;
$fn$;

revoke all on function public.create_snag(uuid, uuid, text, text, text, timestamptz, jsonb) from public, anon;
revoke all on function public.fix_snag(uuid, timestamptz, jsonb, uuid) from public, anon;
revoke all on function public.sign_off_snags_internal(uuid, uuid, timestamptz, text, uuid[], uuid[]) from public, anon;
revoke all on function public.sign_off_snags_contractor(uuid, uuid, timestamptz, text, text, text, text, uuid[], uuid[]) from public, anon;
revoke all on function public.list_snags(uuid) from public, anon;
revoke all on function public.snag_detail(uuid) from public, anon;
revoke all on function public.snag_report(uuid) from public, anon;
revoke all on function public.snag_trade_labels(uuid) from public, anon;

grant execute on function public.create_snag(uuid, uuid, text, text, text, timestamptz, jsonb) to authenticated;
grant execute on function public.fix_snag(uuid, timestamptz, jsonb, uuid) to authenticated;
grant execute on function public.sign_off_snags_internal(uuid, uuid, timestamptz, text, uuid[], uuid[]) to authenticated;
grant execute on function public.sign_off_snags_contractor(uuid, uuid, timestamptz, text, text, text, text, uuid[], uuid[]) to authenticated;
grant execute on function public.list_snags(uuid) to authenticated;
grant execute on function public.snag_detail(uuid) to authenticated;
grant execute on function public.snag_report(uuid) to authenticated;
grant execute on function public.snag_trade_labels(uuid) to authenticated;
