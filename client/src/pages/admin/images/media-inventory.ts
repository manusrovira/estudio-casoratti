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

import type { MediaManifest, MediaReference } from "@/lib/mediaManifest";
import {
  mediaLogicalPath,
  publicMediaUrl,
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
