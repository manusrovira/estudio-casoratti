/**
 * Escaneo real del repositorio para el manifiesto de imágenes del sitio.
 *
 * Este módulo corre únicamente en Node (build de Vite, scripts de consola o
 * pruebas): usa `node:fs` y `node:path`, así que nunca debe importarse desde
 * el navegador. Los tipos compartidos con la interfaz viven en
 * `mediaManifest.ts`, que sí es seguro para el navegador.
 *
 * Qué hace, sin simular nada:
 *   - recorre `client/src/assets/` y `client/public/` buscando imágenes reales;
 *   - lee las dimensiones reales desde la cabecera de cada archivo (PNG, JPEG,
 *     WEBP, GIF, AVIF y SVG), sin dependencias externas;
 *   - busca las referencias reales a cada imagen en el código fuente;
 *   - calcula la ruta lógica estable, la ruta física y la URL pública que
 *     sirve el sitio;
 *   - escanea las **apariciones**: cada lugar del sitio donde se usa una
 *     imagen, con su identificador, su archivo físico y su sitio de uso.
 */

import fs from "node:fs";
import path from "node:path";
import {
  mediaFormatOf,
  type MediaFormat,
  type MediaManifest,
  type MediaManifestEntry,
  type MediaOccurrenceRecord,
  type MediaReference,
  type MediaReferenceKind,
} from "./mediaManifest";

/** Carpetas que nunca se recorren: ruido de herramientas, no del sitio. */
const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  ".manus-logs",
  ".vite",
]);

/** Nombre de la carpeta `client/` dentro del repositorio. */
const CLIENT_DIR = "client";

/**
 * Archivos del propio módulo de medios. Se excluyen del escaneo de
 * referencias porque mencionan rutas lógicas en sus comentarios: contarlas
 * como uso real del sitio sería inventar datos.
 *
 * `mediaAssets.ts` entra por lo mismo y por algo más: es el mapa entre asset
 * y ruta lógica, no un lugar donde se renderice una imagen. Sus importaciones
 * no son sitios de uso.
 */
const MEDIA_MODULE_FILES = new Set([
  "mediaManifest.ts",
  "mediaManifest.server.ts",
  "mediaManifest.server.test.ts",
  "mediaManifestPlugin.ts",
  "mediaResolver.ts",
  "mediaAssets.ts",
]);

/** Extensiones de código fuente donde se buscan referencias. */
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".css"];

/** Etiquetas legibles de las páginas públicas del sitio. */
const SITE_PAGE_LABELS: Record<string, string> = {
  Home: "Página de inicio",
  Studio: "El estudio",
  Areas: "Áreas jurídicas",
  AreaDetail: "Detalle del área",
  Values: "Valores",
  Resources: "Centro de recursos",
  FAQ: "Preguntas frecuentes",
  Contact: "Contacto",
};

/** Una imagen real encontrada en el repositorio. */
export type ScannedImage = {
  /** Ruta absoluta en disco. */
  absolutePath: string;
  /** Ruta real relativa al repositorio, p. ej. "client/src/assets/x.jpg". */
  physicalPath: string;
  /** Ruta lógica estable, p. ej. "assets/x.jpg". */
  logicalPath: string;
  /** Ruta relativa a `client/`, p. ej. "src/assets/x.jpg". */
  clientRelativePath: string;
  originalName: string;
  format: MediaFormat;
  bytes: number;
  width: number | null;
  height: number | null;
  /** Fecha de modificación del archivo (ISO). */
  modifiedAt: string;
  /** De dónde sale el archivo: assets compilados o carpeta pública. */
  origin: "source" | "public";
};

/** Opciones de escaneo. Todas las rutas son absolutas salvo `repoRoot`. */
export type MediaScanOptions = {
  /** Raíz del repositorio: la carpeta que contiene `client/`. */
  repoRoot: string;
  /** Carpeta `client/` (por defecto, `<repoRoot>/client`). */
  clientDir?: string;
  /** Carpeta pública de Vite (por defecto, `<clientDir>/public`). */
  publicDir?: string;
  /** Carpeta de assets compilados (por defecto, `<clientDir>/src/assets`). */
  assetsDir?: string;
};

/** Un asset emitido por Vite en el bundle, tal como lo devuelve Rollup. */
export type EmittedAsset = {
  fileName: string;
  name?: string | undefined;
  names?: string[] | undefined;
  originalFileName?: string | null | undefined;
  originalFileNames?: string[] | undefined;
};

