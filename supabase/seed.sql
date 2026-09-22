-- SitePack v0 smoke seed: one company, owner, CM, dryliner, labourer,
-- three sites, mixed assignments, current + superseded drawings, one Open request.
-- Passwords for every seed login: SitePack123!

create or replace function private.seed_auth_user(
  p_id uuid,
  p_email text,
  p_password text
)
returns void
language plpgsql
security definer
set search_path = auth, extensions, public
as $$
begin
  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    p_id,
    'authenticated',
    'authenticated',
    p_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    '{}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  )
  on conflict (id) do nothing;

  insert into auth.identities (
    id,
    user_id,
    identity_data,
    provider,
    provider_id,
    last_sign_in_at,
    created_at,
    updated_at
  )
  values (
    p_id,
    p_id,
    jsonb_build_object('sub', p_id::text, 'email', p_email, 'email_verified', true),
    'email',
    p_id::text,
    now(),
    now(),
    now()
  )
  on conflict do nothing;
end;
$$;

select private.seed_auth_user(
  '22222222-2222-2222-2222-222222222222',
  'owner@sitepack.test',
  'SitePack123!'
);
select private.seed_auth_user(
  '33333333-3333-3333-3333-333333333333',
  'cm@sitepack.test',
  'SitePack123!'
);
select private.seed_auth_user(
  '44444444-4444-4444-4444-444444444444',
  'amy@sitepack.test',
  'SitePack123!'
);
select private.seed_auth_user(
  '55555555-5555-5555-5555-555555555555',
  'ben@sitepack.test',
  'SitePack123!'
);

insert into public.companies (id, name)
values ('11111111-1111-1111-1111-111111111111', 'Ashfield Finishes')
on conflict (id) do nothing;

insert into public.people (id, company_id, role, trade, display_name, email, phone)
values
  (
    '22222222-2222-2222-2222-222222222222',
    '11111111-1111-1111-1111-111111111111',
    'owner',
    null,
    'Jordan Hale',
    'owner@sitepack.test',
    null
  ),
  (
    '33333333-3333-3333-3333-333333333333',
    '11111111-1111-1111-1111-111111111111',
    'cm',
    'contracts',
    'Priya Shah',
    'cm@sitepack.test',
    null
  ),
  (
    '44444444-4444-4444-4444-444444444444',
    '11111111-1111-1111-1111-111111111111',
    'operative',
    'dryliner',
    'Amy Keane',
    'amy@sitepack.test',
    null
  ),
  (
    '55555555-5555-5555-5555-555555555555',
    '11111111-1111-1111-1111-111111111111',
    'operative',
    'labourer',
    'Ben Torres',
    'ben@sitepack.test',
    null
  )
on conflict (id) do nothing;

insert into public.sites (id, company_id, name, address_line, created_at, updated_at)
values
  (
    '66666666-6666-6666-6666-666666666666',
    '11111111-1111-1111-1111-111111111111',
    'Plot 12 – Oak Estate',
    'Oak Estate, Phase 2',
    now() - interval '12 days',
    timestamptz '2026-09-17 18:02:00+00'
  ),
  (
    '77777777-7777-7777-7777-777777777777',
    '11111111-1111-1111-1111-111111111111',
    'Plot 4 – Riverside',
    'Riverside, Block B',
    now() - interval '20 days',
    now() - interval '20 days'
  ),
  (
    '88888888-8888-8888-8888-888888888888',
    '11111111-1111-1111-1111-111111111111',
    'Warehouse – North Yard',
    'North Yard compound',
    now() - interval '8 days',
    timestamptz '2026-09-12 09:00:00+00'
  )
on conflict (id) do nothing;

insert into public.site_assignments (id, site_id, person_id)
values
  -- Oak: CM, Amy (dryliner), Ben (labourer)
  ('aaaaaaaa-0001-0000-0000-000000000001', '66666666-6666-6666-6666-666666666666', '33333333-3333-3333-3333-333333333333'),
  ('aaaaaaaa-0001-0000-0000-000000000002', '66666666-6666-6666-6666-666666666666', '44444444-4444-4444-4444-444444444444'),
  ('aaaaaaaa-0001-0000-0000-000000000003', '66666666-6666-6666-6666-666666666666', '55555555-5555-5555-5555-555555555555'),
  -- Riverside: Amy only (operative sees this; CM does not)
  ('aaaaaaaa-0002-0000-0000-000000000001', '77777777-7777-7777-7777-777777777777', '44444444-4444-4444-4444-444444444444'),
  -- Warehouse: CM only (CM sees this; operatives do not)
  ('aaaaaaaa-0003-0000-0000-000000000001', '88888888-8888-8888-8888-888888888888', '33333333-3333-3333-3333-333333333333')
