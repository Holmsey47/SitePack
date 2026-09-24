-- An operative can read only their own assignment row. The sent-request line still needs the
-- contracts manager's name. This returns those names for a site the caller can already open.

create or replace function public.site_contracts_manager_names(p_site_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
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

grant execute on function public.site_contracts_manager_names(uuid) to authenticated;
