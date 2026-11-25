/**
 * Validadores de seguridad del gestor de imágenes.
 *
 * Toda imagen que entra al panel se controla por tres vías independientes:
 * extensión, tipo MIME declarado y **bytes mágicos** (la firma real del
 * archivo). Con las tres se cierra el ataque más común de la web: un `.jpg`
 * que en realidad es texto plano, o un archivo que se hace pasar por imagen.
 *
 * Los SVG son el caso delicado: son XML y pueden llevar código ejecutable.
 * Por eso se rechazan los que contienen `<script>`, `foreignObject`, atributos
 * `on*`, URLs `javascript:` o referencias externas. Además existe
 * `sanitizeSvg`, que deja limpio un SVG recuperable.
 *
 * Nota de alcance: se valida la **firma del archivo**, no su autenticidad.
 * Un PNG re-codificado sigue siendo un PNG válido. No hay verificación
 * criptográfica de imagen (no aplica a imágenes rasterizadas).
 */

/** Tipos MIME que admite el bucket `site-media`. */
export const ALLOWED_IMAGE_MIME: string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/svg+xml",
];

/** Límite de tamaño por archivo (10 MB), el mismo que el bucket. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Carpetas de destino que ofrece el panel. */
export const ALLOWED_MEDIA_FOLDERS: string[] = [
  "images/institucional",
  "images/equipo",
  "images/servicios",
  "images/publicaciones",
  "images/general",
];

/** MIME canónico por extensión. */
export const MEDIA_EXTENSION_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  gif: "image/gif",
};

/** MIME declarados por el navegador que no son los canónicos. */
const MIME_ALIASES: Record<string, string> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/x-png": "image/png",
  "image/svg": "image/svg+xml",
  "image/svg-xml": "image/svg+xml",
};

/** Resultado de una validación. */
export type MediaValidationResult = { ok: true } | { ok: false; error: string };

/* ------------------------------------------------------------------ */
/* Bytes mágicos                                                       */
/* ------------------------------------------------------------------ */

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let out = "";
  for (let i = start; i < end && i < bytes.length; i += 1) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

/**
 * Detecta el MIME **real** de un archivo mirando sus bytes iniciales.
 * Devuelve `null` cuando el contenido no es una imagen reconocida.
 */
