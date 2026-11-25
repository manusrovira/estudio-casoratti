/**
 * Servicios de la biblioteca de imágenes.
 *
 * Toda la persistencia va a Supabase: el bucket público `site-media` para los
 * binarios y las tablas `site_media`, `media_folders` y `media_activity` para
 * el inventario, las carpetas y la auditoría. El sitio se despliega como
 * aplicación estática de sólo lectura, así que el sistema de archivos del
 * proyecto no se puede escribir: el bucket es el único almacenamiento real.
 *
 * Se usa la clave pública de Supabase y las policies de RLS: el rol de
 * administrador se decide en Postgres (`public.is_admin()`), nunca acá.
 */

import { getSupabase } from "@/lib/supabase";
import {
  MEDIA_EXTENSION_MIME,
  isProtectedMediaPath,
  isSafeRelativePath,
  normalizeFolderPath,
  normalizeMediaName,
  safeStoragePath,
  validateImageFile,
} from "./media-validator";

/** Bucket público donde viven las imágenes administradas. */
export const SITE_MEDIA_BUCKET = "site-media";

/** Carpeta del bucket donde se guardan las copias de seguridad. */
export const MEDIA_BACKUP_PREFIX = "backups";

/** Fila de la tabla `site_media`. */
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

/** Resultado simple de una operación que no devuelve datos. */
export type MediaResult = { ok: true } | { ok: false; error: string };

/* ------------------------------------------------------------------ */
/* Utilidades internas                                                 */
/* ------------------------------------------------------------------ */

function supabaseOrThrow() {
  try {
    return getSupabase();
  } catch {
    throw new Error(
      "Supabase no está configurado: no se puede acceder a la biblioteca de imágenes.",
    );
  }
}

function isDuplicateError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();
  return (
    code === "23505" ||
    message.includes("duplicate key") ||
    message.includes("already exists")
  );
}

function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message?: unknown }).message ?? "").trim();
    if (message) return `${fallback}: ${message}`;
  }
  return fallback;
}

/** Identificador del administrador en sesión (o `null` si no hay). */
async function currentUserId(): Promise<string | null> {
  try {
    const { data } = await getSupabase().auth.getSession();
    return data.session?.user?.id ?? null;
  } catch {
    return null;
  }
}

function extensionOf(name: string): string {
  const lower = (name ?? "").toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot >= 0 && dot < lower.length - 1 ? lower.slice(dot + 1) : "";
}

function mimeOf(storedName: string): string {
  return MEDIA_EXTENSION_MIME[extensionOf(storedName)] ?? "application/octet-stream";
}

function formatOf(storedName: string): string {
  return extensionOf(storedName) || "bin";
}

/** Carpeta que contiene a la ruta lógica. */
function folderOf(logicalPath: string): string {
  const clean = (logicalPath ?? "").replace(/^\/+/, "");
  const index = clean.lastIndexOf("/");
  return index > 0 ? clean.slice(0, index) : "images/general";
}

/** Ruta de la copia de seguridad: `backups/<marca de tiempo>-<nombre>`. */
function backupStoragePath(storagePath: string): string {
  const base = storagePath.split("/").pop() || "imagen";
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "")
    .replace("T", "-")
    .replace(/Z$/, "");
  return `${MEDIA_BACKUP_PREFIX}/${stamp}-${base}`;
}

/**
 * Lee el tamaño real de la imagen. Usa `createImageBitmap` y, si el
 * navegador no lo soporta (SVG), cae a un `<img>` con object URL.
 */
export async function readImageDimensions(
  file: Blob,
): Promise<{ width: number; height: number } | null> {
  if (typeof window === "undefined" || typeof document === "undefined") return null;

  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    /* createImageBitmap no soporta todos los formatos: seguimos con <img>. */
  }

  try {
    const url = URL.createObjectURL(file);
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("no se pudo leer la imagen"));
      image.src = url;
    });
    const size = { width: image.naturalWidth, height: image.naturalHeight };
    URL.revokeObjectURL(url);
    return size;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Lectura                                                             */
/* ------------------------------------------------------------------ */

/**
 * Lista todos los medios registrados, del más nuevo al más viejo.
 * Si Supabase responde con error, lanza una `Error` con un mensaje en
 * español para que la interfaz lo muestre.
 */
export async function listMedia(): Promise<MediaRow[]> {
  const { data, error } = await supabaseOrThrow()
    .from("site_media")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(
      errorMessage(error, "No se pudo cargar la biblioteca de imágenes."),
    );
  }
  return (data ?? []) as MediaRow[];
}

/** Lista las carpetas de medios, ordenadas alfabéticamente. */
export async function listFolders(): Promise<string[]> {
  const { data, error } = await supabaseOrThrow()
    .from("media_folders")
    .select("path")
    .order("path", { ascending: true });

  if (error) {
    throw new Error(
      errorMessage(error, "No se pudieron cargar las carpetas de imágenes."),
    );
  }
  const rows = (data ?? []) as Array<{ path?: string | null }>;
  const paths = rows
    .map((row) => (row.path ?? "").trim())
    .filter((path): path is string => path.length > 0);
  return Array.from(new Set(paths)).sort((a, b) => a.localeCompare(b, "es"));
}

