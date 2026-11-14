-- =============================================================================
-- Estudio Jurídico Casoratti — 004: Supabase Storage (buckets privados).
-- Los binarios nunca son públicos: se sirven con URLs firmadas y con
-- vencimiento, y las policieseglue el mismo modelo de permisos que las tablas.
-- Convención de paths:
--   client-documents/{client_id}/{archivo}
--   case-documents/{case_id}/{archivo}
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('client-documents', 'client-documents', false, 26214400,
   array['application/pdf', 'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  ('case-documents', 'case-documents', false, 26214400,
   array['application/pdf', 'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Helpers de carpeta (SECURITY DEFINER: consultan clients/legal_cases sin
-- quedar atrapados en las policies RLS de esas tablas).
-- ---------------------------------------------------------------------------
create or replace function public.can_access_client_folder(p_folder text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.is_admin()
    or exists (
      select 1 from public.clients c
      where c.id::text = p_folder
        and (c.assigned_lawyer_id = public.current_lawyer_id() or c.user_id = auth.uid())
    )
  , false);
$$;

create or replace function public.can_access_case_folder(p_folder text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.is_admin()
    or exists (
      select 1 from public.legal_cases lc
      join public.clients c on c.id = lc.client_id
      where lc.id::text = p_folder
        and (lc.assigned_lawyer_id = public.current_lawyer_id() or c.user_id = auth.uid())
    )
  , false);
$$;

-- ---------------------------------------------------------------------------
-- Policies sobre storage.objects
-- ---------------------------------------------------------------------------
drop policy if exists "client-documents read scoped" on storage.objects;
create policy "client-documents read scoped" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'client-documents'
    and public.can_access_client_folder((storage.foldername(name))[1])
  );

drop policy if exists "client-documents write admin" on storage.objects;
create policy "client-documents write admin" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'client-documents'
    and public.can_access_client_folder((storage.foldername(name))[1])
  );

drop policy if exists "client-documents delete admin" on storage.objects;
create policy "client-documents delete admin" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'client-documents'
    and public.is_admin()
  );

drop policy if exists "case-documents read scoped" on storage.objects;
create policy "case-documents read scoped" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'case-documents'
    and public.can_access_case_folder((storage.foldername(name))[1])
  );

drop policy if exists "case-documents write admin" on storage.objects;
create policy "case-documents write admin" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'case-documents'
    and public.can_access_case_folder((storage.foldername(name))[1])
  );

drop policy if exists "case-documents delete admin" on storage.objects;
create policy "case-documents delete admin" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'case-documents'
    and public.is_admin()
  );
