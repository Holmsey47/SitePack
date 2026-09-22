-- Owner insert uses INSERT ... RETURNING. Postgres then applies the SELECT
-- policy in the same statement. can_access_site() reads public.sites and does
-- not see the row being inserted, so Create site failed with
-- "new row violates row-level security policy" even for the owner.
-- This policy uses the new row's own company_id.

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
