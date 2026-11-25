/**
 * Pruebas de los servicios de **apariciones**.
 *
 * Se comprueba lo que el contrato exige: la fila de una aparición se escribe
 * con su propio `occurrence_id` y `logical_path = occurrence/<id>`, la fila del
 * archivo físico nunca se toca, la versión anterior queda respaldada y cada
 * operación queda registrada en la auditoría.
 *
 * No hay red: el cliente de Supabase es un doble de prueba.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

/* ------------------------------------------------------------------ */
/* Doble de Supabase                                                    */
/* ------------------------------------------------------------------ */

type FakeRow = Record<string, unknown>;

type Filter = { column: string; value: unknown; negated?: boolean };

type FakeState = {
  rows: FakeRow[];
  inserted: FakeRow[];
  updated: FakeRow[];
  deleted: FakeRow[];
  uploaded: string[];
  copied: { from: string; to: string }[];
  removed: string[];
  activity: { action: string; mediaPath: string | null; detail: Record<string, unknown> }[];
};

function matches(row: FakeRow, filters: Filter[]): boolean {
  return filters.every(filter => {
    const value = row[filter.column];
    return filter.negated
      ? value !== null && value !== undefined
      : value === filter.value;
  });
}

function createFakeClient(initialRows: FakeRow[]) {
  const state: FakeState = {
    rows: initialRows.map(row => ({ ...row })),
    inserted: [],
    updated: [],
    deleted: [],
    uploaded: [],
    copied: [],
    removed: [],
    activity: [],
  };

  function selectQuery(filters: Filter[]) {
    const api: Record<string, unknown> = {
      select: () => api,
      eq: (column: string, value: unknown) => {
        filters.push({ column, value });
        return api;
      },
      not: (column: string, _operator: string, value: unknown) => {
        filters.push({ column, value, negated: true });
        return api;
      },
      order: () => api,
      maybeSingle: async () => {
        const found = state.rows.filter(row => matches(row, filters));
        return { data: found[0] ?? null, error: null };
      },
      then: (
        resolve: (value: { data: FakeRow[]; error: null }) => unknown,
        reject: (reason: unknown) => unknown,
      ) =>
        Promise.resolve({
          data: state.rows.filter(row => matches(row, filters)),
          error: null,
        }).then(resolve, reject),
    };
    return api;
  }

  function updateQuery(payload: FakeRow) {
    const filters: Filter[] = [];
    const api: Record<string, unknown> = {
      select: () => api,
      eq: (column: string, value: unknown) => {
        filters.push({ column, value });
        return api;
      },
      then: (
        resolve: (value: { data: FakeRow[]; error: null }) => unknown,
        reject: (reason: unknown) => unknown,
      ) => {
        const affected = state.rows.filter(row => matches(row, filters));
        for (const row of affected) Object.assign(row, payload);
        state.updated.push(...affected.map(row => ({ ...row })));
        return Promise.resolve({ data: affected, error: null }).then(resolve, reject);
      },
    };
    return api;
  }

  function insertQuery(payload: FakeRow) {
    const api: Record<string, unknown> = {
      select: () => api,
      then: (
        resolve: (value: { data: FakeRow; error: null }) => unknown,
        reject: (reason: unknown) => unknown,
      ) => {
        const row: FakeRow = { id: `row-${state.rows.length + 1}`, ...payload };
        state.rows.push(row);
        state.inserted.push({ ...row });
        return Promise.resolve({ data: row, error: null }).then(resolve, reject);
      },
    };
    return api;
  }

  function deleteQuery() {
    const filters: Filter[] = [];
    const api: Record<string, unknown> = {
      select: () => api,
      eq: (column: string, value: unknown) => {
        filters.push({ column, value });
        return api;
      },
      then: (
        resolve: (value: { data: FakeRow[]; error: null }) => unknown,
        reject: (reason: unknown) => unknown,
      ) => {
        const removed: FakeRow[] = [];
        const kept: FakeRow[] = [];
        for (const row of state.rows) {
          if (matches(row, filters)) removed.push(row);
          else kept.push(row);
        }
        state.rows = kept;
        state.deleted.push(...removed.map(row => ({ ...row })));
        return Promise.resolve({ data: removed, error: null }).then(resolve, reject);
      },
    };
    return api;
  }

  const client = {
    from: () => ({
      select: () => selectQuery([]),
      insert: (payload: FakeRow) => insertQuery(payload),
      update: (payload: FakeRow) => updateQuery(payload),
      delete: () => deleteQuery(),
    }),
    storage: {
      from: () => ({
        upload: async (path: string) => {
          state.uploaded.push(path);
          return { data: { path }, error: null };
        },
        copy: async (from: string, to: string) => {
          state.copied.push({ from, to });
          return { data: { path: to }, error: null };
        },
        remove: async (paths: string[]) => {
          state.removed.push(...paths);
          return { data: paths, error: null };
        },
      }),
    },
    rpc: async (
      _name: string,
      args: {
        p_action: string;
        p_media_path: string | null;
        p_detail: Record<string, unknown>;
      },
    ) => {
      state.activity.push({
        action: args.p_action,
        mediaPath: args.p_media_path,
        detail: args.p_detail ?? {},
      });
      return { data: null, error: null };
    },
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: "admin-1" } } },
        error: null,
      }),
    },
  };

  return { client, state };
}

