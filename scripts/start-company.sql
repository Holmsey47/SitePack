-- Grants and behaviour for owner start. Throwaway database only.
-- Apply migrations first, then:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/start-company.sql

\set ON_ERROR_STOP on

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

select pg_temp.ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral unnest(coalesce(p.proconfig, array[]::text[])) cfg
    where n.nspname = 'public'
      and p.proname = 'bootstrap_owner'
      and p.prosecdef
      and cfg like 'search_path=%'
  )
  and exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral unnest(coalesce(p.proconfig, array[]::text[])) cfg
    where n.nspname = 'public'
      and p.proname = 'claim_start_company'
      and p.prosecdef
      and cfg like 'search_path=%'
  ),
  'bootstrap_owner and claim_start_company are security definer with search_path set'
);

select pg_temp.ok(
  not has_function_privilege('public', 'public.bootstrap_owner(uuid, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.bootstrap_owner(uuid, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.bootstrap_owner(uuid, text, text)', 'execute')
  and has_function_privilege('service_role', 'public.bootstrap_owner(uuid, text, text)', 'execute')
  and not has_function_privilege('public', 'public.claim_start_company(text, text)', 'execute')
  and not has_function_privilege('anon', 'public.claim_start_company(text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.claim_start_company(text, text)', 'execute')
  and has_function_privilege('service_role', 'public.claim_start_company(text, text)', 'execute'),
  'only service_role can execute owner start'
);

select pg_temp.ok(
  not exists (
    select 1
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'companies'
      and pol.polname = 'companies_insert_owner'
  )
  and not exists (
    select 1
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'companies'
      and pol.polcmd = 'a'
  ),
  'companies_insert_owner is gone and companies have no insert policy'
);

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_other uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_taken uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  v_email text := repeat('ab', 32);
  v_email_b text := repeat('cd', 32);
  v_ip text := repeat('ef', 32);
  v_ip_b text := repeat('12', 32);
  v_ip_fresh text := repeat('46', 32);
  v_row jsonb;
  v_company uuid;
  i integer;
begin
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);

  begin
    perform public.bootstrap_owner(v_owner, 'Acme', 'Ada');
    raise exception 'authenticated bootstrap was allowed';
  exception
    when others then
      if sqlerrm is distinct from 'not_authorized' then
        raise;
      end if;
  end;

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  insert into auth.users (id, email) values
    (v_owner, 'Owner@Example.com'),
    (v_other, 'second@example.com'),
    (v_taken, 'taken@example.com');

  insert into public.companies (id, name)
  values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Existing Co');
  insert into public.people (id, auth_user_id, company_id, role, display_name, email)
  values (
    v_taken,
    v_taken,
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'operative',
    'Taken Person',
    'taken@example.com'
  );

  begin
    perform public.bootstrap_owner(v_owner, '   ', 'Ada');
    raise exception 'blank company was allowed';
  exception
    when others then
      if sqlerrm is distinct from 'invalid_input' then
        raise;
      end if;
  end;

  begin
    perform public.bootstrap_owner(v_owner, repeat('A', 81), 'Ada');
    raise exception 'long company was allowed';
  exception
    when others then
      if sqlerrm is distinct from 'invalid_input' then
        raise;
      end if;
  end;

  begin
    perform public.bootstrap_owner(v_owner, 'Acme', repeat('B', 81));
    raise exception 'long name was allowed';
  exception
    when others then
      if sqlerrm is distinct from 'invalid_input' then
        raise;
      end if;
  end;

  v_row := public.bootstrap_owner(v_owner, '  Acme Drylining  ', '  Ada Owner  ');
  if v_row->>'ok' is distinct from 'true' then
    raise exception 'bootstrap did not succeed';
  end if;

  if not exists (
    select 1
    from public.companies c
    join public.people p on p.company_id = c.id
    where p.id = v_owner
      and p.auth_user_id = v_owner
      and p.role = 'owner'
      and p.display_name = 'Ada Owner'
      and p.email = 'owner@example.com'
      and c.name = 'Acme Drylining'
  ) then
    raise exception 'owner row does not match the bootstrap shape';
  end if;

  if not exists (
    select 1
    from public.join_audit a
    where a.actor_id = v_owner
      and a.action = 'owner_start'
      and a.detail = '{}'::jsonb
      and a.detail::text not like '%example.com%'
  ) then
    raise exception 'owner_start audit row is missing';
  end if;

  begin
    perform public.bootstrap_owner(v_owner, 'Second Co', 'Ada Owner');
    raise exception 'second company for the same user was allowed';
  exception
    when others then
      if sqlerrm is distinct from 'already_has_person' then
        raise;
      end if;
  end;

  begin
    perform public.bootstrap_owner(v_taken, 'Taken Co', 'Taken Person');
    raise exception 'existing people row was allowed to start a company';
  exception
    when others then
      if sqlerrm is distinct from 'already_has_person' then
        raise;
      end if;
  end;

  v_row := public.bootstrap_owner(v_other, 'Second Drylining', 'Bea Owner');
  if v_row->>'ok' is distinct from 'true' then
    raise exception 'a different new owner was rejected';
  end if;

  select count(*) into i from public.companies where name in ('Acme Drylining', 'Second Drylining');
  if i <> 2 then
    raise exception 'expected one company per new owner';
  end if;

  for i in 1..3 loop
    v_row := public.claim_start_company(v_ip, v_email);
    if v_row->>'ok' is distinct from 'true' then
      raise exception 'email hash attempt % was limited too soon', i;
    end if;
  end loop;
  v_row := public.claim_start_company(v_ip_b, v_email);
  if v_row->>'error' is distinct from 'rate_limited' then
    raise exception 'email hash was not limited';
  end if;

  for i in 1..8 loop
    v_row := public.claim_start_company(v_ip_fresh, repeat(i::text, 64));
    if v_row->>'ok' is distinct from 'true' then
      raise exception 'ip hash attempt % was limited too soon', i;
    end if;
  end loop;
  v_row := public.claim_start_company(v_ip_fresh, repeat('9', 64));
  if v_row->>'error' is distinct from 'rate_limited' then
    raise exception 'ip hash was not limited';
  end if;

  v_row := public.claim_start_company(null, v_email_b);
  if v_row->>'ok' is distinct from 'true' then
    raise exception 'unknown ip was rejected';
  end if;

  select id into v_company from public.companies where name = 'Acme Drylining';
  if v_company is null then
    raise exception 'company missing after limits';
  end if;
end;
$$;

select pg_temp.ok(true, 'owner start grants, one company per user, and hash limits');