/* ------------------------------------------------------------------ */
/* Carpetas                                                            */
/* ------------------------------------------------------------------ */

/**
 * Crea una carpeta de medios. La ruta se valida antes de normalizarse: una
 * ruta con `..` o absoluta se rechaza sin tocar la base.
 */
export async function createFolder(path: string): Promise<MediaResult> {
  const raw = (path ?? "").trim();
  if (!raw) {
    return { ok: false, error: "Indicá el nombre de la carpeta." };
  }
  if (!isSafeRelativePath(raw)) {
    return {
      ok: false,
      error: "La ruta de la carpeta no es válida: usá una ruta relativa dentro del directorio de imágenes.",
    };
  }

  const normalized = normalizeFolderPath(raw);
  if (!normalized) {
    return { ok: false, error: "La ruta de la carpeta no es válida." };
  }
  if (normalized.length > 120) {
    return {
      ok: false,
      error: "La ruta de la carpeta es demasiado larga (máximo 120 caracteres).",
    };
  }

  const { error } = await supabaseOrThrow().from("media_folders").insert({
    path: normalized,
    created_by: await currentUserId(),
  });

  if (error) {
    if (isDuplicateError(error)) {
      return {
        ok: false,
        error: `Ya existe una carpeta con la ruta «${normalized}».`,
      };
    }
    return {
      ok: false,
      error: errorMessage(error, "No se pudo crear la carpeta."),
    };
  }

  await logMediaActivity("folder_create", normalized, "success", { path: normalized });
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Carga                                                               */
/* ------------------------------------------------------------------ */

/**
 * Sube una imagen al bucket y la registra en `site_media`.
 *
 * El archivo se valida completo (extensión, MIME y bytes mágicos) antes de
 * tocar la red. Si el registro en la base falla, el objeto subido se borra
 * para no dejar basura en el bucket.
 */
export async function uploadImage(
  file: File,
  folder: string,
  options?: { logicalPath?: string; overwrite?: boolean },
): Promise<
  { ok: true; storagePath: string; logicalPath: string } | { ok: false; error: string }
> {
  const validation = await validateImageFile(file);
  if (!validation.ok) return { ok: false, error: validation.error };

  const storedName = normalizeMediaName(file.name);
  const storagePath = safeStoragePath(folder, storedName);

  let logicalPath = mediaLogicalPath(folder, storedName);
  if (options?.logicalPath) {
    const candidate = options.logicalPath.trim().replace(/^\/+|\/+$/g, "");
    if (!isSafeRelativePath(candidate)) {
      return { ok: false, error: "La ruta lógica indicada no es válida." };
    }
    logicalPath = candidate;
  }

  const overwrite = Boolean(options?.overwrite);
  const supabase = supabaseOrThrow();

  const { data: existing } = await supabase
    .from("site_media")
    .select("id, storage_path")
    .eq("logical_path", logicalPath)
    .maybeSingle();

  if (existing && !overwrite) {
    return {
      ok: false,
      error: `Ya existe una imagen con el nombre «${storedName}» en esa carpeta. Elegí otro nombre o confirmá el reemplazo.`,
    };
  }

  const { error: uploadError } = await supabase.storage
    .from(SITE_MEDIA_BUCKET)
    .upload(storagePath, file, { upsert: overwrite, cacheControl: "3600" });

  if (uploadError) {
    const message = uploadError.message ?? "";
    if (isDuplicateError({ message }) || /already exists/i.test(message)) {
      return {
        ok: false,
        error: `Ya existe una imagen con el nombre «${storedName}» en esa carpeta.`,
      };
    }
    return {
      ok: false,
      error: errorMessage(uploadError, "No se pudo subir la imagen."),
    };
  }

  const dimensions = await readImageDimensions(file);
  const payload = {
    storage_path: storagePath,
    mime_type: mimeOf(storedName),
    format: formatOf(storedName),
    size_bytes: file.size,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    updated_at: new Date().toISOString(),
    updated_by: await currentUserId(),
  };

  if (existing) {
    const { error: updateError } = await supabase
      .from("site_media")
      .update({
        ...payload,
        source: "override",
        original_name: file.name,
        stored_name: storedName,
      })
      .eq("id", (existing as { id: string }).id);
    if (updateError) {
      // Sólo se borra el objeto si quedó huérfano: si es el mismo que ya
      // referencia la fila, borrarlo dejaría la imagen sin archivo.
      const previousPath = (existing as { storage_path?: string | null })?.storage_path;
      if (previousPath !== storagePath) {
        await supabase.storage.from(SITE_MEDIA_BUCKET).remove([storagePath]);
      }
      return {
        ok: false,
        error: errorMessage(
          updateError,
          "No se pudo registrar la imagen que se subió.",
        ),
      };
    }
    await logMediaActivity("replace", logicalPath, "success", {
      storagePath,
      overwrite: true,
    });
    return { ok: true, storagePath, logicalPath };
  }

  const { error: insertError } = await supabase.from("site_media").insert({
    logical_path: logicalPath,
    storage_path: storagePath,
    source: "upload",
    original_name: file.name,
    stored_name: storedName,
    mime_type: mimeOf(storedName),
    format: formatOf(storedName),
    size_bytes: file.size,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    created_by: await currentUserId(),
  });

  if (insertError) {
    // El objeto quedó subido pero sin registro: se borra para no dejar basura.
    await supabase.storage.from(SITE_MEDIA_BUCKET).remove([storagePath]);
    return {
      ok: false,
      error: errorMessage(
        insertError,
        "La imagen se subió pero no se pudo registrar.",
      ),
    };
  }

  await logMediaActivity("upload", logicalPath, "success", {
    storagePath,
    folder: folderOf(logicalPath),
    sizeBytes: file.size,
  });
  return { ok: true, storagePath, logicalPath };
}

/* ------------------------------------------------------------------ */
/* Reemplazo                                                           */
/* ------------------------------------------------------------------ */

/**
 * Reemplaza una imagen **sin cambiar su ruta lógica**: las referencias del
 * sitio siguen apuntando al mismo lugar y lo que se ve es la versión nueva.
 *
 * Antes de sobrescribir se guarda una copia de la versión original en
 * `backups/` (se puede desactivar con `{ backup: false }`).
 */
export async function replaceImage(
  logicalPath: string,
  file: File,
  options?: { backup?: boolean },
): Promise<{ ok: true; storagePath: string } | { ok: false; error: string }> {
  const validation = await validateImageFile(file);
  if (!validation.ok) return { ok: false, error: validation.error };

  const supabase = supabaseOrThrow();
  const { data: row, error: lookupError } = await supabase
    .from("site_media")
    .select("*")
    .eq("logical_path", logicalPath)
    .maybeSingle();

  if (lookupError) {
    return {
      ok: false,
      error: errorMessage(lookupError, "No se pudo buscar la imagen a reemplazar."),
    };
  }
  if (!row) {
    return {
      ok: false,
      error: `No se encontró ninguna imagen con la ruta «${logicalPath}».`,
    };
  }

  const current = row as MediaRow;
  const withBackup = options?.backup !== false;

  let backupPath: string | null = null;
  if (withBackup && current.storage_path) {
    backupPath = backupStoragePath(current.storage_path);
    const { error: copyError } = await supabase.storage
      .from(SITE_MEDIA_BUCKET)
      .copy(current.storage_path, backupPath);
    if (copyError) {
      return {
        ok: false,
        error: errorMessage(
          copyError,
          "No se pudo guardar la copia de seguridad de la imagen original.",
        ),
      };
    }
  }

  const storedName = normalizeMediaName(file.name);
  let targetPath = current.storage_path ?? safeStoragePath(folderOf(logicalPath), storedName);
  if (!targetPath || targetPath.startsWith(`${MEDIA_BACKUP_PREFIX}/`)) {
    // No se sobrescribe una copia de seguridad: se sube a una ruta nueva.
    targetPath = safeStoragePath(folderOf(logicalPath), storedName);
  }

  const { error: uploadError } = await supabase.storage
    .from(SITE_MEDIA_BUCKET)
    .upload(targetPath, file, { upsert: true, cacheControl: "3600" });

  if (uploadError) {
    return {
      ok: false,
      error: errorMessage(uploadError, "No se pudo reemplazar la imagen."),
    };
  }

  const dimensions = await readImageDimensions(file);
  const { error: updateError } = await supabase
    .from("site_media")
    .update({
      storage_path: targetPath,
      source: "override",
      mime_type: mimeOf(storedName),
      format: formatOf(storedName),
      size_bytes: file.size,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      updated_at: new Date().toISOString(),
      updated_by: await currentUserId(),
    })
    .eq("id", current.id);

  if (updateError) {
    return {
      ok: false,
      error: errorMessage(
        updateError,
        "La imagen se reemplazó pero no se pudo actualizar su registro.",
      ),
    };
  }

  await logMediaActivity("replace", logicalPath, "success", {
    storagePath: targetPath,
    backupPath,
  });
  return { ok: true, storagePath: targetPath };
}

/* ------------------------------------------------------------------ */
/* Metadatos                                                           */
/* ------------------------------------------------------------------ */

/** Actualiza los metadatos descriptivos de una imagen. */
export async function updateMediaMetadata(
  id: string,
  patch: Partial<
    Pick<MediaRow, "alt_text" | "title" | "description" | "category" | "tags">
  >,
): Promise<MediaResult> {
  const allowed = ["alt_text", "title", "description", "category", "tags"] as const;
  const payload: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in (patch ?? {})) payload[key] = (patch as Record<string, unknown>)[key];
  }
  if (!Object.keys(payload).length) {
    return { ok: false, error: "No hay cambios para guardar." };
  }

  const supabase = supabaseOrThrow();
  const { data: row } = await supabase
    .from("site_media")
    .select("logical_path")
    .eq("id", id)
    .maybeSingle();

  payload.updated_at = new Date().toISOString();
  payload.updated_by = await currentUserId();

  const { error } = await supabase.from("site_media").update(payload).eq("id", id);
  if (error) {
    return {
      ok: false,
      error: errorMessage(error, "No se pudo actualizar la información de la imagen."),
    };
  }

  await logMediaActivity(
    "metadata_update",
    (row as { logical_path?: string } | null)?.logical_path ?? id,
    "success",
    { campos: Object.keys(payload).filter((key) => key !== "updated_at" && key !== "updated_by") },
  );
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Papelera                                                            */
/* ------------------------------------------------------------------ */

