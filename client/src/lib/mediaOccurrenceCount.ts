import { useEffect, useState } from "react";

/**
 * Contador de apariciones de imágenes del sitio.
 *
 * El panel navega por módulos y el de imágenes necesita mostrar cuántas
 * apariciones hay administrables ("Imágenes (25)"). El dato sale del manifiesto
 * que genera el build, así que se lee una sola vez y se comparte en memoria.
 *
 * Si el manifiesto todavía no está disponible (por ejemplo, en desarrollo sin
 * build), el contador simplemente no se muestra: la navegación no se rompe.
 */

type ManifestLike = {
  occurrences?: unknown[];
};

let cached: number | null = null;
let inflight: Promise<void> | null = null;
const listeners = new Set<(count: number | null) => void>();

function emit(): void {
  listeners.forEach(listener => listener(cached));
}

async function loadCount(): Promise<number | null> {
  try {
    const response = await fetch("/media-manifest.json", { cache: "no-store" });
    if (!response.ok) return null;
    const manifest = (await response.json()) as ManifestLike;
    if (!manifest || !Array.isArray(manifest.occurrences)) return null;
    return manifest.occurrences.length;
  } catch {
    return null;
  }
}

/** Total de apariciones conocidas, o `null` si todavía no se cargó. */
export function getMediaOccurrenceCount(): number | null {
  return cached;
}

export function subscribeMediaOccurrenceCount(
  listener: (count: number | null) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Hook para la navegación del panel. */
export function useMediaOccurrenceCount(): number | null {
  const [count, setCount] = useState<number | null>(cached);

  useEffect(() => {
    setCount(cached);
    const unsubscribe = subscribeMediaOccurrenceCount(setCount);
    if (!inflight) {
      inflight = loadCount()
        .then(value => {
          if (value !== null) {
            cached = value;
            emit();
          }
        })
        .catch(() => {
          /* Sin manifiesto: la navegación sigue igual. */
        })
        .finally(() => {
          inflight = null;
        });
    }
    return unsubscribe;
  }, []);

  return count;
}
