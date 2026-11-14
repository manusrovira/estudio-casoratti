/**
 * Capa REST compatible con PostgREST.
 *
 * El cliente usa `supabase-js`, que speaks PostgREST: los filtros llegan en el
 * query string (`?status=eq.nueva&order=received_at.desc`), los inserts son
 * POST con cuerpo JSON, y la cabecera `Prefer: count=exact` pide el total.
 *
 * Se traduce ese formato a SQL parametrizado. Los valores NUNCA se interpolan
 * en la consulta: van como parámetros, así que un filtro malicioso no puede
 * inyectar SQL.
 */

import { quoteIdent } from "./db";

type Condition = { sql: string; params: unknown[] };

const RESERVED_PARAMS = new Set(["select", "order", "limit", "offset", "on_conflict"]);

/** Traduce `columna=operador.valor` a una condición SQL parametrizada. */
function parseCondition(column: string, raw: string): Condition {
  const separator = raw.indexOf(".");
  const operator = separator === -1 ? "eq" : raw.slice(0, separator);
  const value = separator === -1 ? raw : raw.slice(separator + 1);
  const col = quoteIdent(column);

  switch (operator) {
    case "eq":
      return { sql: `${col} = $`, params: [literal(value)] };
    case "neq":
      return { sql: `${col} <> $`, params: [literal(value)] };
    case "gt":
      return { sql: `${col} > $`, params: [literal(value)] };
    case "gte":
      return { sql: `${col} >= $`, params: [literal(value)] };
    case "lt":
      return { sql: `${col} < $`, params: [literal(value)] };
    case "lte":
      return { sql: `${col} <= $`, params: [literal(value)] };
    case "like":
      return { sql: `${col} like $`, params: [likePattern(value)] };
    case "ilike":
      return { sql: `${col} ilike $`, params: [likePattern(value)] };
    case "is":
      if (value === "null") return { sql: `${col} is null`, params: [] };
      if (value === "not_null") return { sql: `${col} is not null`, params: [] };
      return { sql: `${col} is $`, params: [value === "true"] };
    case "in": {
      const items = listValues(value);
      if (items.length === 0) return { sql: "false", params: [] };
      const placeholders = items.map(() => "$").join(", ");
      return { sql: `${col} in (${placeholders})`, params: items };
    }
    case "not": {
      const inner = parseCondition(column, value);
      // PostgREST: not.is.null → IS NOT NULL; not.eq.x → <> x
      if (inner.sql.endsWith("is null")) {
        return { sql: `${col} is not null`, params: [] };
      }
      if (inner.sql.endsWith("is not null")) {
        return { sql: `${col} is null`, params: [] };
      }
      return { sql: `not (${inner.sql})`, params: inner.params };
    }
    default:
      throw new Error(`Operador no soportado: ${operator}`);
  }
}

/** `or=(a.ilike.*x*,b.ilike.*y*)` → `(cond OR cond)`. */
function parseOr(raw: string): Condition {
  const inner = raw.replace(/^\(|\)$/g, "");
  const parts = splitTopLevel(inner);
  const conditions = parts.map((part) => parseCondition(part.split(".")[0], part.slice(part.indexOf(".") + 1)));
  const params = conditions.flatMap((condition) => condition.params);
  const placeholders = conditions.map((condition) => condition.sql);
  return { sql: `(${placeholders.join(" or ")})`, params };
}

/** Parte por comas respetando paréntesis (para `in.(a,b)` dentro de un `or`). */
function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) parts.push(current);
  return parts;
}

function listValues(value: string): string[] {
  const inner = value.replace(/^\(|\)$/g, "");
  if (!inner) return [];
  return splitTopLevel(inner);
}

/** PostgREST manda los valores sin comillas; los de texto van como texto. */
function literal(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/.test(value)) return value;
  return value;
}

function likePattern(value: string): string {
  return value.replace(/\*/g, "%");
}

