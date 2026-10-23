-- Inductions and toolbox talks signed on the phone (6.5).
-- The server builds the meaning sentence and stores it on the signature.
-- A change of title, body, or PDF starts a new version. Old signatures stay.
-- Operatives read talks on their own sites and only their own signatures.
-- Who has signed, and the register, are null unless the caller is an owner,
-- a contracts manager, or the presenter of that talk.
-- Writes are SECURITY DEFINER with search_path pinned to empty.
-- This migration does not alter storage tables or auth.
-- PDF files reuse the private drawings bucket at company_id/site_id/talks/.
-- Once a version references a talks/ object, update and delete of that object are refused.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.site_talks (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  kind text not null,
  delivery text not null,
  title text not null,
  audience text not null,
  presenter_person_id uuid not null references public.people (id),
  presenter_name text not null,
  presenter_role text not null,
  presented_at timestamptz not null,
  created_by uuid not null references public.people (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_talks_kind check (kind in ('induction', 'toolbox')),
  constraint site_talks_delivery check (delivery in ('phone', 'in_person')),
  constraint site_talks_audience check (audience in ('all', 'chosen')),
  constraint site_talks_induction_phone check (kind <> 'induction' or delivery = 'phone'),
  constraint site_talks_title_len check (char_length(btrim(title)) between 1 and 120),
  constraint site_talks_presenter_len check (char_length(btrim(presenter_name)) between 1 and 120),
  constraint site_talks_role_len check (char_length(btrim(presenter_role)) between 1 and 80)
);

create index site_talks_site_idx on public.site_talks (site_id, created_at desc);

comment on table public.site_talks is
  'An induction or toolbox talk. Presenter name, role, and time are captured with it.';

create table public.site_talk_versions (
  id uuid primary key default gen_random_uuid(),
  talk_id uuid not null references public.site_talks (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  version_no integer not null,
  body text,
  pdf_path text,
  pdf_content_type text,
  pdf_size_bytes bigint,
  pdf_sha256 text,
  content_hash text not null,
  is_current boolean not null default true,
  created_by uuid not null references public.people (id),
  created_at timestamptz not null default now(),
  unique (talk_id, version_no),
  constraint site_talk_versions_body_len check (body is null or char_length(body) <= 8000),
  constraint site_talk_versions_has_content check (
    (body is not null and char_length(btrim(body)) > 0) or pdf_path is not null
  ),
  constraint site_talk_versions_pdf_meta check (
    (
      pdf_path is null
      and pdf_content_type is null
      and pdf_size_bytes is null
      and pdf_sha256 is null
    )
    or (
      pdf_path is not null
      and pdf_content_type = 'application/pdf'
      and pdf_size_bytes between 1 and 52428800
      and pdf_sha256 is not null
    )
  )
);

create unique index site_talk_versions_one_current
  on public.site_talk_versions (talk_id)
  where is_current;

comment on table public.site_talk_versions is
  'One body and optional PDF. Signatures point at this id and its content hash.';

create table public.site_talk_required (
  talk_id uuid not null references public.site_talks (id) on delete cascade,
  person_id uuid not null references public.people (id),
  site_id uuid not null references public.sites (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  primary key (talk_id, person_id)
);

comment on table public.site_talk_required is
  'Chosen operatives. Audience all uses current site assignments instead.';

create table public.site_talk_signatures (
  id uuid primary key default gen_random_uuid(),
  talk_id uuid not null references public.site_talks (id) on delete cascade,
  version_id uuid not null references public.site_talk_versions (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  person_id uuid not null references public.people (id),
  person_name text not null,
  signer_name text not null,
  captured_by uuid not null references public.people (id),
  session_id text not null,
  shared_device boolean not null,
  signature_role text not null,
  meaning text not null,
  signature_png text not null,
  device_at timestamptz not null,
  received_at timestamptz not null,
  content_hash text not null,
  created_at timestamptz not null default now(),
  unique (version_id, person_id, signature_role),
  constraint site_talk_signatures_role check (signature_role in ('attendee', 'presenter')),
  constraint site_talk_signatures_name_len check (char_length(btrim(person_name)) between 1 and 120),
  constraint site_talk_signatures_signer_len check (char_length(btrim(signer_name)) between 1 and 120),
  constraint site_talk_signatures_session_len check (char_length(session_id) between 8 and 80),
  constraint site_talk_signatures_png_len check (char_length(signature_png) between 40 and 200000)
);

create index site_talk_signatures_version_idx on public.site_talk_signatures (version_id, person_id);

comment on table public.site_talk_signatures is
  'One person, one version. meaning is built on the server. received_at is the server clock.';

comment on column public.site_talk_signatures.device_at is
  'When the phone said the person signed.';

comment on column public.site_talk_signatures.received_at is
  'Server clock when the signature was stored. Not supplied by the client.';

comment on column public.site_talk_signatures.shared_device is
  'True when the logged-in person is not the signer.';

comment on column public.site_talk_signatures.signer_name is
  'The signer''s display name at the moment they signed. A later rename does not change this.';

comment on column public.site_talk_signatures.signature_png is
  'Signature image. Granted on its own so a later guest grant can omit this column. Row security still limits a direct select to the host owner, the host contracts manager, and the signer.';

create table public.site_talk_questions (
  id uuid primary key default gen_random_uuid(),
  talk_id uuid not null references public.site_talks (id) on delete cascade,
  version_id uuid not null references public.site_talk_versions (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  person_id uuid not null references public.people (id),
  person_name text not null,
  body text,
  captured_by uuid not null references public.people (id),
  session_id text not null,
  shared_device boolean not null,
  device_at timestamptz not null,
  received_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (version_id, person_id),
  constraint site_talk_questions_body_len check (body is null or char_length(body) <= 280)
);

comment on table public.site_talk_questions is
  'A question instead of a signature. It does not count as signed.';

create table public.site_talk_notes (
  talk_id uuid not null references public.site_talks (id) on delete cascade,
  version_id uuid not null references public.site_talk_versions (id) on delete cascade,
  person_id uuid not null references public.people (id),
  site_id uuid not null references public.sites (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  explained_verbally boolean not null default false,
  interpreter_used boolean not null default false,
  noted_by uuid not null references public.people (id),
  updated_at timestamptz not null default now(),
  primary key (version_id, person_id),
  constraint site_talk_notes_some check (explained_verbally or interpreter_used)
);

comment on table public.site_talk_notes is
  'Presenter marks for one person: explained verbally, interpreter used, or both.';

-- ---------------------------------------------------------------------------
-- Helpers. search_path is empty. Not callable by anon or authenticated.
-- ---------------------------------------------------------------------------

create or replace function private.talk_actor()
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

revoke all on function private.talk_actor() from public, anon, authenticated;

-- U+0000 cannot be stored in text. Line breaks, bidi overrides, and a leading
-- spreadsheet mark are rejected so a title, role, or question cannot spoof a sheet.
create or replace function private.talk_plain(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $fn$
begin
  if p_value is not null
     and (
       p_value ~ (
         '['
         || pg_catalog.chr(1) || '-' || pg_catalog.chr(31)
         || pg_catalog.chr(127)
         || pg_catalog.chr(133)
         || pg_catalog.chr(8206) || pg_catalog.chr(8207)
         || pg_catalog.chr(8232) || pg_catalog.chr(8233)
         || pg_catalog.chr(8234) || '-' || pg_catalog.chr(8238)
         || pg_catalog.chr(8294) || '-' || pg_catalog.chr(8297)
         || ']'
       )
       or left(btrim(p_value), 1) in ('=', '+', '-', '@')
     ) then
    raise exception 'invalid_input';
  end if;
  return p_value;
end;
$fn$;

revoke all on function private.talk_plain(text) from public, anon, authenticated;

create or replace function private.talk_label(p_name text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select left(coalesce(nullif(btrim(coalesce(private.talk_plain(p_name), '')), ''), 'Someone on site'), 120);
$fn$;

revoke all on function private.talk_label(text) from public, anon, authenticated;

create or replace function private.talk_device_time(p_at timestamptz)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $fn$
begin
  if p_at is null
     or p_at > pg_catalog.now() + interval '24 hours'
     or p_at < pg_catalog.now() - interval '30 days' then
    raise exception 'invalid_time';
  end if;
  return p_at;
end;
$fn$;

revoke all on function private.talk_device_time(timestamptz) from public, anon, authenticated;

create or replace function private.talk_uk_date(p_at timestamptz)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select
    (extract(day from timezone('Europe/London', p_at)))::int::text
    || ' '
    || case (extract(month from timezone('Europe/London', p_at)))::int
         when 1 then 'Jan' when 2 then 'Feb' when 3 then 'Mar' when 4 then 'Apr'
         when 5 then 'May' when 6 then 'Jun' when 7 then 'Jul' when 8 then 'Aug'
         when 9 then 'Sep' when 10 then 'Oct' when 11 then 'Nov' when 12 then 'Dec'
       end
    || ' '
    || (extract(year from timezone('Europe/London', p_at)))::int::text;
$fn$;

revoke all on function private.talk_uk_date(timestamptz) from public, anon, authenticated;

-- Keep the sentences in step with lib/talkMeaning.ts. This function is the copy the server stores.
create or replace function private.talk_meaning(
  p_kind text,
  p_delivery text,
  p_role text,
  p_site_name text,
  p_title text,
  p_presenter_name text,
  p_presented_at timestamptz
)
returns text
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_site text := btrim(coalesce(p_site_name, ''));
  v_title text := btrim(coalesce(p_title, ''));
  v_presenter text := btrim(coalesce(p_presenter_name, ''));
begin
  if p_role = 'presenter' then
    return 'I gave this talk to the people listed.';
  end if;
  if p_kind = 'induction' then
    return 'I''ve read and understood the site induction for ' || v_site
      || ' and I''ll follow it. If anything''s unclear, I''ll ask the site manager before starting work.';
  end if;
  if p_delivery = 'in_person' then
    return 'I was at the toolbox talk ''' || v_title || ''' given by ' || v_presenter
      || ' at ' || v_site || ' on ' || private.talk_uk_date(p_presented_at) || ', and I understood it.';
  end if;
  return 'I''ve read and understood the toolbox talk ''' || v_title || ''' for ' || v_site || '.';
end;
$fn$;

revoke all on function private.talk_meaning(text, text, text, text, text, text, timestamptz) from public, anon, authenticated;

create or replace function private.talk_hash(
  p_kind text,
  p_delivery text,
  p_title text,
  p_body text,
  p_pdf text,
  p_sha text
)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select encode(
    extensions.digest(
      convert_to(
        p_kind || E'\n' || p_delivery || E'\n' || btrim(coalesce(p_title, '')) || E'\n'
          || btrim(coalesce(p_body, '')) || E'\n' || coalesce(p_pdf, '') || E'\n' || coalesce(p_sha, ''),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$fn$;

revoke all on function private.talk_hash(text, text, text, text, text, text) from public, anon, authenticated;

-- Exact path company/site/talks/file. The stored object, not the client, supplies type and size.
create or replace function private.talk_storage_path(p_company uuid, p_site uuid, p_path text)
returns table (path text, content_type text, size_bytes bigint, byte_sha256 text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v text;
  v_file text;
  v_prefix text;
  v_object uuid;
  v_owner uuid;
  v_owner_id text;
  v_meta jsonb;
  v_type text;
  v_size bigint;
begin
  if p_path is null or btrim(p_path) = '' then
    return;
  end if;
  v := btrim(p_path);
  v_prefix := p_company::text || '/' || p_site::text || '/talks/';
  v_file := case
    when char_length(v) > char_length(v_prefix) then substr(v, char_length(v_prefix) + 1)
    else ''
  end;
  if left(v, 1) = '/'
     or strpos(v, '..') > 0
     or strpos(v, pg_catalog.chr(92)) > 0
     or strpos(v, '//') > 0
     or v ~ '[[:space:]]'
     or left(v, char_length(v_prefix)) is distinct from v_prefix
     or v_file = ''
     or strpos(v_file, '/') > 0
     or v_file !~ '^[A-Za-z0-9._-]+$' then
    raise exception 'invalid_path';
  end if;

  if exists (
    select 1
    from public.site_talk_versions existing
    where existing.pdf_path = v
  ) then
    raise exception 'invalid_path';
  end if;

  select objects.id, objects.owner, objects.owner_id, objects.metadata
  into v_object, v_owner, v_owner_id, v_meta
  from storage.objects objects
  where objects.bucket_id = 'drawings'
    and objects.name = v;

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

  if v_type is distinct from 'application/pdf' then
    raise exception 'invalid_input';
  end if;
  if v_size is null or v_size < 1 or v_size > 52428800 then
    raise exception 'invalid_input';
  end if;

  path := v;
  content_type := v_type;
  size_bytes := v_size;
  -- Snapshot of the stored object. The version hash includes it, and a later update is blocked.
  byte_sha256 := encode(
    extensions.digest(
      convert_to(coalesce(v_meta::text, '') || '|' || v_object::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  return next;
end;
$fn$;

revoke all on function private.talk_storage_path(uuid, uuid, text) from public, anon, authenticated;

create or replace function private.talk_required_ids(p_talk_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select p.id
  from public.site_talks t
  join public.people p
    on p.company_id = t.company_id
   and p.role = 'operative'
  join public.site_assignments a
    on a.site_id = t.site_id
   and a.person_id = p.id
  where t.id = p_talk_id
    and (
      t.audience = 'all'
      or exists (
        select 1
        from public.site_talk_required r
        where r.talk_id = t.id
          and r.person_id = p.id
      )
    );
$fn$;

revoke all on function private.talk_required_ids(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS. No client insert, update, or delete.
-- ---------------------------------------------------------------------------

alter table public.site_talks enable row level security;
alter table public.site_talk_versions enable row level security;
alter table public.site_talk_required enable row level security;
alter table public.site_talk_signatures enable row level security;
alter table public.site_talk_questions enable row level security;
alter table public.site_talk_notes enable row level security;

revoke all on table public.site_talks from public, anon, authenticated;
revoke all on table public.site_talk_versions from public, anon, authenticated;
revoke all on table public.site_talk_required from public, anon, authenticated;
revoke all on table public.site_talk_signatures from public, anon, authenticated;
revoke all on table public.site_talk_questions from public, anon, authenticated;
revoke all on table public.site_talk_notes from public, anon, authenticated;

grant select on table public.site_talks to authenticated;
grant select on table public.site_talk_versions to authenticated;
grant select on table public.site_talk_required to authenticated;
-- A table-level select cannot be narrowed by revoking one column.
-- signature_png is its own grant so guest access can drop the image and keep the names.
grant select (
  id,
  talk_id,
  version_id,
  site_id,
  company_id,
  person_id,
  person_name,
  captured_by,
  session_id,
  shared_device,
  signature_role,
  meaning,
  device_at,
  received_at,
  content_hash,
  created_at
) on table public.site_talk_signatures to authenticated;
grant select (signature_png) on table public.site_talk_signatures to authenticated;
grant select on table public.site_talk_questions to authenticated;
grant select on table public.site_talk_notes to authenticated;

create policy site_talks_select
  on public.site_talks for select to authenticated
  using (
    company_id = private.my_company_id()
    and private.can_access_site(site_id)
    and (
      private.my_role() in ('owner', 'cm')
      or presenter_person_id = (select p.id from public.people p where p.auth_user_id = (select auth.uid()))
      or (
        audience = 'all'
        and exists (
          select 1
          from public.site_assignments a
          join public.people p on p.id = a.person_id
          where a.site_id = site_talks.site_id
            and p.auth_user_id = (select auth.uid())
            and p.role = 'operative'
        )
      )
      or exists (
        select 1
        from public.site_talk_required r
        where r.talk_id = site_talks.id
          and r.person_id = (select p.id from public.people p where p.auth_user_id = (select auth.uid()))
      )
    )
  );

create policy site_talk_versions_select
  on public.site_talk_versions for select to authenticated
  using (
    company_id = private.my_company_id()
    and private.can_access_site(site_id)
    and exists (
      select 1
      from public.site_talks t
      where t.id = site_talk_versions.talk_id
    )
  );

create policy site_talk_required_select
  on public.site_talk_required for select to authenticated
  using (
    company_id = private.my_company_id()
    and private.can_access_site(site_id)
    and (
      person_id = (select p.id from public.people p where p.auth_user_id = (select auth.uid()))
      or private.my_role() in ('owner', 'cm')
    )
  );

-- The image column is readable only on rows this policy returns:
-- the host owner, the host contracts manager, or the signer.
create policy site_talk_signatures_select
  on public.site_talk_signatures for select to authenticated
  using (
    company_id = private.my_company_id()
    and private.can_access_site(site_id)
    and (
      person_id = (select p.id from public.people p where p.auth_user_id = (select auth.uid()))
      or private.my_role() in ('owner', 'cm')
    )
  );

create policy site_talk_questions_select
  on public.site_talk_questions for select to authenticated
  using (
    company_id = private.my_company_id()
    and private.can_access_site(site_id)
    and (
      person_id = (select p.id from public.people p where p.auth_user_id = (select auth.uid()))
      or private.my_role() in ('owner', 'cm')
    )
  );

create policy site_talk_notes_select
  on public.site_talk_notes for select to authenticated
  using (
    company_id = private.my_company_id()
    and private.can_access_site(site_id)
    and private.my_role() in ('owner', 'cm')
  );

-- ---------------------------------------------------------------------------
-- Writes and shaped reads
-- ---------------------------------------------------------------------------

create or replace function public.create_site_talk(
  p_site_id uuid,
  p_kind text,
  p_delivery text,
  p_title text,
  p_body text,
  p_pdf_path text,
  p_audience text,
  p_person_ids uuid[],
  p_presenter_person_id uuid,
  p_presenter_role text,
  p_presented_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_company uuid;
  v_title text;
  v_body text;
  v_pdf text;
  v_pdf_type text;
  v_pdf_size bigint;
  v_pdf_sha text;
  v_name text;
  v_role text;
  v_id uuid;
  v_version uuid;
  v_hash text;
  v_presenter uuid;
  v_expected integer;
  v_inserted integer;
begin
  select * into v_actor from private.talk_actor();
  if v_actor.person_id is null or v_actor.role not in ('owner', 'cm') or not private.can_access_site(p_site_id) then
    raise exception 'not_authorized';
  end if;
  select s.company_id into v_company from public.sites s where s.id = p_site_id;
  if v_company is null or v_company is distinct from v_actor.company_id then
    raise exception 'not_authorized';
  end if;
  if p_kind not in ('induction', 'toolbox') or p_delivery not in ('phone', 'in_person') or p_audience not in ('all', 'chosen') then
    raise exception 'invalid_input';
  end if;
  if p_kind = 'induction' and p_delivery is distinct from 'phone' then
    raise exception 'invalid_input';
  end if;
  v_title := private.talk_plain(btrim(coalesce(p_title, '')));
  v_body := btrim(coalesce(p_body, ''));
  v_role := private.talk_plain(btrim(coalesce(p_presenter_role, '')));
  if char_length(v_title) < 1 or char_length(v_title) > 120
     or char_length(v_body) > 8000
     or char_length(v_role) < 1 or char_length(v_role) > 80 then
    raise exception 'invalid_input';
  end if;
  select claimed.path, claimed.content_type, claimed.size_bytes, claimed.byte_sha256
  into v_pdf, v_pdf_type, v_pdf_size, v_pdf_sha
  from private.talk_storage_path(v_company, p_site_id, p_pdf_path) claimed;
  if v_body = '' and v_pdf is null then
    raise exception 'invalid_input';
  end if;
  if v_body = '' then
    v_body := null;
  end if;
  perform private.talk_device_time(p_presented_at);

  select p.id, private.talk_plain(btrim(coalesce(p.display_name, '')))
  into v_presenter, v_name
  from public.people p
  where p.id = p_presenter_person_id
    and p.company_id = v_company;
  if v_presenter is null or char_length(coalesce(v_name, '')) < 1 or char_length(v_name) > 120 then
    raise exception 'invalid_input';
  end if;
  if not exists (
    select 1 from public.site_assignments a
    where a.site_id = p_site_id and a.person_id = v_presenter
  ) and not (v_presenter = v_actor.person_id and v_actor.role in ('owner', 'cm')) then
    raise exception 'invalid_input';
  end if;

  v_id := pg_catalog.gen_random_uuid();
  v_version := pg_catalog.gen_random_uuid();
  v_hash := private.talk_hash(p_kind, p_delivery, v_title, coalesce(v_body, ''), v_pdf, v_pdf_sha);

  insert into public.site_talks (
    id, site_id, company_id, kind, delivery, title, audience,
    presenter_person_id, presenter_name, presenter_role, presented_at, created_by
  ) values (
    v_id, p_site_id, v_company, p_kind, p_delivery, v_title, p_audience,
    v_presenter, v_name, v_role, p_presented_at, v_actor.person_id
  );

  insert into public.site_talk_versions (
    id, talk_id, site_id, company_id, version_no, body, pdf_path, pdf_content_type, pdf_size_bytes, pdf_sha256, content_hash, is_current, created_by
  ) values (
    v_version, v_id, p_site_id, v_company, 1, v_body, v_pdf, v_pdf_type, v_pdf_size, v_pdf_sha, v_hash, true, v_actor.person_id
  );

  if p_audience = 'chosen' then
    select count(distinct chosen.person_id) into v_expected
    from unnest(coalesce(p_person_ids, array[]::uuid[])) as chosen(person_id);
    if coalesce(v_expected, 0) < 1 then
      raise exception 'invalid_input';
    end if;
    insert into public.site_talk_required (talk_id, person_id, site_id, company_id)
    select distinct v_id, p.id, p_site_id, v_company
    from unnest(p_person_ids) as chosen(person_id)
    join public.people p on p.id = chosen.person_id
    where p.role = 'operative'
      and p.company_id = v_company
      and exists (
        select 1 from public.site_assignments a
        where a.site_id = p_site_id and a.person_id = p.id
      );
    get diagnostics v_inserted = row_count;
    if v_inserted is distinct from v_expected then
      raise exception 'invalid_input';
    end if;
  end if;

  return jsonb_build_object(
    'talk_id', v_id,
    'version_id', v_version,
    'version_no', 1,
    'content_hash', v_hash,
    'presenter_person_id', v_presenter
  );
end;
$fn$;

create or replace function public.revise_site_talk(
  p_talk_id uuid,
  p_title text,
  p_body text,
  p_pdf_path text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_talk public.site_talks%rowtype;
  v_current public.site_talk_versions%rowtype;
  v_title text;
  v_body text;
  v_pdf text;
  v_pdf_type text;
  v_pdf_size bigint;
  v_pdf_sha text;
  v_hash text;
  v_version uuid;
  v_no integer;
begin
  select * into v_actor from private.talk_actor();
  select * into v_talk from public.site_talks t where t.id = p_talk_id for update;
  if v_actor.person_id is null
     or v_actor.role not in ('owner', 'cm')
     or v_talk.id is null
     or v_talk.company_id is distinct from v_actor.company_id
     or not private.can_access_site(v_talk.site_id) then
    raise exception 'not_authorized';
  end if;
  select * into v_current
  from public.site_talk_versions v
  where v.talk_id = v_talk.id and v.is_current
  for update;
  if v_current.id is null then
    raise exception 'not_authorized';
  end if;
  v_title := private.talk_plain(btrim(coalesce(p_title, '')));
  v_body := btrim(coalesce(p_body, ''));
  if char_length(v_title) < 1 or char_length(v_title) > 120 or char_length(v_body) > 8000 then
    raise exception 'invalid_input';
  end if;
  -- A new file is a new upload. Omitting the file never drops one the current version has.
  if p_pdf_path is null or btrim(p_pdf_path) = '' then
    if v_current.pdf_path is not null then
      raise exception 'pdf_required';
    end if;
    v_pdf := null;
    v_pdf_type := null;
    v_pdf_size := null;
    v_pdf_sha := null;
  else
    select claimed.path, claimed.content_type, claimed.size_bytes, claimed.byte_sha256
    into v_pdf, v_pdf_type, v_pdf_size, v_pdf_sha
    from private.talk_storage_path(v_talk.company_id, v_talk.site_id, p_pdf_path) claimed;
  end if;
  if v_body = '' and v_pdf is null then
    raise exception 'invalid_input';
  end if;
  if v_body = '' then
    v_body := null;
  end if;
  v_hash := private.talk_hash(v_talk.kind, v_talk.delivery, v_title, coalesce(v_body, ''), v_pdf, v_pdf_sha);
  if v_hash = v_current.content_hash and v_talk.title = v_title then
    return jsonb_build_object(
      'talk_id', v_talk.id,
      'version_id', v_current.id,
      'version_no', v_current.version_no,
      'content_hash', v_current.content_hash
    );
  end if;
  update public.site_talk_versions set is_current = false where id = v_current.id;
  update public.site_talks set title = v_title, updated_at = pg_catalog.now() where id = v_talk.id;
  v_version := pg_catalog.gen_random_uuid();
  v_no := v_current.version_no + 1;
  insert into public.site_talk_versions (
    id, talk_id, site_id, company_id, version_no, body, pdf_path, pdf_content_type, pdf_size_bytes, pdf_sha256, content_hash, is_current, created_by
  ) values (
    v_version, v_talk.id, v_talk.site_id, v_talk.company_id, v_no, v_body, v_pdf, v_pdf_type, v_pdf_size, v_pdf_sha, v_hash, true, v_actor.person_id
  );
  return jsonb_build_object(
    'talk_id', v_talk.id,
    'version_id', v_version,
    'version_no', v_no,
    'content_hash', v_hash
  );
end;
$fn$;

create or replace function public.sign_site_talk(
  p_talk_id uuid,
  p_version_id uuid,
  p_person_id uuid,
  p_understood boolean,
  p_signature_png text,
  p_device_at timestamptz,
  p_session text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_talk public.site_talks%rowtype;
  v_version public.site_talk_versions%rowtype;
  v_site_name text;
  v_person_name text;
  v_device timestamptz;
  v_received timestamptz;
  v_id uuid;
  v_shared boolean;
  v_meaning text;
  v_existing public.site_talk_signatures%rowtype;
begin
  select * into v_actor from private.talk_actor();
  select * into v_talk from public.site_talks t where t.id = p_talk_id for update;
  if v_actor.person_id is null
     or v_talk.id is null
     or v_talk.company_id is distinct from v_actor.company_id
     or not private.can_access_site(v_talk.site_id) then
    raise exception 'not_authorized';
  end if;
  select * into v_version
  from public.site_talk_versions v
  where v.id = p_version_id and v.talk_id = v_talk.id
  for update;
  if v_version.id is null then
    raise exception 'not_authorized';
  end if;
  if not v_version.is_current then
    raise exception 'version_locked';
  end if;
  if coalesce(p_understood, false) is distinct from true then
    raise exception 'invalid_input';
  end if;
  if p_signature_png is null
     or left(p_signature_png, 22) is distinct from 'data:image/png;base64,'
     or char_length(p_signature_png) < 40
     or char_length(p_signature_png) > 200000
     or p_session is null
     or p_session !~ '^[A-Za-z0-9-]{8,80}$' then
    raise exception 'invalid_input';
  end if;
  if not exists (select 1 from private.talk_required_ids(v_talk.id) req(person_id) where req.person_id = p_person_id) then
    raise exception 'not_required';
  end if;
  if p_person_id is distinct from v_actor.person_id then
    if v_actor.role not in ('owner', 'cm') and v_actor.person_id is distinct from v_talk.presenter_person_id then
      raise exception 'not_authorized';
    end if;
    if not exists (
      select 1 from public.site_assignments a
      where a.site_id = v_talk.site_id and a.person_id = p_person_id
    ) then
      raise exception 'not_authorized';
    end if;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_version.id::text || ':' || p_person_id::text || ':attendee', 0)
  );
  select * into v_existing
  from public.site_talk_signatures s
  where s.version_id = v_version.id
    and s.person_id = p_person_id
    and s.signature_role = 'attendee'
  for update;
  if v_existing.id is not null then
    return jsonb_build_object(
      'talk_id', v_talk.id,
      'version_id', v_version.id,
      'version_no', v_version.version_no,
      'content_hash', v_version.content_hash,
      'signature_id', v_existing.id,
      'meaning', v_existing.meaning,
      'received_at', v_existing.received_at,
      'device_at', v_existing.device_at,
      'shared_device', v_existing.shared_device,
      'captured_by', v_existing.captured_by,
      'session_id', v_existing.session_id
    );
  end if;

  select s.name into v_site_name from public.sites s where s.id = v_talk.site_id;
  select private.talk_label(p.display_name) into v_person_name
  from public.people p where p.id = p_person_id;
  v_device := private.talk_device_time(p_device_at);
  v_received := pg_catalog.now();
  v_shared := p_person_id is distinct from v_actor.person_id;
  v_meaning := private.talk_meaning(
    v_talk.kind, v_talk.delivery, 'attendee', v_site_name, v_talk.title, v_talk.presenter_name, v_talk.presented_at
  );
  v_id := pg_catalog.gen_random_uuid();
  begin
    insert into public.site_talk_signatures (
      id, talk_id, version_id, site_id, company_id, person_id, person_name, signer_name,
      captured_by, session_id, shared_device, signature_role, meaning, signature_png,
      device_at, received_at, content_hash
    ) values (
      v_id, v_talk.id, v_version.id, v_talk.site_id, v_talk.company_id, p_person_id, v_person_name, v_person_name,
      v_actor.person_id, p_session, v_shared, 'attendee', v_meaning, p_signature_png,
      v_device, v_received, v_version.content_hash
    );
  exception
    when unique_violation then
      select * into v_existing
      from public.site_talk_signatures s
      where s.version_id = v_version.id
        and s.person_id = p_person_id
        and s.signature_role = 'attendee';
      if v_existing.id is not null then
        return jsonb_build_object(
          'talk_id', v_talk.id,
          'version_id', v_version.id,
          'version_no', v_version.version_no,
          'content_hash', v_version.content_hash,
          'signature_id', v_existing.id,
          'meaning', v_existing.meaning,
          'received_at', v_existing.received_at,
          'device_at', v_existing.device_at,
          'shared_device', v_existing.shared_device,
          'captured_by', v_existing.captured_by,
          'session_id', v_existing.session_id
        );
      end if;
      raise;
  end;
  return jsonb_build_object(
    'talk_id', v_talk.id,
    'version_id', v_version.id,
    'version_no', v_version.version_no,
    'content_hash', v_version.content_hash,
    'signature_id', v_id,
    'meaning', v_meaning,
    'received_at', v_received,
    'device_at', v_device,
    'shared_device', v_shared,
    'captured_by', v_actor.person_id,
    'session_id', p_session
  );
end;
$fn$;

create or replace function public.ask_site_talk(
  p_talk_id uuid,
  p_version_id uuid,
  p_person_id uuid,
  p_body text,
  p_device_at timestamptz,
  p_session text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_talk public.site_talks%rowtype;
  v_version public.site_talk_versions%rowtype;
  v_body text;
  v_device timestamptz;
  v_received timestamptz;
  v_id uuid;
  v_name text;
  v_shared boolean;
begin
  select * into v_actor from private.talk_actor();
  select * into v_talk from public.site_talks t where t.id = p_talk_id for update;
  if v_actor.person_id is null
     or v_talk.id is null
     or v_talk.company_id is distinct from v_actor.company_id
     or not private.can_access_site(v_talk.site_id) then
    raise exception 'not_authorized';
  end if;
  select * into v_version
  from public.site_talk_versions v
  where v.id = p_version_id and v.talk_id = v_talk.id
  for update;
  if v_version.id is null then
    raise exception 'not_authorized';
  end if;
  if not v_version.is_current then
    raise exception 'version_locked';
  end if;
  if p_session is null or p_session !~ '^[A-Za-z0-9-]{8,80}$' then
    raise exception 'invalid_input';
  end if;
  v_body := nullif(btrim(coalesce(p_body, '')), '');
  if v_body is not null then
    v_body := private.talk_plain(v_body);
    if char_length(v_body) > 280 then
      raise exception 'invalid_input';
    end if;
  end if;
  if not exists (select 1 from private.talk_required_ids(v_talk.id) req(person_id) where req.person_id = p_person_id) then
    raise exception 'not_required';
  end if;
  if p_person_id is distinct from v_actor.person_id then
    if v_actor.role not in ('owner', 'cm') and v_actor.person_id is distinct from v_talk.presenter_person_id then
      raise exception 'not_authorized';
    end if;
  end if;
  select private.talk_label(p.display_name) into v_name from public.people p where p.id = p_person_id;
  v_device := private.talk_device_time(p_device_at);
  v_received := pg_catalog.now();
  v_shared := p_person_id is distinct from v_actor.person_id;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_version.id::text || ':' || p_person_id::text || ':question', 0)
  );
  select q.id into v_id
  from public.site_talk_questions q
  where q.version_id = v_version.id and q.person_id = p_person_id
  for update;
  if v_id is null then
    v_id := pg_catalog.gen_random_uuid();
    insert into public.site_talk_questions (
      id, talk_id, version_id, site_id, company_id, person_id, person_name, body,
      captured_by, session_id, shared_device, device_at, received_at
    ) values (
      v_id, v_talk.id, v_version.id, v_talk.site_id, v_talk.company_id, p_person_id, v_name, v_body,
      v_actor.person_id, p_session, v_shared, v_device, v_received
    );
  else
    update public.site_talk_questions
    set body = v_body,
        captured_by = v_actor.person_id,
        session_id = p_session,
        shared_device = v_shared,
        device_at = v_device,
        received_at = v_received
    where id = v_id;
  end if;
  return jsonb_build_object('question_id', v_id, 'received_at', v_received);
end;
$fn$;

create or replace function public.set_talk_person_note(
  p_talk_id uuid,
  p_person_id uuid,
  p_explained boolean,
  p_interpreter boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_talk public.site_talks%rowtype;
  v_version uuid;
begin
  select * into v_actor from private.talk_actor();
  select * into v_talk from public.site_talks t where t.id = p_talk_id for update;
  if v_actor.person_id is null
     or v_talk.id is null
     or v_talk.company_id is distinct from v_actor.company_id
     or not private.can_access_site(v_talk.site_id) then
    raise exception 'not_authorized';
  end if;
  if v_actor.role not in ('owner', 'cm') and v_actor.person_id is distinct from v_talk.presenter_person_id then
    raise exception 'not_authorized';
  end if;
  if not exists (select 1 from private.talk_required_ids(v_talk.id) req(person_id) where req.person_id = p_person_id) then
    raise exception 'not_required';
  end if;
  select v.id into v_version
  from public.site_talk_versions v
  where v.talk_id = v_talk.id and v.is_current
  for update;
  if coalesce(p_explained, false) = false and coalesce(p_interpreter, false) = false then
    delete from public.site_talk_notes n where n.version_id = v_version and n.person_id = p_person_id;
  else
    insert into public.site_talk_notes (
      talk_id, version_id, person_id, site_id, company_id, explained_verbally, interpreter_used, noted_by
    ) values (
      v_talk.id, v_version, p_person_id, v_talk.site_id, v_talk.company_id,
      coalesce(p_explained, false), coalesce(p_interpreter, false), v_actor.person_id
    )
    on conflict (version_id, person_id) do update
    set explained_verbally = excluded.explained_verbally,
        interpreter_used = excluded.interpreter_used,
        noted_by = excluded.noted_by,
        updated_at = pg_catalog.now();
  end if;
  return jsonb_build_object(
    'explained_verbally', coalesce(p_explained, false),
    'interpreter_used', coalesce(p_interpreter, false)
  );
end;
$fn$;

create or replace function public.sign_talk_presenter(
  p_talk_id uuid,
  p_version_id uuid,
  p_signature_png text,
  p_device_at timestamptz,
  p_session text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_talk public.site_talks%rowtype;
  v_version public.site_talk_versions%rowtype;
  v_site_name text;
  v_device timestamptz;
  v_received timestamptz;
  v_id uuid;
  v_meaning text;
  v_named boolean;
  v_existing public.site_talk_signatures%rowtype;
begin
  select * into v_actor from private.talk_actor();
  select * into v_talk from public.site_talks t where t.id = p_talk_id for update;
  v_named := v_talk.id is not null and v_actor.person_id = v_talk.presenter_person_id;
  if v_actor.person_id is null
     or v_talk.id is null
     or v_talk.company_id is distinct from v_actor.company_id
     or not private.can_access_site(v_talk.site_id)
     or (
       not v_named
       and v_actor.role not in ('owner', 'cm')
     ) then
    raise exception 'not_authorized';
  end if;
  if v_talk.delivery is distinct from 'in_person' then
    raise exception 'invalid_input';
  end if;
  select * into v_version
  from public.site_talk_versions v
  where v.id = p_version_id and v.talk_id = v_talk.id and v.is_current
  for update;
  if v_version.id is null then
    raise exception 'version_locked';
  end if;
  if p_signature_png is null
     or left(p_signature_png, 22) is distinct from 'data:image/png;base64,'
     or char_length(p_signature_png) < 40
     or char_length(p_signature_png) > 200000
     or p_session is null
     or p_session !~ '^[A-Za-z0-9-]{8,80}$' then
    raise exception 'invalid_input';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_version.id::text || ':presenter', 0)
  );
  select * into v_existing
  from public.site_talk_signatures s
  where s.version_id = v_version.id and s.signature_role = 'presenter'
  for update;
  if v_existing.id is not null then
    return jsonb_build_object(
      'talk_id', v_talk.id,
      'version_id', v_version.id,
      'version_no', v_version.version_no,
      'content_hash', v_version.content_hash,
      'signature_id', v_existing.id,
      'meaning', v_existing.meaning,
      'received_at', v_existing.received_at,
      'device_at', v_existing.device_at,
      'shared_device', v_existing.shared_device,
      'captured_by', v_existing.captured_by,
      'session_id', v_existing.session_id
    );
  end if;
  select s.name into v_site_name from public.sites s where s.id = v_talk.site_id;
  v_device := private.talk_device_time(p_device_at);
  v_received := pg_catalog.now();
  if v_named then
    v_meaning := private.talk_meaning(
      v_talk.kind, v_talk.delivery, 'presenter', v_site_name, v_talk.title, v_talk.presenter_name, v_talk.presented_at
    );
  else
    v_meaning := 'signed by ' || private.talk_label(v_actor.display_name) || ' for ' || private.talk_label(v_talk.presenter_name);
  end if;
  v_id := pg_catalog.gen_random_uuid();
  begin
    insert into public.site_talk_signatures (
      id, talk_id, version_id, site_id, company_id, person_id, person_name, signer_name,
      captured_by, session_id, shared_device, signature_role, meaning, signature_png,
      device_at, received_at, content_hash
    ) values (
      v_id, v_talk.id, v_version.id, v_talk.site_id, v_talk.company_id, v_actor.person_id,
      private.talk_label(v_actor.display_name),
      private.talk_label(v_actor.display_name),
      v_actor.person_id, p_session, false, 'presenter', v_meaning, p_signature_png,
      v_device, v_received, v_version.content_hash
    );
  exception
    when unique_violation then
      select * into v_existing
      from public.site_talk_signatures s
      where s.version_id = v_version.id and s.signature_role = 'presenter';
      if v_existing.id is not null then
        return jsonb_build_object(
          'talk_id', v_talk.id,
          'version_id', v_version.id,
          'version_no', v_version.version_no,
          'content_hash', v_version.content_hash,
          'signature_id', v_existing.id,
          'meaning', v_existing.meaning,
          'received_at', v_existing.received_at,
          'device_at', v_existing.device_at,
          'shared_device', v_existing.shared_device,
          'captured_by', v_existing.captured_by,
          'session_id', v_existing.session_id
        );
      end if;
      raise;
  end;
  return jsonb_build_object(
    'talk_id', v_talk.id,
    'version_id', v_version.id,
    'version_no', v_version.version_no,
    'content_hash', v_version.content_hash,
    'signature_id', v_id,
    'meaning', v_meaning,
    'received_at', v_received,
    'device_at', v_device,
    'shared_device', false,
    'captured_by', v_actor.person_id,
    'session_id', p_session
  );
end;
$fn$;

create or replace function private.talk_list_item(p_talk_id uuid, p_actor uuid, p_show boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_talk public.site_talks%rowtype;
  v_version public.site_talk_versions%rowtype;
  v_required integer;
  v_signed integer;
  v_questions integer;
begin
  select * into v_talk from public.site_talks t where t.id = p_talk_id;
  select * into v_version from public.site_talk_versions v where v.talk_id = p_talk_id and v.is_current;
  if p_show then
    select count(*) into v_required from private.talk_required_ids(p_talk_id) req(person_id);
    select count(*) into v_signed
    from private.talk_required_ids(p_talk_id) req(person_id)
    where exists (
      select 1 from public.site_talk_signatures s
      where s.version_id = v_version.id and s.person_id = req.person_id and s.signature_role = 'attendee'
    );
    select count(*) into v_questions
    from public.site_talk_questions q
    where q.version_id = v_version.id
      and q.person_id in (select req.person_id from private.talk_required_ids(p_talk_id) req(person_id));
  end if;
  return jsonb_build_object(
    'talk_id', v_talk.id,
    'site_id', v_talk.site_id,
    'kind', v_talk.kind,
    'delivery', v_talk.delivery,
    'title', v_talk.title,
    'version_no', v_version.version_no,
    'version_id', v_version.id,
    'content_hash', v_version.content_hash,
    'audience', v_talk.audience,
    'presenter_person_id', v_talk.presenter_person_id,
    'presenter_name', v_talk.presenter_name,
    'presenter_role', v_talk.presenter_role,
    'presented_at', v_talk.presented_at,
    'signed_count', case when p_show then v_signed else null end,
    'required_count', case when p_show then v_required else null end,
    'question_count', case when p_show then v_questions else null end,
    'mine_signed', exists (
      select 1 from public.site_talk_signatures s
      where s.version_id = v_version.id and s.person_id = p_actor and s.signature_role = 'attendee'
    ),
    'mine_question', exists (
      select 1 from public.site_talk_questions q
      where q.version_id = v_version.id and q.person_id = p_actor
    )
  );
end;
$fn$;

revoke all on function private.talk_list_item(uuid, uuid, boolean) from public, anon, authenticated;

create or replace function private.talk_register(p_talk_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_version uuid;
  v_not jsonb;
  v_signed jsonb;
  v_presenter jsonb;
  v_questions jsonb;
  v_required integer;
  v_signed_count integer;
begin
  select * into v_actor from private.talk_actor();
  select v.id into v_version from public.site_talk_versions v where v.talk_id = p_talk_id and v.is_current;
  select count(*) into v_required from private.talk_required_ids(p_talk_id) r;
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.person_name), '[]'::jsonb)
  into v_not
  from (
    select
      p.id as person_id,
      private.talk_label(p.display_name) as person_name,
      left(p.id::text, 6) as person_ref,
      false as name_changed,
      (q.id is not null) as has_question,
      case
        when v_actor.role in ('owner', 'cm') or p.id = v_actor.person_id then q.body
        else null
      end as question,
      coalesce(n.explained_verbally, false) as explained_verbally,
      coalesce(n.interpreter_used, false) as interpreter_used
    from private.talk_required_ids(p_talk_id) req(person_id)
    join public.people p on p.id = req.person_id
    left join public.site_talk_questions q
      on q.version_id = v_version and q.person_id = p.id
    left join public.site_talk_notes n
      on n.version_id = v_version and n.person_id = p.id
    where not exists (
      select 1 from public.site_talk_signatures s
      where s.version_id = v_version and s.person_id = p.id and s.signature_role = 'attendee'
    )
  ) x;
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.received_at), '[]'::jsonb)
  into v_signed
  from (
    select
      s.person_id,
      s.signer_name as person_name,
      left(s.person_id::text, 6) as person_ref,
      private.talk_label(p.display_name) is distinct from s.signer_name as name_changed,
      (q.id is not null) as has_question,
      case
        when v_actor.role in ('owner', 'cm') or s.person_id = v_actor.person_id then q.body
        else null
      end as question,
      coalesce(n.explained_verbally, false) as explained_verbally,
      coalesce(n.interpreter_used, false) as interpreter_used,
      s.received_at,
      s.device_at,
      s.meaning,
      case
        when v_actor.role in ('owner', 'cm') or s.person_id = v_actor.person_id then s.signature_png
        else null
      end as signature_png,
      s.shared_device,
      case
        when v_actor.role in ('owner', 'cm') or s.person_id = v_actor.person_id then s.session_id
        else null
      end as session_id,
      case
        when v_actor.role in ('owner', 'cm') or s.person_id = v_actor.person_id then s.captured_by
        else null
      end as captured_by,
      s.content_hash
    from public.site_talk_signatures s
    join public.people p on p.id = s.person_id
    left join public.site_talk_questions q
      on q.version_id = s.version_id and q.person_id = s.person_id
    left join public.site_talk_notes n
      on n.version_id = s.version_id and n.person_id = s.person_id
    where s.version_id = v_version
      and s.signature_role = 'attendee'
      and s.person_id in (select req.person_id from private.talk_required_ids(p_talk_id) req(person_id))
  ) x;
  select count(*) into v_signed_count from jsonb_array_elements(v_signed);
  select row_to_json(x)::jsonb into v_presenter
  from (
    select
      s.person_id,
      s.signer_name as person_name,
      left(s.person_id::text, 6) as person_ref,
      private.talk_label(p.display_name) is distinct from s.signer_name as name_changed,
      false as has_question,
      null::text as question,
      false as explained_verbally,
      false as interpreter_used,
      s.received_at,
      s.device_at,
      s.meaning,
      case
        when v_actor.role in ('owner', 'cm') or s.person_id = v_actor.person_id then s.signature_png
        else null
      end as signature_png,
      s.shared_device,
      case
        when v_actor.role in ('owner', 'cm') or s.person_id = v_actor.person_id then s.session_id
        else null
      end as session_id,
      case
        when v_actor.role in ('owner', 'cm') or s.person_id = v_actor.person_id then s.captured_by
        else null
      end as captured_by,
      s.content_hash
    from public.site_talk_signatures s
    join public.people p on p.id = s.person_id
    where s.version_id = v_version and s.signature_role = 'presenter'
  ) x;
  select coalesce(jsonb_agg(jsonb_build_object(
    'person_id', q.person_id,
    'person_name', q.person_name,
    'body', q.body,
    'received_at', q.received_at
  ) order by q.received_at), '[]'::jsonb)
  into v_questions
  from public.site_talk_questions q
  where q.version_id = v_version
    and (v_actor.role in ('owner', 'cm') or q.person_id = v_actor.person_id);
  return jsonb_build_object(
    'required_count', v_required,
    'signed_count', v_signed_count,
    'not_signed', v_not,
    'signed', v_signed,
    'presenter_signature', v_presenter,
    'questions', v_questions
  );
end;
$fn$;

revoke all on function private.talk_register(uuid) from public, anon, authenticated;

create or replace function public.list_site_talks(p_site_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_company uuid;
  v_rows jsonb;
begin
  select * into v_actor from private.talk_actor();
  select s.company_id into v_company from public.sites s where s.id = p_site_id;
  if v_actor.person_id is null
     or v_company is null
     or v_company is distinct from v_actor.company_id
     or not private.can_access_site(p_site_id) then
    raise exception 'not_authorized';
  end if;
  select coalesce(jsonb_agg(
    private.talk_list_item(
      t.id,
      v_actor.person_id,
      v_actor.role in ('owner', 'cm') or t.presenter_person_id = v_actor.person_id
    )
    order by t.created_at
  ), '[]'::jsonb)
  into v_rows
  from public.site_talks t
  where t.site_id = p_site_id
    and (
      v_actor.role in ('owner', 'cm')
      or t.presenter_person_id = v_actor.person_id
      or v_actor.person_id in (select req.person_id from private.talk_required_ids(t.id) req(person_id))
    );
  return v_rows;
end;
$fn$;

create or replace function public.my_outstanding_talks()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_rows jsonb;
begin
  select * into v_actor from private.talk_actor();
  if v_actor.person_id is null then
    raise exception 'not_authorized';
  end if;
  select coalesce(jsonb_agg(
    private.talk_list_item(t.id, v_actor.person_id, v_actor.role in ('owner', 'cm') or t.presenter_person_id = v_actor.person_id)
    order by t.created_at
  ), '[]'::jsonb)
  into v_rows
  from public.site_talks t
  join public.site_talk_versions v on v.talk_id = t.id and v.is_current
  where t.company_id = v_actor.company_id
    and private.can_access_site(t.site_id)
    and v_actor.person_id in (select req.person_id from private.talk_required_ids(t.id) req(person_id))
    and not exists (
      select 1 from public.site_talk_signatures s
      where s.version_id = v.id and s.person_id = v_actor.person_id and s.signature_role = 'attendee'
    );
  return v_rows;
end;
$fn$;

create or replace function public.site_talk_detail(p_talk_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_talk public.site_talks%rowtype;
  v_version public.site_talk_versions%rowtype;
  v_site_name text;
  v_show boolean;
begin
  select * into v_actor from private.talk_actor();
  select * into v_talk from public.site_talks t where t.id = p_talk_id;
  if v_actor.person_id is null
     or v_talk.id is null
     or v_talk.company_id is distinct from v_actor.company_id
     or not private.can_access_site(v_talk.site_id) then
    raise exception 'not_authorized';
  end if;
  v_show := v_actor.role in ('owner', 'cm') or v_talk.presenter_person_id = v_actor.person_id;
  if not v_show and not exists (select 1 from private.talk_required_ids(v_talk.id) req(person_id) where req.person_id = v_actor.person_id) then
    raise exception 'not_authorized';
  end if;
  select * into v_version from public.site_talk_versions v where v.talk_id = v_talk.id and v.is_current;
  select s.name into v_site_name from public.sites s where s.id = v_talk.site_id;
  return jsonb_build_object(
    'talk_id', v_talk.id,
    'site_id', v_talk.site_id,
    'site_name', v_site_name,
    'company_id', v_talk.company_id,
    'kind', v_talk.kind,
    'delivery', v_talk.delivery,
    'title', v_talk.title,
    'body', coalesce(v_version.body, ''),
    'pdf_path', v_version.pdf_path,
    'version_id', v_version.id,
    'version_no', v_version.version_no,
    'content_hash', v_version.content_hash,
    'audience', v_talk.audience,
    'presenter_person_id', v_talk.presenter_person_id,
    'presenter_name', v_talk.presenter_name,
    'presenter_role', v_talk.presenter_role,
    'presented_at', v_talk.presented_at,
    'attendee_meaning', private.talk_meaning(
      v_talk.kind, v_talk.delivery, 'attendee', v_site_name, v_talk.title, v_talk.presenter_name, v_talk.presented_at
    ),
    'mine_signed', exists (
      select 1 from public.site_talk_signatures s
      where s.version_id = v_version.id and s.person_id = v_actor.person_id and s.signature_role = 'attendee'
    ),
    'register', case when v_show then private.talk_register(v_talk.id) else null end
  );
end;
$fn$;

create or replace function public.talk_meaning_line(p_talk_id uuid, p_person_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_talk public.site_talks%rowtype;
  v_site_name text;
begin
  select * into v_actor from private.talk_actor();
  select * into v_talk from public.site_talks t where t.id = p_talk_id;
  if v_actor.person_id is null
     or v_talk.id is null
     or v_talk.company_id is distinct from v_actor.company_id
     or not private.can_access_site(v_talk.site_id) then
    raise exception 'not_authorized';
  end if;
  if not exists (select 1 from private.talk_required_ids(v_talk.id) req(person_id) where req.person_id = p_person_id) then
    raise exception 'not_required';
  end if;
  if p_person_id is distinct from v_actor.person_id
     and v_actor.role not in ('owner', 'cm')
     and v_actor.person_id is distinct from v_talk.presenter_person_id then
    raise exception 'not_authorized';
  end if;
  select s.name into v_site_name from public.sites s where s.id = v_talk.site_id;
  return private.talk_meaning(
    v_talk.kind, v_talk.delivery, 'attendee', v_site_name, v_talk.title, v_talk.presenter_name, v_talk.presented_at
  );
end;
$fn$;

create or replace function public.induction_sign_in_gaps(p_site_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_company uuid;
  v_rows jsonb;
begin
  select * into v_actor from private.talk_actor();
  if v_actor.person_id is null then
    raise exception 'not_authorized';
  end if;
  if v_actor.role not in ('owner', 'cm') then
    return null;
  end if;
  select s.company_id into v_company from public.sites s where s.id = p_site_id;
  if v_company is null or v_company is distinct from v_actor.company_id or not private.can_access_site(p_site_id) then
    raise exception 'not_authorized';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'person_id', p.id,
    'person_name', private.talk_label(p.display_name)
  ) order by private.talk_label(p.display_name)), '[]'::jsonb)
  into v_rows
  from public.people p
  where p.id in (
    select distinct att.person_id
    from public.site_attendance att
    where att.site_id = p_site_id
      and att.out_at is null
      and exists (
        select 1
        from public.site_talks t
        join public.site_talk_versions v on v.talk_id = t.id and v.is_current
        where t.site_id = p_site_id
          and t.kind = 'induction'
          and att.person_id in (select req.person_id from private.talk_required_ids(t.id) req(person_id))
          and not exists (
            select 1 from public.site_talk_signatures s
            where s.version_id = v.id and s.person_id = att.person_id and s.signature_role = 'attendee'
          )
      )
  );
  return v_rows;
end;
$fn$;

create or replace function public.my_talk_badges()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_rows jsonb;
begin
  select * into v_actor from private.talk_actor();
  if v_actor.person_id is null then
    raise exception 'not_authorized';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'site_id', site_id,
    'outstanding', outstanding,
    'questions', case when v_actor.role in ('owner', 'cm') then questions else null end
  )), '[]'::jsonb)
  into v_rows
  from (
    select
      t.site_id,
      count(distinct t.id) filter (
        where v_actor.person_id in (select req.person_id from private.talk_required_ids(t.id) req(person_id))
          and not exists (
            select 1 from public.site_talk_signatures s
            join public.site_talk_versions v on v.id = s.version_id and v.is_current
            where s.talk_id = t.id and s.person_id = v_actor.person_id and s.signature_role = 'attendee'
          )
      ) as outstanding,
      count(distinct q.id) as questions
    from public.site_talks t
    left join public.site_talk_versions ver on ver.talk_id = t.id and ver.is_current
    left join public.site_talk_questions q on q.version_id = ver.id
    where t.company_id = v_actor.company_id
      and private.can_access_site(t.site_id)
    group by t.site_id
  ) badges
  where outstanding > 0 or (v_actor.role in ('owner', 'cm') and questions > 0);
  return v_rows;
end;
$fn$;

revoke all on function public.create_site_talk(uuid, text, text, text, text, text, text, uuid[], uuid, text, timestamptz) from public, anon;
revoke all on function public.revise_site_talk(uuid, text, text, text) from public, anon;
revoke all on function public.sign_site_talk(uuid, uuid, uuid, boolean, text, timestamptz, text) from public, anon;
revoke all on function public.ask_site_talk(uuid, uuid, uuid, text, timestamptz, text) from public, anon;
revoke all on function public.set_talk_person_note(uuid, uuid, boolean, boolean) from public, anon;
revoke all on function public.sign_talk_presenter(uuid, uuid, text, timestamptz, text) from public, anon;
revoke all on function public.list_site_talks(uuid) from public, anon;
revoke all on function public.my_outstanding_talks() from public, anon;
revoke all on function public.site_talk_detail(uuid) from public, anon;
revoke all on function public.talk_meaning_line(uuid, uuid) from public, anon;
revoke all on function public.induction_sign_in_gaps(uuid) from public, anon;
revoke all on function public.my_talk_badges() from public, anon;

grant execute on function public.create_site_talk(uuid, text, text, text, text, text, text, uuid[], uuid, text, timestamptz) to authenticated;
grant execute on function public.revise_site_talk(uuid, text, text, text) to authenticated;
grant execute on function public.sign_site_talk(uuid, uuid, uuid, boolean, text, timestamptz, text) to authenticated;
grant execute on function public.ask_site_talk(uuid, uuid, uuid, text, timestamptz, text) to authenticated;
grant execute on function public.set_talk_person_note(uuid, uuid, boolean, boolean) to authenticated;
grant execute on function public.sign_talk_presenter(uuid, uuid, text, timestamptz, text) to authenticated;
grant execute on function public.list_site_talks(uuid) to authenticated;
grant execute on function public.my_outstanding_talks() to authenticated;
grant execute on function public.site_talk_detail(uuid) to authenticated;
grant execute on function public.talk_meaning_line(uuid, uuid) to authenticated;
grant execute on function public.induction_sign_in_gaps(uuid) to authenticated;
grant execute on function public.my_talk_badges() to authenticated;

-- A joined person cannot rename themselves. The owner or a contracts manager can.
drop policy if exists people_update_self_or_owner on public.people;
create policy people_update_self_or_owner
  on public.people for update to authenticated
  using (
    private.my_role() in ('owner', 'cm')
    and company_id = private.my_company_id()
  )
  with check (
    private.my_role() in ('owner', 'cm')
    and company_id = private.my_company_id()
  );

-- Display names reject bidi overrides, zero-width characters, and a leading spreadsheet mark.
-- Replacing the attendance trigger function. It already existed, so this is not a new function.
do $replace_name$
begin
  execute $body$
    create or replace function private.reject_control_display_name()
    returns trigger
    language plpgsql
    set search_path = ''
    as $fn$
    declare
      v_name text := btrim(coalesce(new.display_name, ''));
    begin
      if v_name ~ (
           '['
           || pg_catalog.chr(1) || '-' || pg_catalog.chr(31)
           || pg_catalog.chr(127)
           || pg_catalog.chr(133)
           || pg_catalog.chr(8203) || '-' || pg_catalog.chr(8207)
           || pg_catalog.chr(8232) || pg_catalog.chr(8233)
           || pg_catalog.chr(8234) || '-' || pg_catalog.chr(8238)
           || pg_catalog.chr(8288)
           || pg_catalog.chr(8294) || '-' || pg_catalog.chr(8297)
           || pg_catalog.chr(65279)
           || ']'
         )
         or left(v_name, 1) in ('=', '+', '-', '@') then
        raise exception 'invalid_display_name';
      end if;
      return new;
    end;
    $fn$
  $body$;
end
$replace_name$;

revoke all on function private.reject_control_display_name() from public, anon, authenticated;

-- A talks/ object that a version already records cannot be replaced or removed.
-- Other drawings paths keep the policies from the drawings migration.
create or replace function private.talk_pdf_locked(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.site_talk_versions versions
    where versions.pdf_path = p_name
  );
$fn$;

revoke all on function private.talk_pdf_locked(text) from public, anon;
grant execute on function private.talk_pdf_locked(text) to authenticated;

drop policy if exists drawings_storage_update on storage.objects;
create policy drawings_storage_update
  on storage.objects for update to authenticated
  using (
    bucket_id = 'drawings'
    and private.is_cm_or_owner()
    and private.storage_company_id(name) = private.my_company_id()
    and private.can_access_site(private.storage_site_id(name))
    and not (
      (storage.foldername(name))[3] = 'talks'
      and private.talk_pdf_locked(name)
    )
  )
  with check (
    bucket_id = 'drawings'
    and private.is_cm_or_owner()
    and private.storage_company_id(name) = private.my_company_id()
    and private.can_access_site(private.storage_site_id(name))
    and not (
      (storage.foldername(name))[3] = 'talks'
      and private.talk_pdf_locked(name)
    )
  );

drop policy if exists drawings_storage_delete on storage.objects;
create policy drawings_storage_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'drawings'
    and private.is_cm_or_owner()
    and private.can_access_site(private.storage_site_id(name))
    and not (
      (storage.foldername(name))[3] = 'talks'
      and private.talk_pdf_locked(name)
    )
  );