/** Opciones para armar el manifiesto completo. */
export type ManifestBuildOptions = MediaScanOptions & {
  /**
   * Archivos emitidos por Vite. Si viene informado, las URLs públicas se
   * calculan con el nombre final hasheado. Si no viene, se usan las rutas de
   * desarrollo (`/src/assets/...`).
   */
  emitted?: EmittedAsset[] | undefined;
  /** Base pública del sitio (por defecto, "/"). */
  base?: string | undefined;
};

type Dimensions = { width: number | null; height: number | null };

const NO_DIMENSIONS: Dimensions = { width: null, height: null };

// -----------------------------------------------------------------------------
// Rutas
// -----------------------------------------------------------------------------

/** Convierte separadores de Windows en "/". */
export function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

/** Ruta de `to` relativa a `from`, siempre con "/". */
export function relativePosix(from: string, to: string): string {
  return toPosix(path.relative(from, to));
}

/**
 * Ruta lógica estable de una imagen, a partir de su ruta física.
 *
 *   "client/src/assets/x.jpg" → "assets/x.jpg"
 *   "client/public/x/y.webp"  → "x/y.webp"
 *
 * Es la clave de deduplicación y de resolución en el sitio: no depende del
 * hash que Vite asigne en cada build.
 */
export function logicalPathFromPhysical(physicalPath: string): string {
  const normalized = toPosix(physicalPath).replace(/^\.\//, "");
  const clientPrefix = `${CLIENT_DIR}/`;
  if (!normalized.startsWith(clientPrefix)) return normalized;
  const insideClient = normalized.slice(clientPrefix.length);
  if (insideClient.startsWith("src/")) return insideClient.slice("src/".length);
  if (insideClient.startsWith("public/")) return insideClient.slice("public/".length);
  return insideClient;
}

function normalizeBase(base: string): string {
  if (!base || base === "./") return "/";
  const trimmed = base.replace(/\/+$/, "");
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function joinBase(base: string, relative: string): string {
  const clean = relative.replace(/^\/+/, "");
  return base === "/" ? `/${clean}` : `${base}/${clean}`;
}

// -----------------------------------------------------------------------------
// Lectura de dimensiones reales desde la cabecera del archivo
// -----------------------------------------------------------------------------

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function readPngDimensions(bytes: Uint8Array): Dimensions {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24) return NO_DIMENSIONS;
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[index] !== signature[index]) return NO_DIMENSIONS;
  }
  // La firma ocupa 8 bytes, luego el largo del chunk (4) y "IHDR" (4):
  // el ancho arranca en el byte 16 y el alto en el 20 (big endian).
  const view = viewOf(bytes);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function readJpegDimensions(bytes: Uint8Array): Dimensions {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return NO_DIMENSIONS;
  const view = viewOf(bytes);
  let offset = 2;
  while (offset < bytes.length - 1) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    let marker = bytes[offset + 1];
    // Se saltan los bytes de relleno 0xFF antes del marcador.
    while (marker === 0xff && offset + 2 < bytes.length) {
      offset += 1;
      marker = bytes[offset + 1];
    }
    offset += 2;
    // Marcadores que no llevan largo de segmento.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    // Fin de la imagen o inicio del barrido: no hay SOF después.
    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 2 > bytes.length) break;
    const length = view.getUint16(offset);
    if (length < 2) break;
    // SOF0..SOF15, salvo DHT (0xC4), JPG (0xC8) y DAC (0xCC).
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      if (offset + 7 > bytes.length) break;
      return { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
    }
    offset += length;
  }
  return NO_DIMENSIONS;
}

