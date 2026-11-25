/**
 * Inventario unificado de la biblioteca de imágenes.
 *
 * El módulo junta dos fuentes reales y distintas:
 *
 *  - el **manifiesto** (`/media-manifest.json`), que se genera en el build de
 *    Vite: los assets compilados del sitio, con sus medidas reales y las
 *    referencias reales detectadas en el código;
 *  - las filas de `site_media`, que son los objetos reales del bucket
 *    `site-media` subidos desde el panel (y los overrides de assets).
 *
 * Todo lo que hay acá son funciones puras: reciben datos y devuelven datos.
 * No tocan la red ni el DOM. La interfaz (`ImageLibraryModule`) las usa para
 * pintar el inventario, filtrarlo y resumirlo.
 */

import type {
  MediaManifest,
  MediaOccurrenceRecord,
  MediaReference,
} from "@/lib/mediaManifest";
import {
  mediaLogicalPath,
  publicMediaUrl,
  type MediaOccurrenceRow,
  type MediaRow,
} from "./media-service";
import { isProtectedMediaPath, normalizeMediaName } from "./media-validator";

/** De dónde viene la imagen. */
export type MediaOrigin = "bundled" | "storage";

/**
 * Estado de utilización de una imagen.
 *
 *  - `in-use`: el manifiesto detectó al menos una referencia en el código.
 *  - `unused`: ninguna referencia detectada.
 *  - `replaced`: hay una versión nueva en Storage que sustituye al asset.
 *  - `trashed`: está en la papelera.
 */
export type MediaUsageStatus = "in-use" | "unused" | "replaced" | "trashed";

/** Texto de cada estado, con la voz del panel. */
export const MEDIA_USAGE_LABELS: Record<MediaUsageStatus, string> = {
  "in-use": "En uso",
  unused: "Sin referencias",
  replaced: "Reemplazada",
  trashed: "En papelera",
};

/** Ficha descriptiva guardada en `site_media`. */
export type MediaMetadata = {
  altText: string | null;
  title: string | null;
  description: string | null;
  category: string | null;
  tags: string[];
};

/** Una imagen del inventario, sin importar de dónde venga. */
export type InventoryItem = {
  /** Clave estable dentro de la interfaz. */
  key: string;
  origin: MediaOrigin;
  /** Ruta lógica: la clave con la que el sitio resuelve la imagen. */
  logicalPath: string;
  /** Nombre del archivo tal como se lo muestra al administrador. */
  name: string;
  /** Nombre con el que quedó guardado en el bucket (si aplica). */
  storedName: string | null;
  format: string;
  bytes: number;
  width: number | null;
  height: number | null;
  /**
   * Ruta real del archivo: la del repositorio para un asset compilado o la
   * ruta dentro del bucket para un medio de Storage. Nunca se inventa una
   * ruta local para un objeto que vive en Storage.
   */
  physicalPath: string;
  /** `bundled` o `supabase-storage`. */
  provider: string;
  /** Ruta dentro del bucket `site-media`, si el medio vive en Storage. */
  storagePath: string | null;
  /** Ruta pública que usa el navegador. */
  publicPath: string;
  /** URL absoluta (o relativa al sitio) para la vista previa. */
  publicUrl: string;
  modifiedAt: string | null;
  references: MediaReference[];
  referenceCount: number;
  status: MediaUsageStatus;
  /** Carpeta o directorio que contiene la imagen. */
  folder: string;
  /** Identificador de la fila en `site_media` (si existe). */
  rowId: string | null;
  metadata: MediaMetadata;
  /** La imagen es parte del build del sitio: no se puede eliminar. */
  essential: boolean;
  /** La ruta está en una carpeta protegida (`assets/`, `backups/`). */
  protectedPath: boolean;
};

/** Números del encabezado. */
export type InventorySummary = {
  total: number;
  active: number;
  inUse: number;
  unused: number;
  replaced: number;
  trashed: number;
  bytes: number;
};

/** Filtros del panel de inventario. */
export type InventoryFilters = {
  search: string;
  format: string;
  folder: string;
  status: MediaUsageStatus | "all";
};

/** Constructor de URL pública para los objetos del bucket. */
export type StorageUrlBuilder = (storagePath: string) => string;

const EMPTY_METADATA: MediaMetadata = {
  altText: null,
  title: null,
  description: null,
  category: null,
  tags: [],
};

