-- One-level floor folder on each drawing. Not part of sheet identity.
-- Existing rows land in Other. Do not edit the v0 migration.

alter table public.drawings
  add column folder text not null default 'Other';

comment on column public.drawings.folder is
  'One-level pack folder. Blank is stored as Other. Not part of (site, title, sheet_key).';

-- Known v0 seed rows, so a database that already ran seed.sql still smokes as two Oak folders.
update public.drawings
set folder = 'Ground floor'
where id in (
  '99999999-9999-9999-9999-999999999991',
  '99999999-9999-9999-9999-999999999992'
);

update public.drawings
set folder = 'First floor'
where id = '99999999-9999-9999-9999-999999999993';

drop function if exists public.replace_drawing(
  uuid, text, text, text, text, date, bigint, text, uuid, uuid
);

create or replace function public.replace_drawing(
  p_site_id uuid,
  p_title text,
  p_revision text,
  p_storage_path text,
  p_sheet_number text default null,
  p_dated date default null,
  p_file_size_bytes bigint default null,
  p_content_type text default 'application/pdf',
  p_replace_drawing_id uuid default null,
  p_id uuid default null,
  p_folder text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.drawings;
  v_new public.drawings;
  v_sheet_key text;
  v_action text;
  v_folder text;
begin
  if not private.is_cm_or_owner() or not private.can_access_site(p_site_id) then
    raise exception 'not_authorized';
  end if;

  if not exists (select 1 from public.sites s where s.id = p_site_id) then
    raise exception 'site_not_found';
  end if;

  if p_storage_path is null or length(trim(p_storage_path)) = 0 then
    raise exception 'storage_path_required';
  end if;

  if p_title is null or length(trim(p_title)) = 0 or p_revision is null or length(trim(p_revision)) = 0 then
    raise exception 'title_and_revision_required';
  end if;

  v_sheet_key := coalesce(nullif(trim(coalesce(p_sheet_number, '')), ''), '');

  if p_replace_drawing_id is not null then
    select * into v_old
    from public.drawings d
    where d.id = p_replace_drawing_id
      and d.site_id = p_site_id
    for update;

    if not found or v_old.is_current is not true then
      raise exception 'replace_target_not_current';
    end if;
  else
    select * into v_old
    from public.drawings d
    where d.site_id = p_site_id
      and d.title = trim(p_title)
      and d.sheet_key = v_sheet_key
      and d.is_current = true
    for update;
  end if;

  -- Null p_folder copies the previous current folder. Blank becomes Other.
  -- A sent name moves only the new current row. The superseded row keeps its folder.
  if p_folder is null then
    v_folder := coalesce(nullif(trim(coalesce(v_old.folder, '')), ''), 'Other');
  else
    v_folder := coalesce(nullif(trim(p_folder), ''), 'Other');
  end if;

  -- Flip old current first so the unique partial index never sees two currents.
  if v_old.id is not null then
    update public.drawings
    set is_current = false
    where id = v_old.id;
    v_action := 'replace';
  else
    v_action := 'upload';
  end if;

  insert into public.drawings (
    id,
    site_id,
    title,
    sheet_number,
    revision,
    dated,
    is_current,
    supersedes_id,
    storage_path,
    file_size_bytes,
    content_type,
    uploaded_by,
    folder
  ) values (
    coalesce(p_id, gen_random_uuid()),
    p_site_id,
    trim(p_title),
    nullif(trim(coalesce(p_sheet_number, '')), ''),
    trim(p_revision),
    p_dated,
    true,
    v_old.id,
    trim(p_storage_path),
    p_file_size_bytes,
    coalesce(nullif(trim(coalesce(p_content_type, '')), ''), 'application/pdf'),
    (select auth.uid()),
    v_folder
  )
  returning * into v_new;

  update public.sites
  set updated_at = now()
  where id = p_site_id;

  insert into public.drawing_audit (drawing_id, site_id, actor_id, action, revision)
  values (v_new.id, p_site_id, (select auth.uid()), v_action, v_new.revision);

  return to_jsonb(v_new);
end;
$$;

revoke all on function public.replace_drawing(
  uuid, text, text, text, text, date, bigint, text, uuid, uuid, text
) from public, anon;

grant execute on function public.replace_drawing(
  uuid, text, text, text, text, date, bigint, text, uuid, uuid, text
) to authenticated;
