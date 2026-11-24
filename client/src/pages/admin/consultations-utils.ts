/**
 * Utilidades puras del módulo de administración de consultas.
 *
 * Acá vive todo el cálculo que no necesita la base: paginación, formateo de
 * fechas en es-AR, alineación a la zona horaria del estudio (Argentina),
 * agregación de la serie diaria y resumen del uso de IPs.
 *
 * Son funciones puras a propósito: se prueban sin Supabase y sin React.
 */

/** Filas por página. El listado se pagina en el servidor con `.range()`. */
export const PAGE_SIZE = 10;

/** Consultas admitidas por IP dentro de la ventana de control. */
export const IP_RATE_LIMIT = 5;

/** Ventana, en horas, del límite por IP. */
export const IP_RATE_WINDOW_HOURS = 24;

/** Zona horaria de referencia: el estudio opera en Posadas, Misiones. */
export const ARGENTINA_TIME_ZONE = "America/Argentina/Buenos_Aires";

/** Días que cubre la serie temporal del encabezado. */
export const SERIES_DAYS = 30;

const dateTimeFormat = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short",
  timeStyle: "short",
});

const dateFormat = new Intl.DateTimeFormat("es-AR", { dateStyle: "short" });

/** Etiqueta de día del gráfico: se formatea en UTC para no correr de día. */
const dayLabelFormat = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
});

const numberFormat = new Intl.NumberFormat("es-AR");

/* -------------------------------------------------------------------------- */
/* Paginación                                                                  */
/* -------------------------------------------------------------------------- */

/** Cantidad total de páginas; 0 cuando no hay resultados. */
export function calculateTotalPages(
  total: number,
  pageSize: number = PAGE_SIZE,
): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  if (!Number.isFinite(pageSize) || pageSize <= 0) return 0;
  return Math.ceil(total / pageSize);
}

/** Ajusta la página al rango válido (1..totalPages). */
export function clampPage(page: number, totalPages: number): number {
  if (!Number.isFinite(page)) return 1;
  const whole = Math.floor(page);
  if (totalPages <= 0) return 1;
  return Math.min(Math.max(whole, 1), totalPages);
}

