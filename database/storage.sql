-- =============================================================================
-- Supabase Storage: buckets + policies
-- Size and MIME limits are enforced by Storage itself, not only the browser.
-- SVG is intentionally NOT allowed (it can carry script).
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('media',          'media',          true,  5242880,  array['image/png','image/jpeg','image/webp','image/avif','image/gif']),
  ('certificates',   'certificates',   true,  10485760, array['image/png','image/jpeg','image/webp','application/pdf']),
  ('resumes',        'resumes',        false, 10485760, array['application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "cms admin read"   on storage.objects;
drop policy if exists "cms admin insert" on storage.objects;
drop policy if exists "cms admin update" on storage.objects;
drop policy if exists "cms admin delete" on storage.objects;

-- Public buckets are readable through their public URL without a policy.
-- Listing / signed URLs / writes require an administrator.
create policy "cms admin read" on storage.objects for select to authenticated
  using (bucket_id in ('media', 'certificates', 'resumes') and public.is_admin());

create policy "cms admin insert" on storage.objects for insert to authenticated
  with check (bucket_id in ('media', 'certificates', 'resumes') and public.is_admin()
              and name ~ '^[a-z0-9][a-z0-9/_\.-]*$' and name !~ '\.\.');

create policy "cms admin update" on storage.objects for update to authenticated
  using (bucket_id in ('media', 'certificates', 'resumes') and public.is_admin())
  with check (bucket_id in ('media', 'certificates', 'resumes') and public.is_admin());

create policy "cms admin delete" on storage.objects for delete to authenticated
  using (bucket_id in ('media', 'certificates', 'resumes') and public.is_admin());
