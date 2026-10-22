-- Proof each lad saw the latest drawing revision (6.2).
-- A new upload or replace is a new drawings row, so previous confirmations
-- stay on the superseded row and do not count toward the current revision.
-- N is the people currently in site_assignments. Removed people drop out of N.
-- Writes are SECURITY DEFINER with search_path pinned to empty.
-- Reads run as the caller, so RLS applies.
-- This migration does not touch storage, auth, invites, or variations.

-- ---------------------------------------------------------------------------
-- Tables. Clients may select rows on sites they can access. Inserts go
-- through the functions below, which require an open before a confirmation.
-- ---------------------------------------------------------------------------

create table public.drawing_revision_opens (
  id uuid primary key default gen_random_uuid(),
  drawing_id uuid not null references public.drawings (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  revision text not null,
  opened_at timestamptz not null default now(),
  constraint drawing_revision_opens_revision_len check (char_length(revision) between 1 and 120),
  constraint drawing_revision_opens_once unique (drawing_id, person_id, revision)
);

create index drawing_revision_opens_site_idx on public.drawing_revision_opens (site_id);

comment on table public.drawing_revision_opens is
  'Proof a person opened this drawing revision. confirm_drawing_seen rejects a tap with no matching open.';

create table public.drawing_seen (
  id uuid primary key default gen_random_uuid(),
  drawing_id uuid not null references public.drawings (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  revision text not null,
  seen_at timestamptz not null,
  received_at timestamptz not null default now(),
  constraint drawing_seen_revision_len check (char_length(revision) between 1 and 120),
  constraint drawing_seen_once unique (drawing_id, person_id, revision)
);

create index drawing_seen_site_idx on public.drawing_seen (site_id);
create index drawing_seen_drawing_idx on public.drawing_seen (drawing_id);

comment on table public.drawing_seen is
  'A person tapped seen for this drawing revision. Superseded rows stay as history and do not count for the current revision.';

comment on column public.drawing_seen.seen_at is
  'Device time the person tapped seen, when that time is not more than 5 minutes ahead of the server and not before their recorded open of this revision. Otherwise this equals received_at.';

comment on column public.drawing_seen.received_at is
  'Server time the tap was stored.';

create or replace function private.drawing_proof_site_matches()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not exists (
    select 1
    from public.drawings d
    where d.id = new.drawing_id
      and d.site_id = new.site_id
      and d.revision = new.revision
  ) then
    raise exception 'invalid_input';
  end if;
  return new;
end;
$fn$;

revoke all on function private.drawing_proof_site_matches() from public, anon, authenticated;

create trigger drawing_revision_opens_site_matches
  before insert or update on public.drawing_revision_opens
  for each row execute function private.drawing_proof_site_matches();

create trigger drawing_seen_site_matches
  before insert or update on public.drawing_seen
  for each row execute function private.drawing_proof_site_matches();

alter table public.drawing_revision_opens enable row level security;
alter table public.drawing_seen enable row level security;

revoke all on table public.drawing_revision_opens from public, anon, authenticated;
revoke all on table public.drawing_seen from public, anon, authenticated;

grant select on table public.drawing_revision_opens to authenticated;
grant select on table public.drawing_seen to authenticated;

create policy drawing_revision_opens_select
  on public.drawing_revision_opens for select to authenticated
  using (private.can_access_site(site_id));

create policy drawing_seen_select
  on public.drawing_seen for select to authenticated
  using (private.can_access_site(site_id));

-- ---------------------------------------------------------------------------
-- Actor. Empty search_path. Schema-qualified names.
-- ---------------------------------------------------------------------------

create or replace function private.drawing_seen_person()
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select p.id
  from public.people p
  where p.auth_user_id = (select auth.uid());
$fn$;

revoke all on function private.drawing_seen_person() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Open the current revision. Idempotent. The revision is taken from the row.
-- ---------------------------------------------------------------------------

create or replace function public.record_drawing_open(p_drawing_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_person uuid;
  v_drawing public.drawings;
  v_opened timestamptz;
begin
  v_person := private.drawing_seen_person();
  if v_person is null then
    raise exception 'not_authorized';
  end if;

  select * into v_drawing
  from public.drawings d
  where d.id = p_drawing_id;

  if not found then
    raise exception 'drawing_not_found';
  end if;
  if not private.can_access_site(v_drawing.site_id) then
    raise exception 'not_authorized';
  end if;
  if v_drawing.is_current is not true then
    raise exception 'not_current';
  end if;

  insert into public.drawing_revision_opens (drawing_id, site_id, person_id, revision, opened_at)
  values (v_drawing.id, v_drawing.site_id, v_person, v_drawing.revision, now())
  on conflict (drawing_id, person_id, revision) do nothing;

  select o.opened_at into v_opened
  from public.drawing_revision_opens o
  where o.drawing_id = v_drawing.id
    and o.person_id = v_person
    and o.revision = v_drawing.revision;

  return jsonb_build_object('opened_at', v_opened);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Tap "I've seen rev X". Rejects a revision the caller has not opened.
-- p_seen_at is the device tap time. It is stored when it is not more than
-- 5 minutes in the future and not before this person's open of this rev.
-- Otherwise seen_at falls back to the server receive time. The first tap sticks.
-- A missing drawing and a drawing the caller cannot access both raise
-- drawing_not_found, so the caller cannot tell whether the sheet exists.
-- not_authorized stays for a caller with no people row.
-- ---------------------------------------------------------------------------

create or replace function public.confirm_drawing_seen(
  p_drawing_id uuid,
  p_seen_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_person uuid;
  v_drawing public.drawings;
  v_opened timestamptz;
  v_received timestamptz;
  v_seen timestamptz;
begin
  v_person := private.drawing_seen_person();
  if v_person is null then
    raise exception 'not_authorized';
  end if;

  select * into v_drawing
  from public.drawings d
  where d.id = p_drawing_id;

  if not found or not private.can_access_site(v_drawing.site_id) then
    raise exception 'drawing_not_found';
  end if;
  if v_drawing.is_current is not true then
    raise exception 'not_current';
  end if;

  select o.opened_at into v_opened
  from public.drawing_revision_opens o
  where o.drawing_id = v_drawing.id
    and o.person_id = v_person
    and o.revision = v_drawing.revision;

  if v_opened is null then
    raise exception 'not_opened';
  end if;

  v_received := now();
  v_seen := v_received;
  if p_seen_at is not null
     and p_seen_at <= v_received + interval '5 minutes'
     and p_seen_at >= v_opened
  then
    v_seen := p_seen_at;
  end if;

  insert into public.drawing_seen (drawing_id, site_id, person_id, revision, seen_at, received_at)
  values (v_drawing.id, v_drawing.site_id, v_person, v_drawing.revision, v_seen, v_received)
  on conflict (drawing_id, person_id, revision) do nothing;

  select s.seen_at into v_seen
  from public.drawing_seen s
  where s.drawing_id = v_drawing.id
    and s.person_id = v_person
    and s.revision = v_drawing.revision;

  return jsonb_build_object('seen_at', v_seen);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Reads. Caller role, so an operative of site A cannot see site B, and
-- firm X cannot see firm Y. Counts use people still assigned to the site.
-- ---------------------------------------------------------------------------

create or replace function public.my_drawing_proof(p_drawing_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_person uuid;
  v_drawing public.drawings;
  v_seen timestamptz;
begin
  select p.id into v_person
  from public.people p
  where p.auth_user_id = (select auth.uid());

  if v_person is null then
    raise exception 'not_authorized';
  end if;

  select * into v_drawing
  from public.drawings d
  where d.id = p_drawing_id;

  if not found then
    raise exception 'drawing_not_found';
  end if;
  if not private.can_access_site(v_drawing.site_id) then
    raise exception 'not_authorized';
  end if;

  select s.seen_at into v_seen
  from public.drawing_seen s
  where s.drawing_id = v_drawing.id
    and s.person_id = v_person
    and s.revision = v_drawing.revision;

  return jsonb_build_object(
    'drawing_id', v_drawing.id,
    'site_id', v_drawing.site_id,
    'revision', v_drawing.revision,
    'is_current', v_drawing.is_current,
    'assigned', private.is_assigned_to_site(v_drawing.site_id),
    'opened', exists (
      select 1
      from public.drawing_revision_opens o
      where o.drawing_id = v_drawing.id
        and o.person_id = v_person
        and o.revision = v_drawing.revision
    ),
    'seen_at', v_seen
  );
end;
$fn$;

create or replace function public.my_unseen_drawings()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_person uuid;
begin
  select p.id into v_person
  from public.people p
  where p.auth_user_id = (select auth.uid());

  if v_person is null then
    raise exception 'not_authorized';
  end if;

  return coalesce(
    (
      select jsonb_agg(item order by item->>'site_name', item->>'sheet', item->>'revision')
      from (
        select jsonb_build_object(
          'site_id', d.site_id,
          'site_name', s.name,
          'drawing_id', d.id,
          'title', d.title,
          'sheet_number', d.sheet_number,
          'sheet', case
            when nullif(btrim(coalesce(d.sheet_number, '')), '') is not null then btrim(d.sheet_number)
            else d.title
          end,
          'revision', d.revision
        ) as item
        from public.drawings d
        join public.sites s on s.id = d.site_id
        where d.is_current
          and private.is_assigned_to_site(d.site_id)
          and not exists (
            select 1
            from public.drawing_seen seen
            where seen.drawing_id = d.id
              and seen.person_id = v_person
              and seen.revision = d.revision
          )
      ) rows
    ),
    '[]'::jsonb
  );
end;
$fn$;

create or replace function public.site_drawing_seen(p_site_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_role text;
  v_assigned integer;
  v_missing integer;
  v_drawings jsonb;
begin
  v_role := private.my_role();
  if v_role is distinct from 'owner' and v_role is distinct from 'cm' then
    raise exception 'not_authorized';
  end if;
  if p_site_id is null or not private.can_access_site(p_site_id) then
    raise exception 'not_authorized';
  end if;

  select count(distinct a.person_id)::int into v_assigned
  from public.site_assignments a
  where a.site_id = p_site_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'drawing_id', row.drawing_id,
        'title', row.title,
        'sheet_number', row.sheet_number,
        'revision', row.revision,
        'seen_count', row.seen_count
      )
      order by row.title, row.sheet_number nulls last
    ),
    '[]'::jsonb
  )
  into v_drawings
  from (
    select
      d.id as drawing_id,
      d.title,
      d.sheet_number,
      d.revision,
      (
        select count(distinct s.person_id)::int
        from public.drawing_seen s
        join public.site_assignments a
          on a.site_id = d.site_id
         and a.person_id = s.person_id
        where s.drawing_id = d.id
          and s.revision = d.revision
      ) as seen_count
    from public.drawings d
    where d.site_id = p_site_id
      and d.is_current
  ) row;

  select count(*)::int into v_missing
  from jsonb_array_elements(v_drawings) item
  where v_assigned > 0
    and (item->>'seen_count')::int < v_assigned;

  return jsonb_build_object(
    'site_id', p_site_id,
    'assigned_count', coalesce(v_assigned, 0),
    'not_seen_by_everyone', coalesce(v_missing, 0),
    'drawings', v_drawings
  );
end;
$fn$;

create or replace function public.drawing_seen_roster(p_drawing_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_role text;
  v_drawing public.drawings;
  v_assigned integer;
  v_seen jsonb;
  v_unseen jsonb;
  v_seen_count integer;
begin
  v_role := private.my_role();
  if v_role is distinct from 'owner' and v_role is distinct from 'cm' then
    raise exception 'not_authorized';
  end if;

  select * into v_drawing
  from public.drawings d
  where d.id = p_drawing_id;

  if not found then
    raise exception 'drawing_not_found';
  end if;
  if not private.can_access_site(v_drawing.site_id) then
    raise exception 'not_authorized';
  end if;

  select count(distinct a.person_id)::int into v_assigned
  from public.site_assignments a
  where a.site_id = v_drawing.site_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'person_id', row.person_id,
        'display_name', row.display_name,
        'seen_at', row.seen_at
      )
      order by row.seen_at, row.display_name nulls last
    ),
    '[]'::jsonb
  )
  into v_seen
  from (
    select distinct on (a.person_id)
      a.person_id,
      p.display_name,
      s.seen_at
    from public.site_assignments a
    join public.drawing_seen s
      on s.person_id = a.person_id
     and s.drawing_id = v_drawing.id
     and s.revision = v_drawing.revision
    left join public.people p on p.id = a.person_id
    where a.site_id = v_drawing.site_id
    order by a.person_id, s.seen_at
  ) row;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'person_id', row.person_id,
        'display_name', row.display_name
      )
      order by row.display_name nulls last, row.person_id
    ),
    '[]'::jsonb
  )
  into v_unseen
  from (
    select distinct a.person_id, p.display_name
    from public.site_assignments a
    left join public.people p on p.id = a.person_id
    where a.site_id = v_drawing.site_id
      and not exists (
        select 1
        from public.drawing_seen s
        where s.drawing_id = v_drawing.id
          and s.person_id = a.person_id
          and s.revision = v_drawing.revision
      )
  ) row;

  v_seen_count := coalesce(jsonb_array_length(v_seen), 0);

  return jsonb_build_object(
    'drawing_id', v_drawing.id,
    'site_id', v_drawing.site_id,
    'title', v_drawing.title,
    'sheet_number', v_drawing.sheet_number,
    'revision', v_drawing.revision,
    'is_current', v_drawing.is_current,
    'seen_count', v_seen_count,
    'assigned_count', coalesce(v_assigned, 0),
    'seen', v_seen,
    'unseen', v_unseen
  );
