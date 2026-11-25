# Especificación — Módulos «Seguridad» e «Imágenes» del panel del Estudio Casoratti

> Documento normative. Todo el equipo (personas y agentes) implementa contra este
> contrato. Si el código y este documento discrepan, el documento manda: se
> actualiza primero el documento y después el código.

Fecha: 2026-11-25 · Proyecto: `manusrovira/estudio-casoratti` · Rama: `main`

---

## 0. Contexto técnico (hechos verificados, no supuestos)

| Hecho | Valor |
|---|---|
| Stack | React 19 + Vite 7 + TypeScript 5.9 + Tailwind 4 + `wouter` + `@supabase/supabase-js` 2.119 |
| UI del panel | `client/src/pages/admin/*` + CSS propio en `client/src/styles/admin*.css` |
| Autenticación | Supabase Auth (GoTrue). `client/src/contexts/AuthContext.tsx` expone `user`, `role`, `updatePassword`, `signOut`, `signInWithEmail` |
| Roles | `public.user_roles` (`admin`, `abogado`, `cliente`, `usuario`). Helper `public.is_admin()` (SECURITY DEFINER). El rol **nunca** se decide en el frontend |
| Backend | Supabase Postgres (proyecto `tdlmritilgtwnxbxkrze`). RLS siempre activo. `service_role` jamás en el frontend |
| Despliegue | **Vercel, build estático**: `npm run build:static` → `vite build` → `dist/public`. `vercel.json` sirve `dist/public` con rewrite de SPA a `index.html` |
| Consecuencia crítica | El sistema de archivos de producción es **de sólo lectura y efímero**. No se puede escribir una imagen en `client/src/assets/` desde el panel ni desde la Edge Function |
| Imágenes actuales | 8 archivos reales en `client/src/assets/`, importados desde TypeScript (`import x from "@/assets/..."`) y compilados por Vite con nombre hasheado |
| Storage existente | Buckets privados `client-documents` y `case-documents` (25 MB, MIMErestricted). URLs firmadas de 60 s |
| Migraciones | `supabase/migrations/*.sql`, aplicadas en orden lexicográfico. El harness de pruebas (`supabase/tests/harness.ts`) las aplica todas sobre PGlite |
| Pruebas | `vitest run` — `include`: `server/**`, `supabase/**`, `client/**/*.test.ts`. `environment: node` |

### 0.1 Consecuencia de diseño: dónde viven las imágenes administradas

Como producción es un sitio estático de sólo lectura, **el gestor de imágenes
trabaja sobre Supabase Storage** (bucket `site-media`), que es el único
almacenamiento persistente real del proyecto. El inventario combina dos
procedencias, ambas reales y sin datos simulados:

1. **`bundled`** — los 8 archivos reales de `client/src/assets/` y de
   `client/public/`. Se detectan con un escaneo real del repositorio y sus
   referencias se detectan con un escaneo real del código fuente.
2. **`storage`** — objetos reales del bucket `site-media`, subidos desde el panel.

Un reemplazo de una imagen `bundled` **no puede** sobrescribir el archivo del
repositorio en producción. La solución honesta y persistente: el reemplazo se
guarda en Storage y se registra como **override** de la ruta lógica; el sitio
público resuelve esa ruta lógica contra Storage y usa la versión nueva cuando
existe. Si no hay override, el sitio sigue usando el asset compilado — es decir,
**el sitio nunca se rompe**.

### 0.2 Rutas lógicas

La clave estable de cada imagen es su **ruta lógica**, relativa a `client/`:

- Asset compilado: `assets/casoratti-hero.jpg`
- Imagen subida: `images/institucional/foto.webp`
- Override: se registra con la ruta lógica del asset original (`assets/casoratti-hero.jpg`)

La ruta lógica es la clave de deduplicación y la clave de resolución en el sitio.

---

## 1. Contrato de base de datos

