# Especificación — Inventario de **apariciones** de imágenes

> Contrato normativo para la corrección del módulo de imágenes. Todo el equipo
> (personas y agentes) implementa contra este documento. Si el código y el
> documento discrepan, manda el documento.

Fecha: 2026-11-25 · Rama: `main` · Base: `supabase/migrations/20260115000400_media_admin.sql`

---

## 1. El problema que se corrige

Hoy el inventario agrupa por **archivo físico**: si 4 páginas usan
`equipo-reunion.jpg`, el panel muestra **una** tarjeta con 4 referencias. Eso no
alcanza para administrar el sitio: hay que poder editar **una** aparición sin
tocar las demás.

**Regla nueva:** el panel administra **apariciones**. Cada lugar del sitio donde
se usa una imagen es un registro independiente, con identificador propio, y es
editable por separado. Los archivos físicos siguen siendo un concepto aparte
(una "biblioteca de archivos"), pero **la pantalla principal muestra las
apariciones**.

## 2. Los 25 lugares reales del sitio

Detectados en `client/src/pages/SitePages.tsx` y `client/src/data/siteContent.ts`.
El escáner debe detectarlos, no inventarlos.

| `occurrenceId` | Archivo físico | Página | Sección | Componente | Uso |
|---|---|---|---|---|---|
| `home-hero` | `assets/casoratti-hero.jpg` | Inicio | Portada | Home | `SitePages.tsx` L32 |
| `home-split` | `assets/equipo-reunion.jpg` | Inicio | Presentación | Home | `SitePages.tsx` L37 |
| `studio-intro` | `assets/equipo-reunion.jpg` | El estudio | Encabezado | Studio | `SitePages.tsx` L45 |
| `studio-gallery-main` | `assets/equipo-sala.jpg` | El estudio | Galería principal | Studio | `SitePages.tsx` L45 |
| `studio-gallery-aside` | `assets/equipo-pasillo.jpg` | El estudio | Galería lateral | Studio | `SitePages.tsx` L45 |
| `areas-intro` | `assets/equipo-pasillo.jpg` | Áreas de práctica | Encabezado | Areas | `SitePages.tsx` L49 |
| `area-detail-<slug>` | el del área (4 de `equipo-reunion.jpg`, 4 de `equipo-pasillo.jpg`, 3 de `equipo-sala.jpg`, 3 de `equipo-audiencia-horizontal.jpg`) | Detalle del área | `<label del área>` | AreaDetail | `SitePages.tsx` L58 (14 áreas reales) |
| `values-intro` | `assets/justice-scale.jpg` | Valores | Encabezado | Values | `SitePages.tsx` L63 |
| `resources-intro` | `assets/equipo-reunion.jpg` | Centro de recursos | Encabezado | Resources | `SitePages.tsx` L66 |
| `faq-intro` | `assets/equipo-reunion.jpg` | Preguntas frecuentes | Encabezado | FAQ | `SitePages.tsx` L73 |
| `contact-intro` | `assets/equipo-pasillo.jpg` | Contacto | Encabezado | Contact | `SitePages.tsx` L178 |

**Total: 10 apariciones estáticas + 14 `area-detail-<slug>` = 24 apariciones**,
sobre **8 archivos físicos**. El conteo final lo calcula el escáner, no se
escribe a mano.

> Corrección 25/11: una auditoría independiente del código real verificó una por
> una las 10 apariciones estáticas y los 14 slugs de área (únicos) y corrigió el
> total: **son 24, no 25**. El "25" del enunciado original era un ejemplo, no
> un dato; lo que vale es que cada aparición real esté registrada una vez.

## 3. Registro de apariciones (código)

Archivo nuevo: `client/src/data/mediaOccurrences.ts`

```ts
export type MediaOccurrence = {
  /** Identificador único y estable de la aparición. */
  id: string;
  /** URL del asset compilado que se usa hoy. */
  image: string;
  /** Página del sitio donde aparece. */
  page: string;
  /** Sección concreta dentro de la página. */
  section: string;
  /** Componente que la renderiza. */
  component: string;
  /** Texto alternativo actual. */
  alt: string;
};

export const mediaOccurrences: Record<string, MediaOccurrence>;
/** Ids de aparición declarados en el sitio (para el escáner y el panel). */
export const mediaOccurrenceIds: string[];
```

