import { describe, expect, it } from "vitest";
import {
  ARGENTINA_TIME_ZONE,
  IP_RATE_LIMIT,
  PAGE_SIZE,
  aggregateByDay,
  asRow,
  asRows,
  buildSearchFilter,
  calculateTotalPages,
  civilDateToIso,
  clampPage,
  dayKey,
  dayStartIso,
  formatDateEs,
  formatDateTimeEs,
  formatDurationEs,
  formatNumberEs,
  formatPercentEs,
  isMissingColumnError,
  normalizeSearchTerm,
  pageRange,
  parseCivilDate,
  percentage,
  summarizeIpUsage,
  truncateText,
  windowStartIso,
} from "./consultations-utils";

/**
 * Guardas de la lógica de paginación, fechas y control de IPs.
 *
 * Lo que no se puede probar acá es el SQL: lo que se prueba es que el módulo
 * calcule bien lo que le pide al servidor (rango de la página, Ventana de 30
 * días alineada a Argentina, capacidad por IP) y que degrade con elegancia
 * cuando la columna `ip_address` todavía no existe.
 */

describe("Paginación", () => {
  it("calcula la cantidad de páginas con 10 filas por página", () => {
    expect(calculateTotalPages(0)).toBe(0);
    expect(calculateTotalPages(1)).toBe(1);
    expect(calculateTotalPages(10)).toBe(1);
    expect(calculateTotalPages(11)).toBe(2);
    expect(calculateTotalPages(250)).toBe(25);
  });

  it("respeta un tamaño de página distinto", () => {
    expect(calculateTotalPages(25, 10)).toBe(3);
    expect(calculateTotalPages(25, 5)).toBe(5);
  });

  it("ajusta la página al rango válido", () => {
    expect(clampPage(0, 4)).toBe(1);
    expect(clampPage(-3, 4)).toBe(1);
    expect(clampPage(3, 4)).toBe(3);
    expect(clampPage(9, 4)).toBe(4);
    expect(clampPage(2, 0)).toBe(1);
  });

  it("devuelve el rango inclusivo que espera .range()", () => {
    expect(pageRange(1)).toEqual({ from: 0, to: 9 });
    expect(pageRange(2)).toEqual({ from: 10, to: 19 });
    expect(pageRange(7)).toEqual({ from: 60, to: 69 });
  });

  it("usa 10 filas por página", () => {
    expect(PAGE_SIZE).toBe(10);
    const { from, to } = pageRange(3);
    expect(to - from + 1).toBe(10);
  });
});

describe("Búsqueda", () => {
  it("limpia los separadores de la gramática de PostgREST", () => {
    expect(normalizeSearchTerm("  hola  ")).toBe("hola");
    expect(normalizeSearchTerm("a,b")).toBe("a b");
    expect(normalizeSearchTerm("(x)")).toBe("x");
    expect(normalizeSearchTerm("100%")).toBe("100");
    expect(normalizeSearchTerm("a   b")).toBe("a b");
  });

  it("arma el filtro or sobre nombre, email, asunto y referencia", () => {
    expect(buildSearchFilter(" juan ")).toBe(
      "full_name.ilike.%juan%,email.ilike.%juan%,subject.ilike.%juan%,reference_code.ilike.%juan%",
    );
  });

  it("devuelve null cuando no hay término usable", () => {
    expect(buildSearchFilter("")).toBeNull();
    expect(buildSearchFilter("   ")).toBeNull();
    expect(buildSearchFilter(",()%")).toBeNull();
  });
});