function readWebpDimensions(bytes: Uint8Array): Dimensions {
  if (bytes.length < 16) return NO_DIMENSIONS;
  const ascii = (index: number) => String.fromCharCode(bytes[index]);
  if (ascii(0) !== "R" || ascii(1) !== "I" || ascii(2) !== "F" || ascii(3) !== "F") return NO_DIMENSIONS;
  if (ascii(8) !== "W" || ascii(9) !== "E" || ascii(10) !== "B" || ascii(11) !== "P") return NO_DIMENSIONS;
  const chunk = ascii(12) + ascii(13) + ascii(14) + ascii(15);
  const start = 20;
  const view = viewOf(bytes);
  if (chunk === "VP8 ") {
    // Etiqueta de frame (3 bytes), código de inicio (9D 01 2A) y luego
    // ancho y alto de 14 bits, escalados por 1/16.
    if (bytes.length < start + 10) return NO_DIMENSIONS;
    if (bytes[start + 3] !== 0x9d || bytes[start + 4] !== 0x01 || bytes[start + 5] !== 0x2a) {
      return NO_DIMENSIONS;
    }
    return {
      width: view.getUint16(start + 6, true) & 0x3fff,
      height: view.getUint16(start + 8, true) & 0x3fff,
    };
  }
  if (chunk === "VP8L") {
    // Firma 0x2F y 32 bits: ancho-1 (14), alto-1 (14), alfa (1), versión (3).
    if (bytes.length < start + 5) return NO_DIMENSIONS;
    if (bytes[start] !== 0x2f) return NO_DIMENSIONS;
    const bits = view.getUint32(start + 1, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") {
    // 1 byte de flags, 3 de reservado y luego el lienzo menos uno (24 bits).
    if (bytes.length < start + 10) return NO_DIMENSIONS;
    const width = bytes[start + 4] | (bytes[start + 5] << 8) | (bytes[start + 6] << 16);
    const height = bytes[start + 7] | (bytes[start + 8] << 8) | (bytes[start + 9] << 16);
    return { width: width + 1, height: height + 1 };
  }
  return NO_DIMENSIONS;
}

function readGifDimensions(bytes: Uint8Array): Dimensions {
  if (bytes.length < 10) return NO_DIMENSIONS;
  const header = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (header !== "GIF8") return NO_DIMENSIONS;
  const view = viewOf(bytes);
  return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
}

type BoxRef = { type: string; payloadStart: number; payloadEnd: number };

/** Cajas ISO-BMFF que contienen otras cajas y cuánto hay que saltar al entrar. */
const CONTAINER_SKIP: Record<string, number> = {
  meta: 4, // FullBox: versión + flags
  stsd: 8, // FullBox + cantidad de entradas
  av01: 78, // VisualSampleEntry
  av1f: 78,
};

function listBoxes(bytes: Uint8Array, start: number, end: number): BoxRef[] {
  const boxes: BoxRef[] = [];
  const view = viewOf(bytes);
  let offset = start;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > end) break;
      size = Number(view.getBigUint64(offset + 8));
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < headerSize) break;
    boxes.push({
      type,
      payloadStart: offset + headerSize,
      payloadEnd: Math.min(offset + size, end),
    });
    offset += size;
  }
  return boxes;
}

function findBox(bytes: Uint8Array, start: number, end: number, target: string): BoxRef | null {
  for (const box of listBoxes(bytes, start, end)) {
    if (box.type === target) return box;
    const skip = CONTAINER_SKIP[box.type];
    if (skip === undefined) continue;
    const found = findBox(bytes, box.payloadStart + skip, box.payloadEnd, target);
    if (found) return found;
  }
  return null;
}

function readAvifDimensions(bytes: Uint8Array): Dimensions {
  const box = findBox(bytes, 0, bytes.length, "ispe");
  if (!box) return NO_DIMENSIONS;
  if (box.payloadStart + 12 > bytes.length) return NO_DIMENSIONS;
  const view = viewOf(bytes);
  // ispe: versión (1) + flags (3) + ancho (4, big endian) + alto (4).
  const width = view.getUint32(box.payloadStart + 4);
  const height = view.getUint32(box.payloadStart + 8);
  if (width <= 0 || height <= 0) return NO_DIMENSIONS;
  return { width, height };
}

function readSvgDimensions(bytes: Uint8Array): Dimensions {
  const text = new TextDecoder("utf-8").decode(bytes);
  const root = /<svg\b[^>]*>/i.exec(text);
  if (!root) return NO_DIMENSIONS;
  const tag = root[0];
  const width = /\bwidth\s*=\s*["']\s*([0-9.]+)\s*(?:px)?\s*["']/i.exec(tag);
  const height = /\bheight\s*=\s*["']\s*([0-9.]+)\s*(?:px)?\s*["']/i.exec(tag);
  if (width && height) {
    return { width: Math.round(Number(width[1])), height: Math.round(Number(height[1])) };
  }
  const viewBox = /\bviewBox\s*=\s*["']([^"']+)["']/i.exec(tag);
  if (viewBox) {
    const parts = viewBox[1]
      .trim()
      .split(/[\s,]+/)
      .map((part) => Number(part));
    if (parts.length === 4 && parts.every((part) => Number.isFinite(part))) {
      return { width: Math.round(parts[2]), height: Math.round(parts[3]) };
    }
  }
  return NO_DIMENSIONS;
}

/**
 * Dimensiones reales de una imagen, leídas de la cabecera del archivo.
 * Si el archivo no se puede interpretar, devuelve `null` en ancho y alto:
 * nunca se inventan valores.
 */
export function readImageDimensions(bytes: Uint8Array, format: MediaFormat): Dimensions {
  try {
    switch (format) {
      case "png":
        return readPngDimensions(bytes);
      case "jpg":
      case "jpeg":
        return readJpegDimensions(bytes);
      case "webp":
        return readWebpDimensions(bytes);
      case "gif":
        return readGifDimensions(bytes);
      case "avif":
        return readAvifDimensions(bytes);
      case "svg":
        return readSvgDimensions(bytes);
      default:
        return NO_DIMENSIONS;
    }
  } catch {
    return NO_DIMENSIONS;
  }
}

// -----------------------------------------------------------------------------
// Recorrido del repositorio
// -----------------------------------------------------------------------------

function walkFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const files: string[] = [];
  const walk = (current: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".well-known") continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        walk(full);
        continue;
      }
      if (entry.isFile()) files.push(full);
    }
  };
  walk(dir);
  return files.sort();
}