end;
$fn$;

create or replace function public.manager_drawing_gaps()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_role text;
begin
  v_role := private.my_role();
  if v_role is distinct from 'owner' and v_role is distinct from 'cm' then
    raise exception 'not_authorized';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'site_id', gaps.site_id,
          'not_seen_by_everyone', gaps.missing
        )
        order by gaps.site_id
      )
      from (
        select d.site_id, count(*)::int as missing
        from public.drawings d
        where d.is_current
          and private.can_access_site(d.site_id)
          and (
            select count(distinct a.person_id)
            from public.site_assignments a
            where a.site_id = d.site_id
          ) > 0
          and (
            select count(distinct s.person_id)
            from public.drawing_seen s
            join public.site_assignments a
              on a.site_id = d.site_id
             and a.person_id = s.person_id
            where s.drawing_id = d.id
              and s.revision = d.revision
          ) < (
            select count(distinct a.person_id)
            from public.site_assignments a
            where a.site_id = d.site_id
          )
        group by d.site_id
      ) gaps
    ),
    '[]'::jsonb
  );
end;
$fn$;

revoke all on function public.record_drawing_open(uuid) from public, anon, authenticated;
revoke all on function public.confirm_drawing_seen(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.my_drawing_proof(uuid) from public, anon, authenticated;
revoke all on function public.my_unseen_drawings() from public, anon, authenticated;
revoke all on function public.site_drawing_seen(uuid) from public, anon, authenticated;
revoke all on function public.drawing_seen_roster(uuid) from public, anon, authenticated;
revoke all on function public.manager_drawing_gaps() from public, anon, authenticated;

grant execute on function public.record_drawing_open(uuid) to authenticated;
grant execute on function public.confirm_drawing_seen(uuid, timestamptz) to authenticated;
grant execute on function public.my_drawing_proof(uuid) to authenticated;
grant execute on function public.my_unseen_drawings() to authenticated;
grant execute on function public.site_drawing_seen(uuid) to authenticated;
grant execute on function public.drawing_seen_roster(uuid) to authenticated;
grant execute on function public.manager_drawing_gaps() to authenticated;
