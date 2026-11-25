-- =============================================================================
-- Estudio Jurídico Casoratti — 004: gestor integral de imágenes del panel.
--
-- El gestor de imágenes del panel trabaja sobre Supabase Storage (bucket
-- `site-media`), que es el único almacenamiento persistente real del proyecto
-- (el build de producción es estático, de sólo lectura y efímero).
--
-- Modelo de seguridad:
--   - `site_media` y `media_folders`: sólo los administradores (RLS + is_admin).
--   - `media_activity`: bitácora append-only. Nadie la actualiza ni la borra
--     (ni siquiera un administrador) y su autor real sale siempre de auth.uid().
--   - `resolve_media_overrides()`: la única puerta de lectura pública. El sitio
--     público resuelve sus imágenes contra ese mapa; `anon` no lee las tablas.
--   - El bucket `site-media` es público (es material del sitio público), pero
--     escribirlo exige sesión de administrador.
--
-- Idempotente: se puede reejecutar desde el dashboard sin romper nada.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Bucket público de medios del sitio
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-media', 'site-media', true, 10485760,
  array['image/jpeg','image/png','image/webp','image/avif','image/svg+xml'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. Tablas del gestor
--    `logical_path` es la clave estable de cada imagen (la que usa el sitio
--    público); `storage_path` es la ruta dentro del bucket `site-media`.
-- ---------------------------------------------------------------------------
create table if not exists public.site_media (
  id            uuid primary key default gen_random_uuid(),
  logical_path  text not null unique,
  storage_path  text,
  provider      text not null default 'supabase-storage',
  source        text not null default 'upload',   -- 'bundled' | 'upload' | 'override'
  original_name text not null,
  stored_name   text,
  mime_type     text not null,
  format        text not null,
  size_bytes    bigint not null default 0,
  width         integer,
  height        integer,
  alt_text      text,
  title         text,
  description   text,
  category      text,
  tags          text[] not null default '{}',
  status        text not null default 'active',   -- 'active' | 'trashed'
  checksum      text,
  created_by    uuid references auth.users(id) on delete set null,
  updated_by    uuid references auth.users(id) on delete set null,
  deleted_at    timestamptz,
  deleted_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint site_media_source_check  check (source in ('bundled','upload','override')),
  constraint site_media_status_check  check (status in ('active','trashed')),
  constraint site_media_format_check  check (format in ('jpg','jpeg','png','webp','avif','svg','gif'))
);

create table if not exists public.media_folders (
  id         uuid primary key default gen_random_uuid(),
  path       text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- Rutas relativas y seguras: sin espacios, sin mayúsculas y sin `..`
  -- (path traversal). El mismo criterio aplica en el cliente.
  constraint media_folders_path_check check (
    path ~ '^[a-z0-9][a-z0-9._/-]*$' and path !~ '(^|/)\.\.' and length(path) <= 120
  )
);

create table if not exists public.media_activity (
  id         uuid primary key default gen_random_uuid(),
  action     text not null,
  media_path text,
  actor_id   uuid references auth.users(id) on delete set null,
  result     text not null default 'success',
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. Índices — de acuerdo a los accesos reales del panel (filtro por estado,
--    búsqueda por ruta lógica y listados por fecha).
-- ---------------------------------------------------------------------------
create index if not exists idx_site_media_status        on public.site_media (status);
create index if not exists idx_site_media_logical_path  on public.site_media (logical_path);
create index if not exists idx_site_media_created_at    on public.site_media (created_at desc);
create index if not exists idx_media_activity_created   on public.media_activity (created_at desc);

-- ---------------------------------------------------------------------------
-- 4. updated_at automático (la función ya existe desde la migración 002)
-- ---------------------------------------------------------------------------
drop trigger if exists trg_site_media_updated_at on public.site_media;
create trigger trg_site_media_updated_at before update on public.site_media
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Funciones de servidor
-- ---------------------------------------------------------------------------

-- 5.1. Sanea el detalle de la bitácora: descarta toda clave que parezca una
--      credencial, para que una contraseña nunca quede registrada.
create or replace function public.scrub_media_detail(p_detail jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_out   jsonb := '{}'::jsonb;
  v_key   text;
  v_value jsonb;
begin
  if jsonb_typeof(p_detail) <> 'object' then
    return v_out;
  end if;

  for v_key, v_value in select * from jsonb_each(p_detail) loop
    -- Lista de claves que nunca se guardan (sin distinguir mayúsculas).
    if lower(v_key) = any (array[
         'password', 'new_password', 'current_password', 'secret', 'token', 'api_key'])
       or lower(v_key) like '%password%' then
      continue;
    end if;

    v_out := v_out || jsonb_build_object(
      v_key,
      case when jsonb_typeof(v_value) = 'object'
           then public.scrub_media_detail(v_value)
           else v_value end
    );
  end loop;

  return v_out;
end;
$$;

-- 5.2. Registro de actividad con autor no falsificable: `actor_id` sale de
--      auth.uid(), nunca de un parámetro del cliente.
create or replace function public.log_media_action(
  p_action     text,
  p_media_path text default null,
  p_result     text default 'success',
  p_detail     jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- La bitácora es una herramienta del panel: sólo un administrador deja
  -- registros. Un cliente o un usuario registrado no pueden escribir en ella.
  if not public.is_admin() then
    raise exception 'solo un administrador puede registrar operaciones de media'
      using errcode = '42501';
  end if;

  -- Lista blanca de acciones: el cliente no puede inventar tipos de operación.
  if coalesce(p_action = any (array[
       'upload', 'replace', 'edit', 'delete', 'restore', 'purge',
       'folder_create', 'metadata_update', 'password_change']), false) = false then
    raise exception 'accion de media no permitida: %', coalesce(p_action, '(null)')
      using errcode = '22023';
  end if;

  insert into public.media_activity (action, media_path, actor_id, result, detail)
  values (
    p_action,
    p_media_path,
    auth.uid(),
    coalesce(p_result, 'success'),
    public.scrub_media_detail(coalesce(p_detail, '{}'::jsonb))
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- 5.3. Mapa ruta lógica → ruta en Storage. Es la única puerta de lectura
--      pública de medios: sólo medios activos y con ruta de Storage.
create or replace function public.resolve_media_overrides()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_object_agg(m.logical_path, m.storage_path),
    '{}'::jsonb
  )
  from public.site_media m
  where m.status = 'active'
    and m.storage_path is not null;
$$;

-- ---------------------------------------------------------------------------
-- 6. RLS: el gestor es exclusivo de los administradores.
-- ---------------------------------------------------------------------------
alter table public.site_media     enable row level security;
alter table public.media_folders enable row level security;
alter table public.media_activity enable row level security;

-- 6.1. site_media
drop policy if exists site_media_admin_select on public.site_media;
create policy site_media_admin_select on public.site_media
  for select to authenticated
  using (public.is_admin());

drop policy if exists site_media_admin_insert on public.site_media;
create policy site_media_admin_insert on public.site_media
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists site_media_admin_update on public.site_media;
create policy site_media_admin_update on public.site_media
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists site_media_admin_delete on public.site_media;
create policy site_media_admin_delete on public.site_media
  for delete to authenticated
  using (public.is_admin());

-- 6.2. media_folders
drop policy if exists media_folders_admin_select on public.media_folders;
create policy media_folders_admin_select on public.media_folders
  for select to authenticated
  using (public.is_admin());

drop policy if exists media_folders_admin_insert on public.media_folders;
create policy media_folders_admin_insert on public.media_folders
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists media_folders_admin_update on public.media_folders;
create policy media_folders_admin_update on public.media_folders
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists media_folders_admin_delete on public.media_folders;
create policy media_folders_admin_delete on public.media_folders
  for delete to authenticated
  using (public.is_admin());

-- 6.3. media_activity — sólo lectura para el administrador. No hay policy de
--      INSERT (el alta pasa por log_media_action, que fija el autor real),
--      ni de UPDATE ni de DELETE: la bitácora es append-only.
drop policy if exists media_activity_admin_select on public.media_activity;
create policy media_activity_admin_select on public.media_activity
  for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 7. Policies sobre storage.objects para el bucket `site-media`.
--    El bucket es público (se sirve sin sesión), pero el escritura exige
--    sesión de administrador: sin policy de INSERT, `anon` recibe 403.
-- ---------------------------------------------------------------------------
drop policy if exists "site-media read admin" on storage.objects;
create policy "site-media read admin" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'site-media'
    and public.is_admin()
  );

drop policy if exists "site-media insert admin" on storage.objects;
create policy "site-media insert admin" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'site-media'
    and public.is_admin()
  );

drop policy if exists "site-media update admin" on storage.objects;
create policy "site-media update admin" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'site-media'
    and public.is_admin()
  )
  with check (
    bucket_id = 'site-media'
    and public.is_admin()
  );

drop policy if exists "site-media delete admin" on storage.objects;
create policy "site-media delete admin" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'site-media'
    and public.is_admin()
  );