/** Manda una imagen a la papelera. El archivo físico no se borra todavía. */
export async function trashMedia(id: string): Promise<MediaResult> {
  const supabase = supabaseOrThrow();
  const { data: row } = await supabase
    .from("site_media")
    .select("logical_path, status")
    .eq("id", id)
    .maybeSingle();

  if (!row) {
    return { ok: false, error: "No se encontró la imagen." };
  }
  const current = row as { logical_path: string; status: string };
  if (current.status === "trashed") {
    return { ok: false, error: "La imagen ya está en la papelera." };
  }

  const { error } = await supabase
    .from("site_media")
    .update({
      status: "trashed",
      deleted_at: new Date().toISOString(),
      deleted_by: await currentUserId(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    return {
      ok: false,
      error: errorMessage(error, "No se pudo mover la imagen a la papelera."),
    };
  }

  await logMediaActivity("delete", current.logical_path, "success", { id });
  return { ok: true };
}

/** Saca una imagen de la papelera y la vuelve a activar. */
export async function restoreMedia(id: string): Promise<MediaResult> {
  const supabase = supabaseOrThrow();
  const { data: row } = await supabase
    .from("site_media")
    .select("logical_path, status")
    .eq("id", id)
    .maybeSingle();

  if (!row) {
    return { ok: false, error: "No se encontró la imagen." };
  }
  const current = row as { logical_path: string; status: string };
  if (current.status !== "trashed") {
    return { ok: false, error: "La imagen no está en la papelera." };
  }

  const { error } = await supabase
    .from("site_media")
    .update({
      status: "active",
      deleted_at: null,
      deleted_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    return {
      ok: false,
      error: errorMessage(error, "No se pudo restaurar la imagen."),
    };
  }

  await logMediaActivity("restore", current.logical_path, "success", { id });
  return { ok: true };
}

/**
 * Borrado definitivo: elimina el objeto del bucket y la fila de la base.
 * Sólo se permite desde la papelera y nunca sobre rutas protegidas.
 */
export async function purgeMedia(id: string): Promise<MediaResult> {
  const supabase = supabaseOrThrow();
  const { data: row } = await supabase
    .from("site_media")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!row) {
    return { ok: false, error: "No se encontró la imagen." };
  }
  const current = row as MediaRow;

  if (current.status !== "trashed") {
    return {
      ok: false,
      error: "Sólo se puede eliminar definitivamente una imagen que está en la papelera.",
    };
  }
  if (current.storage_path && isProtectedMediaPath(current.storage_path)) {
    return {
      ok: false,
      error: "Esta imagen pertenece a una carpeta protegida y no se puede eliminar definitivamente.",
    };
  }

  if (current.storage_path) {
    const { error: storageError } = await supabase.storage
      .from(SITE_MEDIA_BUCKET)
      .remove([current.storage_path]);
    if (storageError) {
      return {
        ok: false,
        error: errorMessage(storageError, "No se pudo borrar el archivo de la imagen."),
      };
    }
  }

  const { error: deleteError } = await supabase.from("site_media").delete().eq("id", id);
  if (deleteError) {
    return {
      ok: false,
      error: errorMessage(deleteError, "No se pudo eliminar el registro de la imagen."),
    };
  }

  await logMediaActivity("purge", current.logical_path, "success", { id });
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Rutas y URLs                                                        */
/* ------------------------------------------------------------------ */

/**
 * URL pública de un objeto del bucket `site-media`. Cada segmento de la ruta
 * va codificado por separado para que los nombres con espacios o acentos
 * funcionen.
 */
export function publicMediaUrl(storagePath: string): string {
  const clean = (storagePath ?? "").trim().replace(/^\/+/, "");
  if (!clean) return "";
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!base) return "";
  const encoded = clean
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${base}/storage/v1/object/public/${SITE_MEDIA_BUCKET}/${encoded}`;
}

/** Ruta lógica de una imagen: `carpeta/<nombre normalizado>`. */
export function mediaLogicalPath(folder: string, fileName: string): string {
  const safeFolder = normalizeFolderPath(folder);
  const safeName = normalizeMediaName(fileName);
  return `${safeFolder}/${safeName}`.replace(/^\/+/, "").replace(/\/+$/, "");
}

/* ------------------------------------------------------------------ */
/* Apariciones                                                          */
/* ------------------------------------------------------------------ */

/** Carpeta del bucket donde viven los archivos de las apariciones. */
export const MEDIA_OCCURRENCE_PREFIX = "occurrences";

/**
 * Fila de `site_media` que corresponde a una **aparición**: un lugar concreto
 * del sitio donde se usa una imagen.
 *
 * La fila del archivo físico nunca se toca desde acá: una aparición es un
 * registro aparte, con su propio `occurrence_id` y su propia ruta lógica
 * (`occurrence/<id>`).
 */
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

/** Fila completa de `site_media` con el identificador de aparición. */
type OccurrenceDbRow = {
  id?: string;
  occurrence_id?: string | null;
  storage_path?: string | null;
  status?: string | null;
  logical_path?: string | null;
  original_name?: string | null;
  stored_name?: string | null;
  mime_type?: string | null;
  format?: string | null;
  size_bytes?: number | null;
  width?: number | null;
  height?: number | null;
  title?: string | null;
  alt_text?: string | null;
  description?: string | null;
  category?: string | null;
  tags?: string[] | null;
};

/**
 * Contexto mínimo del archivo que usa la aparición. Se usa sólo cuando la
 * aparición todavía no tiene fila propia y hay que crearla (por ejemplo, al
 * quitarle la imagen a una aparición que nunca fue editada).
 */
export type MediaOccurrenceContext = {
  /** Nombre original del archivo que usa la aparición. */
  name?: string;
  /** Formato del archivo ("jpg", "png", …). */
  format?: string;
  /** Tipo MIME declarado del archivo. */
  mimeType?: string;
  /** Peso del archivo, en bytes. */
  bytes?: number;
  /** Ancho en píxeles. */
  width?: number | null;
  /** Alto en píxeles. */
  height?: number | null;
};

/** ¿El error dice que la columna `occurrence_id` todavía no existe? */
function isMissingOccurrenceColumn(
  error: { code?: string; message?: string } | null,
): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();
  return (
    code === "42703" ||
    message.includes("occurrence_id") ||
    message.includes("does not exist")
  );
}

/** Normaliza una fila de la base al tipo público de aparición. */
function normalizeOccurrenceRow(row: OccurrenceDbRow): MediaOccurrenceRow {
  const status =
    row.status === "hidden" || row.status === "trashed" ? row.status : "active";
  return {
    occurrence_id: row.occurrence_id ?? "",
    storage_path: row.storage_path ?? null,
    status,
    title: row.title ?? null,
    alt_text: row.alt_text ?? null,
    description: row.description ?? null,
    category: row.category ?? null,
    tags: Array.isArray(row.tags) ? row.tags : [],
  };
}

/** Ruta lógica de la fila de una aparición: `occurrence/<id>`. */
export function occurrenceLogicalPath(occurrenceId: string): string {
  return `occurrence/${(occurrenceId ?? "").trim()}`;
}

/**
 * Ruta dentro del bucket para el archivo de una aparición. Cada aparición
 * tiene su propia carpeta: dos apariciones nunca comparten objeto.
 */
export function occurrenceStoragePath(
  occurrenceId: string,
  fileName: string,
): string {
  const id = (occurrenceId ?? "").trim().replace(/[^a-zA-Z0-9_-]+/g, "-");
  return `${MEDIA_OCCURRENCE_PREFIX}/${id}/${normalizeMediaName(fileName)}`;
}

/**
 * Lista las apariciones que tienen ficha propia en la base (las que fueron
 * editadas, reemplazadas u ocultadas desde el panel).
 *
 * Si la base todavía no tiene la columna `occurrence_id` (migración pendiente)
 * devuelve una lista vacía: el panel sigue funcionando.
 */
export async function listOccurrenceOverrides(): Promise<MediaOccurrenceRow[]> {
  const { data, error } = await supabaseOrThrow()
    .from("site_media")
    .select(
      "occurrence_id, storage_path, status, title, alt_text, description, category, tags",
    )
    .not("occurrence_id", "is", null)
    .order("occurrence_id", { ascending: true });

  if (error) {
    if (isMissingOccurrenceColumn(error)) {
      console.warn(
        "La tabla site_media todavía no tiene la columna occurrence_id: no hay apariciones registradas.",
      );
      return [];
    }
    throw new Error(
      errorMessage(error, "No se pudieron cargar las apariciones de imágenes."),
    );
  }

  return ((data ?? []) as OccurrenceDbRow[]).map(normalizeOccurrenceRow);
}

/**
 * Reemplaza la imagen de **una sola aparición**.
 *
 * Escribe una fila con `occurrence_id` y `logical_path = occurrence/<id>`:
 * la fila del archivo físico no se toca, así que las demás apariciones que
 * usan ese mismo archivo siguen mostrando la imagen original.
 *
 * Con `backup: true` (por omisión) la versión anterior se copia a `backups/`.
 */
export async function upsertOccurrenceImage(
  occurrenceId: string,
  file: File,
  options?: { backup?: boolean },
): Promise<{ ok: true; storagePath: string } | { ok: false; error: string }> {
  const id = (occurrenceId ?? "").trim();
  if (!id) {
    return { ok: false, error: "No se indicó qué aparición hay que reemplazar." };
  }
  if (!isSafeRelativePath(id)) {
    return { ok: false, error: "El identificador de la aparición no es válido." };
  }

  const validation = await validateImageFile(file);
  if (!validation.ok) return { ok: false, error: validation.error };

  const supabase = supabaseOrThrow();
  const { data: existing, error: lookupError } = await supabase
    .from("site_media")
    .select("id, storage_path, logical_path")
    .eq("occurrence_id", id)
    .maybeSingle();

  if (lookupError) {
    if (isMissingOccurrenceColumn(lookupError)) {
      return {
        ok: false,
        error:
          "La base todavía no admite apariciones: falta aplicar la migración de la tabla de imágenes.",
      };
    }
    return {
      ok: false,
      error: errorMessage(
        lookupError,
        "No se pudo buscar la aparición a reemplazar.",
      ),
    };
  }

  const current = (existing ?? null) as OccurrenceDbRow | null;
  const logicalPath = occurrenceLogicalPath(id);
  const storedName = normalizeMediaName(file.name);
  const storagePath = occurrenceStoragePath(id, storedName);

  /* Copia de seguridad de la versión anterior (si la había). */
  const withBackup = options?.backup !== false;
  let backupPath: string | null = null;
  if (withBackup && current?.storage_path) {
    backupPath = backupStoragePath(current.storage_path);
    const { error: copyError } = await supabase.storage
      .from(SITE_MEDIA_BUCKET)
      .copy(current.storage_path, backupPath);
    if (copyError) {
      return {
        ok: false,
        error: errorMessage(
          copyError,
          "No se pudo guardar la copia de seguridad de la imagen anterior.",
        ),
      };
    }
  }

  const { error: uploadError } = await supabase.storage
    .from(SITE_MEDIA_BUCKET)
    .upload(storagePath, file, { upsert: true, cacheControl: "3600" });

  if (uploadError) {
    return {
      ok: false,
      error: errorMessage(uploadError, "No se pudo subir la imagen de la aparición."),
    };
  }

  const dimensions = await readImageDimensions(file);
  const payload = {
    occurrence_id: id,
    logical_path: logicalPath,
    storage_path: storagePath,
    provider: "supabase-storage",
    source: "override",
    original_name: file.name,
    stored_name: storedName,
    mime_type: mimeOf(storedName),
    format: formatOf(storedName),
    size_bytes: file.size,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    status: "active",
    deleted_at: null,
    deleted_by: null,
    updated_at: new Date().toISOString(),
    updated_by: await currentUserId(),
  };

  if (current?.id) {
    const { error: updateError } = await supabase
      .from("site_media")
      .update(payload)
      .eq("id", current.id);

    if (updateError) {
      return {
        ok: false,
        error: errorMessage(
          updateError,
          "La imagen se subió pero no se pudo registrar el reemplazo de la aparición.",
        ),
      };
    }

    /* El objeto anterior queda respaldado en `backups/`: se puede limpiar. */
    if (
      backupPath &&
      current.storage_path &&
      current.storage_path !== storagePath
    ) {
      await supabase.storage
        .from(SITE_MEDIA_BUCKET)
        .remove([current.storage_path]);
    }
  } else {
    const { error: insertError } = await supabase.from("site_media").insert({
      ...payload,
      created_by: await currentUserId(),
    });

    if (insertError) {
      // El objeto quedó subido pero sin registro: se borra para no dejar basura.
      await supabase.storage.from(SITE_MEDIA_BUCKET).remove([storagePath]);
      return {
        ok: false,
        error: errorMessage(
          insertError,
          "La imagen se subió pero no se pudo registrar la aparición.",
        ),
      };
    }
  }

  await logMediaActivity("replace", logicalPath, "success", {
    occurrenceId: id,
    storagePath,
    backupPath,
  });
  return { ok: true, storagePath };
}

/**
 * Quita la imagen de una aparición (`hidden: true`) o la vuelve a mostrar
 * (`hidden: false`).
 *
 * Al ocultarla, el sitio deja de mostrar esa imagen y las demás apariciones no
 * cambian. **El reemplazo se conserva**: la fila queda oculta pero sigue
 * apuntando a su archivo, así que al volver a mostrarla reaparece la versión
 * que el administrador había elegido, y no la original del paquete.
 */
export async function setOccurrenceHidden(
  occurrenceId: string,
  hidden: boolean,
  context?: MediaOccurrenceContext,
): Promise<MediaResult> {
  const id = (occurrenceId ?? "").trim();
  if (!id) {
    return { ok: false, error: "No se indicó la aparición." };
  }
  if (!isSafeRelativePath(id)) {
    return { ok: false, error: "El identificador de la aparición no es válido." };
  }

  const supabase = supabaseOrThrow();
  const { data: row, error: lookupError } = await supabase
    .from("site_media")
    .select("id, storage_path, status, logical_path")
    .eq("occurrence_id", id)
    .maybeSingle();

  if (lookupError) {
    if (isMissingOccurrenceColumn(lookupError)) {
      return {
        ok: false,
        error:
          "La base todavía no admite apariciones: falta aplicar la migración de la tabla de imágenes.",
      };
    }
    return {
      ok: false,
      error: errorMessage(lookupError, "No se pudo buscar la aparición."),
    };
  }

  const current = (row ?? null) as OccurrenceDbRow | null;
  const logicalPath = occurrenceLogicalPath(id);

  if (hidden) {
    if (!current?.id) {
      /* La aparición todavía no tiene ficha: se crea oculta y sin archivo. */
      const format = (context?.format ?? "jpg").toLowerCase();
      const { error: insertError } = await supabase.from("site_media").insert({
        occurrence_id: id,
        logical_path: logicalPath,
        storage_path: null,
        provider: "supabase-storage",
        source: "override",
        original_name: context?.name ?? id,
        stored_name: null,
        mime_type:
          context?.mimeType ?? MEDIA_EXTENSION_MIME[format] ?? "image/jpeg",
        format: MEDIA_EXTENSION_MIME[format] ? format : "jpg",
        size_bytes: Math.max(0, context?.bytes ?? 0),
        width: context?.width ?? null,
        height: context?.height ?? null,
        status: "hidden",
        deleted_at: new Date().toISOString(),
        deleted_by: await currentUserId(),
        created_by: await currentUserId(),
        updated_at: new Date().toISOString(),
        updated_by: await currentUserId(),
      });

      if (insertError) {
        return {
          ok: false,
          error: errorMessage(
            insertError,
            "No se pudo quitar la imagen de esa sección.",
          ),
        };
      }

      await logMediaActivity("delete", logicalPath, "success", {
        occurrenceId: id,
        accion: "ocultar-aparicion",
      });
      return { ok: true };
    }

    const { error } = await supabase
      .from("site_media")
      .update({
        status: "hidden",
        deleted_at: new Date().toISOString(),
        deleted_by: await currentUserId(),
        updated_at: new Date().toISOString(),
        updated_by: await currentUserId(),
      })
      .eq("id", current.id);

    if (error) {
      return {
        ok: false,
        error: errorMessage(
          error,
          "No se pudo quitar la imagen de esa sección.",
        ),
      };
    }

    await logMediaActivity("delete", logicalPath, "success", {
      occurrenceId: id,
      accion: "ocultar-aparicion",
      storagePathAnterior: current.storage_path ?? null,
    });
    return { ok: true };
  }

  if (!current?.id) {
    return {
      ok: false,
      error: "Esta aparición no tiene una ficha para restaurar.",
    };
  }

  const { error } = await supabase
    .from("site_media")
    .update({
      status: "active",
      deleted_at: null,
      deleted_by: null,
      updated_at: new Date().toISOString(),
      updated_by: await currentUserId(),
    })
    .eq("id", current.id);

  if (error) {
    return {
      ok: false,
      error: errorMessage(error, "No se pudo restaurar la aparición."),
    };
  }

  await logMediaActivity("restore", logicalPath, "success", {
    occurrenceId: id,
    accion: "mostrar-aparicion",
  });
  return { ok: true };
}

/**
 * Actualiza los metadatos descriptivos de **una aparición** (texto
 * alternativo, título, descripción, categoría y etiquetas).
 */
export async function updateOccurrenceMetadata(
  occurrenceId: string,
  patch: Partial<
    Pick<
      MediaOccurrenceRow,
      "title" | "alt_text" | "description" | "category" | "tags"
    >
  >,
  context?: MediaOccurrenceContext,
): Promise<MediaResult> {
  const id = (occurrenceId ?? "").trim();
  if (!id) {
    return { ok: false, error: "No se indicó la aparición." };
  }

  const allowed = [
    "title",
    "alt_text",
    "description",
    "category",
    "tags",
  ] as const;
  const payload: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in (patch ?? {})) {
      payload[key] = (patch as Record<string, unknown>)[key];
    }
  }
  if (!Object.keys(payload).length) {
    return { ok: false, error: "No hay cambios para guardar." };
  }

  const supabase = supabaseOrThrow();
  const { data: row, error: lookupError } = await supabase
    .from("site_media")
    .select("id")
    .eq("occurrence_id", id)
    .maybeSingle();

  if (lookupError) {
    if (isMissingOccurrenceColumn(lookupError)) {
      return {
        ok: false,
        error:
          "La base todavía no admite apariciones: falta aplicar la migración de la tabla de imágenes.",
      };
    }
    return {
      ok: false,
      error: errorMessage(
        lookupError,
        "No se pudo buscar la aparición.",
      ),
    };
  }

  const current = (row ?? null) as OccurrenceDbRow | null;
  const now = new Date().toISOString();

  if (!current?.id) {
    /* Sin ficha previa: se crea con la información descriptiva cargada. */
    const format = (context?.format ?? "jpg").toLowerCase();
    const { error: insertError } = await supabase.from("site_media").insert({
      occurrence_id: id,
      logical_path: occurrenceLogicalPath(id),
      storage_path: null,
      provider: "supabase-storage",
      source: "override",
      original_name: context?.name ?? id,
      stored_name: null,
      mime_type:
        context?.mimeType ?? MEDIA_EXTENSION_MIME[format] ?? "image/jpeg",
      format: MEDIA_EXTENSION_MIME[format] ? format : "jpg",
      size_bytes: Math.max(0, context?.bytes ?? 0),
      width: context?.width ?? null,
      height: context?.height ?? null,
      status: "active",
      ...payload,
      created_by: await currentUserId(),
      updated_at: now,
      updated_by: await currentUserId(),
    });

    if (insertError) {
      return {
        ok: false,
        error: errorMessage(
          insertError,
          "No se pudo actualizar la información de la aparición.",
        ),
      };
    }

    await logMediaActivity("edit", occurrenceLogicalPath(id), "success", {
      occurrenceId: id,
      campos: Object.keys(payload),
    });
    return { ok: true };
  }

  const { error } = await supabase
    .from("site_media")
    .update({
      ...payload,
      updated_at: now,
      updated_by: await currentUserId(),
    })
    .eq("id", current.id);

  if (error) {
    return {
      ok: false,
      error: errorMessage(
        error,
        "No se pudo actualizar la información de la aparición.",
      ),
    };
  }

  await logMediaActivity("edit", occurrenceLogicalPath(id), "success", {
    occurrenceId: id,
    campos: Object.keys(payload),
  });
  return { ok: true };
}

/**
 * Deshace el reemplazo de una aparición: borra su fila y su objeto, y el
 * sitio vuelve a mostrar el archivo original del paquete.
 */
export async function purgeOccurrenceOverride(
  occurrenceId: string,
): Promise<MediaResult> {
  const id = (occurrenceId ?? "").trim();
  if (!id) {
    return { ok: false, error: "No se indicó la aparición." };
  }

  const supabase = supabaseOrThrow();
  const { data: row, error: lookupError } = await supabase
    .from("site_media")
    .select("id, storage_path, logical_path")
    .eq("occurrence_id", id)
    .maybeSingle();

  if (lookupError) {
    return {
      ok: false,
      error: errorMessage(lookupError, "No se pudo buscar la aparición."),
    };
  }

  const current = (row ?? null) as OccurrenceDbRow | null;
  if (!current?.id) {
    return {
      ok: false,
      error: "Esta aparición no tiene un reemplazo propio que se pueda deshacer.",
    };
  }

  if (current.storage_path && !isProtectedMediaPath(current.storage_path)) {
    const { error: storageError } = await supabase.storage
      .from(SITE_MEDIA_BUCKET)
      .remove([current.storage_path]);
    if (storageError) {
      return {
        ok: false,
        error: errorMessage(
          storageError,
          "No se pudo borrar el archivo del reemplazo.",
        ),
      };
    }
  }

  const { error: deleteError } = await supabase
    .from("site_media")
    .delete()
    .eq("id", current.id);

  if (deleteError) {
    return {
      ok: false,
      error: errorMessage(
        deleteError,
        "No se pudo eliminar el registro del reemplazo.",
      ),
    };
  }

  await logMediaActivity(
    "delete",
    current.logical_path ?? occurrenceLogicalPath(id),
    "success",
    { occurrenceId: id, accion: "deshacer-reemplazo" },
  );
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Auditoría                                                           */
/* ------------------------------------------------------------------ */

/**
 * Registra una operación en `media_activity` a través del RPC
 * `log_media_action`. Si el registro falla, la operación principal **no** se
 * corta: el error se avisa por consola y se sigue.
 */
export async function logMediaActivity(
  action: string,
  mediaPath: string | null,
  result: "success" | "error" = "success",
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    const { error } = await getSupabase().rpc("log_media_action", {
      p_action: action,
      p_media_path: mediaPath,
      p_result: result,
      p_detail: detail ?? {},
    });
    if (error) {
      console.warn("No se pudo registrar la actividad:", error.message);
    }
  } catch (error) {
    console.warn("No se pudo registrar la actividad:", error);
  }
}