export function detectImageMime(bytes: ArrayBuffer): string | null {
  if (!bytes || bytes.byteLength === 0) return null;
  const view = new Uint8Array(bytes);

  // JPEG: FF D8 FF
  if (
    view.length >= 3 &&
    view[0] === 0xff &&
    view[1] === 0xd8 &&
    view[2] === 0xff
  ) {
    return "image/jpeg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    view.length >= 8 &&
    view[0] === 0x89 &&
    view[1] === 0x50 &&
    view[2] === 0x4e &&
    view[3] === 0x47 &&
    view[4] === 0x0d &&
    view[5] === 0x0a &&
    view[6] === 0x1a &&
    view[7] === 0x0a
  ) {
    return "image/png";
  }

  // WEBP: "RIFF" .... "WEBP"
  if (
    view.length >= 12 &&
    ascii(view, 0, 4) === "RIFF" &&
    ascii(view, 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  // GIF: "GIF87a" / "GIF89a"
  const gif = ascii(view, 0, 6);
  if (gif === "GIF87a" || gif === "GIF89a") {
    return "image/gif";
  }

  // AVIF: caja "ftyp" con marca "avif" / "avis"
  if (view.length >= 12 && ascii(view, 4, 8) === "ftyp") {
    const brand = ascii(view, 8, 12);
    if (brand === "avif" || brand === "avis") return "image/avif";
    // Marcas compatibles: las declara la caja ftyp después del tamaño.
    for (let i = 16; i + 4 <= Math.min(view.length, 64); i += 4) {
      const compat = ascii(view, i, i + 4);
      if (compat === "avif" || compat === "avis") return "image/avif";
    }
  }

  // SVG: texto (XML) que contiene <svg
  const head = new TextDecoder("utf-8", { fatal: false }).decode(
    view.subarray(0, Math.min(view.length, 2048)),
  );
  if (head.trimStart().startsWith("<") && /<svg[\s/>]/i.test(head)) {
    return "image/svg+xml";
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* SVG                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Lista los riesgos concretos de un SVG. Si la lista está vacía, el SVG es
 * seguro para servirse desde el bucket público.
 */
export function findDangerousSvgConstructs(text: string): string[] {
  if (!text) return [];
  const found: string[] = [];
  if (/<script[\s>]/i.test(text)) found.push("un bloque <script>");
  if (/<foreignObject[\s/>]/i.test(text)) found.push("un elemento <foreignObject>");
  if (/\son[a-zA-Z]+\s*=/.test(text)) found.push("atributos de evento (on*=)");
  if (/javascript\s*:/i.test(text)) found.push("URLs javascript:");
  return found;
}

/**
 * Devuelve las referencias **externas** del SVG (href / xlink:href con
 * http://, https:// o protocolo relativo). Las internas (`#id`) y el
 * namespace estándar de SVG no cuentan.
 */
export function findExternalSvgReferences(text: string): string[] {
  if (!text) return [];
  const found: string[] = [];
  const pattern = /(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let match = pattern.exec(text);
  while (match !== null) {
    const value = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    const isExternal =
      /^(https?:)?\/\//i.test(value) &&
      value !== "http://www.w3.org/2000/svg" &&
      value !== "https://www.w3.org/2000/svg";
    if (isExternal) found.push(value);
    match = pattern.exec(text);
  }
  return found;
}

/**
 * Limpia un SVG: elimina `<script>` (con su contenido), `<foreignObject>`,
 * atributos `on*` y URLs `javascript:`.
 *
 * Devuelve `{ ok: true, text }` con el SVG saneado, o `{ ok: false, error }`
 * cuando el contenido no se puede recuperar (no es un SVG o sigue siendo
 * peligroso después de limpiar).
 */
export function sanitizeSvg(text: string): { ok: true; text: string } | { ok: false; error: string } {
  if (!text || !text.trim()) {
    return { ok: false, error: "El archivo SVG está vacío." };
  }
  if (!/<svg[\s/>]/i.test(text)) {
    return { ok: false, error: "El contenido no es un SVG válido." };
  }

  let out = text;

  // 1. <script> ... </script> (y el caso autocerrado).
  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  out = out.replace(/<script\b[^>]*\/>/gi, "");

  // 2. <foreignObject> ... </foreignObject>.
  out = out.replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject\s*>/gi, "");
  out = out.replace(/<foreignObject\b[^>]*\/>/gi, "");

  // 3. Atributos de evento (onclick, onload, onerror, ...).
  out = out.replace(/\son[a-zA-Z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");

  // 4. URLs javascript: en href / xlink:href y en cualquier atributo.
  out = out.replace(
    /\s(?:xlink:)?href\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*'|javascript:[^\s>]+)/gi,
    "",
  );
  out = out.replace(/javascript\s*:/gi, "");

  const remaining = findDangerousSvgConstructs(out);
  if (remaining.length > 0) {
    return {
      ok: false,
      error: `El SVG no se puede sanear: todavía contiene ${remaining.join(", ")}.`,
    };
  }
  if (!/<svg[\s/>]/i.test(out)) {
    return { ok: false, error: "El SVG no se puede sanear: quedó sin elemento <svg>." };
  }
  return { ok: true, text: out };
}

/* ------------------------------------------------------------------ */
/* Validación de archivos                                              */
/* ------------------------------------------------------------------ */

function extensionOf(name: string): string {
  const lower = (name ?? "").toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0 || dot === lower.length - 1) return "";
  return lower.slice(dot + 1);
}

function canonicalMime(value: string): string {
  const clean = (value ?? "").split(";")[0].trim().toLowerCase();
  return MIME_ALIASES[clean] ?? clean;
}

/**
 * Chequeo rápido **sin leer el contenido**: tamaño, extensión y MIME
 * declarado. Sirve para filtrar en el selector de archivos; para la
 * validación completa (con bytes mágicos) usá `validateImageFile`.
 */
export function validateImageFileMeta(file: File): MediaValidationResult {
  if (!file) return { ok: false, error: "No hay ningún archivo seleccionado." };
  if (file.size <= 0) return { ok: false, error: "El archivo está vacío." };
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, error: "El archivo supera el máximo de 10 MB." };
  }

  const extension = extensionOf(file.name);
  if (!extension) {
    return { ok: false, error: "El archivo no tiene extensión." };
  }
  const expected = MEDIA_EXTENSION_MIME[extension];
  if (!expected || !ALLOWED_IMAGE_MIME.includes(expected)) {
    return {
      ok: false,
      error: `El formato «.${extension}» no está admitido. Usá JPG, PNG, WEBP, AVIF o SVG.`,
    };
  }

  const declared = canonicalMime(file.type);
  if (declared) {
    if (!ALLOWED_IMAGE_MIME.includes(declared)) {
      return {
        ok: false,
        error: `El tipo MIME declarado («${declared}») no está admitido.`,
      };
    }
    if (declared !== expected) {
      return {
        ok: false,
        error: `El tipo MIME declarado («${declared}») no coincide con la extensión «.${extension}».`,
      };
    }
  }

  return { ok: true };
}

/**
 * Validación completa de un archivo de imagen: extensión, MIME declarado y
 * **bytes mágicos**, más el control especial de los SVG.
 *
 * Es asíncrona porque tiene que leer los bytes del archivo (`arrayBuffer()`).
 * Devuelve exactamente el mismo resultado que la especificación, envuelto en
 * una `Promise`: `{ ok: true }` o `{ ok: false; error }`.
 */
export async function validateImageFile(file: File): Promise<MediaValidationResult> {
  const meta = validateImageFileMeta(file);
  if (!meta.ok) return meta;

  const extension = extensionOf(file.name);
  const expected = MEDIA_EXTENSION_MIME[extension];

  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    return { ok: false, error: "No se pudo leer el contenido del archivo." };
  }

  const real = detectImageMime(bytes);
  if (!real) {
    return {
      ok: false,
      error: `El contenido real del archivo no coincide con la extensión «.${extension}»: no se pudo verificar que sea una imagen válida.`,
    };
  }
  if (real !== expected) {
    return {
      ok: false,
      error: `El contenido real del archivo («${real}») no coincide con la extensión «.${extension}».`,
    };
  }

  if (real === "image/svg+xml") {
    let text = "";
    try {
      text = await file.text();
    } catch {
      return { ok: false, error: "No se pudo leer el contenido del SVG." };
    }
    const dangerous = findDangerousSvgConstructs(text);
    if (dangerous.length > 0) {
      return {
        ok: false,
        error: `El SVG contiene ${dangerous.join(", ")} y no se admite por seguridad.`,
      };
    }
    const external = findExternalSvgReferences(text);
    if (external.length > 0) {
      return {
        ok: false,
        error: `El SVG referencia recursos externos («${external[0]}») y no se admite.`,
      };
    }
  }

  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Rutas y nombres                                                     */
/* ------------------------------------------------------------------ */

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Normaliza un nombre de archivo: sin acentos, en minúsculas, con las
 * palabras unidas por guiones, conservando la extensión. Nunca queda vacío
 * ni empieza con punto.
 */
export function normalizeMediaName(name: string): string {
  const raw = (name ?? "").trim();
  const dot = raw.lastIndexOf(".");
  const hasExtension = dot > 0 && /^[a-z0-9]+$/i.test(raw.slice(dot + 1));
  const base = hasExtension ? raw.slice(0, dot) : raw;
  const extension = hasExtension ? raw.slice(dot + 1).toLowerCase() : "";

  let slug = stripAccents(base)
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");

  if (!slug) slug = "imagen";
  return extension ? `${slug}.${extension}` : slug;
}

/**
 * Normaliza una ruta de carpeta: minúsculas, sin acentos, con guiones en los
 * espacios y sin segmentos vacíos. Se usa antes de guardar en `media_folders`,
 * cuya ruta tiene que cumplir `^[a-z0-9][a-z0-9._/-]*$`.
 */
export function normalizeFolderPath(path: string): string {
  const raw = (path ?? "").trim().replace(/\\/g, "/");
  return raw
    .split("/")
    .map((segment) =>
      stripAccents(segment)
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/-{2,}/g, "-")
        .replace(/^[-._]+/, "")
        .replace(/[-._]+$/, ""),
    )
    .filter((segment) => segment.length > 0)
    .join("/");
}

/**
 * ¿La ruta es relativa y segura? Rechaza rutas absolutas, `..`, barras
 * invertidas, bytes nulos, caracteres de control y rutas que salgan de la
 * raíz autorizada.
 */
export function isSafeRelativePath(path: string): boolean {
  if (typeof path !== "string") return false;
  if (!path || path.length > 255) return false;
  if (path.includes("\0")) return false;

  for (let i = 0; i < path.length; i += 1) {
    const code = path.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return false;
  }

  if (path.includes("\\")) return false;
  if (path.startsWith("/")) return false;
  if (path.startsWith("~")) return false;
  if (/^[a-zA-Z]:/.test(path)) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(path)) return false;

  const segments = path.split("/");
  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") return false;
  }
  return true;
}