function readHead(file: string, limit: number): Uint8Array {
  const handle = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(limit);
    const read = fs.readSync(handle, buffer, 0, limit, 0);
    return buffer.subarray(0, read);
  } finally {
    fs.closeSync(handle);
  }
}

function isExcludedSource(file: string): boolean {
  const base = path.basename(file);
  if (/\.(test|spec)\.[jt]sx?$/.test(base)) return true;
  if (MEDIA_MODULE_FILES.has(base)) return true;
  return false;
}

/**
 * Archivos de código donde se buscan referencias: todo `client/src/**` de
 * TypeScript y CSS, más los CSS de `client/public/`.
 */
export function collectSourceFiles(options: MediaScanOptions): string[] {
  const clientDir = options.clientDir ?? path.join(options.repoRoot, CLIENT_DIR);
  const publicDir = options.publicDir ?? path.join(clientDir, "public");
  const files: string[] = [];
  for (const file of walkFiles(clientDir)) {
    if (!SOURCE_EXTENSIONS.includes(path.extname(file).toLowerCase())) continue;
    if (isExcludedSource(file)) continue;
    files.push(file);
  }
  for (const file of walkFiles(publicDir)) {
    if (path.extname(file).toLowerCase() !== ".css") continue;
    if (isExcludedSource(file)) continue;
    files.push(file);
  }
  return files;
}

/**
 * Imágenes reales del proyecto: las de `client/src/assets/` y las de
 * `client/public/`, con peso, dimensiones y fecha reales.
 */
export function scanImages(options: MediaScanOptions): ScannedImage[] {
  const clientDir = options.clientDir ?? path.join(options.repoRoot, CLIENT_DIR);
  const publicDir = options.publicDir ?? path.join(clientDir, "public");
  const assetsDir = options.assetsDir ?? path.join(clientDir, "src", "assets");
  const images: ScannedImage[] = [];

  const collect = (dir: string, origin: "source" | "public") => {
    for (const file of walkFiles(dir)) {
      const format = mediaFormatOf(file);
      if (!format) continue;
      const stats = fs.statSync(file);
      const head = readHead(file, 512 * 1024);
      const dimensions = readImageDimensions(head, format);
      const physicalPath = relativePosix(options.repoRoot, file);
      images.push({
        absolutePath: file,
        physicalPath,
        logicalPath: logicalPathFromPhysical(physicalPath),
        clientRelativePath: relativePosix(clientDir, file),
        originalName: path.basename(file),
        format,
        bytes: stats.size,
        width: dimensions.width,
        height: dimensions.height,
        modifiedAt: stats.mtime.toISOString(),
        origin,
      });
    }
  };

  collect(assetsDir, "source");
  collect(publicDir, "public");
  return images.sort((a, b) => a.logicalPath.localeCompare(b.logicalPath, "es"));
}

// -----------------------------------------------------------------------------
// Referencias reales en el código
// -----------------------------------------------------------------------------

function extractStrings(line: string): string[] {
  const found: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'/g;
  let match = pattern.exec(line);
  while (match) {
    found.push(match[1] ?? match[2] ?? "");
    match = pattern.exec(line);
  }
  return found;
}

function extractUrlTargets(line: string): string[] {
  const found: string[] = [];
  const pattern = /url\(\s*["']?([^"')]+)["']?\s*\)/g;
  let match = pattern.exec(line);
  while (match) {
    found.push(match[1]);
    match = pattern.exec(line);
  }
  return found;
}

