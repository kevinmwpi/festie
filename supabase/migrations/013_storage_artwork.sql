-- 013_storage_artwork.sql
--
-- Artwork storage (docs/v1-architecture.md §9.8): the artist and festival
-- images that admin-tools uploads together with their credit (012). Every
-- storage.* statement lives here, isolated like 008, so a hosted permission
-- quirk cannot roll back 012. Idempotent.
--
-- Object path: artists/<uuid>.<ext> or festivals/<uuid>.<ext>. The bucket is
-- public: clients load an image by the public URL stored in artists.image_url
-- / festivals.image_url. Only admin-tools (service role, bypasses RLS) writes
-- objects; the restrictive policies below keep anon and authenticated from
-- ever inserting, updating or deleting artwork objects, whatever permissive
-- (e.g. dashboard-made) policies exist on storage.objects.
-- Never alter storage tables, create storage functions or delete storage rows
-- from SQL migrations (CI greps for it); objects are removed through the
-- Storage API.

-- Public bucket, 2 MiB, JPEG / PNG / WebP.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('artwork', 'artwork', true, 2097152, '{image/jpeg,image/png,image/webp}')
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Drop anything (dashboard-made policies, earlier runs of this migration) that
-- targets the artwork bucket.
do $$
declare
  r record;
begin
  for r in
    select p.policyname
    from pg_policies p
    where p.schemaname = 'storage'
      and p.tablename = 'objects'
      and (
        coalesce(p.qual, '') ilike '%artwork%'
        or coalesce(p.with_check, '') ilike '%artwork%'
        or p.policyname ilike '%artwork%'
      )
  loop
    execute format('drop policy if exists %I on storage.objects', r.policyname);
  end loop;
end
$$;

-- Anyone can read artwork objects (the bucket is public anyway).
create policy artwork_select_public on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'artwork');

-- Restrictive guards: a client role can never write an artwork object, even
-- if a permissive policy elsewhere would allow it. The service role bypasses
-- RLS, so admin-tools is unaffected.
create policy artwork_no_client_insert on storage.objects
  as restrictive
  for insert
  to public
  with check (bucket_id <> 'artwork');

create policy artwork_no_client_update on storage.objects
  as restrictive
  for update
  to public
  using (bucket_id <> 'artwork');

create policy artwork_no_client_delete on storage.objects
  as restrictive
  for delete
  to public
  using (bucket_id <> 'artwork');
