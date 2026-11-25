/**
 * Pruebas del escáner real del manifiesto de imágenes.
 *
 * Todo es determinista y local: se construyen bytes de imagen en memoria y
 * se usan carpetas temporales. Ninguna prueba depende de la red.
 */

import { crc32 } from "node:zlib";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildMediaManifest,
  findImageReferences,
  logicalPathFromPhysical,
  matchEmittedAsset,
  readImageDimensions,
  scanImages,
  type ScannedImage,
} from "./mediaManifest.server";

// -----------------------------------------------------------------------------
// Fixtures: imágenes mínimas construidas a mano
// -----------------------------------------------------------------------------

function buildPng(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profundidad de bits
  ihdr[9] = 6; // color RGBA
  const chunk = Buffer.alloc(8 + 13 + 4);
  chunk.writeUInt32BE(13, 0);
  chunk.write("IHDR", 4, "ascii");
  ihdr.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([Buffer.from("IHDR", "ascii"), ihdr])), 8 + 13);
  return Buffer.concat([signature, chunk]);
}

function buildJpeg(width: number, height: number): Buffer {
  const app0 = Buffer.alloc(18);
  app0[0] = 0xff;
  app0[1] = 0xe0;
  app0.writeUInt16BE(16, 2);
  app0.write("JFIF\0", 4, "ascii");
  const sof0 = Buffer.alloc(21);
  sof0[0] = 0xff;
  sof0[1] = 0xc0;
  sof0.writeUInt16BE(17, 2); // largo del segmento
  sof0[4] = 8; // precisión
  sof0.writeUInt16BE(height, 5);
  sof0.writeUInt16BE(width, 7);
  sof0[9] = 3; // componentes
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof0, Buffer.from([0xff, 0xd9])]);
}

function buildWebpLossless(width: number, height: number): Buffer {
  const bits = ((width - 1) | ((height - 1) << 14) | (1 << 28)) >>> 0;
  const payload = Buffer.alloc(5);
  payload[0] = 0x2f;
  payload.writeUInt32LE(bits, 1);
  const chunk = Buffer.alloc(8);
  chunk.write("VP8L", 0, "ascii");
  chunk.writeUInt32LE(payload.length, 4);
  const body = Buffer.concat([chunk, payload]);
  const riff = Buffer.alloc(12);
  riff.write("RIFF", 0, "ascii");
  riff.writeUInt32LE(4 + body.length, 4);
  riff.write("WEBP", 8, "ascii");
  return Buffer.concat([riff, body]);
}

function buildGif(width: number, height: number): Buffer {
  const header = Buffer.alloc(10);
  header.write("GIF89a", 0, "ascii");
  header.writeUInt16LE(width, 6);
  header.writeUInt16LE(height, 8);
  return header;
}

function buildBox(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + payload.length, 0);
  header.write(type, 4, "ascii");
  return Buffer.concat([header, payload]);
}

function buildAvif(width: number, height: number): Buffer {
  const ispePayload = Buffer.alloc(12);
  ispePayload.writeUInt32BE(width, 4);
  ispePayload.writeUInt32BE(height, 8);
  const meta = buildBox("meta", Buffer.concat([Buffer.alloc(4), buildBox("ispe", ispePayload)]));
  const ftyp = buildBox("ftyp", Buffer.from("avifisom", "ascii"));
  return Buffer.concat([ftyp, meta]);
}