describe("Formato", () => {
  it("muestra guion largo cuando no hay fecha", () => {
    expect(formatDateTimeEs(null)).toBe("—");
    expect(formatDateTimeEs(undefined)).toBe("—");
    expect(formatDateTimeEs("no-es-fecha")).toBe("—");
    expect(formatDateEs(null)).toBe("—");
  });

  it("formatea fechas en es-AR", () => {
    expect(formatNumberEs(1234)).toBe("1.234");
    expect(formatPercentEs(62.5)).toBe("62,5 %");
    expect(percentage(1, 4)).toBe(25);
    expect(percentage(1, 0)).toBe(0);
  });

  it("corta textos largos sin partir palabras", () => {
    expect(truncateText("corto", 20)).toBe("corto");
    expect(truncateText(null, 20)).toBe("—");
    expect(truncateText("un texto bastante largo de verdad", 10)).toBe(
      "un texto…",
    );
  });

  it("expresa la espera de forma legible", () => {
    expect(formatDurationEs(null)).toBe("—");
    expect(formatDurationEs(0)).toBe("ahora");
    expect(formatDurationEs(45)).toBe("45 min");
    expect(formatDurationEs(60)).toBe("1 h");
    expect(formatDurationEs(200)).toBe("3 h 20 min");
  });
});

describe("Zona horaria de Argentina", () => {
  it("agrupa el día según la hora local, no la del servidor", () => {
    // 2026-03-02T02:30:00Z todavía es el 1 de marzo en Argentina (UTC-3).
    const instant = new Date("2026-03-02T02:30:00.000Z");
    expect(dayKey(instant, ARGENTINA_TIME_ZONE)).toBe("2026-03-01");
    // Y a las 04:00Z ya es el 2 de marzo.
    expect(dayKey(new Date("2026-03-02T04:00:00.000Z"), ARGENTINA_TIME_ZONE)).toBe(
      "2026-03-02",
    );
  });

  it("devuelve la medianoche local en ISO", () => {
    const start = dayStartIso(new Date("2026-03-02T12:00:00.000Z"));
    expect(start).toBe("2026-03-02T03:00:00.000Z");
  });

  it("interpreta el input de fecha como hora local", () => {
    expect(civilDateToIso("2026-03-02", false)).toBe("2026-03-02T03:00:00.000Z");
    expect(civilDateToIso("2026-03-02", true)).toBe(
      "2026-03-03T02:59:59.999Z",
    );
    expect(civilDateToIso("basura", false)).toBeNull();
  });

  it("interpreta correctamente las fechas civiles", () => {
    expect(parseCivilDate("2026-03-02")).toEqual({
      year: 2026,
      month: 3,
      day: 2,
    });
    expect(parseCivilDate("2026-13-02")).toBeNull();
    expect(parseCivilDate("")).toBeNull();
  });

  it("la ventana de 30 días arranca 29 días antes, a la medianoche local", () => {
    const now = new Date("2026-03-15T18:00:00.000Z");
    expect(windowStartIso(30, now)).toBe("2026-02-14T03:00:00.000Z");
    expect(windowStartIso(7, now)).toBe("2026-03-09T03:00:00.000Z");
  });
});

describe("Serie temporal", () => {
  const now = new Date("2026-03-15T18:00:00.000Z");

  it("devuelve un punto por día, con los días sin consultas en cero", () => {
    const points = aggregateByDay(
      [{ received_at: "2026-03-15T14:00:00.000Z" }],
      30,
      now,
    );
    expect(points).toHaveLength(30);
    expect(points.every((point) => point.count === 0 || point.count === 1)).toBe(
      true,
    );
    expect(points[29]).toMatchObject({
      key: "2026-03-15",
      count: 1,
      isToday: true,
    });
    expect(points[0].key).toBe("2026-02-14");
  });

  it("cuenta varias consultas del mismo día local", () => {
    const points = aggregateByDay(
      [
        { received_at: "2026-03-14T02:00:00.000Z" }, // 13/03 23:00 ARG
        { received_at: "2026-03-14T05:00:00.000Z" }, // 14/03 02:00 ARG
        { received_at: "2026-03-14T20:00:00.000Z" }, // 14/03 17:00 ARG
        { received_at: "2026-03-15T04:00:00.000Z" }, // 15/03 01:00 ARG
      ],
      30,
      now,
    );
    expect(points[27].count).toBe(1);
    expect(points[28].count).toBe(2);
    expect(points[29].count).toBe(1);
  });

  it("ignora fechas inválidas", () => {
    const points = aggregateByDay(
      [
        { received_at: null },
        { received_at: "no-es-fecha" },
      ],
      30,
      now,
    );
    expect(points.reduce((sum, point) => sum + point.count, 0)).toBe(0);
  });
});

