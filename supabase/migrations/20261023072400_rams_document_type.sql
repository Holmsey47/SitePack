-- RAMS is a third document type on the existing talks table.
-- Assigned signers stay the operatives with a site_assignments row for the site
-- (everyone, or the chosen list). The owner and a contracts manager are not in
-- that list: this model does not give them an operative assignment.
-- Kind is set only by create_site_talk, which already requires an owner or
-- contracts manager. Nothing updates kind in place, so a type change cannot
-- skip the version hash or the signature.

alter table public.site_talks alter column kind set default 'induction';

-- Existing rows are already induction or toolbox. A null would become induction.
update public.site_talks
set kind = 'induction'
where kind is null;

alter table public.site_talks drop constraint site_talks_kind;
alter table public.site_talks
  add constraint site_talks_kind check (kind in ('induction', 'toolbox', 'rams'));

alter table public.site_talks drop constraint site_talks_induction_phone;
alter table public.site_talks
  add constraint site_talks_phone_document
  check (kind not in ('induction', 'rams') or delivery = 'phone');

comment on column public.site_talks.kind is
  'induction, toolbox, or rams. An owner or contracts manager sets it when the document is created. It is not changed in place.';

comment on table public.site_talks is
  'An induction, toolbox talk, or RAMS. Presenter name, role, and time are captured with it.';

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
    if p_kind = 'rams' then
      return 'I issued this RAMS to the people listed.';
    end if;
    return 'I gave this talk to the people listed.';
  end if;
  if p_kind = 'induction' then
    return 'I''ve read and understood the site induction for ' || v_site
      || ' and I''ll follow it. If anything''s unclear, I''ll ask the site manager before starting work.';
  end if;
  if p_kind = 'rams' then
    return 'I''ve read and understood the RAMS ''' || v_title || ''' for ' || v_site || '.';
  end if;
  if p_delivery = 'in_person' then
    return 'I was at the toolbox talk ''' || v_title || ''' given by ' || v_presenter
      || ' at ' || v_site || ' on ' || private.talk_uk_date(p_presented_at) || ', and I understood it.';
  end if;
  return 'I''ve read and understood the toolbox talk ''' || v_title || ''' for ' || v_site || '.';
end;
$fn$;

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
  if p_kind not in ('induction', 'toolbox', 'rams') or p_delivery not in ('phone', 'in_person') or p_audience not in ('all', 'chosen') then
    raise exception 'invalid_input';
  end if;
  if p_kind in ('induction', 'rams') and p_delivery is distinct from 'phone' then
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
  select claimed.path, claimed.content_type, claimed.size_bytes, claimed.object_fingerprint
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
    id, talk_id, site_id, company_id, version_no, body, pdf_path, pdf_content_type, pdf_size_bytes, pdf_object_fingerprint, content_hash, is_current, created_by
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
  v_role text;
  v_roll boolean := false;
  v_unsigned jsonb := null;
begin
  select * into v_talk from public.site_talks t where t.id = p_talk_id;
  select * into v_version from public.site_talk_versions v where v.talk_id = p_talk_id and v.is_current;
  select p.role into v_role from public.people p where p.id = p_actor;
  v_roll := v_talk.kind = 'rams' and v_role in ('owner', 'cm');
  if p_show and (v_talk.kind is distinct from 'rams' or v_roll) then
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
    ),
    'unsigned', case when v_roll then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'person_id', p.id,
        'person_name', private.talk_label(p.display_name)
      ) order by private.talk_label(p.display_name)), '[]'::jsonb)
      from private.talk_required_ids(p_talk_id) req(person_id)
      join public.people p on p.id = req.person_id
      where not exists (
        select 1 from public.site_talk_signatures s
        where s.version_id = v_version.id
          and s.person_id = p.id
          and s.signature_role = 'attendee'
      )
    ) else null end
  );
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
  v_show := v_actor.role in ('owner', 'cm')
    or (v_talk.kind is distinct from 'rams' and v_talk.presenter_person_id = v_actor.person_id);
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
