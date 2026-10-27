-- A member who can open a site sees their own company's owner on that site's
-- People list, even when the owner is not assigned there.
-- The people row stays hidden. This exposes display name and role only.
-- No email, no phone, and nothing from another company.
-- The view is security invoker, so an authenticated member selects it with
-- their own rights. It reads private.company_owner_label(), which stays
-- security definer so it can see the owner row that people RLS hides.
-- Execute on that helper is for authenticated only. anon and public cannot
-- execute it. private is not an exposed Data API schema, so PostgREST does
-- not publish the function.
-- The function returns display name and role only. The app reads the view.

create or replace function private.company_owner_label()
returns table (display_name text, role text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.display_name, p.role
  from public.people p
  where p.company_id = private.my_company_id()
    and p.role = 'owner'
    and exists (
      select 1
      from public.sites s
      where s.company_id = p.company_id
        and private.can_access_site(s.id)
    )
  order by p.display_name nulls last, p.id
  limit 1;
$$;

comment on function private.company_owner_label() is
  'Display name and role of the caller''s own company owner, when the caller can open a site. No email or phone.';

revoke all on function private.company_owner_label() from public, anon;
grant execute on function private.company_owner_label() to authenticated;

create or replace view public.company_owner_label
with (security_invoker = true, security_barrier = true)
as
select display_name, role
from private.company_owner_label();

comment on view public.company_owner_label is
  'Security invoker. Display name and role of the caller''s own company owner, read through private.company_owner_label(). No other columns.';

revoke all on table public.company_owner_label from public, anon, authenticated;
grant select on table public.company_owner_label to authenticated;