/**
 * Compone la ruta dentro del bucket: `carpeta/<nombre-normalizado>`.
 * Si la carpeta no es segura, cae en `images/general` para que la ruta
 * final nunca pueda salir de la raíz autorizada.
 */
export function safeStoragePath(folder: string, name: string): string {
  const raw = (folder ?? "").trim();
  const normalized = normalizeFolderPath(raw);
  const suspicious =
    raw.includes("..") ||
    raw.startsWith("/") ||
    raw.includes("\\") ||
    /^[a-zA-Z]:/.test(raw);
  const safeFolder =
    !suspicious && normalized && isSafeRelativePath(normalized)
      ? normalized
      : "images/general";

  const safeName = normalizeMediaName(name);
  const candidate = `${safeFolder}/${safeName}`;
  return isSafeRelativePath(candidate) ? candidate : `images/general/${safeName}`;
}

/**
 * ¿La ruta está en una carpeta protegida? `assets/` (assets compilados) y
 * `backups/` (copias de seguridad) no se pueden eliminar.
 */
export function isProtectedMediaPath(path: string): boolean {
  if (!path) return false;
  const clean = path.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
  return (
    clean === "assets" ||
    clean.startsWith("assets/") ||
    clean === "backups" ||
    clean.startsWith("backups/")
  );
}
