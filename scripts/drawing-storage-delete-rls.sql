-- Own-recent drawing storage delete. Apply scripts/throwaway-auth.sql and every migration first.
-- The checks roll back. Nothing here is a hosted project.

\set ON_ERROR_STOP on
\set firmx 'c1111111-1111-4111-8111-111111111111'
\set cmx 'a1111111-1111-4111-8111-111111111112'
\set ownerx 'a1111111-1111-4111-8111-111111111111'
\set opx 'a1111111-1111-4111-8111-111111111113'
\set sitea '51111111-1111-4111-8111-111111111111'
\set siteb '51111111-1111-4111-8111-111111111112'

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

create or replace function pg_temp.try_delete(p_name text)
returns void
language plpgsql
as $$
begin
  delete from storage.objects where bucket_id = 'drawings' and name = p_name;
exception
  when others then
    return;
end;
$$;

insert into auth.users (id, email)
values
  (:'ownerx', 'ownerx@firmx.test'),
  (:'cmx', 'cmx@firmx.test'),
  (:'opx', 'opx@firmx.test');

insert into public.companies (id, name)
values (:'firmx', 'Firm X');

insert into public.people (id, auth_user_id, company_id, role, display_name, email)
values
  (:'ownerx', :'ownerx', :'firmx', 'owner', 'Owner X', 'ownerx@firmx.test'),
  (:'cmx', :'cmx', :'firmx', 'cm', 'CM X', 'cmx@firmx.test'),
  (:'opx', :'opx', :'firmx', 'operative', 'Op X', 'opx@firmx.test');

insert into public.sites (id, company_id, name)
values
  (:'sitea', :'firmx', 'Site A'),
  (:'siteb', :'firmx', 'Site B');

insert into public.site_assignments (site_id, person_id)
values
  (:'sitea', :'cmx'),
  (:'sitea', :'opx');

insert into storage.objects (bucket_id, name, owner, created_at)
values
  ('drawings', :'firmx' || '/' || :'sitea' || '/recent.pdf', :'cmx'::uuid, now()),
  ('drawings', :'firmx' || '/' || :'sitea' || '/old.pdf', :'cmx'::uuid, now() - interval '16 minutes'),
  ('drawings', :'firmx' || '/' || :'sitea' || '/theirs.pdf', :'ownerx'::uuid, now()),
  ('drawings', :'firmx' || '/' || :'sitea' || '/requests/photo.jpg', :'cmx'::uuid, now()),
  ('drawings', :'firmx' || '/' || :'siteb' || '/other-site.pdf', :'cmx'::uuid, now()),
  ('drawings', :'firmx' || '/' || :'sitea' || '/operative.pdf', :'opx'::uuid, now()),
  ('drawings', :'firmx' || '/' || :'sitea' || '/../secret.pdf', :'cmx'::uuid, now());

select pg_temp.ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'drawings_storage_delete'
  )
  and exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'drawings_storage_delete_own_recent'
  ),
  'the owner delete policy stays and the recent policy is added'
);

select pg_temp.jwt(:'cmx'::uuid);
set local role authenticated;
select pg_temp.try_delete(:'firmx' || '/' || :'sitea' || '/recent.pdf');
select pg_temp.try_delete(:'firmx' || '/' || :'sitea' || '/old.pdf');
select pg_temp.try_delete(:'firmx' || '/' || :'sitea' || '/theirs.pdf');
select pg_temp.try_delete(:'firmx' || '/' || :'sitea' || '/requests/photo.jpg');
select pg_temp.try_delete(:'firmx' || '/' || :'siteb' || '/other-site.pdf');
select pg_temp.try_delete(:'firmx' || '/' || :'sitea' || '/../secret.pdf');
reset role;

select pg_temp.ok(
  (select count(*) from storage.objects where name = :'firmx' || '/' || :'sitea' || '/recent.pdf') = 0,
  'a contracts manager deletes their own recent file in their site folder'
);
select pg_temp.ok(
  (select count(*) from storage.objects where name = :'firmx' || '/' || :'sitea' || '/old.pdf') = 1
  and (select count(*) from storage.objects where name = :'firmx' || '/' || :'sitea' || '/theirs.pdf') = 1
  and (select count(*) from storage.objects where name = :'firmx' || '/' || :'sitea' || '/requests/photo.jpg') = 1
  and (select count(*) from storage.objects where name = :'firmx' || '/' || :'siteb' || '/other-site.pdf') = 1
  and (select count(*) from storage.objects where name = :'firmx' || '/' || :'sitea' || '/../secret.pdf') = 1,
  'an old file, someone else''s file, a nested file, another site, and a dotted path stay'
);

select pg_temp.jwt(:'opx'::uuid);
set local role authenticated;
select pg_temp.try_delete(:'firmx' || '/' || :'sitea' || '/operative.pdf');
reset role;
select pg_temp.ok(
  (select count(*) from storage.objects where name = :'firmx' || '/' || :'sitea' || '/operative.pdf') = 1,
  'an operative cannot delete a drawing file'
);

select pg_temp.jwt(:'ownerx'::uuid);
set local role authenticated;
select pg_temp.try_delete(:'firmx' || '/' || :'sitea' || '/old.pdf');
reset role;
select pg_temp.ok(
  (select count(*) from storage.objects where name = :'firmx' || '/' || :'sitea' || '/old.pdf') = 0,
  'an owner can still delete an older company drawing'
);

set local role anon;
select pg_temp.try_delete(:'firmx' || '/' || :'sitea' || '/theirs.pdf');
reset role;
select pg_temp.ok(
  (select count(*) from storage.objects where name = :'firmx' || '/' || :'sitea' || '/theirs.pdf') = 1,
  'anon cannot delete a drawing file'
);

rollback;
