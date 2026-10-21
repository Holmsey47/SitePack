-- Optional free-text level on each drawing. Not part of sheet identity.
-- Timestamp is after 20261021163528 so this applies after that security migration.
-- Does not change who can read or write a drawing. Null is a blank level.

alter table public.drawings
  add column if not exists level text;

comment on column public.drawings.level is
  'Optional free-text level tag. Null means blank. Not part of (site, title, sheet_key).';

alter table public.drawings drop constraint if exists drawings_level_len;
alter table public.drawings add constraint drawings_level_len check (level is null or char_length(level) <= 40);

alter table public.drawings drop constraint if exists drawings_folder_len;
alter table public.drawings add constraint drawings_folder_len check (folder is null or char_length(folder) <= 40);

drop function if exists public.replace_drawing(
  uuid, text, text, text, text, date, bigint, text, uuid, uuid, text
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
  p_folder text default null,
  p_level text default null
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
  v_level text;
  v_actor uuid;
begin
  if not private.is_cm_or_owner() or not private.can_access_site(p_site_id) then
    raise exception 'not_authorized';
  end if;

  v_actor := (
    select p.id from public.people p where p.auth_user_id = (select auth.uid())
  );
  if v_actor is null then
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

  -- Null p_level copies the previous current level. Blank is stored as null.
  -- A sent value is trimmed onto the new current row only. The superseded row keeps its level.
  if p_level is null then
    v_level := nullif(trim(coalesce(v_old.level, '')), '');
  else
    v_level := nullif(trim(p_level), '');
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
    folder,
    level
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
    v_actor,
    v_folder,
    v_level
  )
  returning * into v_new;

  update public.sites
  set updated_at = now()
  where id = p_site_id;

  insert into public.drawing_audit (drawing_id, site_id, actor_id, action, revision)
  values (v_new.id, p_site_id, v_actor, v_action, v_new.revision);

  return to_jsonb(v_new);
end;
$$;

revoke all on function public.replace_drawing(
  uuid, text, text, text, text, date, bigint, text, uuid, uuid, text, text
) from public, anon;

grant execute on function public.replace_drawing(
  uuid, text, text, text, text, date, bigint, text, uuid, uuid, text, text
) to authenticated;

-- Current sheets only. Level is display text on the offline pack. Access is unchanged.
create or replace function public.site_pack_manifest(p_site_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.sites s where s.id = p_site_id) then
    raise exception 'site_not_found';
  end if;
  if not private.can_access_site(p_site_id) then
    raise exception 'not_authorized';
  end if;

  return coalesce(
    (
      select jsonb_agg(item order by item->>'title', item->>'sheet_number')
      from (
        select jsonb_build_object(
          'drawing_id', d.id,
          'title', d.title,
          'sheet_number', d.sheet_number,
          'revision', d.revision,
          'dated', d.dated,
          'file_size_bytes', d.file_size_bytes,
          'content_type', d.content_type,
          'storage_path', d.storage_path,
          'level', d.level
        ) as item
        from public.drawings d
        where d.site_id = p_site_id
          and d.is_current = true
        order by d.title, d.sheet_number nulls last
      ) q
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.site_pack_manifest(uuid) from public, anon;

grant execute on function public.site_pack_manifest(uuid) to authenticated;
