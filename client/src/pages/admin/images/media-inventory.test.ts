/**
 * Pruebas de la lógica pura del inventario de imágenes.
 *
 * Se prueba la fusión entre el manifiesto (assets compilados) y las filas de
 * `site_media` (medios de Storage), el filtrado y el resumen. No se toca la
 * red: todos los datos son fixtures.
 */

import { describe, expect, it } from "vitest";
import type { MediaManifest } from "@/lib/mediaManifest";
import type { MediaRow } from "./media-service";
import {
  filterMediaInventory,
  findDuplicateByName,
  findDuplicateMedia,
  mediaDeleteBlockers,
  mediaFolderOf,
  mediaFolderOptions,
  mediaFormatOptions,
  mediaUsageWarning,
  mergeMediaInventory,
  summarizeMediaInventory,
  withCacheVersion,
  type InventoryFilters,
} from "./media-inventory";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function makeManifest(entries: MediaManifest["entries"]): MediaManifest {
  return { generatedAt: "2026-11-25T10:00:00.000Z", entries };
}

function makeRow(overrides: Partial<MediaRow> = {}): MediaRow {
  return {
    id: "row-1",
    logical_path: "images/general/foto.webp",
    storage_path: "images/general/foto.webp",
    provider: "supabase-storage",
    source: "upload",
    original_name: "Foto Original.webp",
    stored_name: "foto.webp",
    mime_type: "image/webp",
    format: "webp",
    size_bytes: 2048,
    width: 800,
    height: 600,
    alt_text: null,
    title: null,
    description: null,
    category: null,
    tags: [],
    status: "active",
    created_at: "2026-11-20T10:00:00.000Z",
    updated_at: "2026-11-21T10:00:00.000Z",
    deleted_at: null,
    ...overrides,
  };
}

const HERO_ENTRY = {
  logicalPath: "assets/casoratti-hero.jpg",
  physicalPath: "client/src/assets/casoratti-hero.jpg",
  publicPath: "/assets/casoratti-hero-a1b2c3.jpg",
  originalName: "casoratti-hero.jpg",
  format: "jpg" as const,
  bytes: 672379,
  width: 1600,
  height: 900,
  modifiedAt: "2026-11-10T08:00:00.000Z",
  provider: "bundled" as const,
  references: [
    {
      file: "client/src/pages/SitePages.tsx",
      line: 42,
      kind: "import" as const,
      label: "Página de inicio",
    },
  ],
};

const SCALES_ENTRY = {
  ...HERO_ENTRY,
  logicalPath: "assets/scales.webp",
  physicalPath: "client/src/assets/scales.webp",
  publicPath: "/assets/scales-d4e5f6.webp",
  originalName: "scales.webp",
  format: "webp" as const,
  bytes: 18832,
  width: 600,
  height: 600,
  references: [],
};

const NO_FILTERS: InventoryFilters = {
  search: "",
  format: "",
  folder: "",
  status: "all",
};

/* ------------------------------------------------------------------ */
/* Fusión                                                              */
/* ------------------------------------------------------------------ */

