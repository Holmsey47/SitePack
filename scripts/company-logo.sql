-- Company logo grants. Throwaway database only.
-- Apply migrations first, then:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/company-logo.sql

\set ON_ERROR_STOP on

begin;

create or replace function pg_temp.ok(cond boolean, message text)
returns void
language plpgsql
as $$
begin
  if coalesce(cond, false) then
    raise notice 'ok: %', message;
  else
    raise exception 'FAIL: %', message;
  end if;
end;
$$;

create or replace function pg_temp.jwt(p_sub uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', p_sub::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_sub::text, 'role', 'authenticated')::text,
    true
  );
end;
$$;

-- Local stand-in grants select and insert only. Hosted storage already grants update and delete.
grant update, delete on table storage.objects to authenticated;

select pg_temp.ok(
  (
    select public is false
      and file_size_limit = 1048576
      and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
    from storage.buckets
    where id = 'company-logos'
  ),
  'company-logos is private, 1 MiB, and jpeg png webp only'
);

select pg_temp.ok(
  (
    select count(*) = 4
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage'
      and c.relname = 'objects'
      and pol.polname in (
        'company_logos_select',
        'company_logos_insert',
        'company_logos_update',
        'company_logos_delete'
      )
      and pol.polroles = array[(select oid from pg_roles where rolname = 'authenticated')]
  ),
  'logo policies are authenticated only'
);

select pg_temp.ok(
  not exists (
    select 1
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage'
      and c.relname = 'objects'
      and pol.polname like 'company_logos_%'
      and (
        pol.polroles = array[(select oid from pg_roles where rolname = 'anon')]::oid[]
        or pol.polroles = '{}'::oid[]
      )
  ),
  'anon and public have no company logo policy'
);

do $$
declare
  v_company uuid := 'c1111111-1111-4111-8111-111111111111';
  v_other uuid := 'c2222222-2222-4222-8222-222222222222';
  v_owner uuid := 'a1111111-1111-4111-8111-111111111111';
  v_operative uuid := 'a1111111-1111-4111-8111-111111111113';
  v_other_owner uuid := 'a2222222-2222-4222-8222-222222222221';
  v_file text := 'd1111111-1111-4111-8111-111111111111';
  v_path text;
  v_count integer;
begin
  insert into auth.users (id, email) values
    (v_owner, 'owner-logo@example.com'),
    (v_operative, 'op-logo@example.com'),
    (v_other_owner, 'other-logo@example.com');

  insert into public.companies (id, name) values
    (v_company, 'Logo Co'),
    (v_other, 'Other Co');

  insert into public.people (id, auth_user_id, company_id, role, display_name, email) values
    (v_owner, v_owner, v_company, 'owner', 'Ada Owner', 'owner-logo@example.com'),
    (v_operative, v_operative, v_company, 'operative', 'Sam Op', 'op-logo@example.com'),
    (v_other_owner, v_other_owner, v_other, 'owner', 'Bea Other', 'other-logo@example.com');

  v_path := v_company::text || '/' || v_file || '.jpg';

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  update public.companies set logo_path = v_path where id = v_company;
  if (select logo_path from public.companies where id = v_company) is distinct from v_path then
    raise exception 'owner could not set logo_path';
  end if;

  begin
    update public.companies set name = 'Renamed' where id = v_company;
    raise exception 'owner renamed the company';
  exception
    when others then
      if sqlerrm is distinct from 'not_authorized' then
        raise;
      end if;
  end;

  begin
    update public.companies
    set logo_path = v_other::text || '/' || v_file || '.png'
    where id = v_company;
    raise exception 'logo path for another company was stored';
  exception
    when others then
      if sqlerrm is distinct from 'invalid_input' then
        raise;
      end if;
  end;

  insert into storage.objects (bucket_id, name)
  values ('company-logos', v_path);

  begin
    insert into storage.objects (bucket_id, name)
    values ('company-logos', v_other::text || '/' || v_file || '.jpg');
    raise exception 'owner stored a logo on another company';
  exception
    when others then
      if sqlerrm <> 'new row violates row-level security policy for table "objects"' then
        raise;
      end if;
  end;

  update storage.objects
  set metadata = '{"mimetype":"image/jpeg"}'::jsonb
  where bucket_id = 'company-logos' and name = v_path;
  if not found then
    raise exception 'owner could not update their logo object';
  end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_operative::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_operative::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  if (select count(*) from storage.objects where bucket_id = 'company-logos' and name = v_path) <> 1 then
    raise exception 'a member cannot read their company logo';
  end if;

  begin
    insert into storage.objects (bucket_id, name)
    values ('company-logos', v_company::text || '/e1111111-1111-4111-8111-111111111111.png');
    raise exception 'operative inserted a logo';
  exception
    when others then
      if sqlerrm <> 'new row violates row-level security policy for table "objects"' then
        raise;
      end if;
  end;

  delete from storage.objects where bucket_id = 'company-logos' and name = v_path;
  if (select count(*) from storage.objects where bucket_id = 'company-logos' and name = v_path) <> 1 then
    raise exception 'operative deleted a logo';
  end if;

  update public.companies set logo_path = null where id = v_company;
  if (select logo_path from public.companies where id = v_company) is distinct from v_path then
    raise exception 'operative changed logo_path';
  end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_other_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_other_owner::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into v_count from storage.objects where bucket_id = 'company-logos';
  if v_count <> 0 then
    raise exception 'another company can list this logo';
  end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  update public.companies set logo_path = null where id = v_company;
  if (select logo_path from public.companies where id = v_company) is not null then
    raise exception 'owner could not clear logo_path';
  end if;

  delete from storage.objects where bucket_id = 'company-logos' and name = v_path;
  if (select count(*) from storage.objects where name = v_path) <> 0 then
    raise exception 'owner could not delete their logo object';
  end if;
end;
$$;

select pg_temp.ok(true, 'owner sets logo_path, members can read, nobody else can list or write');

rollback;