Las 14 áreas se registran **por su slug real** (`area-detail-familia`,
`area-detail-sucesiones`, …), leídos de `practiceAreas`.

### Cómo lo consume el sitio

- Cada `<MediaImg>` pasa su `occurrenceId`:
  `<MediaImg occurrence="home-hero" src={images.hero} alt="…" />`
- `PageIntro` recibe una prop `occurrence` opcional y la pasa a su `MediaImg`.
- El detalle de área usa el id dinámico: `occurrence={`area-detail-${area.slug}`}`.

**Prohibido** que una aparición comparta la clave de resolución con otra: por eso
cada id es único aunque el archivo físico sea el mismo.

## 4. Escáner (manifiesto)

`client/src/lib/mediaManifest.server.ts` agrega un escaneo de apariciones:

- Lee `client/src/data/mediaOccurrences.ts` (ids, página, sección, componente).
- Busca en `client/src/**/*.{ts,tsx}` los **sitios de uso** de cada id:
  `occurrence="<id>"` y `occurrence={`area-detail-${...}`}`.
- Para los ids derivados de un slug (las áreas) **expande contra los slugs
  reales** de `practiceAreas`: 14 apariciones concretas, no una sola.
- Marca `status: "pending"` una referencia que no se puede resolver de forma
  estática (no inventar ubicaciones).

### Salida del manifiesto

```ts
export type MediaOccurrenceRecord = {
  occurrenceId: string;
  imageLogicalPath: string;   // "assets/casoratti-hero.jpg" (archivo físico)
  page: string;
  section: string;
  component: string;
  file: string;               // "client/src/pages/SitePages.tsx"
  line: number;
  status: "detected" | "pending";
};

export type MediaManifest = {
  generatedAt: string;
  entries: MediaManifestEntry[];         // archivos físicos (se mantiene)
  occurrences: MediaOccurrenceRecord[];  // apariciones (nuevo)
};
```

## 5. Base de datos

Migración nueva: `supabase/migrations/20260116000100_media_occurrences.sql`

```sql
alter table public.site_media add column if not exists occurrence_id text;
alter table public.site_media drop constraint if exists site_media_status_check;
alter table public.site_media add constraint site_media_status_check
  check (status in ('active','trashed','hidden'));
create unique index if not exists site_media_occurrence_unique
  on public.site_media (occurrence_id) where occurrence_id is not null;
```

`resolve_media_overrides()` cambia su forma de retorno:

```json
{
  "occurrences": { "<occurrenceId>": "<ruta en el bucket>" },
  "files":       { "<ruta lógica>":  "<ruta en el bucket>" },
  "hidden":      [ "<occurrenceId>" ]
}
```

- `occurrences`: reemplazo de **una** aparición (fila con `occurrence_id`).
- `files`: reemplazo del **archivo** completo (fila sin `occurrence_id`).
- `hidden`: apariciones cuya imagen se quitó del sitio (fila con
  `occurrence_id` y `status = 'hidden'`). La fila **conserva** su
  `storage_path`: mientras está oculta no se sirve, y al volver a mostrarla
  reaparece la versión reemplazada, no la original del paquete.

Todo lo demás se mantiene: RLS admin-only, `media_activity` de sólo lectura,
bitácora con autor real (`auth.uid()`), sin contraseñas.

## 6. Servicios (frontend)

En `client/src/pages/admin/images/media-service.ts`:

```ts
export type MediaOccurrenceRow = {
  occurrence_id: string;
  storage_path: string | null;
  status: "active" | "trashed" | "hidden";
  title: string | null;
  alt_text: string | null;
  description: string | null;
  category: string | null;
  tags: string[];
};

export async function listOccurrenceOverrides(): Promise<MediaOccurrenceRow[]>;
export async function upsertOccurrenceImage(
  occurrenceId: string,
  file: File,
  options?: { backup?: boolean },
): Promise<{ ok: true; storagePath: string } | { ok: false; error: string }>;
export async function setOccurrenceHidden(
  occurrenceId: string,
  hidden: boolean,
): Promise<MediaResult>;
export async function updateOccurrenceMetadata(
  occurrenceId: string,
  patch: Partial<Pick<MediaOccurrenceRow, "title" | "alt_text" | "description" | "category" | "tags">>,
): Promise<MediaResult>;
export async function purgeOccurrenceOverride(occurrenceId: string): Promise<MediaResult>;
```