/** ¿La línea es un `import`/`export ... from`? */
function isImportLine(line: string): boolean {
  if (/^\s*(?:import|export)\b/.test(line)) return true;
  return /\bfrom\s*["'][^"']+["']\s*;?\s*$/.test(line);
}

function matchesImage(value: string, image: ScannedImage): boolean {
  const clean = value.split("?")[0].split("#")[0].trim();
  if (!clean) return false;
  const normalized = toPosix(clean);
  if (normalized === image.originalName) return true;
  if (normalized.endsWith(`/${image.originalName}`)) return true;
  if (normalized.endsWith(`/${image.logicalPath}`)) return true;
  return false;
}

/**
 * Etiqueta legible de una referencia: la página, el componente o el módulo
 * donde está el uso.
 */
export function labelForReference(relativeFile: string, lines: string[], line: number): string {
  const file = toPosix(relativeFile);
  if (file === "client/src/pages/SitePages.tsx") return sitePageLabel(lines, line);
  if (file === "client/src/data/siteContent.ts") return "Área jurídica";
  const component = /^client\/src\/components\/([^/]+)\.[jt]sx?$/.exec(file);
  if (component) return `Componente ${component[1]}`;
  const adminModule = /^client\/src\/pages\/admin\/(?:[^/]+\/)*([^/]+)\.[jt]sx?$/.exec(file);
  if (adminModule) return `Módulo ${adminModule[1]}`;
  const page = /^client\/src\/pages\/([^/]+)\.[jt]sx?$/.exec(file);
  if (page) return `Página ${page[1]}`;
  const base = file.split("/").pop() ?? file;
  return base.replace(/\.[jt]sx?$/, "");
}

/**
 * En `SitePages.tsx` cada página vive en su propia función exportada: se
 * busca la función que contiene la línea de la referencia.
 */
function sitePageLabel(lines: string[], line: number): string {
  let current: string | null = null;
  const limit = Math.min(line - 1, lines.length);
  for (let index = 0; index < limit; index += 1) {
    const text = lines[index];
    const match = /^export\s+function\s+([A-Za-z0-9_]+)/.exec(text);
    if (match) {
      current = match[1];
      continue;
    }
    if (/^\}/.test(text)) current = null;
  }
  if (current && SITE_PAGE_LABELS[current]) return SITE_PAGE_LABELS[current];
  return "Página del sitio";
}

/**
 * Referencias reales a las imágenes, agrupadas por ruta lógica.
 * Se recorren los archivos de código del sitio y se anotan archivo, línea,
 * tipo de hallazgo y una etiqueta legible.
 */
export function findImageReferences(
  images: ScannedImage[],
  options: MediaScanOptions,
): Map<string, MediaReference[]> {
  const found = new Map<string, MediaReference[]>();
  for (const image of images) found.set(image.logicalPath, []);

  for (const file of collectSourceFiles(options)) {
    const relative = relativePosix(options.repoRoot, file);
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line) continue;
      const strings = extractStrings(line);
      const urlTargets = extractUrlTargets(line);
      const importStrings = isImportLine(line) ? strings : [];
      if (strings.length === 0 && urlTargets.length === 0) continue;
      for (const image of images) {
        const importMatch = importStrings.find((value) => matchesImage(value, image));
        const urlMatch = urlTargets.find((value) => matchesImage(value, image));
        const stringMatch = strings.find((value) => matchesImage(value, image));
        const matched = importMatch ?? urlMatch ?? stringMatch;
        if (!matched) continue;
        const bucket = found.get(image.logicalPath);
        if (!bucket) continue;
        const lineNumber = index + 1;
        if (bucket.some((ref) => ref.file === relative && ref.line === lineNumber)) continue;
        const kind: MediaReferenceKind = importMatch
          ? "import"
          : urlMatch
            ? "url"
            : "string";
        bucket.push({
          file: relative,
          line: lineNumber,
          kind,
          label: labelForReference(relative, lines, lineNumber),
        });
      }
    }
  }
  return found;
}

// -----------------------------------------------------------------------------
// Emparejamiento con los archivos emitidos por Vite
// -----------------------------------------------------------------------------

function stripAssetHash(fileName: string): string {
  return fileName.replace(/-[A-Za-z0-9_-]{8,}(\.[^.]+)$/, "$1");
}

/**
 * Empareja un asset de origen con el archivo que Vite emitió en el bundle.
 * Vite registra la ruta original del asset (`originalFileNames`), así que la
 * coincidencia es exacta; si noviniera, se cae al nombre del archivo.
 */