export type RestQuery = {
  table: string;
  filters: Condition[];
  columns: string;
  orderBy: string;
  limit: number | null;
  offset: number;
  wantsCount: boolean;
  wantsSingle: boolean;
};

export function parseRestQuery(
  table: string,
  query: URLSearchParams,
  headers: { prefer?: string; range?: string; accept?: string },
): RestQuery {
  const filters: Condition[] = [];
  for (const [key, value] of query.entries()) {
    if (RESERVED_PARAMS.has(key)) continue;
    if (key === "or") {
      filters.push(parseOr(value));
      continue;
    }
    if (key === "and") continue;
    filters.push(parseCondition(key, value));
  }

  const selectParam = query.get("select");
  const columns =
    !selectParam || selectParam === "*"
      ? "*"
      : selectParam
          .split(",")
          .map((column) => quoteIdent(column.trim()))
          .join(", ");

  const orderParam = query.get("order");
  let orderBy = "";
  if (orderParam) {
    const parts = orderParam.split(",").map((part) => {
      const [column, direction = "asc"] = part.split(".");
      return `${quoteIdent(column.trim())} ${direction.toLowerCase() === "desc" ? "DESC" : "ASC"}`;
    });
    orderBy = ` order by ${parts.join(", ")}`;
  }

  const limitParam = query.get("limit");
  let limit = limitParam ? Number(limitParam) : null;
  let offset = Number(query.get("offset") ?? 0);

  // `range` (header) tiene prioridad sobre limit/offset.
  if (headers.range) {
    const [from, to] = headers.range.split("-").map(Number);
    if (Number.isFinite(from) && Number.isFinite(to)) {
      offset = from;
      limit = to - from + 1;
    }
  }

  const wantsCount = (headers.prefer ?? "").includes("count=exact");
  const wantsSingle = (headers.accept ?? "").includes("vnd.pgrst.object");

  return {
    table: quoteIdent(table),
    filters,
    columns,
    orderBy,
    limit,
    offset,
    wantsCount,
    wantsSingle,
  };
}

/** WHERE con sus parámetros. */
export function buildWhere(filters: Condition[]): { clause: string; params: unknown[] } {
  if (filters.length === 0) return { clause: "", params: [] };
  return {
    clause: ` where ${filters.map((filter) => filter.sql).join(" and ")}`,
    params: filters.flatMap((filter) => filter.params),
  };
}

/**
 * Ejecuta una consulta REST dentro de la sesión (y por lo tanto bajo las
 * políticas RLS vigentes).
 */
export async function runRestQuery(
  sql: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>,
  query: RestQuery,
): Promise<{ status: number; body: unknown; headers: Record<string, string> }> {
  const { clause, params } = buildWhere(query.filters);
  const headers: Record<string, string> = {};

  if (query.wantsCount) {
    const countResult = await sql(
      `select count(*)::int as total from ${query.table}${clause}`,
      params,
    );
    const total = Number(countResult.rows[0]?.total ?? 0);
    headers["Content-Range"] = total === 0 ? `*/${total}` : `0-${Math.max(0, total - 1)}/${total}`;
  }

  const limitClause = query.limit !== null ? ` limit ${Number(query.limit)}` : "";
  const offsetClause = query.offset ? ` offset ${Number(query.offset)}` : "";

  const result = await sql(
    `select ${query.columns} from ${query.table}${clause}${query.orderBy}${limitClause}${offsetClause}`,
    params,
  );

  if (query.wantsSingle) {
    if (result.rows.length !== 1) {
      return {
        status: 406,
        body: {
          code: "PGRST116",
          details: `Results contain ${result.rows.length} rows`,
          hint: null,
          message: "JSON object requested, multiple (or no) rows returned",
        },
        headers: { ...headers, "Content-Type": "application/json" },
      };
    }
    return {
      status: 200,
      body: result.rows[0],
      headers: { ...headers, "Content-Type": "application/json" },
    };
  }

  return {
    status: 200,
    body: result.rows,
    headers: { ...headers, "Content-Type": "application/json" },
  };
}
