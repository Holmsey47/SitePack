-- Share one site with one main-contractor firm (6.6).
-- The owner names the firm and picks sections. The code works once, for 7 days.
-- Redeeming it does not join the host company. The guest stays in their own firm
-- and can read only the sections the owner left on. Nothing here is a write.
--
-- Guests read through the security-definer shared_* functions. Table policies stay
-- host-only. can_access_site is unchanged. Redeeming a code creates a pending
-- share. The host owner or contracts manager approves it before any read works.
-- preview_site_share names the site, the host firm, and the sections. It does not
-- grant access and it does not use the code.
-- Every new function is security definer with search_path empty.
-- Execute is revoked from public and anon. This file does not alter storage or auth.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.site_share_invites (
  id uuid primary key default gen_random_uuid(),
  host_company_id uuid not null references public.companies (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  code_hash bytea not null,
  guest_company_name text not null,
  guest_company_key text not null,
  share_drawings boolean not null default false,
  share_variations boolean not null default false,
  share_snags boolean not null default false,
  share_sign_in boolean not null default false,
  share_inductions boolean not null default false,
  created_by uuid references public.people (id) on delete set null,
  expires_at timestamptz not null,
  max_uses integer not null default 1,
  uses integer not null default 0,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint site_share_invites_single_use check (max_uses = 1),
  constraint site_share_invites_uses_nonneg check (uses >= 0 and uses <= max_uses),
  constraint site_share_invites_name_len check (char_length(guest_company_name) between 1 and 160),
  constraint site_share_invites_key_len check (char_length(guest_company_key) between 1 and 160)
);

create unique index site_share_invites_hash_idx on public.site_share_invites (code_hash);
create index site_share_invites_site_idx on public.site_share_invites (site_id, created_at desc);

comment on table public.site_share_invites is
  'One host site, one named firm, one use, seven days. code_hash is HMAC-SHA256. The plaintext is not stored.';

comment on column public.site_share_invites.code_hash is
  'HMAC-SHA256 of the normalised code. Never granted to anon, authenticated, or service_role.';

comment on column public.site_share_invites.guest_company_key is
  'Company name, trimmed, internal spaces collapsed, then lower-cased. Redeem matches this key.';

create table public.site_shares (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null unique references public.site_share_invites (id) on delete cascade,
  host_company_id uuid not null references public.companies (id) on delete cascade,
  guest_company_id uuid not null references public.companies (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  share_drawings boolean not null default false,
  share_variations boolean not null default false,
  share_snags boolean not null default false,
  share_sign_in boolean not null default false,
  share_inductions boolean not null default false,
  guest_company_name text not null,
  redeemer_name text not null,
  redeemer_email text,
  redeemed_by uuid references public.people (id) on delete set null,
  redeemed_at timestamptz not null default now(),
  status text not null default 'pending',
  approved_at timestamptz,
  approved_by uuid references public.people (id) on delete set null,
  declined_at timestamptz,
  declined_by uuid references public.people (id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references public.people (id) on delete set null,
  constraint site_shares_status check (status in ('pending', 'approved', 'declined')),
  constraint site_shares_name_len check (char_length(btrim(guest_company_name)) between 1 and 160),
  constraint site_shares_redeemer_len check (char_length(btrim(redeemer_name)) between 1 and 120)
);

create unique index site_shares_one_active
  on public.site_shares (site_id, guest_company_id)
  where revoked_at is null;

create index site_shares_guest_idx on public.site_shares (guest_company_id, revoked_at);

comment on table public.site_shares is
  'One guest firm on one host site. Pending until the host approves. Firm name, redeemer name, and email are pinned at redeem. Revoke is immediate.';

comment on column public.site_shares.guest_company_name is
  'The guest firm name at redeem time. A later rename does not change this.';

comment on column public.site_shares.redeemer_email is
  'The redeeming person''s email at redeem time. Returned to the host by list_site_shares, not by a table select.';

create table public.site_share_audit (
  id uuid primary key default gen_random_uuid(),
  host_company_id uuid not null references public.companies (id) on delete cascade,
  guest_company_id uuid references public.companies (id) on delete set null,
  site_id uuid not null references public.sites (id) on delete cascade,
  share_id uuid references public.site_shares (id) on delete set null,
  invite_id uuid references public.site_share_invites (id) on delete set null,
  actor_id uuid references public.people (id) on delete set null,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint site_share_audit_action check (
    action in ('created', 'redeemed', 'approved', 'declined', 'sections_changed', 'revoked', 'view_granted')
  )
);

create index site_share_audit_site_idx on public.site_share_audit (site_id, created_at desc);

comment on table public.site_share_audit is
  'Create, redeem, section change, revoke, and each view grant. No code plaintext and no email or phone.';

-- Failed redeem attempts. A person who fails ten times in an hour is refused.
create table public.site_share_attempts (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  client_ip text,
  created_at timestamptz not null default now()
);

create index site_share_attempts_actor_idx on public.site_share_attempts (actor_id, created_at desc);
create index site_share_attempts_ip_idx on public.site_share_attempts (client_ip, created_at desc);

alter table public.site_share_attempts enable row level security;
revoke all on table public.site_share_attempts from public, anon, authenticated;

comment on table public.site_share_attempts is
  'Failed redeem attempts for one person. No code plaintext.';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Trim, collapse spaces, then lower-case. "  FIRM   y " matches Firm Y.
-- The code is not bound to a company id: the guest firm may not exist yet.
create or replace function private.share_company_key(p_name text)
returns text
language sql
immutable
security definer
set search_path = ''
as $fn$
  select nullif(lower(regexp_replace(btrim(coalesce(p_name, '')), '[[:space:]]+', ' ', 'g')), '');
$fn$;

revoke all on function private.share_company_key(text) from public, anon, authenticated;

create or replace function private.share_actor()
returns table (
  person_id uuid,
  company_id uuid,
  role text,
  company_name text,
  display_name text,
  email text
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select p.id, p.company_id, p.role, c.name, p.display_name, p.email
  from public.people p
  join public.companies c on c.id = p.company_id
  where p.auth_user_id = (select auth.uid());
$fn$;

revoke all on function private.share_actor() from public, anon, authenticated;

create or replace function private.can_view_shared_site(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.site_shares s
    join public.people p on p.auth_user_id = (select auth.uid())
    where s.site_id = p_site_id
      and s.guest_company_id = p.company_id
      and s.revoked_at is null
      and s.status = 'approved'
  );
$fn$;

revoke all on function private.can_view_shared_site(uuid) from public, anon;
grant execute on function private.can_view_shared_site(uuid) to authenticated;

create or replace function private.can_view_shared_section(p_site_id uuid, p_section text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.site_shares s
    join public.people p on p.auth_user_id = (select auth.uid())
    where s.site_id = p_site_id
      and s.guest_company_id = p.company_id
      and s.revoked_at is null
      and s.status = 'approved'
      and (
        (p_section = 'drawings' and s.share_drawings)
        or (p_section = 'variations' and s.share_variations)
        or (p_section = 'snags' and s.share_snags)
        or (p_section = 'sign_in' and s.share_sign_in)
        or (p_section = 'inductions' and s.share_inductions)
      )
  );
$fn$;

revoke all on function private.can_view_shared_section(uuid, text) from public, anon;
grant execute on function private.can_view_shared_section(uuid, text) to authenticated;

create or replace function private.share_audit(
  p_host_company uuid,
  p_guest_company uuid,
  p_site_id uuid,
  p_share_id uuid,
  p_invite_id uuid,
  p_actor uuid,
  p_action text,
  p_detail jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.site_share_audit (
    host_company_id, guest_company_id, site_id, share_id, invite_id, actor_id, action, detail
  )
  values (
    p_host_company, p_guest_company, p_site_id, p_share_id, p_invite_id, p_actor, p_action,
    coalesce(p_detail, '{}'::jsonb)
  );
end;
$fn$;

revoke all on function private.share_audit(uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;

-- Drawing files only: <company>/<site>/<uuid>.pdf, and the object is in the drawings bucket.
-- A requests/ photo, a talks/ PDF, or a path with no object is invalid_path.
create or replace function private.share_path_ok(p_path text, p_company uuid, p_site uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select p_path is not null
    and lower(p_path) = lower(p_company::text) || '/' || lower(p_site::text) || '/' ||
      substring(lower(p_path) from '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf)$')
    and lower(p_path) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'
    and exists (
      select 1
      from storage.objects o
      where o.bucket_id = 'drawings'
        and o.name = p_path
    );
$fn$;

revoke all on function private.share_path_ok(text, uuid, uuid) from public, anon, authenticated;

-- Active share, or a precise refusal. p_section 'site' allows any section flags.
create or replace function private.share_guard(p_site_id uuid, p_section text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_share public.site_shares;
  v_revoked boolean;
begin
  select * into v_actor from private.share_actor();
  if not found then
    raise exception 'not_authorized';
  end if;

  select * into v_share
  from public.site_shares s
  where s.site_id = p_site_id
    and s.guest_company_id = v_actor.company_id
    and s.revoked_at is null
  order by case when s.status = 'approved' then 0 else 1 end
  limit 1;

  if found and v_share.status = 'approved' then
    if p_section = 'site'
      or (p_section = 'drawings' and v_share.share_drawings)
      or (p_section = 'variations' and v_share.share_variations)
      or (p_section = 'snags' and v_share.share_snags)
      or (p_section = 'sign_in' and v_share.share_sign_in)
      or (p_section = 'inductions' and v_share.share_inductions)
    then
      return v_share.id;
    end if;
    raise exception 'section_off';
  end if;

  -- Pending and declined stay closed. An older revoked share must not say
  -- share_revoked while this firm is still waiting or has been declined.
  if found then
    raise exception 'not_shared';
  end if;

  select exists (
    select 1
    from public.site_shares s
    where s.site_id = p_site_id
      and s.guest_company_id = v_actor.company_id
      and s.revoked_at is not null
  ) into v_revoked;

  if v_revoked then
    raise exception 'share_revoked';
  end if;
  raise exception 'not_shared';
end;
$fn$;

revoke all on function private.share_guard(uuid, text) from public, anon, authenticated;

-- A guest owner is still an owner of their own firm. Prices stay on the host site.
create or replace function private.visible_variation_pence(p_version_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $fn$
  select case
    when private.can_access_site(v.site_id) and private.can_see_variation_value() then v.value_pence
  end
  from public.variation_versions v
  where v.id = p_version_id;
$fn$;

create or replace function private.visible_shown_pence(p_version_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $fn$
  select case
    when private.can_access_site(s.site_id) and private.can_see_variation_value() then s.shown_value_pence
  end
  from public.variation_signatures s
  where s.version_id = p_version_id;
$fn$;

revoke all on function private.visible_variation_pence(uuid) from public, anon;
revoke all on function private.visible_shown_pence(uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- RLS for the new tables. Clients do not write them.
-- ---------------------------------------------------------------------------

alter table public.site_share_invites enable row level security;
alter table public.site_shares enable row level security;
alter table public.site_share_audit enable row level security;

revoke all on table public.site_share_invites from public, anon, authenticated, service_role;
revoke all on table public.site_shares from public, anon, authenticated, service_role;
revoke all on table public.site_share_audit from public, anon, authenticated, service_role;

grant select (
  id,
  host_company_id,
  site_id,
  guest_company_name,
  guest_company_key,
  share_drawings,
  share_variations,
  share_snags,
  share_sign_in,
  share_inductions,
  created_by,
  expires_at,
  max_uses,
  uses,
  revoked_at,
  created_at
) on table public.site_share_invites to authenticated;

revoke select (code_hash) on table public.site_share_invites from public, anon, authenticated, service_role;

grant select (
  id,
  invite_id,
  host_company_id,
  guest_company_id,
  site_id,
  share_drawings,
  share_variations,
  share_snags,
  share_sign_in,
  share_inductions,
  guest_company_name,
  redeemer_name,
  redeemed_by,
  redeemed_at,
  status,
  approved_at,
  approved_by,
  declined_at,
  declined_by,
  revoked_at,
  revoked_by
) on table public.site_shares to authenticated;
revoke select (redeemer_email) on table public.site_shares from public, anon, authenticated;

grant select (
  id,
  host_company_id,
  guest_company_id,
  site_id,
  share_id,
  invite_id,
  actor_id,
  action,
  detail,
  created_at
) on table public.site_share_audit to authenticated;

drop policy if exists site_share_invites_select on public.site_share_invites;
create policy site_share_invites_select
  on public.site_share_invites for select to authenticated
  using (
    host_company_id = private.my_company_id()
    and private.my_role() = 'owner'
    and private.can_access_site(site_id)
  );

drop policy if exists site_shares_select on public.site_shares;
create policy site_shares_select
  on public.site_shares for select to authenticated
  using (
    host_company_id = private.my_company_id()
    and private.my_role() = 'owner'
    and private.can_access_site(site_id)
  );

drop policy if exists site_share_audit_select on public.site_share_audit;
create policy site_share_audit_select
  on public.site_share_audit for select to authenticated
  using (
    host_company_id = private.my_company_id()
    and private.my_role() = 'owner'
    and private.can_access_site(site_id)
  );

-- ---------------------------------------------------------------------------
-- Existing reads. Host policies stay as they were. Guests have no branch:
-- the shared_* functions are security definer and check the approved share.
-- ---------------------------------------------------------------------------

drop policy if exists sites_select_accessible on public.sites;
create policy sites_select_accessible
  on public.sites for select to authenticated
  using (
    company_id = private.my_company_id()
    and (
      private.my_role() = 'owner'
      or private.is_assigned_to_site(id)
    )
  );

drop policy if exists drawings_select_accessible on public.drawings;
create policy drawings_select_accessible
  on public.drawings for select to authenticated
  using (private.can_access_site(site_id));

drop policy if exists variations_select on public.variations;
create policy variations_select
  on public.variations for select to authenticated
  using (
    company_id = private.my_company_id()
    and private.can_access_site(site_id)
  );

drop policy if exists variation_versions_select on public.variation_versions;
create policy variation_versions_select
  on public.variation_versions for select to authenticated
  using (private.can_access_site(site_id));

drop policy if exists variation_photos_select on public.variation_photos;
create policy variation_photos_select
  on public.variation_photos for select to authenticated
  using (private.can_access_site(site_id));

drop policy if exists variation_signatures_select on public.variation_signatures;
create policy variation_signatures_select
  on public.variation_signatures for select to authenticated
  using (private.can_access_site(site_id));

drop policy if exists snags_select on public.snags;
create policy snags_select
  on public.snags for select to authenticated
  using (
    company_id = private.my_company_id()
    and private.can_access_site(site_id)
  );

drop policy if exists site_attendance_select on public.site_attendance;
create policy site_attendance_select
  on public.site_attendance for select to authenticated
  using (
    company_id = private.my_company_id()
    and private.can_access_site(site_id)
    and (
      person_id = (select p.id from public.people p where p.auth_user_id = (select auth.uid()))
      or private.my_role() in ('owner', 'cm')
    )
  );

drop policy if exists site_talks_select on public.site_talks;
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

drop policy if exists site_talk_versions_select on public.site_talk_versions;
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

-- A table-level select cannot be narrowed by revoking one column, so the image
-- is its own grant. Guests have no policy on this table: can_access_site stays
-- false for the other firm, and a direct select returns no rows and no image.
-- The host owner, the contracts manager, and the signer still read the image.
-- A guest's names, times, and meaning come only from shared_induction_register.
revoke select on table public.site_talk_signatures from public, anon, authenticated;
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

drop policy if exists site_talk_signatures_select on public.site_talk_signatures;
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

-- ---------------------------------------------------------------------------
-- Owner writes and guest reads
-- ---------------------------------------------------------------------------

create or replace function public.create_site_share_invite(
  p_site_id uuid,
  p_guest_company_name text,
  p_drawings boolean,
  p_variations boolean,
  p_snags boolean,
  p_sign_in boolean,
  p_inductions boolean,
  p_code_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_company uuid;
  v_site_name text;
  v_archived timestamptz;
  v_host_key text;
  v_guest_name text;
  v_guest_key text;
  v_hash bytea;
  v_id uuid;
  v_expires timestamptz;
begin
  select * into v_actor from private.share_actor();
  if not found or v_actor.role is distinct from 'owner' then
    raise exception 'not_authorized';
  end if;

  select s.company_id, s.name, s.archived_at
  into v_company, v_site_name, v_archived
  from public.sites s
  where s.id = p_site_id;

  if v_company is null or v_company is distinct from v_actor.company_id or v_archived is not null then
    raise exception 'not_authorized';
  end if;

  v_guest_name := btrim(coalesce(p_guest_company_name, ''));
  v_guest_key := private.share_company_key(v_guest_name);
  v_host_key := private.share_company_key(v_actor.company_name);
  if v_guest_key is null or char_length(v_guest_name) > 160 then
    raise exception 'invalid_input';
  end if;
  if v_guest_key = v_host_key then
    raise exception 'own_firm';
  end if;

  begin
    v_hash := decode(p_code_hash, 'hex');
  exception
    when others then
      v_hash := null;
  end;
  if v_hash is null or octet_length(v_hash) <> 32 then
    raise exception 'invalid_input';
  end if;

  v_expires := now() + interval '7 days';

  begin
    insert into public.site_share_invites (
      host_company_id, site_id, code_hash, guest_company_name, guest_company_key,
      share_drawings, share_variations, share_snags, share_sign_in, share_inductions,
      created_by, expires_at, max_uses
    )
    values (
      v_company, p_site_id, v_hash, v_guest_name, v_guest_key,
      coalesce(p_drawings, false), coalesce(p_variations, false), coalesce(p_snags, false),
      coalesce(p_sign_in, false), coalesce(p_inductions, false),
      v_actor.person_id, v_expires, 1
    )
    returning id into v_id;
  exception
    when unique_violation then
      raise exception 'code_in_use';
  end;

  perform private.share_audit(
    v_company, null, p_site_id, null, v_id, v_actor.person_id, 'created',
    jsonb_build_object(
      'guest_company_name', v_guest_name,
      'drawings', coalesce(p_drawings, false),
      'variations', coalesce(p_variations, false),
      'snags', coalesce(p_snags, false),
      'sign_in', coalesce(p_sign_in, false),
      'inductions', coalesce(p_inductions, false)
    )
  );

  return jsonb_build_object(
    'id', v_id,
    'expires_at', v_expires,
    'site_id', p_site_id,
    'site_name', v_site_name,
    'guest_company_name', v_guest_name,
    'sections', jsonb_build_object(
      'drawings', coalesce(p_drawings, false),
      'variations', coalesce(p_variations, false),
      'snags', coalesce(p_snags, false),
      'sign_in', coalesce(p_sign_in, false),
      'inductions', coalesce(p_inductions, false)
    )
  );
end;
$fn$;

revoke all on function public.create_site_share_invite(uuid, text, boolean, boolean, boolean, boolean, boolean, text) from public, anon;
grant execute on function public.create_site_share_invite(uuid, text, boolean, boolean, boolean, boolean, boolean, text) to authenticated;

-- What the code would share. Same refusal as a bad redeem. No share row, no use.
create or replace function public.preview_site_share(p_code_hash text, p_client_ip text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_hash bytea;
  v_invite public.site_share_invites;
  v_site_name text;
  v_host_name text;
  v_failed integer;
  v_ip text;
  v_ip_failed integer;
begin
  select * into v_actor from private.share_actor();
  if not found or v_actor.company_id is null then
    raise exception 'not_authorized';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_actor.person_id::text)::bigint);

  v_ip := private.ip_subject(coalesce(p_client_ip, ''));
  if v_ip is distinct from 'unknown' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('share-ip:' || v_ip)::bigint);
  end if;

  select count(*) into v_failed
  from public.site_share_attempts a
  where a.actor_id = v_actor.person_id
    and a.created_at > pg_catalog.now() - interval '1 hour';
  if v_failed >= 10 then
    return jsonb_build_object('error', 'too_many_attempts');
  end if;

  if v_ip is distinct from 'unknown' then
    select count(*) into v_ip_failed
    from public.site_share_attempts a
    where a.client_ip = v_ip
      and a.created_at > pg_catalog.now() - interval '15 minutes';
    if v_ip_failed >= 40 then
      return jsonb_build_object('error', 'too_many_attempts');
    end if;
  end if;

  begin
    v_hash := decode(p_code_hash, 'hex');
  exception
    when others then
      v_hash := null;
  end;

  if v_hash is null or octet_length(v_hash) <> 32 then
    insert into public.site_share_attempts (actor_id, client_ip)
    values (v_actor.person_id, nullif(v_ip, 'unknown'));
    return jsonb_build_object('error', 'invalid_input');
  end if;

  select * into v_invite
  from public.site_share_invites
  where code_hash = v_hash;

  if not found
     or v_invite.revoked_at is not null
     or v_invite.expires_at <= pg_catalog.now()
     or v_invite.uses >= v_invite.max_uses
     or private.share_company_key(v_actor.company_name) is distinct from v_invite.guest_company_key
  then
    insert into public.site_share_attempts (actor_id, client_ip)
    values (v_actor.person_id, nullif(v_ip, 'unknown'));
    return jsonb_build_object('error', 'invalid_input');
  end if;

  if v_actor.role not in ('owner', 'cm') then
    insert into public.site_share_attempts (actor_id, client_ip)
    values (v_actor.person_id, nullif(v_ip, 'unknown'));
    return jsonb_build_object('error', 'not_allowed');
  end if;

  select s.name into v_site_name from public.sites s where s.id = v_invite.site_id;
  select c.name into v_host_name from public.companies c where c.id = v_invite.host_company_id;

  return jsonb_build_object(
    'site_name', v_site_name,
    'host_company_name', v_host_name,
    'expires_at', v_invite.expires_at,
    'sections', private.share_sections(
      v_invite.share_drawings, v_invite.share_variations, v_invite.share_snags,
      v_invite.share_sign_in, v_invite.share_inductions
    )
  );
end;
$fn$;

revoke all on function public.preview_site_share(text, text) from public, anon;
grant execute on function public.preview_site_share(text, text) to authenticated;

create or replace function public.redeem_site_share(p_code_hash text, p_client_ip text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_hash bytea;
  v_invite public.site_share_invites;
  v_share public.site_shares;
  v_share_id uuid;
  v_site_name text;
  v_failed integer;
  v_ip text;
  v_ip_failed integer;
begin
  select * into v_actor from private.share_actor();
  if not found or v_actor.company_id is null then
    raise exception 'not_authorized';
  end if;

  -- Person lock first, then the count. Parallel redeems wait on this row.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_actor.person_id::text)::bigint);

  v_ip := private.ip_subject(coalesce(p_client_ip, ''));
  if v_ip is distinct from 'unknown' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('share-ip:' || v_ip)::bigint);
  end if;

  select count(*) into v_failed
  from public.site_share_attempts a
  where a.actor_id = v_actor.person_id
    and a.created_at > pg_catalog.now() - interval '1 hour';
  if v_failed >= 10 then
    return jsonb_build_object('error', 'too_many_attempts');
  end if;

  if v_ip is distinct from 'unknown' then
    select count(*) into v_ip_failed
    from public.site_share_attempts a
    where a.client_ip = v_ip
      and a.created_at > pg_catalog.now() - interval '15 minutes';
    if v_ip_failed >= 40 then
      return jsonb_build_object('error', 'too_many_attempts');
    end if;
  end if;

  begin
    v_hash := decode(p_code_hash, 'hex');
  exception
    when others then
      v_hash := null;
  end;

  if v_hash is null or octet_length(v_hash) <> 32 then
    insert into public.site_share_attempts (actor_id, client_ip)
    values (v_actor.person_id, nullif(v_ip, 'unknown'));
    return jsonb_build_object('error', 'invalid_input');
  end if;

  select * into v_invite
  from public.site_share_invites
  where code_hash = v_hash
  for update;

  if not found
     or v_invite.revoked_at is not null
     or v_invite.expires_at <= pg_catalog.now()
     or private.share_company_key(v_actor.company_name) is distinct from v_invite.guest_company_key
  then
    insert into public.site_share_attempts (actor_id, client_ip)
    values (v_actor.person_id, nullif(v_ip, 'unknown'));
    return jsonb_build_object('error', 'invalid_input');
  end if;

  if v_actor.role not in ('owner', 'cm') then
    insert into public.site_share_attempts (actor_id, client_ip)
    values (v_actor.person_id, nullif(v_ip, 'unknown'));
    return jsonb_build_object('error', 'not_allowed');
  end if;

  select * into v_share
  from public.site_shares s
  where s.invite_id = v_invite.id
    and s.guest_company_id = v_actor.company_id
    and s.revoked_at is null;
  if found then
    select s.name into v_site_name from public.sites s where s.id = v_invite.site_id;
    return jsonb_build_object(
      'share_id', v_share.id,
      'site_id', v_invite.site_id,
      'site_name', v_site_name,
      'status', v_share.status,
      'sections', private.share_sections(
        v_share.share_drawings, v_share.share_variations, v_share.share_snags,
        v_share.share_sign_in, v_share.share_inductions
      )
    );
  end if;

  if v_invite.uses >= v_invite.max_uses or exists (
    select 1
    from public.site_shares s
    where s.site_id = v_invite.site_id
      and s.guest_company_id = v_actor.company_id
      and s.revoked_at is null
  ) then
    insert into public.site_share_attempts (actor_id, client_ip)
    values (v_actor.person_id, nullif(v_ip, 'unknown'));
    return jsonb_build_object('error', 'invalid_input');
  end if;

  insert into public.site_shares (
    invite_id, host_company_id, guest_company_id, site_id,
    share_drawings, share_variations, share_snags, share_sign_in, share_inductions,
    guest_company_name, redeemer_name, redeemer_email, redeemed_by, status
  )
  values (
    v_invite.id, v_invite.host_company_id, v_actor.company_id, v_invite.site_id,
    v_invite.share_drawings, v_invite.share_variations, v_invite.share_snags,
    v_invite.share_sign_in, v_invite.share_inductions,
    v_actor.company_name,
    coalesce(nullif(btrim(v_actor.display_name), ''), 'Someone'),
    v_actor.email,
    v_actor.person_id,
    'pending'
  )
  returning id into v_share_id;

  update public.site_share_invites
  set uses = uses + 1
  where id = v_invite.id;

  select s.name into v_site_name from public.sites s where s.id = v_invite.site_id;

  perform private.share_audit(
    v_invite.host_company_id, v_actor.company_id, v_invite.site_id, v_share_id, v_invite.id,
    v_actor.person_id, 'redeemed',
    jsonb_build_object('guest_company_id', v_actor.company_id, 'guest_company_name', v_actor.company_name)
  );

  return jsonb_build_object(
    'share_id', v_share_id,
    'site_id', v_invite.site_id,
    'site_name', v_site_name,
    'status', 'pending',
    'sections', private.share_sections(
      v_invite.share_drawings, v_invite.share_variations, v_invite.share_snags,
      v_invite.share_sign_in, v_invite.share_inductions
    )
  );
end;
$fn$;

revoke all on function public.redeem_site_share(text, text) from public, anon;
grant execute on function public.redeem_site_share(text, text) to authenticated;

create or replace function public.set_site_share_sections(
  p_share_id uuid,
  p_drawings boolean,
  p_variations boolean,
  p_snags boolean,
  p_sign_in boolean,
  p_inductions boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_share public.site_shares;
begin
  select * into v_actor from private.share_actor();
  if not found or v_actor.role is distinct from 'owner' then
    raise exception 'not_authorized';
  end if;

  select * into v_share from public.site_shares where id = p_share_id;
  if not found or v_share.host_company_id is distinct from v_actor.company_id then
    raise exception 'not_authorized';
  end if;
  if v_share.revoked_at is not null then
    raise exception 'share_revoked';
  end if;

  update public.site_shares
  set share_drawings = coalesce(p_drawings, false),
      share_variations = coalesce(p_variations, false),
      share_snags = coalesce(p_snags, false),
      share_sign_in = coalesce(p_sign_in, false),
      share_inductions = coalesce(p_inductions, false)
  where id = v_share.id;

  perform private.share_audit(
    v_share.host_company_id, v_share.guest_company_id, v_share.site_id, v_share.id, v_share.invite_id,
    v_actor.person_id, 'sections_changed',
    jsonb_build_object(
      'drawings', coalesce(p_drawings, false),
      'variations', coalesce(p_variations, false),
      'snags', coalesce(p_snags, false),
      'sign_in', coalesce(p_sign_in, false),
      'inductions', coalesce(p_inductions, false)
    )
  );
end;
$fn$;

revoke all on function public.set_site_share_sections(uuid, boolean, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.set_site_share_sections(uuid, boolean, boolean, boolean, boolean, boolean) to authenticated;

create or replace function public.revoke_site_share(p_share_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_share public.site_shares;
begin
  select * into v_actor from private.share_actor();
  if not found or v_actor.role not in ('owner', 'cm') then
    raise exception 'not_authorized';
  end if;

  select * into v_share from public.site_shares where id = p_share_id;
  if not found
     or v_share.host_company_id is distinct from v_actor.company_id
     or not private.can_access_site(v_share.site_id)
  then
    raise exception 'not_authorized';
  end if;

  if v_share.revoked_at is null then
    update public.site_shares
    set revoked_at = now(), revoked_by = v_actor.person_id
    where id = v_share.id;
    perform private.share_audit(
      v_share.host_company_id, v_share.guest_company_id, v_share.site_id, v_share.id, v_share.invite_id,
      v_actor.person_id, 'revoked', '{}'::jsonb
    );
  end if;
end;
$fn$;

revoke all on function public.revoke_site_share(uuid) from public, anon;
grant execute on function public.revoke_site_share(uuid) to authenticated;

create or replace function public.approve_site_share(p_share_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_share public.site_shares;
begin
  select * into v_actor from private.share_actor();
  if not found or v_actor.role not in ('owner', 'cm') then
    raise exception 'not_authorized';
  end if;

  select * into v_share from public.site_shares where id = p_share_id for update;
  if not found
     or v_share.host_company_id is distinct from v_actor.company_id
     or not private.can_access_site(v_share.site_id)
  then
    raise exception 'not_authorized';
  end if;
  if v_share.revoked_at is not null then
    raise exception 'share_revoked';
  end if;
  if v_share.status = 'declined' then
    raise exception 'not_authorized';
  end if;
  if v_share.status = 'approved' then
    return;
  end if;

  update public.site_shares
  set status = 'approved',
      approved_at = pg_catalog.now(),
      approved_by = v_actor.person_id
  where id = v_share.id;

  perform private.share_audit(
    v_share.host_company_id, v_share.guest_company_id, v_share.site_id, v_share.id, v_share.invite_id,
    v_actor.person_id, 'approved', '{}'::jsonb
  );
end;
$fn$;

revoke all on function public.approve_site_share(uuid) from public, anon;
grant execute on function public.approve_site_share(uuid) to authenticated;

create or replace function public.decline_site_share(p_share_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_share public.site_shares;
begin
  select * into v_actor from private.share_actor();
  if not found or v_actor.role not in ('owner', 'cm') then
    raise exception 'not_authorized';
  end if;

  select * into v_share from public.site_shares where id = p_share_id for update;
  if not found
     or v_share.host_company_id is distinct from v_actor.company_id
     or not private.can_access_site(v_share.site_id)
  then
    raise exception 'not_authorized';
  end if;
  if v_share.revoked_at is not null then
    raise exception 'share_revoked';
  end if;
  if v_share.status = 'declined' then
    return;
  end if;
  if v_share.status = 'approved' then
    raise exception 'not_authorized';
  end if;

  update public.site_shares
  set status = 'declined',
      declined_at = pg_catalog.now(),
      declined_by = v_actor.person_id
  where id = v_share.id;

  perform private.share_audit(
    v_share.host_company_id, v_share.guest_company_id, v_share.site_id, v_share.id, v_share.invite_id,
    v_actor.person_id, 'declined', '{}'::jsonb
  );
end;
$fn$;

revoke all on function public.decline_site_share(uuid) from public, anon;
grant execute on function public.decline_site_share(uuid) to authenticated;

create or replace function public.revoke_site_share_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_invite public.site_share_invites;
begin
  select * into v_actor from private.share_actor();
  if not found or v_actor.role is distinct from 'owner' then
    raise exception 'not_authorized';
  end if;

  select * into v_invite from public.site_share_invites where id = p_invite_id;
  if not found or v_invite.host_company_id is distinct from v_actor.company_id then
    raise exception 'not_authorized';
  end if;

  if v_invite.revoked_at is null then
    update public.site_share_invites set revoked_at = now() where id = v_invite.id;
    perform private.share_audit(
      v_invite.host_company_id, null, v_invite.site_id, null, v_invite.id,
      v_actor.person_id, 'revoked', jsonb_build_object('invite', true)
    );
  end if;
end;
$fn$;

revoke all on function public.revoke_site_share_invite(uuid) from public, anon;
grant execute on function public.revoke_site_share_invite(uuid) to authenticated;

create or replace function public.list_site_shares(p_site_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_invites jsonb;
  v_shares jsonb;
begin
  select * into v_actor from private.share_actor();
  if not found or v_actor.role not in ('owner', 'cm') or not private.can_access_site(p_site_id) then
    raise exception 'not_authorized';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'guest_company_name', i.guest_company_name,
    'expires_at', i.expires_at,
    'uses', i.uses,
    'revoked_at', i.revoked_at,
    'created_at', i.created_at,
    'sections', private.share_sections(
      i.share_drawings, i.share_variations, i.share_snags, i.share_sign_in, i.share_inductions
    )
  ) order by i.created_at desc), '[]'::jsonb)
  into v_invites
  from public.site_share_invites i
  where i.site_id = p_site_id
    and i.host_company_id = v_actor.company_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'guest_company_id', s.guest_company_id,
    'guest_company_name', s.guest_company_name,
    'current_company_name', c.name,
    'renamed', private.share_company_key(c.name) is distinct from private.share_company_key(s.guest_company_name),
    'redeemer_name', s.redeemer_name,
    'redeemer_email', s.redeemer_email,
    'redeemed_at', s.redeemed_at,
    'status', s.status,
    'approved_at', s.approved_at,
    'approved_by_name', approver.display_name,
    'declined_at', s.declined_at,
    'revoked_at', s.revoked_at,
    'site_name', site.name,
    'code_expires_at', i.expires_at,
    'sections', private.share_sections(
      s.share_drawings, s.share_variations, s.share_snags, s.share_sign_in, s.share_inductions
    )
  ) order by s.redeemed_at desc), '[]'::jsonb)
  into v_shares
  from public.site_shares s
  join public.companies c on c.id = s.guest_company_id
  join public.sites site on site.id = s.site_id
  left join public.people approver on approver.id = s.approved_by
  left join public.site_share_invites i on i.id = s.invite_id
  where s.site_id = p_site_id
    and s.host_company_id = v_actor.company_id;

  return jsonb_build_object('invites', v_invites, 'shares', v_shares);
end;
$fn$;

revoke all on function public.list_site_shares(uuid) from public, anon;
grant execute on function public.list_site_shares(uuid) to authenticated;

create or replace function public.my_share_notices()
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
  select * into v_actor from private.share_actor();
  if not found or v_actor.role not in ('owner', 'cm') then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'share_id', s.id,
    'site_id', s.site_id,
    'site_name', site.name,
    'guest_company_name', s.guest_company_name,
    'current_company_name', c.name,
    'renamed', private.share_company_key(c.name) is distinct from private.share_company_key(s.guest_company_name),
    'redeemer_name', s.redeemer_name,
    'redeemer_email', s.redeemer_email,
    'redeemed_at', s.redeemed_at,
    'code_expires_at', i.expires_at,
    'sections', private.share_sections(
      s.share_drawings, s.share_variations, s.share_snags, s.share_sign_in, s.share_inductions
    )
  ) order by s.redeemed_at desc), '[]'::jsonb)
  into v_rows
  from public.site_shares s
  join public.sites site on site.id = s.site_id
  join public.companies c on c.id = s.guest_company_id
  left join public.site_share_invites i on i.id = s.invite_id
  where s.host_company_id = v_actor.company_id
    and s.status = 'pending'
    and s.revoked_at is null
    and private.can_access_site(s.site_id);

  return v_rows;
end;
$fn$;

revoke all on function public.my_share_notices() from public, anon;
grant execute on function public.my_share_notices() to authenticated;

create or replace function private.share_cm_name(p_site_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select p.display_name
  from public.site_assignments a
  join public.people p on p.id = a.person_id
  where a.site_id = p_site_id
    and p.role = 'cm'
    and nullif(btrim(p.display_name), '') is not null
  order by a.created_at
  limit 1;
$fn$;

revoke all on function private.share_cm_name(uuid) from public, anon, authenticated;

create or replace function private.share_sections(
  p_drawings boolean,
  p_variations boolean,
  p_snags boolean,
  p_sign_in boolean,
  p_inductions boolean
)
returns jsonb
language sql
immutable
security definer
set search_path = ''
as $fn$
  select jsonb_build_object(
    'drawings', p_drawings,
    'variations', p_variations,
    'snags', p_snags,
    'sign_in', p_sign_in,
    'inductions', p_inductions
  );
$fn$;

revoke all on function private.share_sections(boolean, boolean, boolean, boolean, boolean) from public, anon, authenticated;

create or replace function public.my_shared_sites()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_rows jsonb;
  v_share record;
begin
  select * into v_actor from private.share_actor();
  if not found then
    raise exception 'not_authorized';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'share_id', s.id,
    'site_id', s.site_id,
    'site_name', site.name,
    'host_company_name', host.name,
    'cm_contact_name', private.share_cm_name(s.site_id),
    'sections', private.share_sections(
      s.share_drawings, s.share_variations, s.share_snags, s.share_sign_in, s.share_inductions
    )
  ) order by site.name), '[]'::jsonb)
  into v_rows
  from public.site_shares s
  join public.sites site on site.id = s.site_id
  join public.companies host on host.id = s.host_company_id
  where s.guest_company_id = v_actor.company_id
    and s.revoked_at is null
    and s.status = 'approved';

  for v_share in
    select s.id, s.host_company_id, s.guest_company_id, s.site_id, s.invite_id
    from public.site_shares s
    where s.guest_company_id = v_actor.company_id
      and s.revoked_at is null
      and s.status = 'approved'
      and not exists (
        select 1
        from public.site_share_audit a
        where a.share_id = s.id
          and a.action = 'view_granted'
      )
  loop
    perform private.share_audit(
      v_share.host_company_id, v_share.guest_company_id, v_share.site_id, v_share.id, v_share.invite_id,
      v_actor.person_id, 'view_granted', jsonb_build_object('section', 'site')
    );
  end loop;

  return v_rows;
end;
$fn$;

revoke all on function public.my_shared_sites() from public, anon;
grant execute on function public.my_shared_sites() to authenticated;

create or replace function public.shared_site_view(p_site_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_share_id uuid;
  v_share public.site_shares;
  v_site public.sites;
  v_host text;
begin
  select * into v_actor from private.share_actor();
  if not found then
    raise exception 'not_authorized';
  end if;

  v_share_id := private.share_guard(p_site_id, 'site');
  select * into v_share from public.site_shares where id = v_share_id;
  select * into v_site from public.sites where id = p_site_id;
  select c.name into v_host from public.companies c where c.id = v_share.host_company_id;

  return jsonb_build_object(
    'site_id', v_site.id,
    'site_name', v_site.name,
    'address_line', v_site.address_line,
    'host_company_name', v_host,
    'cm_contact_name', private.share_cm_name(v_site.id),
    'sections', private.share_sections(
      v_share.share_drawings, v_share.share_variations, v_share.share_snags,
      v_share.share_sign_in, v_share.share_inductions
    )
  );
end;
$fn$;

revoke all on function public.shared_site_view(uuid) from public, anon;
grant execute on function public.shared_site_view(uuid) to authenticated;

create or replace function public.shared_drawings(p_site_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_share_id uuid;
  v_share public.site_shares;
  v_rows jsonb;
begin
  select * into v_actor from private.share_actor();
  if not found then
    raise exception 'not_authorized';
  end if;
  v_share_id := private.share_guard(p_site_id, 'drawings');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id,
    'title', d.title,
    'sheet_number', d.sheet_number,
    'revision', d.revision,
    'dated', d.dated,
    'level', d.level,
    'folder', d.folder
  ) order by d.title, d.sheet_number), '[]'::jsonb)
  into v_rows
  from public.drawings d
  where d.site_id = p_site_id
    and d.is_current;

  return v_rows;
end;
$fn$;

revoke all on function public.shared_drawings(uuid) from public, anon;
grant execute on function public.shared_drawings(uuid) to authenticated;

create or replace function public.shared_drawing_url(p_site_id uuid, p_drawing_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_drawing public.drawings;
  v_share_id uuid;
  v_company uuid;
begin
  select * into v_actor from private.share_actor();
  if not found then
    raise exception 'not_authorized';
  end if;

  -- Share before the drawing is loaded. A caller without this section gets
  -- not_shared for a missing id and a real id alike.
  v_share_id := private.share_guard(p_site_id, 'drawings');

  select * into v_drawing
  from public.drawings
  where id = p_drawing_id
    and site_id = p_site_id;
  if not found then
    raise exception 'not_shared';
  end if;

  if not v_drawing.is_current then
    raise exception 'not_current';
  end if;

  select s.company_id into v_company from public.sites s where s.id = v_drawing.site_id;

  if not private.share_path_ok(v_drawing.storage_path, v_company, v_drawing.site_id) then
    raise exception 'invalid_path';
  end if;

  return jsonb_build_object(
    'bucket', 'drawings',
    'path', v_drawing.storage_path,
    'expires_in', 300
  );
end;
$fn$;

revoke all on function public.shared_drawing_url(uuid, uuid) from public, anon;
grant execute on function public.shared_drawing_url(uuid, uuid) to authenticated;

create or replace function public.shared_variations(p_site_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_share_id uuid;
  v_share public.site_shares;
  v_rows jsonb;
begin
  select * into v_actor from private.share_actor();
  if not found then
    raise exception 'not_authorized';
  end if;
  v_share_id := private.share_guard(p_site_id, 'variations');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', v.id,
    'vo_seq', v.vo_seq,
    'version_id', ver.id,
    'title', ver.title,
    'description', ver.description,
    'level_area', ver.level_area,
    'quantity_text', ver.quantity_text,
    'status', ver.status,
    'signer_name', sig.signer_name,
    'signer_company', sig.signer_company
  ) order by v.vo_seq), '[]'::jsonb)
  into v_rows
  from public.variations v
  join public.variation_versions ver on ver.variation_id = v.id
  left join public.variation_signatures sig on sig.version_id = ver.id
  where v.site_id = p_site_id
    and ver.status in ('Signed', 'Sent');

  return v_rows;
end;
$fn$;

revoke all on function public.shared_variations(uuid) from public, anon;
grant execute on function public.shared_variations(uuid) to authenticated;

create or replace function public.shared_snags(p_site_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_share_id uuid;
  v_share public.site_shares;
  v_rows jsonb;
begin
  select * into v_actor from private.share_actor();
  if not found then
    raise exception 'not_authorized';
  end if;
  v_share_id := private.share_guard(p_site_id, 'snags');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'snag_seq', s.snag_seq,
    'note', s.note,
    'level_area', s.level_area,
    'trade_label', s.trade_label,
    'status', s.status,
    'raised_by_name', s.raised_by_name,
    'raised_at', s.raised_at,
    'fixed_by_name', s.fixed_by_name
  ) order by s.snag_seq), '[]'::jsonb)
  into v_rows
  from public.snags s
  where s.site_id = p_site_id;

  return v_rows;
