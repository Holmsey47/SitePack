-- Owner self-sign-up. The edge function invites, then this function creates the company.
-- Public signup in config stays off. Only service_role can execute these functions.
-- Company name and full name are trimmed and must be 1–80 characters.
-- One people row per auth user: a second call does not open a second company for that login.
-- The people row matches ownerBootstrapSql: id and auth_user_id are the auth user, role is owner.
-- Email is read from auth.users, not from the caller.
-- Rate limits reuse join_rate_limits. Subjects are hashes. Unknown IPs are not an IP bucket.

alter table public.join_audit drop constraint if exists join_audit_action;
alter table public.join_audit
  add constraint join_audit_action check (
    action in (
      'code_create',
      'code_revoke',
      'cap_change',
      'join',
      'attempt',
      'remove',
      'reset_issue',
      'reset_redeem',
      'reset_release',
      'owner_start'
    )
  );

create or replace function public.claim_start_company(p_ip_hash text, p_email_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ip text := nullif(lower(btrim(coalesce(p_ip_hash, ''))), '');
  v_email text := lower(btrim(coalesce(p_email_hash, '')));
begin
  perform private.reject_unless_service();

  if v_email !~ '^[0-9a-f]{64}$' or (v_ip is not null and v_ip !~ '^[0-9a-f]{64}$') then
    raise exception 'invalid_input';
  end if;

  -- 3 per email hash per hour. 8 per known IP hash per hour.
  if private.subject_limited('start_email', v_email, interval '1 hour', 3)
     or (
       v_ip is not null
       and private.subject_limited('start_ip', v_ip, interval '1 hour', 8)
     ) then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  perform private.record_join_failure('start_email', v_email);
  if v_ip is not null then
    perform private.record_join_failure('start_ip', v_ip);
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.bootstrap_owner(
  p_user_id uuid,
  p_company_name text,
  p_full_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company text := btrim(coalesce(p_company_name, ''));
  v_name text := btrim(coalesce(p_full_name, ''));
  v_email text;
  v_company_id uuid;
begin
  perform private.reject_unless_service();

  if p_user_id is null
     or char_length(v_company) < 1
     or char_length(v_company) > 80
     or char_length(v_name) < 1
     or char_length(v_name) > 80 then
    raise exception 'invalid_input';
  end if;

  select lower(btrim(u.email))
  into v_email
  from auth.users u
  where u.id = p_user_id
  for update;

  if v_email is null or v_email = '' or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'invalid_input';
  end if;

  if exists (
    select 1
    from public.people p
    where p.auth_user_id = p_user_id
       or p.id = p_user_id
  ) then
    raise exception 'already_has_person';
  end if;

  insert into public.companies (name)
  values (v_company)
  returning id into v_company_id;

  insert into public.people (id, auth_user_id, company_id, role, display_name, email)
  values (p_user_id, p_user_id, v_company_id, 'owner', v_name, v_email);

  insert into public.join_audit (company_id, site_id, actor_id, action, detail)
  values (v_company_id, null, p_user_id, 'owner_start', '{}'::jsonb);

  return jsonb_build_object('ok', true, 'company_id', v_company_id);
exception
  when unique_violation then
    raise exception 'already_has_person';
end;
$$;

revoke all on function public.claim_start_company(text, text) from public, anon, authenticated;
revoke all on function public.bootstrap_owner(uuid, text, text) from public, anon, authenticated;

grant execute on function public.claim_start_company(text, text) to service_role;
grant execute on function public.bootstrap_owner(uuid, text, text) to service_role;

-- Nothing in the app inserts a company. The client only selects the name.
-- Authenticated insert is denied once this policy is gone.
drop policy if exists companies_insert_owner on public.companies;

comment on function public.claim_start_company(text, text) is
  'Service role only. Counts one start attempt against the email hash and, when present, the IP hash. 3 and 8 per hour. Unknown IPs are not an IP bucket.';

comment on function public.bootstrap_owner(uuid, text, text) is
  'Service role only. One new company and one owner people row for an auth user who has no people row. Email comes from auth.users.';