Migración: `supabase/migrations/20260115000400_media_admin.sql` (la escribe el
agente de base de datos; la aplica el agente principal en el dashboard).

### 1.1 Bucket

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-media', 'site-media', true, 10485760,
  array['image/jpeg','image/png','image/webp','image/avif','image/svg+xml'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
```

Es **público** a propósito: son fotografías institucionales del sitio público y
el sitio tiene que poder renderizarlas sin sesión. Los documentos sensibles
(clientes y expedientes) siguen en buckets privados, sin cambios.

Políticas sobre `storage.objects` para `site-media`: lectura, escritura,
actualización y borrado **sólo para `authenticated` con `public.is_admin()`**.
El bucket público no habilita la escritura sin sesión: sin policy de `insert`,
el rol `anon` recibe `403`.

### 1.2 Tablas

```sql
create table public.site_media (
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

create table public.media_folders (
  id         uuid primary key default gen_random_uuid(),
  path       text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint media_folders_path_check check (
    path ~ '^[a-z0-9][a-z0-9._/-]*$' and path !~ '(^|/)\.\.' and length(path) <= 120
  )
);

create table public.media_activity (
  id         uuid primary key default gen_random_uuid(),
  action     text not null,
  media_path text,
  actor_id   uuid references auth.users(id) on delete set null,
  result     text not null default 'success',
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
```

Carpetas iniciales sembradas en `media_folders`: `assets`, `overrides`,
`images/institucional`, `images/equipo`, `images/servicios`,
`images/publicaciones`, `images/general`.

### 1.3 Funciones de servidor

```sql
-- Registro de actividad con autor no falsificable (actor_id = auth.uid()).
create or replace function public.log_media_action(
  p_action text, p_media_path text default null,
  p_result text default 'success', p_detail jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$ ... $$;

-- Mapa ruta lógica → ruta en Storage, sólo para medios activos.
create or replace function public.resolve_media_overrides()
returns jsonb language sql stable security definer set search_path = public as $$ ... $$;
```

`log_media_action` valida `p_action` contra una lista blanca
(`upload`, `replace`, `edit`, `delete`, `restore`, `purge`, `folder_create`,
`metadata_update`, `password_change`) y **descarta del `detail` cualquier clave
que parezca una contraseña** (`password`, `new_password`, `current_password`,
`secret`, `token`).

`resolve_media_overrides` devuelve
`{ "<ruta lógica>": "<ruta dentro del bucket>" }` y sólo incluye filas
`status = 'active'` con `storage_path` no nulo. El cliente arma la URL pública.

### 1.4 Privilegios

- `anon`: `grant execute on function public.resolve_media_overrides() to anon;`
  — nada más. No lee `site_media` directamente.
- `authenticated`: `select, insert, update, delete` sobre `site_media`,
  `media_folders`, `media_activity`.
- `service_role`: `grant all on all tables in schema public to service_role;`
  (ya cubierto por `alter default privileges` de la migración de privilegios).
- RLS: `site_media`, `media_folders` y `media_activity` quedan **restringidas a
  `public.is_admin()`** en todas sus operaciones. `media_activity` es de
  **append-only**: policy de `select` para admin, **sin** policy de `update` ni
  `delete`.

---

## 2. Contrato TypeScript compartido (archivos del agente principal)

### 2.1 `client/src/lib/mediaManifest.ts` (sin `node:` — se usa en el navegador)

```ts
export const MEDIA_IMAGE_EXTENSIONS = ["jpg","jpeg","png","webp","avif","svg","gif"] as const;
export type MediaFormat = (typeof MEDIA_IMAGE_EXTENSIONS)[number];

export type MediaReference = {
  file: string;    // ruta relativa al repo, p.ej. "client/src/pages/SitePages.tsx"
  line: number;
  kind: "import" | "url" | "string";
  label: string;   // "Página de inicio", "Área jurídica", "Componente"
};

export type MediaManifestEntry = {
  logicalPath: string;   // "assets/casoratti-hero.jpg"
  physicalPath: string;  // "client/src/assets/casoratti-hero.jpg"
  publicPath: string;    // "/assets/casoratti-hero-<hash>.jpg" (URL real servida)
  originalName: string;
  format: MediaFormat;
  bytes: number;
  width: number | null;
  height: number | null;
  modifiedAt: string;    // ISO
  provider: "bundled";
  references: MediaReference[];
};

export type MediaManifest = { generatedAt: string; entries: MediaManifestEntry[] };

export function mediaFormatOf(name: string): MediaFormat | null;
export function isImageFile(name: string): boolean;
export function formatMediaBytes(bytes: number): string;
export function emptyMediaManifest(): MediaManifest;
```

### 2.2 `client/src/lib/mediaResolver.ts` (sin `node:`)

```ts
export function resolveMediaUrl(logicalPath: string, fallback: string): string;
export function useMediaSrc(logicalPath: string, fallback: string): string;
export function ensureMediaOverrides(): void;
export function getMediaOverrides(): Record<string, string> | null;
```

Comportamiento: el módulo pide una sola vez el RPC
`resolve_media_overrides` con la clave pública, guarda el mapa en memoria y
notifica a los suscriptores. `useMediaSrc` devuelve **el fallback** hasta que
llega el mapa (o para siempre si Supabase no responde). El sitio público nunca
queda sin imagen por culpa del resolver.

---

## 3. Módulo 1 — «Seguridad · Cambiar contraseña»

Ruta: `/panel/seguridad`. Archivos:
`client/src/pages/admin/SecurityModule.tsx`,
`client/src/pages/admin/security-utils.ts`,
`client/src/pages/admin/security-utils.test.ts`,
`client/src/styles/admin-security.css`.

### 3.1 Interfaz

Campo de contraseña actual, campo de nueva contraseña, campo de confirmación,
botón mostrar/ocultar (uno solo, alterna los tres campos), indicador de
fortaleza, lista visual de requisitos, botón «Actualizar contraseña», mensajes
de éxito y de error.

Mensaje de éxito exacto: **«La contraseña se actualizó correctamente»**.

### 3.2 Requisitos de seguridad

1. **Verificar la contraseña actual.** Se reautentica con
   `supabase.auth.signInWithPassword({ email, password })`. Si falla, se aborta
   con «La contraseña actual no es correcta» y **no** se toca la nueva.
2. **Confirmación idéntica**: si `nueva !== confirmación`, error «La
   confirmación no coincide con la nueva contraseña».
3. **Requisitos mínimos**: ≥ 10 caracteres, ≥ 1 minúscula, ≥ 1 mayúscula, ≥ 1
   dígito, ≥ 1 símbolo. Se validan **en el cliente y en el servidor**
   (el RPC de la base vuelve a validar antes de escribir).
4. **Contraseña reutilizada**: se rechaza si la nueva es igual a la actual
   («La nueva contraseña debe ser distinta de la actual»). La comprobación de
   contraseñas comprometidas en listas de filtraciones **no está disponible**
   con esta infraestructura: se documenta como limitación, no se simula.
5. **Hashing**: no se implementa hashing propio. El hash lo produce la
   infraestructura existente (Supabase Auth / GoTrue: bcrypt con coste 10,
   con migración automática a argon2id). Jamás se guarda ni se registra una
   contraseña en claro.
6. **Nunca exponer**: ningún `console.log` de contraseñas; los errores que
   vuelven de Supabase se muestran con un texto propio, sin volcar el objeto
   del error.
7. **Sesiones anteriores**: tras el cambio se revoca el resto de las sesiones
   con `supabase.auth.signOut({ scope: "others" })` si la versión lo soporta; si
   no, se documenta y se cierra la sesión local (`signOut()`), que es el
   comportamiento seguro por defecto.
8. **Reautenticación**: se exige la contraseña actual antes de cada cambio.
9. **CSRF / fuerza bruta / no autorizado**: el cliente de Supabase usa la
   cabecera `Authorization` (no cookies), por lo que no hay superficie CSRF;
   el rol se verifica en Postgres (`is_admin()`), no en el frontend; el
   intento de login se limita en la infraestructura de Auth.
10. **Registro**: se llama a `log_media_action('password_change', null, 'success',
    { metodo: 'supabase-auth' })` — **sin** datos de la contraseña.

### 3.3 Reglas

- Sólo `role === "admin"` ve el módulo (lo garantiza `AdminShell`).
- Sin dependencias nuevas.
- Los mensajes van en español rioplatense, con la voz del sitio.

---

## 4. Módulo 2 — «Imágenes» (Biblioteca de imágenes)

Ruta: `/panel/imagenes`. Archivos bajo `client/src/pages/admin/images/`:
`media-service.ts`, `media-validator.ts`, `media-editor.ts`, `media-inventory.ts`,
`ImageLibraryModule.tsx`, `ImageEditorModal.tsx`, `MediaUploadPanel.tsx`,
`MediaTrashPanel.tsx`, `MediaMetadataDialog.tsx`, `MediaActivityPanel.tsx`, más
`*.test.ts` para la lógica pura. CSS: `client/src/styles/admin-images.css`.

### 4.1 Inventario

Se combina el **manifiesto** (bundled, real) con las filas de `site_media`
(storage, real). Por cada imagen:

1. Vista previa.
2. Nombre del archivo.
3. Formato.
4. Peso.
5. Dimensiones en píxeles.
6. Ruta física completa dentro del proyecto.
7. Fecha de modificación.
8. Estado de utilización (`en uso` / `sin referencias` / `reemplazada` / `en papelera`).
9. Cantidad de referencias detectadas.
10. botón «Ver detalles».

Encabezado: título **«Biblioteca de imágenes»**, total de imágenes, imágenes
utilizadas, imágenes sin referencias detectadas, espacio ocupado (suma de
bytes), botón «Subir imágenes», buscador, filtros por formato, por ubicación y
por estado, y selector de vista **cuadrícula / lista**.

### 4.2 Detalle y rutas

El detalle muestra y permite **copiar**: ruta física del archivo dentro del
proyecto, ruta pública usada por el navegador, nombre original, nombre
almacenado, directorio contenedor, URL pública, y **todas** las páginas o
componentes que usan la imagen (con archivo y línea).

Para los medios de Storage, la «ruta física» es la ruta dentro del bucket y se
identifica el proveedor (`supabase-storage`); **no** se inventa una ruta local.
Para un asset `bundled`, la ruta física es la real del repositorio.

### 4.3 Carga

- Arrastrar y soltar + selección desde el ordenador.
- Varias imágenes simultáneas, con vista previa antes de subir.
- Progreso de carga y **cancelación** de cargas pendientes.
- Validación de extensión **y** del contenido real (bytes mágicos).
- Límite de tamaño configurable (10 MB por defecto).
- Detección de nombres duplicados: avisa y **no** sobrescribe; el administrador
  decide el nombre final.
- Carpeta de destino seleccionable entre las de `media_folders`, y creación de
  carpetas nuevas (validada en el servidor).
- Nombre de archivo normalizado y seguro; los metadatos relevantes se
  conservan.

### 4.4 Editor (modal)

Botón «Editar imagen». Debe permitir:

**A. Recortar** — libre, 1:1, 16:9, 4:3, 3:4, 9:16, área manual, mover,
ampliar/reducucir, girar, restablecer.

**B. Ajustar** — ancho, alto, escala, posición X e Y, zoom, orientación,
relación de aspecto, y opción de **mantener proporciones** (sin deformación).

**C. Enmarcar** — marco rectangular, cuadrado, circular, bordes redondeados,
radio configurable, grosor y color del borde, modos `cover`, `contain`, `fill`,
posicionamiento horizontal y vertical.

**D. Vista previa contextual** — tarjeta, portada, perfil, fondo, institucional.

**E. Guardar** — «Guardar como nueva imagen» o «Reemplazar la original»
(con advertencia). Al reemplazar se **conserva una copia de la versión
original** en `site-media` (prefijo `backups/`) antes de sobrescribir.

El recorte y el encuadre se calculan con funciones puras testeables
(`media-editor.ts`) y se rasterizan en un `<canvas>`; el resultado es un
**archivo real** que se sube a Storage. No se agregan dependencias npm: se
implementa con Canvas + DOM, y las funciones puras se prueban con vitest.

### 4.5 Actualizar / reemplazar una imagen existente

Flujo: seleccionar imagen → mostrar datos y ubicación → elegir la nueva →
comparación antes/después → ajustar, recortar y enmarcar → confirmar →
reemplazar en su ubicación → **verificar que la nueva imagen se sirve**
(comprobación con `fetch` de la URL pública y estado HTTP) → invalidar
cachés (`cache: "no-store"` en la carga y versión con marca de tiempo en la
URL) → mostrar el resultado.

Si la imagen original tiene varias referencias, **se preserva su ruta lógica**:
las referencias siguen apuntando al mismo lugar y el sitio muestra la versión
nueva. Nunca se cambia el nombre ni la URL pública de un asset `bundled` sin
confirmación expresa del administrador.

### 4.6 Eliminación

Antes de eliminar se verifica: si está en uso, cuántas referencias tiene, en
qué páginas, si es un recurso compartido, si pertenece a una carpeta protegida
y si es un recurso esencial.

- Sin referencias: se permite eliminar previa confirmación.
- Con referencias: advertencia — *«Esta imagen está siendo utilizada en 3
  lugares del sitio web. Si la eliminás, podrías generar imágenes rotas o
  espacios vacíos»* — con la lista de lugares y opción de cancelar.
- Los recursos esenciales y las carpetas protegidas no se pueden eliminar.
- **Papelera**: se consulta, se ve la ruta original y la fecha de eliminación, se
  restaura y se elimina de forma definitiva (con confirmación adicional).
- Nunca hay borrado recursivo ni operaciones fuera del directorio multimedia
  autorizado.

### 4.7 Metadatos

Nombre descriptivo, texto alternativo (ALT, orientado a accesibilidad y SEO),
título, descripción, categoría y etiquetas. Nada se modifica sin confirmación.

### 4.8 Seguridad del gestor

Acceso sólo para administradores (RLS + `is_admin()`), validación de
permisos en el backend, MIME **y** firma real del archivo, límite de tamaño,
protección contra *path traversal*, normalización de nombres, directorios
permitidos, protección frente a SVG maliciosos (sanitizado: se eliminan
`<script>`, atributos `on*`, `foreignObject`, referencias `javascript:` y
entidades externas), validación de las solicitudes de eliminación y
actualización, y registro de cada operación.

### 4.9 API de servicios (contrato exacto entre «media-core» y «media-ui»)

Archivo: `client/src/pages/admin/images/media-service.ts`

```ts
export const SITE_MEDIA_BUCKET = "site-media";

export type MediaRow = {
  id: string;
  logical_path: string;
  storage_path: string | null;
  provider: string;
  source: "bundled" | "upload" | "override";
  original_name: string;
  stored_name: string | null;
  mime_type: string;
  format: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  alt_text: string | null;
  title: string | null;
  description: string | null;
  category: string | null;
  tags: string[];
  status: "active" | "trashed";
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type MediaResult = { ok: true } | { ok: false; error: string };

export async function listMedia(): Promise<MediaRow[]>;
export async function listFolders(): Promise<string[]>;
export async function createFolder(path: string): Promise<MediaResult>;
export async function uploadImage(
  file: File,
  folder: string,
  options?: { logicalPath?: string; overwrite?: boolean },
): Promise<{ ok: true; storagePath: string; logicalPath: string } | { ok: false; error: string }>;
export async function replaceImage(
  logicalPath: string,
  file: File,
  options?: { backup?: boolean },
): Promise<{ ok: true; storagePath: string } | { ok: false; error: string }>;
export async function updateMediaMetadata(
  id: string,
  patch: Partial<Pick<MediaRow, "alt_text" | "title" | "description" | "category" | "tags">>,
): Promise<MediaResult>;
export async function trashMedia(id: string): Promise<MediaResult>;
export async function restoreMedia(id: string): Promise<MediaResult>;
export async function purgeMedia(id: string): Promise<MediaResult>;
export function publicMediaUrl(storagePath: string): string;
export function mediaLogicalPath(folder: string, fileName: string): string;
export async function logMediaActivity(
  action: string,
  mediaPath: string | null,
  result?: "success" | "error",
  detail?: Record<string, unknown>,
): Promise<void>;
```

Archivo: `client/src/pages/admin/images/media-validator.ts`

```ts
export const ALLOWED_IMAGE_MIME = ["image/jpeg","image/png","image/webp","image/avif","image/svg+xml"];
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const ALLOWED_MEDIA_FOLDERS = ["images/institucional","images/equipo","images/servicios","images/publicaciones","images/general"];

export function validateImageFile(file: File): { ok: true } | { ok: false; error: string };
export function detectImageMime(bytes: ArrayBuffer): string | null;   // bytes mágicos
export function sanitizeSvg(text: string): { ok: true; text: string } | { ok: false; error: string };
export function normalizeMediaName(name: string): string;
export function isSafeRelativePath(path: string): boolean;
export function safeStoragePath(folder: string, name: string): string;
export function isProtectedMediaPath(path: string): boolean;
```

Archivo: `client/src/pages/admin/images/media-editor.ts`

```ts
export type CropPreset = "free" | "1:1" | "16:9" | "4:3" | "3:4" | "9:16";
export type FitMode = "cover" | "contain" | "fill";
export type FrameShape = "rect" | "square" | "circle" | "rounded";

export type EditorState = {
  zoom: number;                 // 1 = sin zoom
  offsetX: number;              // px sobre la imagen natural
  offsetY: number;
  rotation: number;             // grados
  crop: { x: number; y: number; width: number; height: number };
  frame: {
    shape: FrameShape;
    radius: number;
    borderWidth: number;
    borderColor: string;
    fit: FitMode;
    positionX: number;          // 0..1
    positionY: number;
  };
  output: { width: number; height: number; mime: string; quality: number };
};

export function presetAspect(preset: CropPreset): number | null;
export function cropRectForAspect(imgW: number, imgH: number, aspect: number | null): { x: number; y: number; width: number; height: number };
export function clampEditorState(state: EditorState, imgW: number, imgH: number): EditorState;
export function computeFrameStyle(state: EditorState): Record<string, string>;
export function renderEditorCanvas(canvas: HTMLCanvasElement, image: HTMLImageElement, state: EditorState): void;
```

### 4.10 Registro de.activity

Pestaña con el registro (`media_activity`): fecha, tipo de acción, identificador
del administrador y resultado. Acciones: `upload`, `replace`, `edit`, `delete`,
`restore`, `purge`, `folder_create`, `metadata_update`, `password_change`.
**Nunca** se registra una contraseña.

---

## 5. Manifiesto de imágenes (detección real)

Agente: «manifiesto». Archivos:
`client/src/lib/mediaManifest.server.ts`,
`client/src/lib/mediaManifest.server.test.ts`,
`client/src/lib/mediaManifestPlugin.ts`.

- Escanea `client/src/assets/` y `client/public/` en busca de archivos de
  imagen (jpg, jpeg, png, webp, avif, svg, gif).
- Calcula **dimensiones reales** leyendo la cabecera del archivo (PNG: IHDR;
  JPEG: marcador SOF; WEBP: VP8/VP8L/VP8X; GIF: cabecera logical screen
  descriptor; AVIF: caja `ispe`; SVG: atributos `width`/`height`/`viewBox`).
  Sin dependencias externas.
- Escanea `client/src/**/*.{ts,tsx,css}` y `client/public/*.css` para encontrar
  **referencias reales**: imports (`@/assets/x.jpg`), cadenas de ruta y
  `url(...)`. Registra archivo, línea, tipo y una etiqueta legible de la página
  o componente.
- Emite `media-manifest.json` con la **URL pública real**: en build, el plugin
  de Vite conoce el nombre final hasheado que emite Vite; en desarrollo,
  `/src/assets/<archivo>`.
- El plugin se registra en `vite.config.ts` (lo hace el agente principal) y
  sirve `/media-manifest.json` también en el servidor de desarrollo.

---

## 6. Criterios de aceptación (verificables)

### Seguridad
- [ ] Cambio de contraseña correcto → «La contraseña se actualizó correctamente».
- [ ] Contraseña actual incorrecta → error claro, la nueva no se aplica.
- [ ] Confirmación distinta → error claro.
- [ ] Usuario sin rol `admin` → el módulo no se renderiza y la API responde 403.
- [ ] Archivo con extensión engañosa (`.jpg` que en realidad es texto) → rechazado.
- [ ] SVG con `<script>` → rechazado o saneado.
- [ ] Ruta con `..` → rechazada.

### Imágenes
- [ ] El inventario lista los 8 assets reales con ruta, formato, peso, dimensiones
      y fecha de modificación reales.
- [ ] Las referencias detectadas coinciden con los imports reales del código.
- [ ] Carga individual y múltiple funcionan y persisten (sobreviven a recargar).
- [ ] Nombre duplicado detectado; no se sobrescribe sin confirmación.
- [ ] Recorte y encuadre producen un archivo nuevo real.
- [ ] Reemplazar una imagen usada actualiza lo que ve el sitio sin romper URLs.
- [ ] Eliminar una imagen sin referencias la manda a la papelera; se puede
      restaurar.
- [ ] Eliminar una imagen en uso muestra la advertencia con el número de
      lugares y permite cancelar.
- [ ] La papelera permite borrado definitivo con confirmación adicional.

### Integridad
- [ ] Ninguna página existente queda con imágenes rotas.
- [ ] No se eliminó ningún componente existente.
- [ ] Las rutas públicas siguen funcionando.
- [ ] El panel sigue funcionando (los 8 módulos anteriores).
- [ ] La persistencia sobrevive a la recarga de página.

### Reglas del proyecto
- [ ] `npx tsc --noEmit` sin errores.
- [ ] `npx vitest run` en verde, sin regresiones.
- [ ] `npx vite build` sin errores.
- [ ] RLS activo en las tres tablas nuevas; `anon` no lee `site_media`.
- [ ] Ningún secreto en el código; `.env` y `.env.local` siguen ignorados.

---

## 7. Orden de integración (agente principal)

1. Aplicar la migración `20260115000400_media_admin.sql` en el dashboard de
   Supabase (editor SQL) y verificarla.
2. Registrar los módulos en `AdminShell.tsx` (nav + `pageMeta` + `Route`).
   Orden de la navegación: **Panel principal → Seguridad → Imágenes →** resto de
   los módulos existentes, sin reordenar ni eliminar los actuales.
3. Importar los CSS nuevos en `App.tsx`.
4. Registrar el plugin del manifiesto en `vite.config.ts`.
5. Resolver los overrides en el sitio público (`SitePages.tsx`) sin cambiar el
   diseño: cada `<img>` de contenido pasa a usar `useMediaSrc` con **el mismo
   `alt`** y **el mismo `className`**.
6. Build, pruebas, verificación en el navegador (carga y borrado reales).
7. Commit, push, despliegue en Vercel, verificación en producción.
8. Documentación: `README.md` y `docs/TECHNICAL_REPORT.md`.