end;
$fn$;

revoke all on function public.shared_snags(uuid) from public, anon;
grant execute on function public.shared_snags(uuid) to authenticated;

create or replace function public.shared_sign_in_register(p_site_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_share_id uuid;
  v_share public.site_shares;
  v_rows jsonb;
begin
  select * into v_actor from private.share_actor();
  if not found then
    raise exception 'not_authorized';
  end if;
  v_share_id := private.share_guard(p_site_id, 'sign_in');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'person_name', a.person_name,
    'in_at', a.in_at,
    'out_at', a.out_at
  ) order by a.in_at), '[]'::jsonb)
  into v_rows
  from public.site_attendance a
  where a.site_id = p_site_id;

  return v_rows;
end;
$fn$;

revoke all on function public.shared_sign_in_register(uuid) from public, anon;
grant execute on function public.shared_sign_in_register(uuid) to authenticated;

create or replace function public.shared_induction_register(p_site_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_share_id uuid;
  v_share public.site_shares;
  v_rows jsonb;
begin
  select * into v_actor from private.share_actor();
  if not found then
    raise exception 'not_authorized';
  end if;
  v_share_id := private.share_guard(p_site_id, 'inductions');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', sig.id,
    'talk_id', t.id,
    'title', t.title,
    'person_name', sig.person_name,
    'meaning', sig.meaning,
    'received_at', sig.received_at
  ) order by t.title, sig.person_name, sig.id), '[]'::jsonb)
  into v_rows
  from public.site_talks t
  join public.site_talk_signatures sig on sig.talk_id = t.id
  where t.site_id = p_site_id
    and t.kind = 'induction'
    and sig.signature_role = 'attendee';

  return v_rows;
end;
$fn$;

revoke all on function public.shared_induction_register(uuid) from public, anon;
grant execute on function public.shared_induction_register(uuid) to authenticated;

create or replace function public.list_site_share_audit(p_site_id uuid)
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
  select * into v_actor from private.share_actor();
  if not found or v_actor.role is distinct from 'owner' or not private.can_access_site(p_site_id) then
    raise exception 'not_authorized';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'action', a.action,
    'detail', a.detail,
    'created_at', a.created_at,
    'share_id', a.share_id,
    'invite_id', a.invite_id
  ) order by a.created_at), '[]'::jsonb)
  into v_rows
  from public.site_share_audit a
  where a.site_id = p_site_id
    and a.host_company_id = v_actor.company_id;

  return v_rows;
end;
$fn$;

revoke all on function public.list_site_share_audit(uuid) from public, anon;
grant execute on function public.list_site_share_audit(uuid) to authenticated;
