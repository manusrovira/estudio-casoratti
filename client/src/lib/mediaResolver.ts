import { useEffect, useSyncExternalStore } from "react";
import { getSupabase, isSupabaseConfigured } from "./supabase";

/**
 * Resolución de imágenes por **aparición**.
 *
 * El sitio se despliega como sitio estático de sólo lectura: un asset
 * compilado por Vite no se puede sobrescribir desde el panel. Lo que sí existe
 * es el bucket `site-media` de Supabase Storage.
 *
 * El panel administra **apariciones**, no archivos: cada lugar del sitio donde
 * se usa una imagen es un registro independiente, con su propio identificador
 * (`occurrenceId`). Por eso la resolución tiene dos niveles:
 *
 *   1. Override de la **aparición** (`occurrences`): lo que se cambia al editar
 *      un registro concreto del inventario. Sólo afecta a ese lugar.
 *   2. Override del **archivo** (`files`): reemplazo del recurso completo.
 *
 * Y una lista de apariciones **ocultas**: quitan la imagen de esa sección sin
 * tocar el archivo ni las demás apariciones.
 *
 * Si Supabase no responde, se usa el asset compilado. El sitio nunca queda sin
 * imagen por culpa del resolver.
 */

const STORAGE_KEY = "casoratti.media.overrides.v2";
const CACHE_TTL_MS = 5 * 60 * 1000;

export type MediaOverrides = {
  /** occurrenceId → URL pública. */
  occurrences: Record<string, string>;
  /** ruta lógica del archivo → URL pública. */
  files: Record<string, string>;
  /** Identificadores de aparición cuya imagen se quitó del sitio. */
  hidden: string[];
};

type CacheEntry = {
  data: MediaOverrides;
  fetchedAt: number;
};

const EMPTY: MediaOverrides = { occurrences: {}, files: {}, hidden: [] };

let cache: CacheEntry | null = null;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach(listener => listener());
}

function readSessionCache(): CacheEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!parsed?.data) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSessionCache(entry: CacheEntry): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch {
    /* Sin espacio o almacenamiento bloqueado: se sigue sin respaldo. */
  }
}

function buildPublicUrl(storagePath: string): string {
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!base || !storagePath) return "";
  const encoded = storagePath
    .split("/")
    .map(segment => encodeURIComponent(segment))
    .join("/");
  return `${base}/storage/v1/object/public/site-media/${encoded}`;
}

async function loadOverrides(): Promise<void> {
  if (!isSupabaseConfigured) return;

  const { data, error } = await getSupabase().rpc("resolve_media_overrides");
  if (error || !data || typeof data !== "object") return;

  const payload = data as Partial<MediaOverrides>;
  const next: MediaOverrides = { occurrences: {}, files: {}, hidden: [] };

  for (const [occurrenceId, storagePath] of Object.entries(
    payload.occurrences ?? {},
  )) {
    if (typeof storagePath !== "string" || !storagePath) continue;
    const url = buildPublicUrl(storagePath);
    if (url) next.occurrences[occurrenceId] = url;
  }

  for (const [logicalPath, storagePath] of Object.entries(payload.files ?? {})) {
    if (typeof storagePath !== "string" || !storagePath) continue;
    const url = buildPublicUrl(storagePath);
    if (url) next.files[logicalPath] = url;
  }

  next.hidden = Array.isArray(payload.hidden)
    ? payload.hidden.filter((id): id is string => typeof id === "string")
    : [];

  cache = { data: next, fetchedAt: Date.now() };
  writeSessionCache(cache);
  emit();
}

/** Dispara la carga del mapa de reemplazos (idempotente). */
export function ensureMediaOverrides(): void {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return;
  if (inflight) return;

  const session = readSessionCache();
  if (session && Date.now() - session.fetchedAt < CACHE_TTL_MS) {
    cache = session;
    emit();
    return;
  }

  inflight = loadOverrides()
    .catch(() => {
      /* Sin red o sin permisos: se conserva el asset compilado. */
    })
    .finally(() => {
      inflight = null;
    });
}

/** Mapa de reemplazos conocidos, o `null` si todavía no se cargó. */
export function getMediaOverrides(): MediaOverrides | null {
  return cache ? cache.data : null;
}

/**
 * URL definitiva de una imagen en un lugar concreto del sitio.
 * Prioridad: override de la aparición → override del archivo → asset compilado.
 */
export function resolveMediaUrl(
  occurrenceId: string | null,
  logicalPath: string | null,
  fallback: string,
): string {
  const data = cache?.data;
  if (!data) return fallback;
  if (occurrenceId && data.occurrences[occurrenceId]) return data.occurrences[occurrenceId];
  if (logicalPath && data.files[logicalPath]) return data.files[logicalPath];
  return fallback;
}

/** ¿El administrador quitó esta imagen de esa sección? */
export function isOccurrenceHidden(occurrenceId: string | null): boolean {
  if (!occurrenceId) return false;
  const data = cache?.data;
  return !!data && data.hidden.includes(occurrenceId);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): MediaOverrides | null {
  return cache ? cache.data : null;
}

/**
 * Hook del sitio público: devuelve la URL definitiva de una imagen.
 * Mientras el mapa no llega devuelve el asset compilado, de modo que el
 * diseño del sitio nunca cambia por culpa de una llamada de red.
 */
export function useMediaSrc(
  occurrenceId: string | null,
  logicalPath: string | null,
  fallback: string,
): string {
  useSyncExternalStore(subscribe, getSnapshot, () => null);
  useEffect(() => {
    ensureMediaOverrides();
  }, []);
  return resolveMediaUrl(occurrenceId, logicalPath, fallback);
}

/** Hook complementario: indica si la aparición fue quitada del sitio. */
export function useMediaHidden(occurrenceId: string | null): boolean {
  useSyncExternalStore(subscribe, getSnapshot, () => null);
  useEffect(() => {
    ensureMediaOverrides();
  }, []);
  return isOccurrenceHidden(occurrenceId);
}