Reglas:
- `upsertOccurrenceImage` escribe la fila con `occurrence_id` y
  `logical_path = 'occurrence/' + occurrenceId`; **nunca** toca la fila del
  archivo físico. Con `backup: true` copia el objeto anterior a `backups/`.
- `setOccurrenceHidden(id, true)` deja la aparición sin imagen en el sitio; con
  `false` la restaura.
- Toda operación se registra en `media_activity` (`replace`, `edit`, `delete`,
  `restore`).

## 7. Interfaz del panel

Ruta `/panel/imagenes`. Pestañas: **Apariciones** (principal) · **Archivos** ·
**Papelera** · **Actividad**.

**Pestaña Apariciones** (la principal):
- Lista **una tarjeta por aparición**, sin agrupar. Cada tarjeta:
  vista previa · nombre del archivo · **página** · **sección** · **componente** ·
  ruta física · URL usada por la página · dimensiones · **botón Editar** ·
  **botón Reemplazar** · **botón Eliminar aparición**.
- Indicadores: **archivos físicos**, **apariciones totales**, **páginas con
  imágenes**, **imágenes usadas en varias secciones**, **imágenes sin
  referencias**.
- El contador de la navegación del panel muestra el total de apariciones:
  `Imágenes (24)`.

**Acciones por aparición**
- **Editar / Reemplazar**: abre el editor, permite elegir archivo, previsualizar,
  recortar, ajustar y enmarcar, y guarda **sólo esa aparición**. Al confirmar se
  verifica que la URL pública de la nueva imagen responde 200.
- **Eliminar aparición**: quita la imagen de esa sección. **No** borra el archivo
  físico ni afecta a las demás apariciones. Se avisa con el número de apariciones
  que comparten el archivo y se puede cancelar.

**Pestaña Archivos** (biblioteca física):
- Una tarjeta por **archivo** físico: ruta, URL, peso, dimensiones, fecha,
  **cuántas apariciones lo usan**.
- **Eliminar archivo físico**: permitido **sólo** si no hay ninguna aparición que
  lo use (para un asset del bundle no se permite: son recursos protegidos). Si
  hay apariciones, la acción se bloquea con el motivo.

**Pestaña Papelera y Actividad**: como hasta ahora.

## 8. Verificación obligatoria

1. Conteo de archivos físicos y de apariciones reales.
2. Cada aparición con identificador independiente (y único).
3. Editar una aparición → las demás **no** cambian (comparar URLs resueltas).
4. Reemplazar una aparición → las demás conservan su imagen original.
5. Eliminar una aparición → las demás siguen funcionando.
6. Eliminar un archivo físico con apariciones → bloqueado con motivo.
7. Ninguna imagen rota en el sitio público.
8. Suite de pruebas en verde, `tsc` sin errores, build sin errores.

## 9. Propiedad de archivos

| Agente | Archivos |
|---|---|
| **A — sitio y escáner** | `client/src/data/mediaOccurrences.ts`, `client/src/pages/SitePages.tsx`, `client/src/data/siteContent.ts`, `client/src/components/MediaImg.tsx`, `client/src/lib/mediaManifest.ts`, `client/src/lib/mediaManifest.server.ts`, `client/src/lib/mediaManifest.server.test.ts` |
| **B — base de datos** | `supabase/migrations/20260116000100_media_occurrences.sql`, `supabase/tests/media-occurrences-rls.test.ts` |
| **C — panel** | `client/src/pages/admin/images/*`, `client/src/styles/admin-images.css` |
| **Principal** | `client/src/lib/mediaResolver.ts`, `client/src/lib/mediaAssets.ts`, `client/src/pages/admin/AdminShell.tsx`, `vite.config.ts`, `client/src/App.tsx` |
