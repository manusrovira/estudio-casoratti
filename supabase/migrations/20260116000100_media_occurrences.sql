-- =============================================================================
-- Estudio Jurídico Casoratti — 005: inventario de apariciones de imágenes.
--
-- El gestor de imágenes administra **apariciones**: cada lugar del sitio donde
-- se usa una imagen es un registro independiente, editable por separado. Los
-- archivos físicos siguen siendo un concepto aparte (la "biblioteca de
-- archivos") y conviven con las apariciones en la misma tabla.
--
-- Cómo se distinguen:
--   - `occurrence_id IS NULL` → la fila es un **archivo físico** (biblioteca).
--   - `occurrence_id NOT NULL` → la fila es una **aparición** del sitio.
--
-- Estado nuevo: `hidden` (aparición sin imagen en el sitio). Antes el estado
-- sólo podía ser `active` o `trashed`.
--
-- El RPC público `resolve_media_overrides()` cambia su forma de retorno: pasa
-- de un mapa plano `{ ruta lógica → ruta en el bucket }` a un objeto con tres
-- secciones, para que el sitio pueda resolver por aparición y por archivo sin
-- adivinar a cuál de los dos pertenece una clave.
--
-- Idempotente: se puede reejecutar desde el dashboard sin romper nada.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columna de aparición
--    Nula = archivo físico. Con valor = aparición concreta del sitio.
-- ---------------------------------------------------------------------------
alter table public.site_media
  add column if not exists occurrence_id text;

-- ---------------------------------------------------------------------------
-- 2. Estado `hidden`: la aparición se quitó del sitio.
--    Se rehace el check (drop + add) para admitir el valor nuevo sin tocar las
--    filas existentes: la migración es reejecutable.
-- ---------------------------------------------------------------------------
alter table public.site_media
  drop constraint if exists site_media_status_check;

alter table public.site_media
  add constraint site_media_status_check
  check (status in ('active','trashed','hidden'));

-- ---------------------------------------------------------------------------
-- 3. Una aparición por identificador
--    Dos apariciones distintas pueden usar el mismo archivo físico, pero un
--    mismo `occurrence_id` no puede repetirse: el índice único parcial impide
--    que el panel registre dos veces el mismo lugar del sitio.
-- ---------------------------------------------------------------------------
create unique index if not exists site_media_occurrence_unique
  on public.site_media (occurrence_id)
  where occurrence_id is not null;

-- ---------------------------------------------------------------------------
-- 4. RPC público: resolución de imágenes
--    Devuelve tres secciones:
--      - `occurrences`: reemplazo de una aparición (id → ruta en el bucket).
--      - `files`:       reemplazo del archivo físico (ruta lógica → ruta).
--      - `hidden`:      apariciones sin imagen en el sitio (lista de ids).
--    Sólo entran los medios activos con ruta de Storage; `anon` no lee las
--    tablas: usa este RPC.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_media_overrides()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    -- Apariciones con imagen: se resuelven por `occurrence_id`.
    'occurrences', coalesce((
      select jsonb_object_agg(m.occurrence_id, m.storage_path)
      from public.site_media m
      where m.occurrence_id is not null
        and m.status = 'active'
        and m.storage_path is not null
    ), '{}'::jsonb),
    -- Archivos físicos (sin aparición): se resuelven por `logical_path`.
    'files', coalesce((
      select jsonb_object_agg(m.logical_path, m.storage_path)
      from public.site_media m
      where m.occurrence_id is null
        and m.status = 'active'
        and m.storage_path is not null
    ), '{}'::jsonb),
    -- Apariciones ocultas: el sitio las muestra sin imagen.
    'hidden', coalesce((
      select jsonb_agg(m.occurrence_id order by m.occurrence_id)
      from public.site_media m
      where m.occurrence_id is not null
        and m.status = 'hidden'
    ), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------
-- 5. Privilegios
--    El RPC sigue siendo la única puerta de lectura pública. `create or
--    replace` conserva los permisos, pero se reaffirman para que la migración
--    sea idempotente y explícita.
-- ---------------------------------------------------------------------------
revoke all on function public.resolve_media_overrides() from public;
grant execute on function public.resolve_media_overrides()
  to anon, authenticated, service_role;

-- `anon` no lee el inventario: sólo usa el RPC público de overrides.
revoke all on public.site_media from anon;

-- ---------------------------------------------------------------------------
-- 6. PostgREST recarga su cache de esquema: sin esto el RPC público no queda
--    expuesto en la API con su nueva forma de retorno.
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';