const { fake } = vi.hoisted(() => ({
  fake: { current: null as unknown },
}));

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => fake.current,
}));

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const PHYSICAL_ROW: FakeRow = {
  id: "row-physical",
  logical_path: "assets/equipo-pasillo.jpg",
  storage_path: "images/general/equipo-pasillo.jpg",
  provider: "supabase-storage",
  source: "override",
  original_name: "equipo-pasillo.jpg",
  stored_name: "equipo-pasillo.jpg",
  mime_type: "image/jpeg",
  format: "jpg",
  size_bytes: 210300,
  width: 1400,
  height: 933,
  status: "active",
  tags: [],
};

const OCCURRENCE_ROW: FakeRow = {
  id: "row-occurrence",
  occurrence_id: "area-detail-penal",
  logical_path: "occurrence/area-detail-penal",
  storage_path: "occurrences/area-detail-penal/equipo-audiencia-horizontal.jpg",
  provider: "supabase-storage",
  source: "override",
  original_name: "equipo-audiencia-horizontal.jpg",
  stored_name: "equipo-audiencia-horizontal.jpg",
  mime_type: "image/jpeg",
  format: "jpg",
  size_bytes: 187900,
  width: 1600,
  height: 900,
  status: "active",
  title: null,
  alt_text: null,
  description: null,
  category: null,
  tags: [],
};

/** PNG mínimo con los bytes mágicos correctos. */
function makePngFile(name = "nueva.png"): File {
  const bytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  ]);
  return new File([bytes], name, { type: "image/png" });
}

let state: ReturnType<typeof createFakeClient>["state"];

beforeEach(() => {
  const created = createFakeClient([PHYSICAL_ROW, OCCURRENCE_ROW]);
  fake.current = created.client;
  state = created.state;
});

/* ------------------------------------------------------------------ */
/* Pruebas                                                            */
/* ------------------------------------------------------------------ */

describe("listOccurrenceOverrides", () => {
  it("devuelve sólo las filas de aparición, no las del archivo físico", async () => {
    const { listOccurrenceOverrides } = await import("./media-service");

    const rows = await listOccurrenceOverrides();

    expect(rows).toHaveLength(1);
    expect(rows[0].occurrence_id).toBe("area-detail-penal");
    expect(rows[0].storage_path).toBe(
      "occurrences/area-detail-penal/equipo-audiencia-horizontal.jpg",
    );
    expect(rows[0].status).toBe("active");
    expect(rows[0].tags).toEqual([]);
  });
});

describe("upsertOccurrenceImage", () => {
  it("escribe una fila propia con occurrence_id y no toca el archivo físico", async () => {
    const { upsertOccurrenceImage } = await import("./media-service");

    const result = await upsertOccurrenceImage(
      "home-hero",
      makePngFile("hero-nueva.png"),
      { backup: true },
    );

    expect(result.ok).toBe(true);
    expect(state.inserted).toHaveLength(1);

    const inserted = state.inserted[0];
    expect(inserted.occurrence_id).toBe("home-hero");
    expect(inserted.logical_path).toBe("occurrence/home-hero");
    expect(inserted.storage_path).toBe("occurrences/home-hero/hero-nueva.png");
    expect(inserted.status).toBe("active");

    /* La fila del archivo físico queda como estaba. */
    const physical = state.rows.find(row => row.id === "row-physical");
    expect(physical?.logical_path).toBe("assets/equipo-pasillo.jpg");
    expect(physical?.storage_path).toBe("images/general/equipo-pasillo.jpg");
    expect(state.updated).toHaveLength(0);
  });

  it("guarda la versión anterior en la carpeta de respaldos", async () => {
    const { upsertOccurrenceImage } = await import("./media-service");

    await upsertOccurrenceImage(
      "area-detail-penal",
      makePngFile("penal-nueva.png"),
      { backup: true },
    );

    expect(state.copied).toHaveLength(1);
    expect(state.copied[0].from).toBe(
      "occurrences/area-detail-penal/equipo-audiencia-horizontal.jpg",
    );
    expect(state.copied[0].to.startsWith("backups/")).toBe(true);
  });

  it("actualiza la fila de la aparición sin duplicarla", async () => {
    const { upsertOccurrenceImage } = await import("./media-service");

    await upsertOccurrenceImage(
      "area-detail-penal",
      makePngFile("penal-nueva.png"),
      { backup: true },
    );

    expect(state.inserted).toHaveLength(0);
    expect(state.updated).toHaveLength(1);
    expect(state.updated[0].logical_path).toBe("occurrence/area-detail-penal");
    expect(state.updated[0].storage_path).toBe(
      "occurrences/area-detail-penal/penal-nueva.png",
    );
  });

  it("registra el reemplazo en la auditoría", async () => {
    const { upsertOccurrenceImage } = await import("./media-service");

    await upsertOccurrenceImage("home-hero", makePngFile(), { backup: true });

    expect(state.activity).toHaveLength(1);
    expect(state.activity[0].action).toBe("replace");
    expect(state.activity[0].mediaPath).toBe("occurrence/home-hero");
  });

  it("rechaza un archivo que no es una imagen", async () => {
    const { upsertOccurrenceImage } = await import("./media-service");

    const result = await upsertOccurrenceImage(
      "home-hero",
      new File([new Uint8Array([1, 2, 3])], "roto.png", { type: "image/png" }),
    );

    expect(result.ok).toBe(false);
    expect(state.inserted).toHaveLength(0);
  });
});