describe("mergeMediaInventory", () => {
  it("devuelve el inventario vacío si no hay manifiesto ni filas", () => {
    expect(mergeMediaInventory(null, [])).toEqual([]);
  });

  it("traduce las entradas del manifiesto a ítems del inventario", () => {
    const items = mergeMediaInventory(makeManifest([HERO_ENTRY]), []);

    expect(items).toHaveLength(1);
    const [hero] = items;
    expect(hero.origin).toBe("bundled");
    expect(hero.logicalPath).toBe("assets/casoratti-hero.jpg");
    expect(hero.physicalPath).toBe("client/src/assets/casoratti-hero.jpg");
    expect(hero.publicPath).toBe("/assets/casoratti-hero-a1b2c3.jpg");
    expect(hero.format).toBe("jpg");
    expect(hero.bytes).toBe(672379);
    expect(hero.width).toBe(1600);
    expect(hero.height).toBe(900);
    expect(hero.referenceCount).toBe(1);
    expect(hero.status).toBe("in-use");
    expect(hero.folder).toBe("assets");
    expect(hero.rowId).toBeNull();
  });

  it("marca como sin referencias el asset que nadie usa", () => {
    const items = mergeMediaInventory(makeManifest([SCALES_ENTRY]), []);
    expect(items[0].status).toBe("unused");
    expect(items[0].referenceCount).toBe(0);
  });

  it("agrega los medios de Storage al inventario", () => {
    const items = mergeMediaInventory(null, [makeRow()], {
      storageUrl: path => `https://cdn.test/${path}`,
    });

    expect(items).toHaveLength(1);
    const [item] = items;
    expect(item.origin).toBe("storage");
    expect(item.provider).toBe("supabase-storage");
    expect(item.physicalPath).toBe("images/general/foto.webp");
    expect(item.storagePath).toBe("images/general/foto.webp");
    expect(item.publicUrl).toBe("https://cdn.test/images/general/foto.webp");
    expect(item.status).toBe("unused");
    expect(item.rowId).toBe("row-1");
  });

  it("fusiona un override: mantiene el asset del build y suma la versión de Storage", () => {
    const row = makeRow({
      id: "row-override",
      logical_path: "assets/casoratti-hero.jpg",
      storage_path: "images/general/casoratti-hero.jpg",
      source: "override",
      size_bytes: 900,
      width: 800,
      height: 450,
    });

    const items = mergeMediaInventory(makeManifest([HERO_ENTRY]), [row], {
      storageUrl: path => `https://cdn.test/${path}`,
    });

    expect(items).toHaveLength(1);
    const [hero] = items;
    expect(hero.status).toBe("replaced");
    expect(hero.physicalPath).toBe("client/src/assets/casoratti-hero.jpg");
    expect(hero.storagePath).toBe("images/general/casoratti-hero.jpg");
    expect(hero.publicUrl).toBe("https://cdn.test/images/general/casoratti-hero.jpg");
    expect(hero.bytes).toBe(900);
    expect(hero.width).toBe(800);
    expect(hero.referenceCount).toBe(1);
    expect(hero.rowId).toBe("row-override");
  });

  it("no duplica la imagen cuando el override comparte la ruta lógica", () => {
    const row = makeRow({
      id: "row-override",
      logical_path: "assets/casoratti-hero.jpg",
      storage_path: "images/general/casoratti-hero.jpg",
      source: "override",
    });

    const items = mergeMediaInventory(makeManifest([HERO_ENTRY]), [row]);
    expect(items).toHaveLength(1);
  });

  it("respeta el estado de papelera de la fila", () => {
    const row = makeRow({ status: "trashed", deleted_at: "2026-11-22T10:00:00.000Z" });
    const items = mergeMediaInventory(null, [row]);
    expect(items[0].status).toBe("trashed");
  });

  it("marca como esencial al asset compilado sin ficha en la base", () => {
    const items = mergeMediaInventory(makeManifest([HERO_ENTRY]), []);
    expect(items[0].essential).toBe(true);
    expect(items[0].protectedPath).toBe(true);
  });

  it("no marca como esencial a un medio de Storage", () => {
    const items = mergeMediaInventory(null, [makeRow()]);
    expect(items[0].essential).toBe(false);
    expect(items[0].protectedPath).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Filtrado                                                            */
/* ------------------------------------------------------------------ */

describe("filterMediaInventory", () => {
  const items = mergeMediaInventory(
    makeManifest([HERO_ENTRY, SCALES_ENTRY]),
    [
      makeRow({
        id: "row-2",
        logical_path: "images/institucional/fachada.webp",
        storage_path: "images/institucional/fachada.webp",
        stored_name: "fachada.webp",
        original_name: "Fachada.webp",
        format: "webp",
      }),
    ],
  );

  it("devuelve todo cuando no hay filtros", () => {
    expect(filterMediaInventory(items, NO_FILTERS)).toHaveLength(3);
  });

  it("busca por nombre de archivo", () => {
    const found = filterMediaInventory(items, {
      ...NO_FILTERS,
      search: "fachada",
    });
    expect(found).toHaveLength(1);
    expect(found[0].logicalPath).toBe("images/institucional/fachada.webp");
  });

  it("busca por ruta", () => {
    const found = filterMediaInventory(items, {
      ...NO_FILTERS,
      search: "client/src/assets",
    });
    expect(found).toHaveLength(2);
  });

  it("filtra por formato", () => {
    const found = filterMediaInventory(items, { ...NO_FILTERS, format: "webp" });
    expect(found.map(item => item.logicalPath)).toEqual([
      "assets/scales.webp",
      "images/institucional/fachada.webp",
    ]);
  });

  it("filtra por carpeta exacta", () => {
    const found = filterMediaInventory(items, {
      ...NO_FILTERS,
      folder: "assets",
    });
    expect(found).toHaveLength(2);
  });

  it("incluye las subcarpetas al filtrar por ubicación", () => {
    const found = filterMediaInventory(items, {
      ...NO_FILTERS,
      folder: "images",
    });
    expect(found).toHaveLength(1);
    expect(found[0].folder).toBe("images/institucional");
  });

  it("filtra por estado", () => {
    const found = filterMediaInventory(items, { ...NO_FILTERS, status: "in-use" });
    expect(found).toHaveLength(1);
    expect(found[0].logicalPath).toBe("assets/casoratti-hero.jpg");
  });

  it("combina buscador y filtros", () => {
    const found = filterMediaInventory(items, {
      search: "casoratti",
      format: "jpg",
      folder: "assets",
      status: "in-use",
    });
    expect(found).toHaveLength(1);
  });

  it("no encuentra nada con una búsqueda que no coincide", () => {
    expect(
      filterMediaInventory(items, { ...NO_FILTERS, search: "no-existe" }),
    ).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* Resumen                                                             */
/* ------------------------------------------------------------------ */

describe("summarizeMediaInventory", () => {
  it("cuenta imágenes, uso y espacio ocupado", () => {
    const items = mergeMediaInventory(
      makeManifest([HERO_ENTRY, SCALES_ENTRY]),
      [makeRow({ size_bytes: 2048 })],
    );

    const summary = summarizeMediaInventory(items);
    expect(summary.total).toBe(3);
    expect(summary.active).toBe(3);
    expect(summary.inUse).toBe(1);
    expect(summary.unused).toBe(2);
    expect(summary.trashed).toBe(0);
    expect(summary.bytes).toBe(672379 + 18832 + 2048);
  });

  it("deja las imágenes de la papelera fuera del conteo de uso", () => {
    const items = mergeMediaInventory(makeManifest([HERO_ENTRY]), [
      makeRow({ status: "trashed" }),
    ]);

    const summary = summarizeMediaInventory(items);
    expect(summary.total).toBe(2);
    expect(summary.active).toBe(1);
    expect(summary.trashed).toBe(1);
    expect(summary.inUse).toBe(1);
    expect(summary.unused).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Opciones, duplicados y borrado                                      */
/* ------------------------------------------------------------------ */

describe("opciones de los filtros", () => {
  const items = mergeMediaInventory(
    makeManifest([HERO_ENTRY, SCALES_ENTRY]),
    [makeRow()],
  );

  it("lista los formatos presentes sin repetir", () => {
    expect(mediaFormatOptions(items)).toEqual(["jpg", "webp"]);
  });

  it("lista las carpetas presentes sin repetir", () => {
    expect(mediaFolderOptions(items)).toEqual([
      "assets",
      "images/general",
    ]);
  });
});

describe("detección de duplicados", () => {
  const items = mergeMediaInventory(null, [
    makeRow({
      logical_path: "images/general/foto.webp",
      storage_path: "images/general/foto.webp",
    }),
  ]);

  it("encuentra el archivo que ya ocupa la ruta lógica", () => {
    const found = findDuplicateMedia(items, "images/general", "foto.webp");
    expect(found?.logicalPath).toBe("images/general/foto.webp");
  });

  it("encuentra el archivo por nombre normalizado", () => {
    const found = findDuplicateByName(items, "images/general", "FOTO.WEBP");
    expect(found?.name).toBe("foto.webp");
  });

  it("no encuentra duplicados en otra carpeta", () => {
    expect(findDuplicateMedia(items, "images/equipo", "foto.webp")).toBeNull();
  });
});

describe("condiciones de borrado", () => {
  it("no deja eliminar un asset compilado", () => {
    const [hero] = mergeMediaInventory(makeManifest([HERO_ENTRY]), []);
    const blockers = mediaDeleteBlockers(hero);
    expect(blockers.length).toBeGreaterThan(0);
    expect(blockers.join(" ")).toContain("build");
  });

  it("permite eliminar un medio de Storage sin referencias", () => {
    const [item] = mergeMediaInventory(null, [makeRow()]);
    expect(mediaDeleteBlockers(item)).toEqual([]);
  });

  it("avisa cuántas veces se usa una imagen", () => {
    const [hero] = mergeMediaInventory(makeManifest([HERO_ENTRY]), []);
    expect(mediaUsageWarning(hero)).toContain("1 lugar");
  });

  it("no avisa si la imagen no tiene referencias", () => {
    const [item] = mergeMediaInventory(null, [makeRow()]);
    expect(mediaUsageWarning(item)).toBeNull();
  });
});

describe("utilidades", () => {
  it("saca la carpeta de una ruta lógica", () => {
    expect(mediaFolderOf("images/institucional/foto.webp")).toBe(
      "images/institucional",
    );
    expect(mediaFolderOf("foto.webp")).toBe("");
  });

  it("agrega la marca de tiempo a la URL", () => {
    expect(withCacheVersion("/assets/x.jpg", 123)).toBe("/assets/x.jpg?v=123");
    expect(withCacheVersion("/assets/x.jpg?a=1", 123)).toBe("/assets/x.jpg?a=1&v=123");
    expect(withCacheVersion("", 123)).toBe("");
  });
});