on conflict (site_id, person_id) do nothing;

-- Superseded first, then current (unique current index)
insert into public.drawings (
  id, site_id, title, sheet_number, revision, dated, folder, is_current, supersedes_id,
  storage_path, file_size_bytes, content_type, uploaded_by, created_at
)
values
  (
    '99999999-9999-9999-9999-999999999991',
    '66666666-6666-6666-6666-666666666666',
    'Ground Floor GA',
    'A-101',
    'B',
    date '2026-08-02',
    'Ground floor',
    false,
    null,
    '11111111-1111-1111-1111-111111111111/66666666-6666-6666-6666-666666666666/99999999-9999-9999-9999-999999999991.pdf',
    4200,
    'application/pdf',
    '33333333-3333-3333-3333-333333333333',
    timestamptz '2026-08-02 10:00:00+00'
  ),
  (
    '99999999-9999-9999-9999-999999999992',
    '66666666-6666-6666-6666-666666666666',
    'Ground Floor GA',
    'A-101',
    'C',
    date '2026-09-10',
    'Ground floor',
    true,
    '99999999-9999-9999-9999-999999999991',
    '11111111-1111-1111-1111-111111111111/66666666-6666-6666-6666-666666666666/99999999-9999-9999-9999-999999999992.pdf',
    4300,
    'application/pdf',
    '33333333-3333-3333-3333-333333333333',
    timestamptz '2026-09-10 14:20:00+00'
  ),
  (
    '99999999-9999-9999-9999-999999999993',
    '66666666-6666-6666-6666-666666666666',
    'First Floor GA',
    'A-102',
    'A',
    date '2026-09-04',
    'First floor',
    true,
    null,
    '11111111-1111-1111-1111-111111111111/66666666-6666-6666-6666-666666666666/99999999-9999-9999-9999-999999999993.pdf',
    4100,
    'application/pdf',
    '33333333-3333-3333-3333-333333333333',
    timestamptz '2026-09-04 11:00:00+00'
  ),
  (
    '99999999-9999-9999-9999-999999999994',
    '88888888-8888-8888-8888-888888888888',
    'Compound Layout',
    'Y-01',
    'A',
    date '2026-09-12',
    'Other',
    true,
    null,
    '11111111-1111-1111-1111-111111111111/88888888-8888-8888-8888-888888888888/99999999-9999-9999-9999-999999999994.pdf',
    3900,
    'application/pdf',
    '33333333-3333-3333-3333-333333333333',
    timestamptz '2026-09-12 09:00:00+00'
  )
on conflict (id) do nothing;

insert into public.drawing_audit (drawing_id, site_id, actor_id, action, revision, created_at)
values
  (
    '99999999-9999-9999-9999-999999999991',
    '66666666-6666-6666-6666-666666666666',
    '33333333-3333-3333-3333-333333333333',
    'upload',
    'B',
    timestamptz '2026-08-02 10:00:00+00'
  ),
  (
    '99999999-9999-9999-9999-999999999992',
    '66666666-6666-6666-6666-666666666666',
    '33333333-3333-3333-3333-333333333333',
    'replace',
    'C',
    timestamptz '2026-09-10 14:20:00+00'
  ),
  (
    '99999999-9999-9999-9999-999999999993',
    '66666666-6666-6666-6666-666666666666',
    '33333333-3333-3333-3333-333333333333',
    'upload',
    'A',
    timestamptz '2026-09-04 11:00:00+00'
  ),
  (
    '99999999-9999-9999-9999-999999999994',
    '88888888-8888-8888-8888-888888888888',
    '33333333-3333-3333-3333-333333333333',
    'upload',
    'A',
    timestamptz '2026-09-12 09:00:00+00'
  );

insert into public.drawing_requests (
  id, site_id, requester_id, body, sheet_hint, status, created_at
)
values (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '66666666-6666-6666-6666-666666666666',
  '44444444-4444-4444-4444-444444444444',
  'Need the ceiling setting-out for plot 12 kitchen. WhatsApp PDF was unreadable.',
  'A-101 soffit',
  'Open',
  now() - interval '6 hours'
)
on conflict (id) do nothing;

drop function if exists private.seed_auth_user(uuid, text, text);