/* ------------------------------------------------------------------ */
/* Utilidades                                                         */
/* ------------------------------------------------------------------ */

/** Carpeta que contiene a la ruta lógica. */
export function mediaFolderOf(logicalPath: string): string {
  const clean = (logicalPath ?? "").replace(/^\/+/, "");
  const index = clean.lastIndexOf("/");
  return index > 0 ? clean.slice(0, index) : "";
}

/**
 * Agrega una marca de tiempo a una URL para invalidar la caché del
 * navegador después de reemplazar una imagen.
 */
export function withCacheVersion(url: string, version: number | string): string {
  const clean = String(version ?? "").trim();
  if (!url || !clean) return url;
  return url.includes("?") ? `${url}&v=${clean}` : `${url}?v=${clean}`;
}

/** ¿La carpeta del ítem cuelga de la carpeta filtrada? */
export function folderMatches(itemFolder: string, filter: string): boolean {
  if (!filter) return true;
  if (!itemFolder) return false;
  return itemFolder === filter || itemFolder.startsWith(`${filter}/`);
}

function usageStatus(input: {
  rowStatus?: string | null;
  hasOverride: boolean;
  referenceCount: number;
}): MediaUsageStatus {
  if (input.rowStatus === "trashed") return "trashed";
  if (input.hasOverride) return "replaced";
  return input.referenceCount > 0 ? "in-use" : "unused";
}

function metadataOf(row: MediaRow | null): MediaMetadata {
  if (!row) return EMPTY_METADATA;
  return {
    altText: row.alt_text ?? null,
    title: row.title ?? null,
    description: row.description ?? null,
    category: row.category ?? null,
    tags: Array.isArray(row.tags) ? row.tags : [],
  };
}

/* ------------------------------------------------------------------ */
/* Fusión                                                              */
/* ------------------------------------------------------------------ */

/**
 * Fusiona el manifiesto (assets compilados) con las filas de `site_media`
 * (medios de Storage) en un inventario único.
 *
 * Cuando una fila de `site_media` comparte la ruta lógica de un asset del
 * manifiesto, se trata de un **override**: el asset del build sigue en el
 * repositorio y la versión de Storage es la que se sirve.
 */
export function mergeMediaInventory(
  manifest: MediaManifest | null,
  rows: MediaRow[],
  options: { storageUrl?: StorageUrlBuilder } = {},
): InventoryItem[] {
  const storageUrl = options.storageUrl ?? publicMediaUrl;
  const entries = manifest?.entries ?? [];
  const items: InventoryItem[] = [];

  const rowsByLogical = new Map<string, MediaRow>();
  for (const row of rows ?? []) {
    if (row?.logical_path) rowsByLogical.set(row.logical_path, row);
  }

  /* 1. Assets compilados (manifiesto), con su override opcional. */
  for (const entry of entries) {
    const row = rowsByLogical.get(entry.logicalPath) ?? null;
    rowsByLogical.delete(entry.logicalPath);

    const storagePath = row?.storage_path ?? null;
    const hasOverride = Boolean(storagePath);
    const referenceCount = entry.references?.length ?? 0;
    const status = usageStatus({
      rowStatus: row?.status ?? null,
      hasOverride,
      referenceCount,
    });

    const publicPath = hasOverride
      ? storageUrl(storagePath as string)
      : entry.publicPath;

    items.push({
      key: `bundled:${entry.logicalPath}`,
      origin: "bundled",
      logicalPath: entry.logicalPath,
      name: entry.originalName,
      storedName: row?.stored_name ?? null,
      format: entry.format,
      bytes: hasOverride ? Number(row?.size_bytes ?? 0) : entry.bytes,
      width: hasOverride ? row?.width ?? null : entry.width,
      height: hasOverride ? row?.height ?? null : entry.height,
      physicalPath: entry.physicalPath,
      provider: hasOverride ? row?.provider ?? "supabase-storage" : entry.provider,
      storagePath,
      publicPath,
      publicUrl: publicPath,
      modifiedAt: hasOverride ? row?.updated_at ?? null : entry.modifiedAt,
      references: entry.references ?? [],
      referenceCount,
      status,
      folder: mediaFolderOf(entry.logicalPath),
      rowId: row?.id ?? null,
      metadata: metadataOf(row),
      essential: !row,
      protectedPath: isProtectedMediaPath(storagePath ?? entry.logicalPath),
    });
  }

  /* 2. Medios de Storage sin asset del manifiesto. */
  for (const row of rowsByLogical.values()) {
    /* Las apariciones tienen su propio registro: no son archivos de la
       biblioteca física y no se listan acá. */
    if ((row as { occurrence_id?: string | null }).occurrence_id) continue;

    const storagePath = row.storage_path ?? null;
    const publicPath = storagePath ? storageUrl(storagePath) : "";
    const referenceCount = 0;
    const status = usageStatus({
      rowStatus: row.status,
      hasOverride: row.source === "override",
      referenceCount,
    });

    items.push({
      key: `storage:${row.id}`,
      origin: "storage",
      logicalPath: row.logical_path,
      name: row.stored_name || row.original_name,
      storedName: row.stored_name ?? null,
      format: row.format,
      bytes: Number(row.size_bytes ?? 0),
      width: row.width ?? null,
      height: row.height ?? null,
      physicalPath: storagePath ?? row.logical_path,
      provider: row.provider,
      storagePath,
      publicPath,
      publicUrl: publicPath,
      modifiedAt: row.updated_at ?? null,
      references: [],
      referenceCount,
      status,
      folder: mediaFolderOf(row.logical_path),
      rowId: row.id,
      metadata: metadataOf(row),
      essential: false,
      protectedPath: isProtectedMediaPath(storagePath ?? row.logical_path),
    });
  }

  return items;
}

