import { useEffect, useSyncExternalStore } from "react";
import { getSupabase, isSupabaseConfigured } from "./supabase";

/**
 * Resolución de imágenes reemplazadas.
 *
 * El sitio se despliega como sitio estático de sólo lectura: una imagen
 * compilada por Vite no se puede sobrescribir desde el panel. Lo que sí
 * existe es el bucket `site-media` de Supabase Storage, que es el
 * almacenamiento persistente real del proyecto.
 *
 * Cuando el administrador reemplaza una imagen, la versión nueva queda en
 * Storage y se registra con la **misma ruta lógica** del asset original. Este
 * módulo pide al servidor el mapa {ruta lógica → ruta en Storage} y, si
 * existe, el sitio usa la versión nueva.
 *
 * Reglas de seguridad del diseño:
 *   - Si Supabase no responde, se usa el asset compilado. El sitio nunca
 *     queda sin imagen por culpa del resolver.
 *   - La llamada es una sola por sesión de página, con respaldo en
 *     `sessionStorage` para no repetirla en cada navegación.
 *   - Sólo se consultan medios activos: la papelera no se sirve al público.
 */

const STORAGE_KEY = "casoratti.media.overrides.v1";
const CACHE_TTL_MS = 5 * 60 * 1000;

type OverrideMap = Record<string, string>;

type CacheEntry = {
  map: OverrideMap;
  fetchedAt: number;
};

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
    if (!parsed || typeof parsed.fetchedAt !== "number") return null;
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

async function loadOverrides(): Promise<OverrideMap | null> {
  if (!isSupabaseConfigured) return null;

  const { data, error } = await getSupabase().rpc("resolve_media_overrides");
  if (error || !data || typeof data !== "object") return null;

  const map: OverrideMap = {};
  for (const [logicalPath, storagePath] of Object.entries(
    data as Record<string, unknown>,
  )) {
    if (typeof storagePath !== "string" || !storagePath) continue;
    const url = buildPublicUrl(storagePath);
    if (url) map[logicalPath] = url;
  }
  return map;
}

/** kicks off the load of the override map (idempotent). */
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
    .then(map => {
      if (!map) return;
      cache = { map, fetchedAt: Date.now() };
      writeSessionCache(cache);
      emit();
    })
    .catch(() => {
      /* Sin red o sin permisos: se conserva el asset compilado. */
    })
    .finally(() => {
      inflight = null;
    });
}

/** Mapa de reemplazos conocidos, o `null` si todavía no se cargó. */
export function getMediaOverrides(): OverrideMap | null {
  return cache ? cache.map : null;
}

/**
 * Devuelve la URL a usar para una imagen: el reemplazo en Storage si existe,
 * o el asset compilado como respaldo.
 */
export function resolveMediaUrl(logicalPath: string, fallback: string): string {
  const map = cache?.map;
  if (!map || !logicalPath) return fallback;
  return map[logicalPath] ?? fallback;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): OverrideMap | null {
  return cache ? cache.map : null;
}

/**
 * Hook para el sitio público: devuelve la URL definitiva de una imagen.
 * Mientras el mapa no llega devuelve el asset compilado, de modo que el
 * diseño del sitio nunca cambia por culpa de una llamada de red.
 */
export function useMediaSrc(logicalPath: string, fallback: string): string {
  useSyncExternalStore(subscribe, getSnapshot, () => null);
  useEffect(() => {
    ensureMediaOverrides();
  }, []);
  return resolveMediaUrl(logicalPath, fallback);
}
