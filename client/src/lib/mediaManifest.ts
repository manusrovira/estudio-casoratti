/**
 * Tipos y utilidades del inventario de imágenes del sitio.
 *
 * Este módulo es seguro para el navegador: no importa nada de Node. El
 * escaneo real del repositorio vive en `mediaManifest.server.ts`, que corre
 * en el build de Vite; acá sólo se tipan los datos que llegan ya calculados
 * en `media-manifest.json`.
 */

export const MEDIA_IMAGE_EXTENSIONS = [
  "jpg",
  "jpeg",
  "png",
  "webp",
  "avif",
  "svg",
  "gif",
] as const;

export type MediaFormat = (typeof MEDIA_IMAGE_EXTENSIONS)[number];

/** Cómo se encontró la referencia a la imagen dentro del código fuente. */
export type MediaReferenceKind = "import" | "url" | "string";

/** Una referencia real detectada en el código del proyecto. */
export type MediaReference = {
  /** Ruta relativa al repositorio, p. ej. "client/src/pages/SitePages.tsx". */
  file: string;
  /** Número de línea (1-based) donde aparece la referencia. */
  line: number;
  kind: MediaReferenceKind;
  /** Etiqueta legible de la página o el componente. */
  label: string;
};

/** Una imagen real detectada en el proyecto. */
export type MediaManifestEntry = {
  /** Clave estable de la imagen, p. ej. "assets/casoratti-hero.jpg". */
  logicalPath: string;
  /** Ruta física real dentro del repositorio. */
  physicalPath: string;
  /** URL pública real que sirve el sitio. */
  publicPath: string;
  originalName: string;
  format: MediaFormat;
  bytes: number;
  width: number | null;
  height: number | null;
  /** Fecha de modificación del archivo (ISO). */
  modifiedAt: string;
  provider: "bundled";
  references: MediaReference[];
};

/**
 * Una **aparición** de imagen: un lugar concreto del sitio donde se usa una
 * imagen. Cada aparición tiene su propio identificador y se administra por
 * separado, aunque dos apariciones usen el mismo archivo físico.
 */
export type MediaOccurrenceRecord = {
  /** Identificador único de la aparición, p. ej. "home-hero". */
  occurrenceId: string;
  /** Ruta lógica del archivo físico, p. ej. "assets/casoratti-hero.jpg". */
  imageLogicalPath: string;
  /** Página del sitio donde aparece. */
  page: string;
  /** Sección concreta dentro de la página. */
  section: string;
  /** Componente que la renderiza. */
  component: string;
  /** Archivo del código donde se usa, p. ej. "client/src/pages/SitePages.tsx". */
  file: string;
  /** Línea del código donde se usa (0 si no se pudo resolver). */
  line: number;
  /** "detected" cuando el uso se resolvió; "pending" cuando no. */
  status: "detected" | "pending";
};

export type MediaManifest = {
  generatedAt: string;
  /** Archivos físicos del sitio. */
  entries: MediaManifestEntry[];
  /** Apariciones: cada lugar del sitio donde se usa una imagen. */
  occurrences: MediaOccurrenceRecord[];
};

const numberFormatter = new Intl.NumberFormat("es-AR", {
  maximumFractionDigits: 1,
});

/** Devuelve el formato de una imagen a partir de su nombre, o `null`. */
export function mediaFormatOf(name: string): MediaFormat | null {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return null;
  const extension = lower.slice(dot + 1);
  return (MEDIA_IMAGE_EXTENSIONS as readonly string[]).includes(extension)
    ? (extension as MediaFormat)
    : null;
}

/** ¿El nombre corresponde a un archivo de imagen admitido? */
export function isImageFile(name: string): boolean {
  return mediaFormatOf(name) !== null;
}

/** Peso legible, en el formato del resto del panel. */
export function formatMediaBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${numberFormatter.format(kb)} KB`;
  return `${numberFormatter.format(kb / 1024)} MB`;
}

/** Manifiesto vacío: lo que se usa cuando el manifiesto todavía no está. */
export function emptyMediaManifest(): MediaManifest {
  return { generatedAt: "", entries: [], occurrences: [] };
}

/**
 * Lee el manifiesto del sitio. Devuelve `null` si todavía no se generó, para
 * que la interfaz pueda distinguir "no hay inventario" de "hay cero imágenes".
 */
export async function fetchMediaManifest(signal?: AbortSignal): Promise<MediaManifest | null> {
  try {
    const response = await fetch("/media-manifest.json", {
      cache: "no-store",
      signal,
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as MediaManifest;
    if (!payload || !Array.isArray(payload.entries)) return null;
    return payload;
  } catch {
    return null;
  }
}