/* ------------------------------------------------------------------ */
/* Filtrado                                                            */
/* ------------------------------------------------------------------ */

/**
 * Aplica buscador y filtros sobre el inventario.
 *
 * El buscador mira el nombre del archivo y las rutas (lógica, física y la
 * ruta dentro del bucket). Los filtros de formato, ubicación y estado son
 * exactos, salvo la ubicación: elegir `images` también trae lo que cuelga
 * de `images/institucional`.
 */
export function filterMediaInventory(
  items: InventoryItem[],
  filters: InventoryFilters,
): InventoryItem[] {
  const search = (filters.search ?? "").trim().toLowerCase();
  const format = (filters.format ?? "").trim().toLowerCase();
  const folder = (filters.folder ?? "").trim();
  const status = filters.status ?? "all";

  return items.filter((item) => {
    if (status !== "all" && item.status !== status) return false;
    if (format && item.format.toLowerCase() !== format) return false;
    if (!folderMatches(item.folder, folder)) return false;

    if (search) {
      const haystack = [
        item.name,
        item.logicalPath,
        item.physicalPath,
        item.storagePath ?? "",
        item.storedName ?? "",
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }

    return true;
  });
}

/* ------------------------------------------------------------------ */
/* Resumen                                                             */
/* ------------------------------------------------------------------ */

/**
 * Números del encabezado. El espacio ocupado se calcula sobre el tamaño
 * real de los archivos del inventario (el asset del build o, si hay
 * override, la versión que se está sirviendo).
 */
export function summarizeMediaInventory(items: InventoryItem[]): InventorySummary {
  let inUse = 0;
  let unused = 0;
  let replaced = 0;
  let trashed = 0;
  let bytes = 0;

  for (const item of items) {
    bytes += Math.max(0, Number(item.bytes) || 0);
    if (item.status === "trashed") {
      trashed += 1;
      continue;
    }
    if (item.status === "replaced") replaced += 1;
    if (item.referenceCount > 0) inUse += 1;
    else unused += 1;
  }

  return {
    total: items.length,
    active: items.length - trashed,
    inUse,
    unused,
    replaced,
    trashed,
    bytes,
  };
}

/* ------------------------------------------------------------------ */
/* Opciones de los filtros                                             */
/* ------------------------------------------------------------------ */

/** Formatos presentes en el inventario, sin repetir y ordenados. */
export function mediaFormatOptions(items: InventoryItem[]): string[] {
  const set = new Set<string>();
  for (const item of items) {
    if (item.format) set.add(item.format.toLowerCase());
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
}

/** Carpetas presentes en el inventario, sin repetir y ordenadas. */
export function mediaFolderOptions(items: InventoryItem[]): string[] {
  const set = new Set<string>();
  for (const item of items) {
    if (item.folder) set.add(item.folder);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
}

/* ------------------------------------------------------------------ */
/* Duplicados y borrado                                                */
/* ------------------------------------------------------------------ */

/**
 * Busca una imagen que ya ocupe la ruta lógica que searía al subir un
 * archivo con ese nombre en esa carpeta. Sirve para avisar antes de
 * sobrescribir.
 */
export function findDuplicateMedia(
  items: InventoryItem[],
  folder: string,
  fileName: string,
): InventoryItem | null {
  const target = mediaLogicalPath(folder, fileName);
  return items.find((item) => item.logicalPath === target) ?? null;
}

/**
 * Busca un archivo con el mismo nombre normalizado dentro de la misma
 * carpeta. Complementa a `findDuplicateMedia` para nombres que ya existían
 * con otra capitalización o con guiones distintos.
 */
export function findDuplicateByName(
  items: InventoryItem[],
  folder: string,
  fileName: string,
): InventoryItem | null {
  const normalized = normalizeMediaName(fileName);
  return (
    items.find(
      (item) => item.folder === folder && item.name.toLowerCase() === normalized,
    ) ?? null
  );
}

/**
 * Motivos por los que una imagen no se puede eliminar. Si la lista está
 * vacía, se puede pasar a la papelera (previa confirmación).
 */
export function mediaDeleteBlockers(item: InventoryItem): string[] {
  const blockers: string[] = [];

  if (item.essential) {
    blockers.push(
      "Es un asset compilado del sitio: forma parte del build y no se puede eliminar desde el panel. Podés reemplazarlo por una versión nueva.",
    );
  }
  if (item.protectedPath) {
    blockers.push(
      "Pertenece a una carpeta protegida (assets/ o backups/) y no se puede eliminar.",
    );
  }

  return blockers;
}

/**
 * Texto de la advertencia cuando la imagen está en uso. Devuelve `null`
 * cuando no hay referencias detectadas.
 */
export function mediaUsageWarning(item: InventoryItem): string | null {
  if (!item.referenceCount) return null;
  const places = item.referenceCount;
  return `Esta imagen está siendo utilizada en ${places} ${
    places === 1 ? "lugar" : "lugares"
  } del sitio web. Si la eliminás, podrías generar imágenes rotas o espacios vacíos.`;
}

/* ------------------------------------------------------------------ */
/* Apariciones                                                          */
/* ------------------------------------------------------------------ */

/**
 * Aparición tal como la declara el manifiesto del build.
 *
 * Es el mismo tipo que emite el build: cada vez que una imagen se usa en un
 * componente queda registrada una aparición con el lugar exacto (página,
 * sección y componente) y el archivo que usa.
 */
export type MediaOccurrenceManifestRecord = MediaOccurrenceRecord;

/** Estado de una aparición frente al archivo que usa. */
export type OccurrenceStatus = "unchanged" | "replaced" | "hidden";

/** Texto de cada estado, con la voz del panel. */
export const OCCURRENCE_STATUS_LABELS: Record<OccurrenceStatus, string> = {
  unchanged: "Sin cambios",
  replaced: "Reemplazada",
  hidden: "Oculta",
};

/** Una aparición del sitio: un lugar concreto donde se usa una imagen. */
export type OccurrenceItem = {
  /** Clave estable dentro de la interfaz. */
  key: string;
  /** Identificador de la aparición (el que usa el sitio para resolverla). */
  occurrenceId: string;
  /** Ruta lógica del archivo físico que usa la aparición. */
  imageLogicalPath: string;
  /** Nombre del archivo. */
  name: string;
  /** Página del sitio donde aparece. */
  page: string;
  /** Sección de la página donde aparece. */
  section: string;
  /** Componente que la usa. */
  component: string;
  /** Archivo del código donde se detectó la aparición. */
  sourceFile: string;
  /** Línea del archivo donde se detectó. */
  sourceLine: number;
  /** El escáner del build la detectó (`detected`) o está pendiente. */
  detected: boolean;
  /** Ruta física del archivo. */
  physicalPath: string;
  /** Ruta dentro del bucket que se está sirviendo (si hay override). */
  storagePath: string | null;
  /** URL que usa la página ahora mismo. */
  publicUrl: string;
  /** URL compilada del asset del paquete (la imagen original). */
  bundleUrl: string;
  width: number | null;
  height: number | null;
  bytes: number;
  format: string;
  modifiedAt: string | null;
  /** Cuántas apariciones comparten el mismo archivo. */
  sharedCount: number;
  /** Estado de esta aparición. */
  status: OccurrenceStatus;
  /** Ficha descriptiva de la aparición. */
  metadata: MediaMetadata;
  /** ¿La aparición tiene ficha propia en la base? */
  hasOverride: boolean;
};

/** Números del encabezado de la pestaña de apariciones. */
export type OccurrenceSummary = {
  /** Archivos físicos usados por el sitio. */
  physicalFiles: number;
  /** Apariciones totales. */
  totalOccurrences: number;
  /** Páginas que tienen al menos una imagen. */
  pagesWithImages: number;
  /** Imágenes que se usan en más de una sección. */
  sharedImages: number;
  /** Imágenes de la biblioteca que no usa ninguna aparición. */
  unusedImages: number;
};

/** Filtros de la pestaña de apariciones. */
export type OccurrenceFilters = {
  search: string;
  page: string;
  section: string;
  component: string;
  status: OccurrenceStatus | "all";
};

/**
 * Lee las apariciones del manifiesto.
 *
 * El manifiesto es un artefacto del build: puede venir de una versión
 * anterior que todavía no tenga el campo `occurrences`, así que se lee de
 * forma tolerante.
 */
export function manifestOccurrences(
  manifest: MediaManifest | null,
): MediaOccurrenceManifestRecord[] {
  const raw = manifest?.occurrences;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item) => item && typeof item.occurrenceId === "string" && item.occurrenceId,
  );
}

/**
 * Fusiona el manifiesto (apariciones detectadas) con las filas de `site_media`
 * (reemplazos, ocultes y metadatos por aparición).
 *
 * Devuelve **un registro por aparición**: no se agrupan las que comparten el
 * mismo archivo, porque cada una se puede editar o quitar por separado.
 */
export function mergeOccurrenceInventory(
  manifest: MediaManifest | null,
  rows: MediaRow[],
  occurrenceRows: MediaOccurrenceRow[],
  options: { storageUrl?: StorageUrlBuilder } = {},
): OccurrenceItem[] {
  const storageUrl = options.storageUrl ?? publicMediaUrl;
  const records = manifestOccurrences(manifest);
  const entries = manifest?.entries ?? [];

  const entryByLogical = new Map(entries.map((entry) => [entry.logicalPath, entry]));

  /* Fila física (override del archivo) por ruta lógica. */
  const fileRowByLogical = new Map<string, MediaRow>();
  /* Fila completa de una aparición, para traer medidas y peso. */
  const fullRowByOccurrence = new Map<string, MediaRow>();
  for (const row of rows ?? []) {
    const occurrenceId = (row as { occurrence_id?: string | null }).occurrence_id;
    if (occurrenceId) {
      fullRowByOccurrence.set(occurrenceId, row);
      continue;
    }
    if (row?.logical_path) fileRowByLogical.set(row.logical_path, row);
  }

  const overrideByOccurrence = new Map(
    (occurrenceRows ?? [])
      .filter((row) => row?.occurrence_id)
      .map((row) => [row.occurrence_id, row]),
  );

  /* Cuántas apariciones comparten cada archivo. */
  const sharedByLogical = new Map<string, number>();
  for (const record of records) {
    sharedByLogical.set(
      record.imageLogicalPath,
      (sharedByLogical.get(record.imageLogicalPath) ?? 0) + 1,
    );
  }

  const items: OccurrenceItem[] = [];

  for (const record of records) {
    const entry = entryByLogical.get(record.imageLogicalPath) ?? null;
    const fileRow = fileRowByLogical.get(record.imageLogicalPath) ?? null;
    const override = overrideByOccurrence.get(record.occurrenceId) ?? null;
    const fullRow = fullRowByOccurrence.get(record.occurrenceId) ?? null;

    const bundleUrl = entry?.publicPath ?? "";
    const fileOverridePath = fileRow?.storage_path ?? null;

    let status: OccurrenceStatus = "unchanged";
    let storagePath: string | null = null;
    let publicUrl = bundleUrl;
    let width = entry?.width ?? null;
    let height = entry?.height ?? null;
    let bytes = entry?.bytes ?? 0;
    let format = entry?.format ?? "";
    let modifiedAt = entry?.modifiedAt ?? null;

    if (override) {
      if (override.status === "hidden") {
        /* La aparición no muestra imagen: vuelve al asset del paquete. */
        status = "hidden";
        publicUrl = "";
      } else if (override.storage_path) {
        status = "replaced";
        storagePath = override.storage_path;
        publicUrl = storageUrl(override.storage_path);
      }
    }

    /* Si la aparición tiene su propia versión, mandan sus medidas. */
    if (status === "replaced" && fullRow) {
      width = fullRow.width ?? width;
      height = fullRow.height ?? height;
      bytes = Number(fullRow.size_bytes ?? bytes);
      format = fullRow.format || format;
      modifiedAt = fullRow.updated_at ?? modifiedAt;
    } else if (status === "unchanged" && fileOverridePath && fileRow) {
      /* El archivo físico tiene una versión nueva: la usan todas sus
         apariciones salvo las reemplazadas u ocultas. */
      status = "replaced";
      width = fileRow.width ?? width;
      height = fileRow.height ?? height;
      bytes = Number(fileRow.size_bytes ?? bytes);
      format = fileRow.format || format;
      modifiedAt = fileRow.updated_at ?? modifiedAt;
      storagePath = fileOverridePath;
      publicUrl = storageUrl(fileOverridePath);
    }

    const metadataSource = override
      ? {
          alt_text: override.alt_text,
          title: override.title,
          description: override.description,
          category: override.category,
          tags: override.tags,
        }
      : fullRow;

    items.push({
      key: `occurrence:${record.occurrenceId}`,
      occurrenceId: record.occurrenceId,
      imageLogicalPath: record.imageLogicalPath,
      name: entry?.originalName ?? record.imageLogicalPath.split("/").pop() ?? record.imageLogicalPath,
      page: record.page ?? "",
      section: record.section ?? "",
      component: record.component ?? "",
      sourceFile: record.file ?? "",
      sourceLine: Number(record.line ?? 0),
      detected: record.status !== "pending",
      physicalPath: entry?.physicalPath ?? record.imageLogicalPath,
      storagePath,
      publicUrl,
      bundleUrl,
      width,
      height,
      bytes,
      format,
      modifiedAt,
      sharedCount: sharedByLogical.get(record.imageLogicalPath) ?? 1,
      status,
      metadata: metadataSource
        ? {
            altText: metadataSource.alt_text ?? null,
            title: metadataSource.title ?? null,
            description: metadataSource.description ?? null,
            category: metadataSource.category ?? null,
            tags: Array.isArray(metadataSource.tags) ? metadataSource.tags : [],
          }
        : EMPTY_METADATA,
      hasOverride: Boolean(override),
    });
  }

  return items;
}

/* ------------------------------------------------------------------ */
/* Filtrado de apariciones                                              */
/* ------------------------------------------------------------------ */

/**
 * Aplica buscador y filtros sobre las apariciones.
 *
 * El buscador mira el nombre del archivo, la ruta lógica, la página, la
 * sección, el componente y la URL. Los filtros de página, sección,
 * componente y estado son exactos.
 */
export function filterOccurrences(
  items: OccurrenceItem[],
  filters: OccurrenceFilters,
): OccurrenceItem[] {
  const search = (filters.search ?? "").trim().toLowerCase();
  const page = (filters.page ?? "").trim();
  const section = (filters.section ?? "").trim();
  const component = (filters.component ?? "").trim();
  const status = filters.status ?? "all";

  return items.filter((item) => {
    if (status !== "all" && item.status !== status) return false;
    if (page && item.page !== page) return false;
    if (section && item.section !== section) return false;
    if (component && item.component !== component) return false;

    if (search) {
      const haystack = [
        item.occurrenceId,
        item.name,
        item.imageLogicalPath,
        item.page,
        item.section,
        item.component,
        item.publicUrl,
        item.physicalPath,
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }

    return true;
  });
}

/**
 * Orden estable: primero por página, después por sección, por componente y
 * finalmente por identificador de aparición.
 */
export function sortOccurrences(items: OccurrenceItem[]): OccurrenceItem[] {
  return [...items].sort((a, b) => {
    const byPage = a.page.localeCompare(b.page, "es");
    if (byPage !== 0) return byPage;
    const bySection = a.section.localeCompare(b.section, "es");
    if (bySection !== 0) return bySection;
    const byComponent = a.component.localeCompare(b.component, "es");
    if (byComponent !== 0) return byComponent;
    return a.occurrenceId.localeCompare(b.occurrenceId, "es");
  });
}

/* ------------------------------------------------------------------ */
/* Resumen de apariciones                                              */
/* ------------------------------------------------------------------ */

/**
 * Números del encabezado de la pestaña de apariciones.
 *
 * - `physicalFiles`: archivos físicos que usa el sitio.
 * - `totalOccurrences`: apariciones totales (una por lugar, sin agrupar).
 * - `pagesWithImages`: páginas con al menos una imagen.
 * - `sharedImages`: imágenes que se usan en más de un lugar del sitio.
 * - `unusedImages`: imágenes de la biblioteca que no usa ninguna aparición.
 */
export function summarizeOccurrences(
  occurrences: OccurrenceItem[],
  files: InventoryItem[] = [],
): OccurrenceSummary {
  const physicalFiles = new Set<string>();
  const pages = new Set<string>();
  const appearancesByFile = new Map<string, number>();

  for (const item of occurrences) {
    physicalFiles.add(item.imageLogicalPath);
    if (item.page) pages.add(item.page);
    appearancesByFile.set(
      item.imageLogicalPath,
      (appearancesByFile.get(item.imageLogicalPath) ?? 0) + 1,
    );
  }

  let sharedImages = 0;
  for (const appearances of appearancesByFile.values()) {
    if (appearances > 1) sharedImages += 1;
  }

  let unusedImages = 0;
  for (const file of files) {
    if (!physicalFiles.has(file.logicalPath)) unusedImages += 1;
  }

  return {
    physicalFiles: physicalFiles.size,
    totalOccurrences: occurrences.length,
    pagesWithImages: pages.size,
    sharedImages,
    unusedImages,
  };
}

/**
 * Total de apariciones del sitio: es el número que muestra el contador de la
 * navegación del panel.
 */
export function totalOccurrenceCount(
  occurrences: OccurrenceItem[],
): number {
  return occurrences.length;
}

/**
 * Cuenta cuántas apariciones usan cada archivo físico.
 * La clave es la ruta lógica del archivo.
 */
export function countOccurrencesByFile(
  occurrences: OccurrenceItem[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of occurrences) {
    counts.set(item.imageLogicalPath, (counts.get(item.imageLogicalPath) ?? 0) + 1);
  }
  return counts;
}

/* ------------------------------------------------------------------ */
/* Opciones de los filtros de apariciones                              */
/* ------------------------------------------------------------------ */

/** Páginas con apariciones, sin repetir y ordenadas. */
export function occurrencePageOptions(items: OccurrenceItem[]): string[] {
  const set = new Set<string>();
  for (const item of items) if (item.page) set.add(item.page);
  return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
}

/** Secciones con apariciones, sin repetir y ordenadas. */
export function occurrenceSectionOptions(items: OccurrenceItem[]): string[] {
  const set = new Set<string>();
  for (const item of items) if (item.section) set.add(item.section);
  return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
}

/** Componentes con apariciones, sin repetir y ordenados. */
export function occurrenceComponentOptions(items: OccurrenceItem[]): string[] {
  const set = new Set<string>();
  for (const item of items) if (item.component) set.add(item.component);
  return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
}

/* ------------------------------------------------------------------ */
/* Borrado de archivos con apariciones                                 */
/* ------------------------------------------------------------------ */

/**
 * Motivos por los que un archivo físico no se puede eliminar.
 *
 * Un archivo que usa alguna aparición viva no se puede borrar: primero hay
 * que quitar esas apariciones. Los assets del paquete (`assets/`) están
 * protegidos siempre.
 */
export function physicalFileDeleteBlockers(
  item: InventoryItem,
  occurrenceCount: number,
): string[] {
  const blockers = mediaDeleteBlockers(item);

  if (occurrenceCount > 0) {
    blockers.push(
      `Este archivo lo usan ${occurrenceCount} ${
        occurrenceCount === 1 ? "aparición" : "apariciones"
      } del sitio. Quitá esas apariciones antes de eliminarlo.`,
    );
  }

  return blockers;
}

/**
 * Texto de la advertencia al quitar una aparición de una sección.
 * Informa cuántas apariciones comparten el archivo, para que quede claro que
 * las demás no se tocan.
 */
export function occurrenceRemovalWarning(
  item: OccurrenceItem,
): string {
  const others = Math.max(0, item.sharedCount - 1);
  if (!others) {
    return "Esta aparición es la única que usa el archivo: al quitarla, el archivo físico se conserva igual.";
  }
  return `El archivo lo usan ${item.sharedCount} apariciones del sitio. Al quitar esta, las otras ${
    others === 1 ? "apariencia" : "apariciones"
  } siguen con la misma imagen y el archivo físico no se borra.`;
}
