-- Owner sets a site manager. A member is operative. A site manager is cm.
-- Those are the role names already on public.people.
-- Allowed changes are operative -> cm and cm -> operative.
-- The caller must be an owner of that person's company.
-- An owner cannot be changed, and the caller cannot change themselves.
-- Each change writes public.person_role_audit in the same transaction.
-- The function is security definer with an empty search_path. Every name
-- inside it is schema-qualified. Execute is revoked from public and anon
-- and granted to authenticated.
-- A signed-in update of people.role is refused unless it is this function,
-- so the audit row cannot be skipped.
-- private.my_role() and public.my_person() read people.role on each call,
-- so the new role applies on the next refresh. A new login is not required.

create table if not exists public.person_role_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  actor_id uuid not null references public.people (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  old_role text not null,
  new_role text not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint person_role_audit_old_role check (old_role in ('operative', 'cm', 'owner')),
  constraint person_role_audit_new_role check (new_role in ('operative', 'cm')),
  constraint person_role_audit_transition check (
    (old_role = 'operative' and new_role = 'cm')
    or (old_role = 'cm' and new_role = 'operative')
  )
);

comment on table public.person_role_audit is
  'Who changed a person between operative and site manager (cm). Owners of that company can read it. No email or phone.';

create index if not exists person_role_audit_company_idx
  on public.person_role_audit (company_id, created_at desc);

alter table public.person_role_audit enable row level security;

revoke all on table public.person_role_audit from public, anon, authenticated, service_role;
grant select on table public.person_role_audit to authenticated;

drop policy if exists person_role_audit_select on public.person_role_audit;
create policy person_role_audit_select
  on public.person_role_audit for select to authenticated
  using (
    company_id = private.my_company_id()
    and private.my_role() = 'owner'
  );

create or replace function public.set_person_role(p_person_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_actor_role text;
  v_actor_company uuid;
  v_person_id uuid;
  v_company_id uuid;
  v_old_role text;
  v_updated integer;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authorized';
  end if;

  select p.id, p.role, p.company_id
    into v_actor_id, v_actor_role, v_actor_company
  from public.people p
  where p.auth_user_id = (select auth.uid());

  if v_actor_id is null or v_actor_role is distinct from 'owner' then
    raise exception 'not_authorized';
  end if;

  if p_person_id is null or p_person_id = v_actor_id then
    raise exception 'not_authorized';
  end if;

  select p.id, p.company_id, p.role
    into v_person_id, v_company_id, v_old_role
  from public.people p
  where p.id = p_person_id
  for update;

  if v_person_id is null or v_company_id is distinct from v_actor_company then
    raise exception 'not_authorized';
  end if;

  if v_old_role = 'owner' then
    raise exception 'not_authorized';
  end if;

  if p_role is distinct from 'cm' and p_role is distinct from 'operative' then
    raise exception 'not_authorized';
  end if;

  if not (
    (v_old_role = 'operative' and p_role = 'cm')
    or (v_old_role = 'cm' and p_role = 'operative')
  ) then
    raise exception 'not_authorized';
  end if;

  update public.people
  set role = p_role
  where id = v_person_id
    and role = v_old_role;

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'not_authorized';
  end if;

  insert into public.person_role_audit (company_id, actor_id, person_id, old_role, new_role)
  values (v_company_id, v_actor_id, v_person_id, v_old_role, p_role);
end;
$$;

comment on function public.set_person_role(uuid, text) is
  'Owner only. Changes operative to cm or cm to operative, never an owner or the caller, and writes person_role_audit. security definer, search_path empty.';

revoke all on function public.set_person_role(uuid, text) from public, anon;
grant execute on function public.set_person_role(uuid, text) to authenticated;

-- Runs as the user who issued the update. public.set_person_role is security
-- definer, so inside it current_user is the function owner. A signed-in
-- session, including service_role, is not that owner and is refused.
create or replace function private.protect_person_role()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_owner name;
begin
  if new.role is not distinct from old.role then
    return new;
  end if;

  select pg_catalog.pg_get_userbyid(p.proowner)
    into v_owner
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'set_person_role'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_person_id uuid, p_role text';

  if v_owner is null or current_user is distinct from v_owner then
    raise exception 'not_authorized';
  end if;

  return new;
end;
$$;

comment on function private.protect_person_role() is
  'Refuses a people.role change unless public.set_person_role is the writer.';

revoke all on function private.protect_person_role() from public, anon;
grant execute on function private.protect_person_role() to authenticated, service_role;

drop trigger if exists people_protect_role on public.people;
create trigger people_protect_role
  before update of role on public.people
  for each row execute function private.protect_person_role();
