/**
 * Pruebas de la lógica pura del inventario de imágenes.
 *
 * Se prueba la fusión entre el manifiesto (assets compilados) y las filas de
 * `site_media` (medios de Storage), el filtrado y el resumen. No se toca la
 * red: todos los datos son fixtures.
 */

import { describe, expect, it } from "vitest";
import type { MediaManifest } from "@/lib/mediaManifest";
import type { MediaOccurrenceRow, MediaRow } from "./media-service";
import {
  countOccurrencesByFile,
  filterMediaInventory,
  filterOccurrences,
  findDuplicateByName,
  findDuplicateMedia,
  mediaDeleteBlockers,
  mediaFolderOf,
  mediaFolderOptions,
  mediaFormatOptions,
  mediaUsageWarning,
  mergeMediaInventory,
  mergeOccurrenceInventory,
  occurrenceComponentOptions,
  occurrencePageOptions,
  occurrenceRemovalWarning,
  occurrenceSectionOptions,
  physicalFileDeleteBlockers,
  summarizeMediaInventory,
  summarizeOccurrences,
  totalOccurrenceCount,
  withCacheVersion,
  type InventoryFilters,
  type MediaOccurrenceManifestRecord,
  type OccurrenceFilters,
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

/* ------------------------------------------------------------------ */
/* Apariciones                                                          */
/* ------------------------------------------------------------------ */

/**
 * Fixture del sitio real: 8 archivos, 24 apariciones (10 estáticas y 14 del
 * detalle de cada área de práctica), 8 páginas distintas y 2 archivos que
 * ningún componente usa.
 */

const SITE_FILES = [
  {
    logicalPath: "assets/casoratti-hero.jpg",
    name: "casoratti-hero.jpg",
    format: "jpg" as const,
    bytes: 672379,
    width: 1600,
    height: 900,
  },
  {
    logicalPath: "assets/equipo-reunion.jpg",
    name: "equipo-reunion.jpg",
    format: "jpg" as const,
    bytes: 241100,
    width: 1400,
    height: 933,
  },
  {
    logicalPath: "assets/equipo-sala.jpg",
    name: "equipo-sala.jpg",
    format: "jpg" as const,
    bytes: 198450,
    width: 1400,
    height: 933,
  },
  {
    logicalPath: "assets/equipo-pasillo.jpg",
    name: "equipo-pasillo.jpg",
    format: "jpg" as const,
    bytes: 210300,
    width: 1400,
    height: 933,
  },
  {
    logicalPath: "assets/justice-scale.jpg",
    name: "justice-scale.jpg",
    format: "jpg" as const,
    bytes: 143200,
    width: 1200,
    height: 800,
  },
  {
    logicalPath: "assets/equipo-audiencia-horizontal.jpg",
    name: "equipo-audiencia-horizontal.jpg",
    format: "jpg" as const,
    bytes: 187900,
    width: 1600,
    height: 900,
  },
  {
    logicalPath: "assets/scales.webp",
    name: "scales.webp",
    format: "webp" as const,
    bytes: 18832,
    width: 600,
    height: 600,
  },
  {
    logicalPath: "assets/team-room.jpg",
    name: "team-room.jpg",
    format: "jpg" as const,
    bytes: 160000,
    width: 1200,
    height: 800,
  },
];

function siteEntry(file: (typeof SITE_FILES)[number]) {
  return {
    logicalPath: file.logicalPath,
    physicalPath: `client/src/${file.logicalPath}`,
    publicPath: `/assets/${file.name.replace(/\./g, "-")}-hash.${file.format}`,
    originalName: file.name,
    format: file.format,
    bytes: file.bytes,
    width: file.width,
    height: file.height,
    modifiedAt: "2026-11-10T08:00:00.000Z",
    provider: "bundled" as const,
    references: [],
  };
}

/** Las 10 apariciones fijas del sitio, con su archivo y su línea reales. */
const STATIC_OCCURRENCES: MediaOccurrenceManifestRecord[] = [
  {
    occurrenceId: "home-hero",
    imageLogicalPath: "assets/casoratti-hero.jpg",
    page: "Inicio",
    section: "Portada",
    component: "Home",
    file: "client/src/pages/SitePages.tsx",
    line: 32,
    status: "detected",
  },
  {
    occurrenceId: "home-split",
    imageLogicalPath: "assets/equipo-reunion.jpg",
    page: "Inicio",
    section: "Presentación",
    component: "Home",
    file: "client/src/pages/SitePages.tsx",
    line: 37,
    status: "detected",
  },
  {
    occurrenceId: "studio-intro",
    imageLogicalPath: "assets/equipo-reunion.jpg",
    page: "El estudio",
    section: "Encabezado",
    component: "Studio",
    file: "client/src/pages/SitePages.tsx",
    line: 45,
    status: "detected",
  },
  {
    occurrenceId: "studio-gallery-main",
    imageLogicalPath: "assets/equipo-sala.jpg",
    page: "El estudio",
    section: "Galería principal",
    component: "Studio",
    file: "client/src/pages/SitePages.tsx",
    line: 45,
    status: "detected",
  },
  {
    occurrenceId: "studio-gallery-aside",
    imageLogicalPath: "assets/equipo-pasillo.jpg",
    page: "El estudio",
    section: "Galería lateral",
    component: "Studio",
    file: "client/src/pages/SitePages.tsx",
    line: 45,
    status: "detected",
  },
  {
    occurrenceId: "areas-intro",
    imageLogicalPath: "assets/equipo-pasillo.jpg",
    page: "Áreas de práctica",
    section: "Encabezado",
    component: "Areas",
    file: "client/src/pages/SitePages.tsx",
    line: 49,
    status: "detected",
  },
  {
    occurrenceId: "values-intro",
    imageLogicalPath: "assets/justice-scale.jpg",
    page: "Valores",
    section: "Encabezado",
    component: "Values",
    file: "client/src/pages/SitePages.tsx",
    line: 63,
    status: "detected",
  },
  {
    occurrenceId: "resources-intro",
    imageLogicalPath: "assets/equipo-reunion.jpg",
    page: "Centro de recursos",
    section: "Encabezado",
    component: "Resources",
    file: "client/src/pages/SitePages.tsx",
    line: 66,
    status: "detected",
  },
  {
    occurrenceId: "faq-intro",
    imageLogicalPath: "assets/equipo-reunion.jpg",
    page: "Preguntas frecuentes",
    section: "Encabezado",
    component: "FAQ",
    file: "client/src/pages/SitePages.tsx",
    line: 73,
    status: "detected",
  },
  {
    occurrenceId: "contact-intro",
    imageLogicalPath: "assets/equipo-pasillo.jpg",
    page: "Contacto",
    section: "Encabezado",
    component: "Contact",
    file: "client/src/pages/SitePages.tsx",
    line: 178,
    status: "detected",
  },
];

/**
 * Los 14 detalles de área, con el archivo que usa cada uno y la etiqueta real
 * del área (que es la sección donde aparece).
 */
const AREA_OCCURRENCES: MediaOccurrenceManifestRecord[] = [
  ["familia", "Personas", "assets/equipo-reunion.jpg"],
  ["sucesiones", "Patrimonio familiar", "assets/equipo-sala.jpg"],
  ["danos-y-seguros", "Responsabilidad", "assets/equipo-audiencia-horizontal.jpg"],
  ["previsional", "Seguridad social", "assets/equipo-reunion.jpg"],
  ["civil-y-comercial", "Patrimonial", "assets/equipo-pasillo.jpg"],
  ["derecho-de-la-propiedad", "Inmuebles", "assets/equipo-sala.jpg"],
  ["laboral", "Trabajo", "assets/equipo-reunion.jpg"],
  ["penal", "Defensa", "assets/equipo-audiencia-horizontal.jpg"],
  ["gestiones-administrativas", "Estado y trámites", "assets/equipo-pasillo.jpg"],
  ["consumidor", "Relaciones de consumo", "assets/equipo-pasillo.jpg"],
  ["societario-y-empresarial", "Negocios", "assets/equipo-sala.jpg"],
  ["penal-economico", "Defensa especializada", "assets/equipo-audiencia-horizontal.jpg"],
  ["mediacion-y-negociacion", "Prevención", "assets/equipo-reunion.jpg"],
  ["gestoria-automotor", "Gestoría", "assets/equipo-pasillo.jpg"],
].map(([slug, section, imageLogicalPath]) => ({
  occurrenceId: `area-detail-${slug}`,
  imageLogicalPath,
  page: "Detalle del área",
  section,
  component: "AreaDetail",
  file: "client/src/pages/SitePages.tsx",
  line: 58,
  status: "detected" as const,
}));

const SITE_OCCURRENCES = [...STATIC_OCCURRENCES, ...AREA_OCCURRENCES];

function makeSiteManifest(
  occurrences: MediaOccurrenceManifestRecord[] = SITE_OCCURRENCES,
): MediaManifest {
  return {
    generatedAt: "2026-11-25T10:00:00.000Z",
    entries: SITE_FILES.map(siteEntry),
    occurrences,
  } as unknown as MediaManifest;
}

const NO_OCCURRENCE_FILTERS: OccurrenceFilters = {
  search: "",
  page: "",
  section: "",
  component: "",
  status: "all",
};

function makeOccurrenceRow(
  overrides: Partial<MediaOccurrenceRow> & { occurrence_id: string },
): MediaOccurrenceRow {
  return {
    storage_path: null,
    status: "active",
    title: null,
    alt_text: null,
    description: null,
    category: null,
    tags: [],
    ...overrides,
  };
}

describe("mergeOccurrenceInventory", () => {
  it("devuelve un registro por aparición, sin agrupar", () => {
    const occurrences = mergeOccurrenceInventory(makeSiteManifest(), [], []);

    expect(occurrences).toHaveLength(24);
    expect(new Set(occurrences.map(item => item.occurrenceId)).size).toBe(24);
  });

  it("no junta las apariciones que comparten el mismo archivo", () => {
    const occurrences = mergeOccurrenceInventory(makeSiteManifest(), [], []);
    const reuniones = occurrences.filter(
      item => item.imageLogicalPath === "assets/equipo-reunion.jpg",
    );

    /* Las 8 apariciones de la imagen de la reunión siguen siendo 8. */
    expect(reuniones).toHaveLength(8);
    expect(reuniones.every(item => item.sharedCount === 8)).toBe(true);
    expect(
      reuniones.map(item => item.occurrenceId).sort(),
    ).toEqual(
      [
        "area-detail-familia",
        "area-detail-laboral",
        "area-detail-mediacion-y-negociacion",
        "area-detail-previsional",
        "faq-intro",
        "home-split",
        "resources-intro",
        "studio-intro",
      ].sort(),
    );
  });

  it("trae el lugar, el archivo y la URL de cada aparición", () => {
    const occurrences = mergeOccurrenceInventory(makeSiteManifest(), [], []);
    const hero = occurrences.find(item => item.occurrenceId === "home-hero");

    expect(hero).toBeDefined();
    expect(hero?.page).toBe("Inicio");
    expect(hero?.section).toBe("Portada");
    expect(hero?.component).toBe("Home");
    expect(hero?.name).toBe("casoratti-hero.jpg");
    expect(hero?.physicalPath).toBe("client/src/assets/casoratti-hero.jpg");
    expect(hero?.publicUrl).toBe("/assets/casoratti-hero-jpg-hash.jpg");
    expect(hero?.width).toBe(1600);
    expect(hero?.height).toBe(900);
    expect(hero?.status).toBe("unchanged");
    expect(hero?.sourceFile).toBe("client/src/pages/SitePages.tsx");
    expect(hero?.sourceLine).toBeGreaterThan(0);
  });

  it("marca como reemplazada la aparición que tiene ficha propia", () => {
    const occurrenceRows = [
      makeOccurrenceRow({
        occurrence_id: "studio-gallery-aside",
        storage_path: "occurrences/studio-gallery-aside/equipo-pasillo.jpg",
        alt_text: "Reunión de trabajo en el estudio",
      }),
    ];

    const occurrences = mergeOccurrenceInventory(
      makeSiteManifest(),
      [],
      occurrenceRows,
      { storageUrl: path => `https://cdn.test/${path}` },
    );

    const aside = occurrences.find(
      item => item.occurrenceId === "studio-gallery-aside",
    );
    expect(aside?.status).toBe("replaced");
    expect(aside?.publicUrl).toBe(
      "https://cdn.test/occurrences/studio-gallery-aside/equipo-pasillo.jpg",
    );
    expect(aside?.metadata.altText).toBe("Reunión de trabajo en el estudio");

    /* Las demás apariciones del mismo archivo no se tocan. */
    const main = occurrences.find(
      item => item.occurrenceId === "studio-gallery-main",
    );
    expect(main?.status).toBe("unchanged");
  });

  it("marca como oculta la aparición a la que se le quitó la imagen", () => {
    const occurrenceRows = [
      makeOccurrenceRow({
        occurrence_id: "values-intro",
        status: "hidden",
      }),
    ];

    const occurrences = mergeOccurrenceInventory(
      makeSiteManifest(),
      [],
      occurrenceRows,
    );

    const values = occurrences.find(item => item.occurrenceId === "values-intro");
    expect(values?.status).toBe("hidden");
    expect(values?.publicUrl).toBe("");
  });

  it("muestra la versión nueva del archivo en las apariciones que lo usan", () => {
    const fileRow = makeRow({
      id: "row-file-override",
      logical_path: "assets/equipo-reunion.jpg",
      storage_path: "images/general/equipo-reunion.jpg",
      source: "override",
      width: 1200,
      height: 800,
    });

    const occurrences = mergeOccurrenceInventory(
      makeSiteManifest(),
      [fileRow],
      [],
      { storageUrl: path => `https://cdn.test/${path}` },
    );

    const split = occurrences.find(item => item.occurrenceId === "home-split");
    expect(split?.status).toBe("replaced");
    expect(split?.publicUrl).toBe(
      "https://cdn.test/images/general/equipo-reunion.jpg",
    );
    expect(split?.width).toBe(1200);
  });

  it("devuelve una lista vacía si el manifiesto no trae apariciones", () => {    const manifest = {
      generatedAt: "2026-11-25T10:00:00.000Z",
      entries: SITE_FILES.map(siteEntry),
    } as MediaManifest;

    expect(mergeOccurrenceInventory(manifest, [], [])).toEqual([]);
  });
});

describe("resumen de apariciones", () => {
  it("cuenta los números reales del sitio", () => {
    const occurrences = mergeOccurrenceInventory(makeSiteManifest(), [], []);
    const files = mergeMediaInventory(makeSiteManifest(), []);

    const summary = summarizeOccurrences(occurrences, files);

    expect(summary.totalOccurrences).toBe(24);
    expect(summary.physicalFiles).toBe(6);
    expect(summary.pagesWithImages).toBe(8);
    expect(summary.sharedImages).toBe(4);
    expect(summary.unusedImages).toBe(2);
  });

  it("cuenta el total de apariciones para el contador de la navegación", () => {
    const occurrences = mergeOccurrenceInventory(makeSiteManifest(), [], []);
    expect(totalOccurrenceCount(occurrences)).toBe(24);
  });

  it("cuenta cuántas apariciones usa cada archivo", () => {
    const occurrences = mergeOccurrenceInventory(makeSiteManifest(), [], []);
    const counts = countOccurrencesByFile(occurrences);

    expect(counts.get("assets/equipo-reunion.jpg")).toBe(8);
    expect(counts.get("assets/equipo-pasillo.jpg")).toBe(7);
    expect(counts.get("assets/equipo-sala.jpg")).toBe(4);
    expect(counts.get("assets/equipo-audiencia-horizontal.jpg")).toBe(3);
    expect(counts.get("assets/casoratti-hero.jpg")).toBe(1);
    expect(counts.get("assets/scales.webp")).toBeUndefined();
  });
});

describe("filtros de apariciones", () => {
  const occurrences = mergeOccurrenceInventory(makeSiteManifest(), [], []);

  it("filtra por página", () => {
    const found = filterOccurrences(occurrences, {
      ...NO_OCCURRENCE_FILTERS,
      page: "Inicio",
    });
    expect(found).toHaveLength(2);
    expect(found.map(item => item.occurrenceId).sort()).toEqual([
      "home-hero",
      "home-split",
    ]);
  });

  it("filtra por sección", () => {
    const found = filterOccurrences(occurrences, {
      ...NO_OCCURRENCE_FILTERS,
      section: "Encabezado",
    });
    /* studio-intro, areas-intro, values-intro, resources-intro, faq-intro y
       contact-intro. */
    expect(found).toHaveLength(6);
  });

  it("filtra por componente", () => {
    const found = filterOccurrences(occurrences, {
      ...NO_OCCURRENCE_FILTERS,
      component: "Home",
    });
    expect(found).toHaveLength(2);
    expect(found.map(item => item.occurrenceId).sort()).toEqual([
      "home-hero",
      "home-split",
    ]);
  });

  it("filtra por texto", () => {
    const found = filterOccurrences(occurrences, {
      ...NO_OCCURRENCE_FILTERS,
      search: "penal",
    });
    expect(found.map(item => item.occurrenceId)).toEqual([
      "area-detail-penal",
      "area-detail-penal-economico",
    ]);
  });

  it("filtra por estado", () => {
    const occurrenceRows = [
      makeOccurrenceRow({
        occurrence_id: "home-hero",
        storage_path: "occurrences/home-hero/hero.jpg",
      }),
    ];
    const withOverride = mergeOccurrenceInventory(
      makeSiteManifest(),
      [],
      occurrenceRows,
    );

    const found = filterOccurrences(withOverride, {
      ...NO_OCCURRENCE_FILTERS,
      status: "replaced",
    });
    expect(found).toHaveLength(1);
    expect(found[0].occurrenceId).toBe("home-hero");
  });

  it("devuelve todo cuando no hay filtros", () => {
    expect(filterOccurrences(occurrences, NO_OCCURRENCE_FILTERS)).toHaveLength(24);
  });

  it("lista las páginas, secciones y componentes sin repetir", () => {
    expect(occurrencePageOptions(occurrences)).toEqual([
      "Áreas de práctica",
      "Centro de recursos",
      "Contacto",
      "Detalle del área",
      "El estudio",
      "Inicio",
      "Preguntas frecuentes",
      "Valores",
    ]);

    /* 5 secciones fijas más la etiqueta de cada una de las 14 áreas. */
    const sections = occurrenceSectionOptions(occurrences);
    expect(sections).toHaveLength(19);
    expect(sections).toContain("Encabezado");
    expect(sections).toContain("Portada");
    expect(sections).toContain("Defensa especializada");

    expect(occurrenceComponentOptions(occurrences)).toEqual([
      "AreaDetail",
      "Areas",
      "Contact",
      "FAQ",
      "Home",
      "Resources",
      "Studio",
      "Values",
    ]);
  });
});

describe("borrado de archivos con apariciones vivas", () => {
  const occurrences = mergeOccurrenceInventory(makeSiteManifest(), [], []);
  const files = mergeMediaInventory(makeSiteManifest(), []);
  const counts = countOccurrencesByFile(occurrences);

  it("bloquea el borrado de un archivo que tiene apariciones", () => {
    const reunion = files.find(
      item => item.logicalPath === "assets/equipo-reunion.jpg",
    );
    expect(reunion).toBeDefined();

    const blockers = physicalFileDeleteBlockers(
      reunion!,
      counts.get("assets/equipo-reunion.jpg") ?? 0,
    );

    expect(blockers.length).toBeGreaterThan(0);
    expect(blockers.join(" ")).toContain("8 apariciones");
  });

  it("permite borrar un archivo del banco que no usa ninguna aparición", () => {
    const storageRow = makeRow({
      id: "row-storage",
      logical_path: "images/general/guardia.png",
      storage_path: "images/general/guardia.png",
      stored_name: "guardia.png",
      original_name: "Guardia.png",
      format: "png",
      mime_type: "image/png",
    });
    const storageFiles = mergeMediaInventory(null, [storageRow]);
    const storageFile = storageFiles[0];

    const blockers = physicalFileDeleteBlockers(storageFile, 0);

    expect(blockers).toEqual([]);
  });

  it("protege los assets del paquete aunque no tengan apariciones", () => {
    const hero = files.find(
      item => item.logicalPath === "assets/casoratti-hero.jpg",
    );
    expect(hero).toBeDefined();

    const blockers = physicalFileDeleteBlockers(
      hero!,
      counts.get("assets/casoratti-hero.jpg") ?? 0,
    );

    expect(blockers.join(" ")).toContain("build");
  });

  it("avisa cuántas apariciones comparten el archivo al quitar una", () => {
    const reunion = occurrences.find(
      item => item.occurrenceId === "studio-intro",
    );
    expect(reunion?.sharedCount).toBe(8);
    expect(occurrenceRemovalWarning(reunion!)).toContain("8 apariciones");
    expect(occurrenceRemovalWarning(reunion!)).toContain("no se borra");
  });

  it("avisa cuando la aparición es la única que usa el archivo", () => {
    const hero = occurrences.find(item => item.occurrenceId === "home-hero");
    expect(occurrenceRemovalWarning(hero!)).toContain("la única que usa");
  });
});