-- ---------------------------------------------------------------------------
-- 8. Privilegios
--    Crear la tabla no alcanza: sin GRANT la API responde 42501 aunque las
--    policies RLS estén correctas.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on public.site_media     to authenticated, service_role;
grant select, insert, update, delete on public.media_folders to authenticated, service_role;
grant select, insert, update, delete on public.media_activity to authenticated, service_role;

-- El `alter default privileges` de la migración de privilegios concede
-- `select` a `anon` sobre toda tabla nueva: acá se revoca explícitamente.
-- `anon` no lee el inventario: sólo usa el RPC público de overrides.
revoke all on public.site_media     from anon;
revoke all on public.media_folders from anon;
revoke all on public.media_activity from anon;

-- El RPC público: el sitio resuelve sus imágenes contra este mapa.
grant execute on function public.resolve_media_overrides() to anon, authenticated, service_role;

-- La bitácora: anybody con sesión puede dejar un registro (el autor es el de
-- la sesión), pero sólo un administrador puede leerlo.
revoke all on function public.log_media_action(text, text, text, jsonb)
  from public, anon;
grant execute on function public.log_media_action(text, text, text, jsonb)
  to authenticated, service_role;

-- El saneo del detalle es interno: no se expone como RPC.
revoke all on function public.scrub_media_detail(jsonb) from public, anon;
grant execute on function public.scrub_media_detail(jsonb)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. Carpetas iniciales del gestor (idempotente)
-- ---------------------------------------------------------------------------
insert into public.media_folders (path)
values
  ('assets'),
  ('overrides'),
  ('images/institucional'),
  ('images/equipo'),
  ('images/servicios'),
  ('images/publicaciones'),
  ('images/general')
on conflict (path) do nothing;

-- PostgREST recarga su cache de esquema: sin esto el RPC publico
-- resolve_media_overrides no queda expuesto en la API.
notify pgrst, 'reload schema';