function buildSvg(width: number, height: number): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="10" height="10"/></svg>`,
    "utf8",
  );
}

// -----------------------------------------------------------------------------
// Utilidades
// -----------------------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "casoratti-media-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function findRepoRoot(): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    if (
      fs.existsSync(path.join(dir, "client", "src", "assets")) &&
      fs.existsSync(path.join(dir, "package.json"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("No se encontró la raíz del repositorio");
}

function writeFile(root: string, relative: string, content: string | Buffer): void {
  const full = path.join(root, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

// -----------------------------------------------------------------------------
// Lectura de dimensiones
// -----------------------------------------------------------------------------

describe("readImageDimensions", () => {
  it("lee el ancho y el alto de un PNG desde el IHDR", () => {
    expect(readImageDimensions(buildPng(1200, 800), "png")).toEqual({
      width: 1200,
      height: 800,
    });
  });

  it("lee el ancho y el alto de un JPEG desde el marcador SOF0", () => {
    expect(readImageDimensions(buildJpeg(900, 600), "jpg")).toEqual({
      width: 900,
      height: 600,
    });
  });

  it("lee el ancho y el alto de un WEBP sin pérdida (VP8L)", () => {
    expect(readImageDimensions(buildWebpLossless(640, 480), "webp")).toEqual({
      width: 640,
      height: 480,
    });
  });

  it("lee el ancho y el alto de un GIF desde el descriptor lógico", () => {
    expect(readImageDimensions(buildGif(320, 200), "gif")).toEqual({
      width: 320,
      height: 200,
    });
  });

  it("lee el ancho y el alto de un AVIF desde la caja ispe", () => {
    expect(readImageDimensions(buildAvif(1024, 768), "avif")).toEqual({
      width: 1024,
      height: 768,
    });
  });

  it("lee el ancho y el alto de un SVG por sus atributos", () => {
    expect(readImageDimensions(buildSvg(400, 300), "svg")).toEqual({
      width: 400,
      height: 300,
    });
  });

  it("devuelve null cuando la cabecera no se puede interpretar", () => {
    expect(readImageDimensions(Buffer.from("no soy una imagen"), "png")).toEqual({
      width: null,
      height: null,
    });
    expect(readImageDimensions(Buffer.from("no soy una imagen"), "jpg")).toEqual({
      width: null,
      height: null,
    });
  });
});

// -----------------------------------------------------------------------------
// Normalización de rutas
// -----------------------------------------------------------------------------

describe("logicalPathFromPhysical", () => {
  it("deja el asset compilado con su ruta lógica estable", () => {
    expect(logicalPathFromPhysical("client/src/assets/casoratti-hero.jpg")).toBe(
      "assets/casoratti-hero.jpg",
    );
  });

  it("deja la imagen pública con su ruta relativa", () => {
    expect(logicalPathFromPhysical("client/public/institucional/logo.webp")).toBe(
      "institucional/logo.webp",
    );
  });

  it("normaliza separadores de Windows", () => {
    expect(logicalPathFromPhysical("client\\src\\assets\\equipo-sala.jpg")).toBe(
      "assets/equipo-sala.jpg",
    );
  });
});

// -----------------------------------------------------------------------------
// Detección de referencias
// -----------------------------------------------------------------------------

describe("findImageReferences", () => {
  function createProject(): string {
    const root = makeTempDir();
    writeFile(root, path.join("client", "src", "assets", "prueba.jpg"), buildJpeg(800, 600));
    writeFile(root, path.join("client", "public", "logo.png"), buildPng(64, 64));
    writeFile(
      root,
      path.join("client", "src", "pages", "Demo.tsx"),
      [
        'import foto from "@/assets/prueba.jpg";',
        'const ruta = "/assets/prueba.jpg";',
        "export const Demo = () => <img src={foto} />;",
      ].join("\n"),
    );
    writeFile(
      root,
      path.join("client", "src", "styles", "demo.css"),
      ['.hero { background-image: url("../assets/prueba.jpg"); }'].join("\n"),
    );
    return root;
  }

  it("detecta el import, la cadena y el url() con archivo y línea", () => {
    const root = createProject();
    const images = scanImages({ repoRoot: root });
    const references = findImageReferences(images, { repoRoot: root });
    const found = references.get("assets/prueba.jpg") ?? [];

    expect(found).toHaveLength(3);
    expect(found).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: "client/src/pages/Demo.tsx", line: 1, kind: "import" }),
        expect.objectContaining({ file: "client/src/pages/Demo.tsx", line: 2, kind: "string" }),
        expect.objectContaining({ file: "client/src/styles/demo.css", line: 1, kind: "url" }),
      ]),
    );
  });

  it("deja sin referencias a la imagen que nadie usa", () => {
    const root = createProject();
    const images = scanImages({ repoRoot: root });
    const references = findImageReferences(images, { repoRoot: root });
    expect(references.get("logo.png")).toEqual([]);
  });

  it("escanea las imágenes reales del repositorio con sus rutas", () => {
    const root = findRepoRoot();
    const images = scanImages({ repoRoot: root });
    const logicalPaths = images.map((image) => image.logicalPath);
    expect(logicalPaths).toContain("assets/casoratti-hero.jpg");
    expect(logicalPaths).toContain("assets/equipo-reunion.jpg");
    expect(logicalPaths).toContain("assets/scales.webp");
    for (const image of images) {
      expect(image.bytes).toBeGreaterThan(0);
      expect(image.physicalPath.startsWith("client/")).toBe(true);
      expect(image.modifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });
});

// -----------------------------------------------------------------------------
// Emparejamiento con los archivos emitidos por Vite
// -----------------------------------------------------------------------------

describe("matchEmittedAsset", () => {
  const emitted = [
    {
      fileName: "assets/casoratti-hero-D1x2y3z.jpg",
      name: "casoratti-hero.jpg",
      names: ["casoratti-hero.jpg"],
      originalFileNames: ["src/assets/casoratti-hero.jpg"],
    },
    {
      fileName: "assets/equipo-sala-Ab9c8d7e.jpg",
      name: "equipo-sala.jpg",
      names: ["equipo-sala.jpg"],
      originalFileNames: ["src/assets/equipo-sala.jpg"],
    },
  ];

  it("encuentra el archivo emitido a partir de la ruta original", () => {
    const match = matchEmittedAsset("src/assets/casoratti-hero.jpg", emitted);
    expect(match?.fileName).toBe("assets/casoratti-hero-D1x2y3z.jpg");
  });

  it("devuelve null cuando el asset no fue emitido", () => {
    expect(matchEmittedAsset("src/assets/scales.webp", emitted)).toBeNull();
  });

  it("cae al nombre del archivo si Vite no informa la ruta original", () => {
    const match = matchEmittedAsset(
      "src/assets/equipo-sala.jpg",
      [
        {
          fileName: "assets/equipo-sala-Ab9c8d7e.jpg",
          name: "equipo-sala.jpg",
        },
      ],
    );
    expect(match?.fileName).toBe("assets/equipo-sala-Ab9c8d7e.jpg");
  });
});

// -----------------------------------------------------------------------------
// Manifiesto completo
// -----------------------------------------------------------------------------

describe("buildMediaManifest", () => {
  it("arma el manifiesto con datos reales del repositorio", () => {
    const root = findRepoRoot();
    const manifest = buildMediaManifest({ repoRoot: root });
    expect(manifest.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(manifest.entries.length).toBeGreaterThanOrEqual(8);

    const hero = manifest.entries.find((entry) => entry.logicalPath === "assets/casoratti-hero.jpg");
    expect(hero).toBeDefined();
    expect(hero?.format).toBe("jpg");
    expect(hero?.bytes).toBeGreaterThan(0);
    expect(hero?.width).toBeGreaterThan(0);
    expect(hero?.height).toBeGreaterThan(0);
    expect(hero?.provider).toBe("bundled");
    expect(hero?.references.length).toBeGreaterThan(0);
    expect(hero?.references.map((reference) => reference.file)).toContain(
      "client/src/pages/SitePages.tsx",
    );
    const siteReference = hero?.references.find(
      (reference) => reference.file === "client/src/pages/SitePages.tsx",
    );
    expect(siteReference?.kind).toBe("import");
    expect(siteReference?.line).toBeGreaterThan(0);
  });

  it("usa la URL hasheada real cuando Vite emitió el asset", () => {
    const root = findRepoRoot();
    const manifest = buildMediaManifest({
      repoRoot: root,
      emitted: [
        {
          fileName: "assets/casoratti-hero-D1x2y3z.jpg",
          name: "casoratti-hero.jpg",
          originalFileNames: ["src/assets/casoratti-hero.jpg"],
        },
      ],
    });
    const hero = manifest.entries.find((entry) => entry.logicalPath === "assets/casoratti-hero.jpg");
    expect(hero?.publicPath).toBe("/assets/casoratti-hero-D1x2y3z.jpg");
    // Un asset que Vite no emite no tiene URL pública real.
    const unused = manifest.entries.find((entry) => entry.logicalPath === "assets/scales.webp");
    expect(unused?.publicPath).toBe("");
  });

  it("en desarrollo usa la ruta real que sirve Vite", () => {
    const root = findRepoRoot();
    const manifest = buildMediaManifest({ repoRoot: root });
    const hero = manifest.entries.find((entry) => entry.logicalPath === "assets/casoratti-hero.jpg");
    expect(hero?.publicPath).toBe("/src/assets/casoratti-hero.jpg");
  });

  it("arma un manifiesto con las imágenes de una carpeta temporal", () => {
    const root = makeTempDir();
    writeFile(root, path.join("client", "src", "assets", "prueba.jpg"), buildJpeg(800, 600));
    writeFile(
      root,
      path.join("client", "src", "pages", "Demo.tsx"),
      'import foto from "@/assets/prueba.jpg";',
    );
    const manifest = buildMediaManifest({ repoRoot: root });
    expect(manifest.entries).toHaveLength(1);
    const entry = manifest.entries[0] as (typeof manifest.entries)[number];
    expect(entry.logicalPath).toBe("assets/prueba.jpg");
    expect(entry.physicalPath).toBe("client/src/assets/prueba.jpg");
    expect(entry.width).toBe(800);
    expect(entry.height).toBe(600);
    expect(entry.references[0]?.kind).toBe("import");
    expect(entry.references[0]?.label).toBe("Página Demo");
  });
});

describe("scanImages", () => {
  it("devuelve cada imagen con su peso, sus dimensiones y su ruta", () => {
    const root = makeTempDir();
    writeFile(root, path.join("client", "src", "assets", "prueba.png"), buildPng(320, 240));
    const images: ScannedImage[] = scanImages({ repoRoot: root });
    expect(images).toHaveLength(1);
    expect(images[0]?.logicalPath).toBe("assets/prueba.png");
    expect(images[0]?.clientRelativePath).toBe("src/assets/prueba.png");
    expect(images[0]?.origin).toBe("source");
    expect(images[0]?.width).toBe(320);
    expect(images[0]?.height).toBe(240);
  });
});