/** Rango inclusivo de la página actual para `.range()` de PostgREST. */
export function pageRange(
  page: number,
  pageSize: number = PAGE_SIZE,
): { from: number; to: number } {
  const safePage = Math.max(1, Math.floor(page) || 1);
  const from = (safePage - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

/* -------------------------------------------------------------------------- */
/* Búsqueda                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Limpia el texto antes de mandarlo a un filtro `or` de PostgREST: los
 * separadores de la gramática (`,`, `(`, `)`, `%`, `*`) se eliminan para que
 * un texto pegado no rompa la consulta.
 */
export function normalizeSearchTerm(term: string): string {
  return term
    .replace(/[,()%*"\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Filtro `or` que busca en nombre, email, asunto y código de referencia.
 * Devuelve `null` cuando no hay término usable.
 */
export function buildSearchFilter(term: string): string | null {
  const clean = normalizeSearchTerm(term);
  if (!clean) return null;
  return [
    `full_name.ilike.%${clean}%`,
    `email.ilike.%${clean}%`,
    `subject.ilike.%${clean}%`,
    `reference_code.ilike.%${clean}%`,
  ].join(",");
}

/* -------------------------------------------------------------------------- */
/* Formato                                                                     */
/* -------------------------------------------------------------------------- */

/** Fecha y hora en es-AR; "—" cuando no hay valor o no se puede interpretar. */
export function formatDateTimeEs(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return dateTimeFormat.format(parsed);
}

/** Sólo la fecha, en es-AR. */
export function formatDateEs(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return dateFormat.format(parsed);
}

/** Número con separador de miles argentino. */
export function formatNumberEs(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return numberFormat.format(value);
}

/** Porcentaje con un decimal (62,5). */
export function formatPercentEs(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${numberFormat.format(Math.round(value * 10) / 10)} %`;
}

/** Parte sobre total, en porcentaje con un decimal. */
export function percentage(part: number, total: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

/** Corta un texto largo para la tabla, sin partir palabras. */
export function truncateText(text: string | null | undefined, max: number): string {
  if (!text) return "—";
  const clean = text.trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${base.trimEnd()}…`;
}

/** Duración legible a partir de minutos ("3 h 20 min", "45 min", "ahora"). */
export function formatDurationEs(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return "—";
  if (minutes <= 0) return "ahora";
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  if (hours <= 0) return `${rest} min`;
  if (rest === 0) return `${hours} h`;
  return `${hours} h ${rest} min`;
}

/* -------------------------------------------------------------------------- */
/* Zona horaria Argentina                                                      */
/* -------------------------------------------------------------------------- */

type CivilDate = { year: number; month: number; day: number };

type ZonedParts = CivilDate & {
  hour: number;
  minute: number;
  second: number;
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Descompone un instante en la hora de la zona indicada. */
function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const bag: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }

  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour) % 24,
    minute: Number(bag.minute),
    second: Number(bag.second),
  };
}

/** Desplazamiento de la zona respecto de UTC, en milisegundos. */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts = zonedParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Suma (o resta) días a una fecha civil, sin pasar por la hora local. */
function shiftCivilDate(
  civil: CivilDate,
  deltaDays: number,
): CivilDate {
  const stamp = Date.UTC(civil.year, civil.month - 1, civil.day) +
    deltaDays * 86400000;
  const moved = new Date(stamp);
  return {
    year: moved.getUTCFullYear(),
    month: moved.getUTCMonth() + 1,
    day: moved.getUTCDate(),
  };
}

/** Instante ISO de la medianoche local de una fecha civil. */
function localMidnightIso(
  civil: CivilDate,
  timeZone: string,
): string {
  const naive = Date.UTC(civil.year, civil.month - 1, civil.day, 0, 0, 0);
  let stamp = naive - zoneOffsetMs(new Date(naive), timeZone);
  const refined = zoneOffsetMs(new Date(stamp), timeZone);
  if (refined !== zoneOffsetMs(new Date(naive), timeZone)) {
    stamp = naive - refined;
  }
  return new Date(stamp).toISOString();
}

/** Clave de día (YYYY-MM-DD) del instante en la zona del estudio. */
export function dayKey(
  date: Date,
  timeZone: string = ARGENTINA_TIME_ZONE,
): string {
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** Inicio del día local (ISO) del instante dado. */
export function dayStartIso(
  date: Date,
  timeZone: string = ARGENTINA_TIME_ZONE,
): string {
  const parts = zonedParts(date, timeZone);
  return localMidnightIso(parts, timeZone);
}

/** Interpreta un `<input type="date">` ("YYYY-MM-DD") como fecha civil. */
export function parseCivilDate(value: string): CivilDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/**
 * Convierte un `<input type="date">` a un instante ISO en hora local
 * argentina: desde = 00:00:00.000, hasta = un milisegundo antes del
 * siguiente medianoche (23:59:59.999).
 */
export function civilDateToIso(
  value: string,
  endOfDay: boolean,
  timeZone: string = ARGENTINA_TIME_ZONE,
): string | null {
  const civil = parseCivilDate(value);
  if (!civil) return null;
  if (!endOfDay) return localMidnightIso(civil, timeZone);
  const next = shiftCivilDate(civil, 1);
  const nextStart = new Date(localMidnightIso(next, timeZone)).getTime();
  return new Date(nextStart - 1).toISOString();
}

/**
 * Inicio (ISO) de la ventana de `days` días que termina hoy, en hora local
 * argentina. Con 30 días devuelve el día -29 a las 00:00.
 */
export function windowStartIso(
  days: number,
  now: Date = new Date(),
  timeZone: string = ARGENTINA_TIME_ZONE,
): string {
  const today = zonedParts(now, timeZone);
  const start = shiftCivilDate(today, -(Math.max(1, days) - 1));
  return localMidnightIso(start, timeZone);
}

/* -------------------------------------------------------------------------- */
/* Serie temporal                                                              */
/* -------------------------------------------------------------------------- */

export type DayPoint = {
  /** Clave del día (YYYY-MM-DD) en hora argentina. */
  key: string;
  /** Etiqueta corta para el eje ("05/03"). */
  label: string;
  /** Consultas recibidas ese día. */
  count: number;
  /** Marca el último día de la serie. */
  isToday: boolean;
};

/**
 * Agrega consultas por día local argentino. Los días sin consultas quedan en
 * cero: la serie siempre tiene la misma longitud.
 */
export function aggregateByDay(
  items: Array<{ received_at: string | null }>,
  days: number = SERIES_DAYS,
  now: Date = new Date(),
  timeZone: string = ARGENTINA_TIME_ZONE,
): DayPoint[] {
  const counts = new Map<string, number>();

  for (const item of items) {
    if (!item.received_at) continue;
    const parsed = new Date(item.received_at);
    if (Number.isNaN(parsed.getTime())) continue;
    const key = dayKey(parsed, timeZone);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const today = zonedParts(now, timeZone);
  const points: DayPoint[] = [];

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const civil = shiftCivilDate(today, -offset);
    const key = `${civil.year}-${pad(civil.month)}-${pad(civil.day)}`;
    points.push({
      key,
      label: dayLabelFormat.format(
        new Date(Date.UTC(civil.year, civil.month - 1, civil.day)),
      ),
      count: counts.get(key) ?? 0,
      isToday: offset === 0,
    });
  }

  return points;
}

/* -------------------------------------------------------------------------- */
/* Control de solicitudes por IP                                               */
/* -------------------------------------------------------------------------- */

export type IpUsage = {
  ip: string;
  /** Consultas registradas dentro de la ventana. */
  count: number;
  /** Consultas que todavía se pueden enviar desde esa IP. */
  remaining: number;
  /** La IP alcanzó el límite configurado. */
  atLimit: boolean;
  /** Última consulta registrada desde esa IP (ISO). */
  lastSeenIso: string | null;
  /** Instante en que se libera capacidad (ISO), si está en el límite. */
  releasesAtIso: string | null;
  /** Minutos que faltan para liberar capacidad. */
  releasesInMinutes: number | null;
};

export type IpUsageOptions = {
  limit?: number;
  windowHours?: number;
  now?: Date;
};

/**
 * Resume el uso de cada IP dentro de la ventana (por defecto 24 h).
 *
 * La capacidad se libera de a una: la ventana es móvil, así que una consulta
 * deja de contar recién cuando se cumplen las 24 h desde que se recibió. Para
 * volver a tener un lugar disponible hay que esperar que expiren las
 * consultas más antiguas.
 */
export function summarizeIpUsage(
  rows: Array<{ ip_address: string | null; received_at: string | null }>,
  options: IpUsageOptions = {},
): IpUsage[] {
  const limit = options.limit ?? IP_RATE_LIMIT;
  const windowHours = options.windowHours ?? IP_RATE_WINDOW_HOURS;
  const now = options.now ?? new Date();
  const windowMs = windowHours * 3600000;

  const buckets = new Map<string, number[]>();

  for (const row of rows) {
    const ip = (row.ip_address ?? "").trim();
    if (!ip) continue;
    if (!row.received_at) continue;
    const parsed = new Date(row.received_at);
    if (Number.isNaN(parsed.getTime())) continue;
    if (now.getTime() - parsed.getTime() > windowMs) continue;
    const list = buckets.get(ip) ?? [];
    list.push(parsed.getTime());
    buckets.set(ip, list);
  }

  const usage: IpUsage[] = [];

  for (const [ip, stamps] of buckets) {
    stamps.sort((a, b) => a - b);
    const count = stamps.length;
    const atLimit = count >= limit;
    const remaining = Math.max(0, limit - count);

    // Para liberar un lugar tienen que salir de la ventana las consultas más
    // antiguas: la (count - limit + 1)-ésima en orden de llegada.
    let releasesAtIso: string | null = null;
    let releasesInMinutes: number | null = null;
    if (atLimit) {
      const index = count - limit;
      const oldest = stamps[index];
      if (oldest !== undefined) {
        const releaseAt = oldest + windowMs;
        releasesAtIso = new Date(releaseAt).toISOString();
        releasesInMinutes = Math.max(
          0,
          Math.round((releaseAt - now.getTime()) / 60000),
        );
      }
    }

    usage.push({
      ip,
      count,
      remaining,
      atLimit,
      lastSeenIso: new Date(stamps[stamps.length - 1]).toISOString(),
      releasesAtIso,
      releasesInMinutes,
    });
  }

  usage.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.ip.localeCompare(b.ip);
  });

  return usage;
}

/* -------------------------------------------------------------------------- */
/* Lectura de resultados                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Normaliza el resultado de un `select` de PostgREST a un arreglo de filas.
 *
 * El módulo arma el `select` en runtime (la columna de IP es opcional), así
 * que el resultado llega sin tipo genérico: el casteo se hace explícito y en
 * un solo lugar.
 */
export function asRows<T>(data: unknown): T[] {
  return (data ?? []) as T[];
}

/** Igual que `asRows`, pero para las consultas que devuelven una sola fila. */
export function asRow<T>(data: unknown): T | null {
  return (data ?? null) as T | null;
}

/* -------------------------------------------------------------------------- */
/* Errores del backend                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Detecta el error de PostgREST 42703 (columna inexistente). Sirve para
 * degradar con elegancia cuando la migración que agrega `ip_address` todavía
 * no está aplicada en la base.
 */
export function isMissingColumnError(error: unknown): boolean {
  if (!error) return false;

  const candidate = error as {
    code?: string | number;
    message?: string;
    details?: string;
    hint?: string;
  };

  if (String(candidate.code ?? "") === "42703") return true;

  const text = [
    candidate.message,
    candidate.details,
    candidate.hint,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (text.includes("42703")) return true;
  return (
    text.includes("column") &&
    (text.includes("does not exist") || text.includes("no existe"))
  );
}
