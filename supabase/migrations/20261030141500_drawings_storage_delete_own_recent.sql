-- Item 20. A refused drawing insert must not leave the PDF in the bucket.
-- The client uploads, then inserts. If the insert is refused it deletes that object.
-- Owners already delete company drawings through drawings_storage_delete.
-- This policy adds a second, narrower delete for the person who just uploaded:
-- their own object, in a site folder they can use, uploaded in the last 15 minutes.
-- It does not replace the owner policy. There is no storage delete-query bypass.
-- SECURITY: review this storage delete policy before it is applied.

drop policy if exists drawings_storage_delete_own_recent on storage.objects;

create policy drawings_storage_delete_own_recent
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'drawings'
    and private.is_cm_or_owner()
    and private.storage_company_id(name) = private.my_company_id()
    and private.can_access_site(private.storage_site_id(name))
    and private.site_is_active(private.storage_site_id(name))
    and (storage.foldername(name))[2] is not null
    and (storage.foldername(name))[3] is null
    and position('..' in name) = 0
    and position('//' in name) = 0
    and position(chr(92) in name) = 0
    and left(name, 1) <> '/'
    and created_at >= (now() - interval '15 minutes')
    and created_at <= (now() + interval '1 minute')
    and (
      (
        owner = (select auth.uid())
        and (owner_id is null or owner_id = (select auth.uid())::text)
      )
      or (
        owner is null
        and owner_id = (select auth.uid())::text
      )
    )
  );

comment on policy drawings_storage_delete_own_recent on storage.objects is
  'Uploader deletes their own drawing file in their site folder when it was uploaded in the last 15 minutes. Owners keep drawings_storage_delete.';
