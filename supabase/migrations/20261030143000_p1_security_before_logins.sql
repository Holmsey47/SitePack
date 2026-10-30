-- P1 security before lads get logins (0.2.12).
-- Additive. Do not apply this file to a hosted project from the app or CI.
--
-- 3a. site_contracts_manager_names cannot be called signed out.
--     Execute is revoked from anon and public. The body requires auth.uid()
--     and site access.
-- 3b. The five functions the security advisor flags for a mutable search_path
--     are pinned to empty and schema-qualified:
--       private.try_uuid(text)
--       private.touch_updated_at()
--       private.storage_site_id(text)
--       private.storage_company_id(text)
--       private.guard_site_archive()
-- 76. private.shares_assigned_site ignores sites with archived_at set.
--     A member of an archived site no longer lists co-workers through people.
--     The owner policy does not use this function, so the owner keeps that view.

-- ---------------------------------------------------------------------------
-- 76. Shared-site check. An archived site does not count.
-- ---------------------------------------------------------------------------

create or replace function private.shares_assigned_site(p_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.site_assignments mine
    join public.site_assignments theirs on theirs.site_id = mine.site_id
    join public.sites s on s.id = mine.site_id
    where mine.person_id = (
      select p.id
      from public.people p
      where p.auth_user_id = (select auth.uid())
    )
      and theirs.person_id = p_person_id
      and s.archived_at is null
  );
$$;

comment on function private.shares_assigned_site(uuid) is
  'True when the caller and the person share an assignment on a site whose archived_at is null.';

revoke all on function private.shares_assigned_site(uuid) from public, anon;
grant execute on function private.shares_assigned_site(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3a. Contracts-manager names. Signed-out callers have no auth.uid().
-- Site access stays private.can_access_site, which already hides archived
-- sites from members and other companies.
-- ---------------------------------------------------------------------------

create or replace function public.site_contracts_manager_names(p_site_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not_authorized';
  end if;
  if not private.can_access_site(p_site_id) then
    raise exception 'not_authorized';
  end if;
  return coalesce(
    (
      select jsonb_agg(sub.display_name order by sub.display_name)
      from (
        select coalesce(nullif(btrim(p.display_name), ''), 'Unknown') as display_name
        from public.site_assignments a
        join public.people p on p.id = a.person_id
        where a.site_id = p_site_id
          and p.role = 'cm'
      ) sub
    ),
    '[]'::jsonb
  );
end;
$$;

comment on function public.site_contracts_manager_names(uuid) is
  'Contracts manager display names for a site the caller can open. Requires auth.uid(). Signed-out callers are refused.';

revoke all on function public.site_contracts_manager_names(uuid) from public, anon;
grant execute on function public.site_contracts_manager_names(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3b. Pin search_path to empty and schema-qualify the five advisor functions.
-- pg_catalog is named explicitly because the search path is empty.
-- ---------------------------------------------------------------------------

create or replace function private.try_uuid(p_text text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_text is null or pg_catalog.length(pg_catalog.btrim(p_text)) = 0 then
    return null;
  end if;
  return pg_catalog.btrim(p_text)::pg_catalog.uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

create or replace function private.storage_site_id(p_name text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select private.try_uuid((storage.foldername(p_name))[2]);
$$;

create or replace function private.storage_company_id(p_name text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select private.try_uuid((storage.foldername(p_name))[1]);
$$;

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