describe("setOccurrenceHidden", () => {
  it("oculta la aparición conservando su reemplazo, sin tocar el archivo físico", async () => {
    const { setOccurrenceHidden } = await import("./media-service");

    const result = await setOccurrenceHidden("area-detail-penal", true);

    expect(result.ok).toBe(true);
    expect(state.updated).toHaveLength(1);
    expect(state.updated[0].status).toBe("hidden");
    // El reemplazo se conserva: al volver a mostrarla reaparece la versión
    // elegida, no la original del paquete.
    expect(state.updated[0].storage_path).toBe(
      "occurrences/area-detail-penal/equipo-audiencia-horizontal.jpg",
    );

    const physical = state.rows.find(row => row.id === "row-physical");
    expect(physical?.status).toBe("active");
    expect(physical?.storage_path).toBe("images/general/equipo-pasillo.jpg");
  });

  it("crea la ficha de la aparición cuando todavía no existe", async () => {
    const { setOccurrenceHidden } = await import("./media-service");

    const result = await setOccurrenceHidden("values-intro", true, {
      name: "justice-scale.jpg",
      format: "jpg",
      bytes: 143200,
    });

    expect(result.ok).toBe(true);
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0].occurrence_id).toBe("values-intro");
    expect(state.inserted[0].logical_path).toBe("occurrence/values-intro");
    expect(state.inserted[0].status).toBe("hidden");
    expect(state.inserted[0].storage_path).toBeNull();
  });

  it("restaura la aparición y lo deja registrado", async () => {
    const { setOccurrenceHidden } = await import("./media-service");

    const result = await setOccurrenceHidden("area-detail-penal", false);

    expect(result.ok).toBe(true);
    expect(state.updated[0].status).toBe("active");
    expect(state.activity[0].action).toBe("restore");
  });
});

describe("updateOccurrenceMetadata", () => {
  it("actualiza sólo la fila de la aparición", async () => {
    const { updateOccurrenceMetadata } = await import("./media-service");

    const result = await updateOccurrenceMetadata("area-detail-penal", {
      alt_text: "Sala de audiencia del estudio",
      tags: ["audiencia", "penal"],
    });

    expect(result.ok).toBe(true);
    expect(state.updated).toHaveLength(1);
    expect(state.updated[0].alt_text).toBe("Sala de audiencia del estudio");
    expect(state.updated[0].tags).toEqual(["audiencia", "penal"]);
    expect(state.activity[0].action).toBe("edit");
  });

  it("no hace nada si no hay cambios", async () => {
    const { updateOccurrenceMetadata } = await import("./media-service");

    const result = await updateOccurrenceMetadata("area-detail-penal", {});

    expect(result.ok).toBe(false);
    expect(state.updated).toHaveLength(0);
  });
});

describe("purgeOccurrenceOverride", () => {
  it("borra la fila y el objeto de la aparición, y nada más", async () => {
    const { purgeOccurrenceOverride } = await import("./media-service");

    const result = await purgeOccurrenceOverride("area-detail-penal");

    expect(result.ok).toBe(true);
    expect(state.deleted).toHaveLength(1);
    expect(state.deleted[0].occurrence_id).toBe("area-detail-penal");
    expect(state.removed).toEqual([
      "occurrences/area-detail-penal/equipo-audiencia-horizontal.jpg",
    ]);

    const physical = state.rows.find(row => row.id === "row-physical");
    expect(physical).toBeDefined();
  });

  it("avisa cuando la aparición no tiene reemplazo propio", async () => {
    const { purgeOccurrenceOverride } = await import("./media-service");

    const result = await purgeOccurrenceOverride("home-split");

    expect(result.ok).toBe(false);
    expect(state.deleted).toHaveLength(0);
  });
});