export function matchEmittedAsset(
  clientRelativePath: string,
  emitted: EmittedAsset[],
): EmittedAsset | null {
  const target = toPosix(clientRelativePath).replace(/^\.\//, "");
  const exact = emitted.find((asset) => {
    const originals = asset.originalFileNames ?? [];
    if (originals.some((original) => toPosix(original) === target)) return true;
    const single = asset.originalFileName;
    return typeof single === "string" && toPosix(single) === target;
  });
  if (exact) return exact;

  const targetName = target.split("/").pop() ?? target;
  const byName = emitted.filter((asset) => {
    const names = [asset.name, ...(asset.names ?? [])].filter(
      (value): value is string => typeof value === "string",
    );
    if (names.some((value) => toPosix(value).split("/").pop() === targetName)) return true;
    const stripped = stripAssetHash(toPosix(asset.fileName)).split("/").pop();
    return stripped === targetName;
  });
  return byName.length === 1 ? byName[0] : null;
}

// -----------------------------------------------------------------------------
// Apariciones
// -----------------------------------------------------------------------------

/** Archivo donde vive el registro de apariciones del sitio. */
const OCCURRENCE_REGISTRY_FILE = path.join("src", "data", "mediaOccurrences.ts");

/** Archivo donde viven las áreas de práctica (slugs y labels reales). */
const PRACTICE_AREAS_FILE = path.join("src", "data", "siteContent.ts");

/** Prefijo de las apariciones del detalle de un área. */
const AREA_OCCURRENCE_PREFIX = "area-detail-";

/** Una aparición declarada en el registro del sitio. */
type DeclaredOccurrence = {
  id: string;
  page: string;
  section: string;
  component: string;
  /** Identificador del import que trae la imagen (o `null`). */
  imageRef: string | null;
};

/** Un área de práctica leída del contenido real del sitio. */
type DeclaredPracticeArea = {
  slug: string;
  label: string;
  /** Identificador del import que trae la imagen (o `null`). */
  imageRef: string | null;
};

/** Un lugar del código donde se usa una aparición. */
export type OccurrenceUseSite = {
  /** Ruta del archivo, relativa al repositorio. */
  file: string;
  /** Línea (1-based) del uso. */
  line: number;
};

/** Lee un archivo de código; devuelve `null` si no se puede leer. */
function readSourceFile(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * Importaciones con nombre de un archivo: identificador → especificador.
 * Son las que traen un asset (`import foto from "@/assets/x.jpg"`).
 */
export function parseImportSpecifiers(text: string): Map<string, string> {
  const specifiers = new Map<string, string>();
  const pattern = /\bimport\s+([A-Za-z0-9_$]+)\s+from\s+["']([^"']+)["']/g;
  let match = pattern.exec(text);
  while (match) {
    specifiers.set(match[1], match[2]);
    match = pattern.exec(text);
  }
  return specifiers;
}

/**
 * Ruta lógica del asset que trae una importación.
 *
 *   "@/assets/x.jpg" (desde `client/src/data`) → "assets/x.jpg"
 *
 * Devuelve `null` si el especificador no es un archivo local.
 */
export function logicalPathOfSpecifier(specifier: string, fileDir: string): string | null {
  if (!specifier) return null;
  if (specifier.startsWith("@/")) {
    return logicalPathFromPhysical(`${CLIENT_DIR}/src/${specifier.slice(2)}`);
  }
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return logicalPathFromPhysical(path.posix.join(toPosix(fileDir), specifier));
  }
  return null;
}

/**
 * Valor de un campo dentro de un objeto literal: texto entre comillas o
 * identificador (`image: heroImage`).
 */
function fieldValue(body: string, name: string): string | null {
  const pattern = new RegExp(
    `\\b${name}\\s*:\\s*(?:"([^"]*)"|([A-Za-z0-9_$]+(?:\\.[A-Za-z0-9_$]+)*))`,
  );
  const match = pattern.exec(body);
  if (!match) return null;
  return match[1] ?? match[2] ?? null;
}

/**
 * Texto de un literal de objeto o de array, contando llaves o corchetes.
 * El par vacío de los tipos (`PracticeArea[]`) se saltea.
 */
function literalAfter(
  text: string,
  anchor: string,
  open: "{" | "[",
  close: "}" | "]",
): string | null {
  const anchorIndex = text.indexOf(anchor);
  if (anchorIndex < 0) return null;

  let start = -1;
  for (let index = anchorIndex + anchor.length; index < text.length; index += 1) {
    if (text[index] !== open) continue;
    if (open === "[" && text[index + 1] === "]") continue;
    start = index;
    break;
  }
  if (start < 0) return null;

  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

/**
 * Apariciones declaradas en el registro: los objetos literales con
 * identificador entre comillas. Las apariciones que se derivan de un slug
 * (las del detalle de área) no aparecen acá: se expanden aparte.
 */
export function parseDeclaredOccurrences(text: string): DeclaredOccurrence[] {
  const declared: DeclaredOccurrence[] = [];
  const pattern = /"([A-Za-z0-9_-]+)"\s*:\s*\{([^{}]*)\}/g;
  let match = pattern.exec(text);
  while (match) {
    const body = match[2];
    const id = fieldValue(body, "id");
    const page = fieldValue(body, "page");
    const section = fieldValue(body, "section");
    const component = fieldValue(body, "component");
    if (id && page && section && component) {
      declared.push({
        id,
        page,
        section,
        component,
        imageRef: fieldValue(body, "image"),
      });
    }
    match = pattern.exec(text);
  }
  return declared;
}

/** Áreas de práctica reales: slug, label y el asset que usa cada una. */
export function parseDeclaredPracticeAreas(text: string): DeclaredPracticeArea[] {
  const literal = literalAfter(text, "practiceAreas", "[", "]");
  if (!literal) return [];

  const areas: DeclaredPracticeArea[] = [];
  const pattern = /\{([^{}]*)\}/g;
  let match = pattern.exec(literal);
  while (match) {
    const body = match[1];
    const slug = fieldValue(body, "slug");
    if (slug) {
      areas.push({
        slug,
        label: fieldValue(body, "label") ?? "",
        imageRef: fieldValue(body, "image"),
      });
    }
    match = pattern.exec(literal);
  }
  return areas;
}

/** Valor de una constante de texto declarada en el registro. */
function stringConstant(text: string, name: string): string | null {
  const pattern = new RegExp(`export const ${name}\\s*=\\s*"([^"]*)"`);
  return pattern.exec(text)?.[1] ?? null;
}

/**
 * Sitios de uso de las apariciones en el código del sitio.
 *
 * Se buscan los atributos `occurrence="<id>"` y las plantillas
 * `occurrence={`area-detail-...`}`.
 *
 * No se sigue el mapa `images` de las páginas: es una indirección que el
 * escáner no puede resolver. Por eso el registro explícito de apariciones es
 * la fuente de verdad, y acá sólo se busca dónde se usa cada identificador.
 */
export function findOccurrenceUseSites(options: MediaScanOptions): {
  byId: Map<string, OccurrenceUseSite[]>;
  areaTemplate: OccurrenceUseSite[];
} {
  const byId = new Map<string, OccurrenceUseSite[]>();
  const areaTemplate: OccurrenceUseSite[] = [];

  for (const file of collectSourceFiles(options)) {
    const extension = path.extname(file).toLowerCase();
    if (extension !== ".ts" && extension !== ".tsx") continue;

    const text = readSourceFile(file);
    if (!text) continue;

    const relative = relativePosix(options.repoRoot, file);
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line || !line.includes("occurrence")) continue;
      const lineNumber = index + 1;

      const literal = /\boccurrence\s*=\s*["']([^"']+)["']/g;
      let match = literal.exec(line);
      while (match) {
        const id = match[1];
        const bucket = byId.get(id) ?? [];
        bucket.push({ file: relative, line: lineNumber });
        byId.set(id, bucket);
        match = literal.exec(line);
      }

      const template = /\boccurrence\s*=\s*\{`([^`]*)`\}/g;
      match = template.exec(line);
      while (match) {
        if (match[1].startsWith(AREA_OCCURRENCE_PREFIX)) {
          areaTemplate.push({ file: relative, line: lineNumber });
        }
        match = template.exec(line);
      }
    }
  }

  return { byId, areaTemplate };
}

/**
 * Apariciones reales del sitio: cada lugar donde se usa una imagen.
 *
 * Se lee el registro de apariciones (identificador, página, sección y
 * componente) y se buscan los sitios de uso en el código. Las apariciones del
 * detalle de un área se expanden contra los slugs reales de `practiceAreas`:
 * catorce apariciones concretas, no una sola.
 *
 * Lo que no se puede resolver de forma estática queda como "pending": no se
 * inventan ubicaciones.
 */
export function scanOccurrences(options: MediaScanOptions): MediaOccurrenceRecord[] {
  const clientDir = options.clientDir ?? path.join(options.repoRoot, CLIENT_DIR);
  const registryPath = path.join(clientDir, OCCURRENCE_REGISTRY_FILE);
  const contentPath = path.join(clientDir, PRACTICE_AREAS_FILE);

  const registryText = readSourceFile(registryPath);
  if (!registryText) return [];

  const registryDir = relativePosix(options.repoRoot, path.dirname(registryPath));
  const registryImports = parseImportSpecifiers(registryText);
  const declared = parseDeclaredOccurrences(registryText);
  const { byId, areaTemplate } = findOccurrenceUseSites(options);

  const contentText = readSourceFile(contentPath);
  const contentDir = contentText
    ? relativePosix(options.repoRoot, path.dirname(contentPath))
    : registryDir;
  const contentImports = contentText
    ? parseImportSpecifiers(contentText)
    : new Map<string, string>();
  const areas = contentText ? parseDeclaredPracticeAreas(contentText) : [];

  const areaPage = stringConstant(registryText, "AREA_OCCURRENCE_PAGE");
  const areaComponent = stringConstant(registryText, "AREA_OCCURRENCE_COMPONENT");

  const records: MediaOccurrenceRecord[] = [];

  for (const occurrence of declared) {
    const useSite = byId.get(occurrence.id)?.[0];
    const imageLogicalPath = occurrence.imageRef
      ? logicalPathOfSpecifier(
          registryImports.get(occurrence.imageRef) ?? "",
          registryDir,
        )
      : null;
    records.push({
      occurrenceId: occurrence.id,
      imageLogicalPath: imageLogicalPath ?? "",
      page: occurrence.page,
      section: occurrence.section,
      component: occurrence.component,
      file: useSite?.file ?? "",
      line: useSite?.line ?? 0,
      status: useSite && imageLogicalPath ? "detected" : "pending",
    });
  }

  for (const area of areas) {
    const useSite = areaTemplate[0];
    const imageLogicalPath = area.imageRef
      ? logicalPathOfSpecifier(contentImports.get(area.imageRef) ?? "", contentDir)
      : null;
    records.push({
      occurrenceId: `${AREA_OCCURRENCE_PREFIX}${area.slug}`,
      imageLogicalPath: imageLogicalPath ?? "",
      page: areaPage ?? "",
      section: area.label,
      component: areaComponent ?? "",
      file: useSite?.file ?? "",
      line: useSite?.line ?? 0,
      status: useSite && imageLogicalPath ? "detected" : "pending",
    });
  }

  return records;
}

// -----------------------------------------------------------------------------
// Manifiesto completo
// -----------------------------------------------------------------------------

function publicPathFor(image: ScannedImage, options: ManifestBuildOptions): string {
  const base = normalizeBase(options.base ?? "/");
  if (image.origin === "public") {
    // La carpeta pública se copia tal cual a la raíz del sitio.
    return joinBase(base, image.logicalPath);
  }
  if (options.emitted) {
    const match = matchEmittedAsset(image.clientRelativePath, options.emitted);
    // Si Vite no emitió el archivo es porque ninguna parte del sitio lo usa:
    // en producción no hay URL pública real, y se deja vacía.
    return match ? joinBase(base, match.fileName) : "";
  }
  // Desarrollo: la raíz de Vite es `client/`, así que se sirve directo.
  return joinBase(base, image.clientRelativePath);
}

/**
 * Manifiesto real de las imágenes del sitio: cada imagen con su ruta física,
 * su URL pública, formato, peso, dimensiones y sus referencias en el código;
 * y además las apariciones, que son los lugares del sitio donde se usa cada
 * imagen.
 */
export function buildMediaManifest(options: ManifestBuildOptions): MediaManifest {
  const images = scanImages(options);
  const references = findImageReferences(images, options);
  const entries: MediaManifestEntry[] = images.map((image) => ({
    logicalPath: image.logicalPath,
    physicalPath: image.physicalPath,
    publicPath: publicPathFor(image, options),
    originalName: image.originalName,
    format: image.format,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
    modifiedAt: image.modifiedAt,
    provider: "bundled",
    references: references.get(image.logicalPath) ?? [],
  }));
  entries.sort((a, b) => a.logicalPath.localeCompare(b.logicalPath, "es"));
  return {
    generatedAt: new Date().toISOString(),
    entries,
    occurrences: scanOccurrences(options),
  };
}