describe("Control de solicitudes por IP", () => {
  const now = new Date("2026-03-15T12:00:00.000Z");

  it("resuelve el uso de cada IP dentro de la ventana", () => {
    const usage = summarizeIpUsage(
      [
        { ip_address: "1.1.1.1", received_at: "2026-03-15T11:00:00.000Z" },
        { ip_address: "1.1.1.1", received_at: "2026-03-15T10:00:00.000Z" },
        { ip_address: "2.2.2.2", received_at: "2026-03-15T09:00:00.000Z" },
      ],
      { now },
    );

    expect(usage).toHaveLength(2);
    expect(usage[0]).toMatchObject({
      ip: "1.1.1.1",
      count: 2,
      remaining: IP_RATE_LIMIT - 2,
      atLimit: false,
    });
    expect(usage[1].ip).toBe("2.2.2.2");
  });

  it("marca el límite alcanzado y calcula cuándo se libera capacidad", () => {
    const rows = Array.from({ length: 6 }, (_, index) => ({
      ip_address: "3.3.3.3",
      received_at: new Date(
        now.getTime() - index * 3600000,
      ).toISOString(),
    }));

    const usage = summarizeIpUsage(rows, { now });
    expect(usage).toHaveLength(1);
    expect(usage[0].count).toBe(6);
    expect(usage[0].remaining).toBe(0);
    expect(usage[0].atLimit).toBe(true);
    expect(usage[0].releasesAtIso).not.toBeNull();
    // La 2ª más antigua salió a las 08:00, así que su ventana vence a las
    // 08:00 de mañana: dentro de 20 h.
    expect(usage[0].releasesInMinutes).toBe(20 * 60);
  });

  it("descarta las consultas que están fuera de la ventana", () => {
    const usage = summarizeIpUsage(
      [{ ip_address: "4.4.4.4", received_at: "2026-03-13T10:00:00.000Z" }],
      { now },
    );
    expect(usage).toHaveLength(0);
  });

  it("ignora las filas sin IP", () => {
    const usage = summarizeIpUsage(
      [{ ip_address: null, received_at: now.toISOString() }],
      { now },
    );
    expect(usage).toHaveLength(0);
  });
});

describe("Lectura de resultados", () => {
  it("asRows devuelve un arreglo y tolera un resultado nulo", () => {
    expect(asRows([{ id: 1 }])).toEqual([{ id: 1 }]);
    expect(asRows(null)).toEqual([]);
    expect(asRows(undefined)).toEqual([]);
  });

  it("asRow devuelve la fila única, no un arreglo", () => {
    const row = { id: "abc", reference_code: "CAS-26-00001" };
    expect(asRow(row)).toBe(row);
    expect(asRow(null)).toBeNull();
    expect(asRow(undefined)).toBeNull();
  });
});

describe("Degradación cuando falta la columna ip_address", () => {
  it("detecta el error 42703 de PostgREST", () => {
    expect(
      isMissingColumnError({
        code: "42703",
        message:
          'column legal_consultations.ip_address does not exist',
      }),
    ).toBe(true);
  });

  it("detecta el error por el mensaje", () => {
    expect(
      isMissingColumnError(
        new Error(
          'column "legal_consultations.user_agent" does not exist',
        ),
      ),
    ).toBe(true);
    expect(
      isMissingColumnError({
        message: "la columna ip_address no existe",
      }),
    ).toBe(true);
  });

  it("no confunde otros errores con la columna faltante", () => {
    expect(isMissingColumnError(null)).toBe(false);
    expect(isMissingColumnError(new Error("network error"))).toBe(false);
    expect(
      isMissingColumnError({ code: "42501", message: "permission denied" }),
    ).toBe(false);
  });
});
