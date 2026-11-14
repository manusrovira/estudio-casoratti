/**
 * Entorno local de desarrollo: API compatible con Supabase + sitio estÃ¡tico.
 *
 * Levanta en un solo proceso:
 *   /auth/v1/*       alta, login, refresh, recuperaciÃ³n, OAuth de demostraciÃ³n
 *   /rest/v1/*       API estilo PostgREST, evaluada bajo las polÃ­ticas RLS
 *   /storage/v1/*    buckets privados con URLs firmadas
 *   /functions/v1/*  invocaciÃ³n de la Edge Function de consultas
 *   /*               el sitio compilado (dist/public) con fallback de rutas
 *
 * La base es un PostgreSQL 17 real (PGlite) con las MISMAS migraciones y las
 * MISMAS polÃ­ticas RLS que usa Supabase. No es un mock: si una policy estÃ¡
 * mal, el acceso falla acÃ¡ exactamente igual que en producciÃ³n.
 *
 * Uso: npm run local   â†’   http://127.0.0.1:54321
 */

import express, { type Request, type Response } from "express";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { asServiceRole, getDb, withSession, type Session } from "./db";
import { ANON_KEY, hashPassword, publicUser, sessionResponse, signJwt, verifyJwt, verifyPassword, type AuthUser } from "./auth";
import { parseRestQuery, runRestQuery } from "./rest";
import { seedLocalDatabase, DEMO_ACCOUNTS, DEMO_PASSWORD } from "./seed";
import { handleConsultation } from "../functions/submit-consultation/handler";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const DIST = join(ROOT, "dist", "public");
const STORAGE_DIR = join(ROOT, ".local-data", "storage");
const PORT = Number(process.env.LOCAL_PORT ?? 54321);

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.text({ type: "text/plain", limit: "2mb" }));

// --- CORS ------------------------------------------------------------------
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, x-client-info, apikey, content-type, prefer, range, accept-profile, x-upsert");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, HEAD, OPTIONS");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range, Prefer");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

/** SesiÃ³n de la request: usuario del JWT, o visitante anÃ³nimo. */
function sessionFromRequest(req: Request): Session {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const payload = token ? verifyJwt(token) : null;
  if (!payload) return { sub: null, role: "anon" };
  return { sub: payload.sub, role: "authenticated", email: payload.email };
}

function isServiceRole(req: Request): boolean {
  const key = req.headers.apikey ?? req.headers.authorization?.replace(/^Bearer\s+/i, "");
  return key === process.env.LOCAL_SERVICE_ROLE_KEY || key === "local-service-role-key";
}

// ============================================================================
// AUTH
// ============================================================================
app.post("/auth/v1/signup", async (req, res) => {
  const { email, password, data } = req.body ?? {};
  if (!email || !password) {
    res.status(400).json({ error: "email y password son obligatorios" });
    return;
  }
  const id = crypto.randomUUID();
  const meta = JSON.stringify(data ?? {});
  const hash = hashPassword(password);
  await asServiceRole(async (sql) => {
    await sql(
      `insert into auth.users (id, email, raw_user_meta_data, password_hash, confirmed_at)
       values ($1::uuid, $2, $3::jsonb, $4, now())`,
      [id, email, meta, hash],
    );
  });
  const user: AuthUser = {
    id,
    email,
    created_at: new Date().toISOString(),
    confirmed_at: new Date().toISOString(),
    raw_user_meta_data: (data ?? {}) as Record<string, unknown>,
  };
  res.json(sessionResponse(user, crypto.randomUUID()));
});

app.post("/auth/v1/token", async (req, res) => {
  const grantType = String(req.query.grant_type ?? "password");
  const { email, password, refresh_token } = req.body ?? {};

  if (grantType === "refresh_token") {
    const payload = refresh_token ? verifyJwt(refresh_token) : null;
    if (!payload) {
      res.status(400).json({ error: "refresh token invÃ¡lido" });
      return;
    }
    const user = await findUserById(payload.sub);
    if (!user) {
      res.status(400).json({ error: "usuario inexistente" });
      return;
    }
    res.json(sessionResponse(user, payload.session_id ?? crypto.randomUUID()));
    return;
  }

  const user = await findUserByEmail(String(email ?? ""));
  if (!user || !user.password_hash || !verifyPassword(String(password ?? ""), user.password_hash)) {
    res.status(400).json({ error: "Invalid login credentials" });
    return;
  }
  res.json(sessionResponse(user, crypto.randomUUID()));
});

app.post("/auth/v1/recover", async (_req, res) => {
  // El correo no se envÃ­a de verdad en el entorno local: la cuenta existe en
  // la base y se puede volver a pedir el alta con el mismo correo.
  res.json({});
});

app.get("/auth/v1/user", async (req, res) => {
  const session = sessionFromRequest(req);
  if (!session.sub) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const user = await findUserById(session.sub);
  if (!user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  res.json(publicUser(user));
});

app.patch("/auth/v1/user", async (req, res) => {
  const session = sessionFromRequest(req);
  if (!session.sub) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const { password, email } = req.body ?? {};
  await asServiceRole(async (sql) => {
    if (password) {
      await sql(`update auth.users set password_hash = $2 where id = $1::uuid`, [
        session.sub,
        hashPassword(String(password)),
      ]);
    }
    if (email) {
      await sql(`update auth.users set email = $2 where id = $1::uuid`, [session.sub, String(email)]);
    }
  });
  const user = await findUserById(session.sub);
  res.json(user ? publicUser(user) : {});
});

app.post("/auth/v1/logout", (_req, res) => {
  res.status(204).end();
});

/**
 * OAuth de demostraciÃ³n: en lugar de Google real, muestra las cuentas de
 * prueba y devuelve la sesiÃ³n como lo harÃ­a el proveedor (redirect con el
 * token en el fragmento). El flujo del cliente es exactamente el de Supabase.
 */
app.get("/auth/v1/authorize", async (req, res) => {
  const redirectTo = String(req.query.redirect_to ?? "");
  const accounts = await asServiceRole(async (sql) =>
    sql(`select id, email, raw_user_meta_data from auth.users order by created_at`),
  );

  const options = accounts.rows
    .map((row: any) => {
      const name = row.raw_user_meta_data?.full_name ?? row.email;
      return `<option value="${row.id}">${name} â€” ${row.email}</option>`;
    })
    .join("");

  res.type("html").send(`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Entorno local Â· ElegÃ­ una cuenta</title>
<style>
 body{font-family:system-ui,sans-serif;background:#faf8f3;color:#142b2d;display:grid;place-items:center;min-height:100vh;margin:0}
 .card{background:#fff;border:1px solid rgba(20,43,45,.16);padding:2.5rem;max-width:420px;width:100%}
 h1{font-family:Georgia,serif;font-weight:400;font-size:1.9rem;margin:0 0 .5rem}
 p{color:#667271;font-size:.9rem;margin:0 0 1.5rem}
 button{background:#142b2d;color:#faf8f3;border:0;padding:.8rem 1.2rem;font-size:.8rem;cursor:pointer;width:100%}
 small{display:block;color:#667271;margin-top:1.2rem;font-size:.72rem;line-height:1.5}
</style></head><body>
<div class="card">
  <h1>Continuar con Google</h1>
  <p>Entorno local de desarrollo: elegÃ­ una cuenta de prueba en lugar de autenticarte con Google.</p>
  <select id="account" style="width:100%;padding:.7rem;margin-bottom:1rem;border:1px solid rgba(20,43,45,.16);font-size:.85rem">${options}</select>
  <button onclick="continue()">Continuar</button>
  <small>Esto es una simulaciÃ³n del proveedor OAuth, sÃ³lo para desarrollo. En producciÃ³n, el botÃ³n abre el Google real.</small>
</div>
<script>
const REDIRECT = ${JSON.stringify(redirectTo)};
async function continue_(){
  const id = document.getElementById('account').value;
  const response = await fetch('/auth/v1/oauth/callback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: id, redirect_to: REDIRECT })
  });
  const data = await response.json();
  window.location.href = data.redirect_to;
}
function continue_with(){ continue_(); }
</script>
<script>document.querySelector('button').onclick = () => continue_();</script>
</body></html>`);
});

app.post("/auth/v1/oauth/callback", async (req, res) => {
  const { user_id, redirect_to } = req.body ?? {};
  const user = await findUserById(String(user_id));
  if (!user) {
    res.status(400).json({ error: "usuario inexistente" });
    return;
  }
  const session = sessionResponse(user, crypto.randomUUID());
  const fragment = new URLSearchParams({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    token_type: "bearer",
    expires_in: String(session.expires_in),
    expires_at: String(session.expires_at),
  });
  const base = String(redirect_to ?? "/").split("#")[0];
  res.json({ redirect_to: `${base}#${fragment.toString()}` });
});

// ============================================================================
// REST (PostgREST)
// ============================================================================
/** Convierte el query de Express (ParsedQs) a URLSearchParams. */
function toSearchParams(query: Record<string, unknown>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item));
    } else {
      params.append(key, String(value));
    }
  }
  return params;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

app.get("/rest/v1/:table", async (req, res) => {
  const query = parseRestQuery(req.params.table, toSearchParams(req.query), {
    prefer: headerValue(req.headers.prefer),
    range: headerValue(req.headers.range),
    accept: headerValue(req.headers.accept),
  });
  const session = sessionFromRequest(req);
  const result = await withSession(session, (sql) => runRestQuery(sql, query));
  res.status(result.status);
  for (const [key, value] of Object.entries(result.headers)) res.setHeader(key, value);
  res.json(result.body);
});

app.head("/rest/v1/:table", async (req, res) => {
  const query = parseRestQuery(req.params.table, toSearchParams(req.query), {
    prefer: headerValue(req.headers.prefer),
    range: headerValue(req.headers.range),
    accept: headerValue(req.headers.accept),
  });
  const session = sessionFromRequest(req);
  const result = await withSession(session, (sql) => runRestQuery(sql, query));
  res.status(result.status);
  for (const [key, value] of Object.entries(result.headers)) res.setHeader(key, value);
  res.end();
});

app.post("/rest/v1/:table", async (req, res) => {
  const session = sessionFromRequest(req);
  const table = req.params.table;
  const payload = Array.isArray(req.body) ? req.body : [req.body];
  const returnRepresentation = (req.headers.prefer ?? "").includes("return=representation");

  const result = await withSession(session, async (sql) => {
    const rows: any[] = [];
    for (const item of payload) {
      const columns = Object.keys(item);
      const placeholders = columns.map(() => "$").join(", ");
      const values = columns.map((column) => item[column]);
      const { rows: inserted } = await sql(
        `insert into "${table}" (${columns.map((c) => `"${c}"`).join(", ")})
         values (${placeholders}) returning *`,
        values,
      );
      rows.push(...inserted);
    }
    return rows;
  });

  if (!returnRepresentation) {
    res.status(201).json([]);
    return;
  }
  res.status(201).json(result);
});

app.patch("/rest/v1/:table", async (req, res) => {
  const session = sessionFromRequest(req);
  const table = req.params.table;
  const body = req.body ?? {};
  const columns = Object.keys(body);
  const assignments = columns.map((column, index) => `"${column}" = $${index + 1}`).join(", ");

  const filters = parseFiltersFromQuery(toSearchParams(req.query));
  const where = filters.length ? ` where ${filters.map((f) => f.sql).join(" and ")}` : "";
  const params = [...columns.map((c) => body[c]), ...filters.flatMap((f) => f.params)];

  const result = await withSession(session, async (sql) => {
    const { rows } = await sql(
      `update "${table}" set ${assignments}${where} returning *`,
      params,
    );
    return rows;
  });

  const returnRepresentation = (req.headers.prefer ?? "").includes("return=representation");
  res.status(200).json(returnRepresentation ? result : []);
});

app.delete("/rest/v1/:table", async (req, res) => {
  const session = sessionFromRequest(req);
  const table = req.params.table;
  const filters = parseFiltersFromQuery(toSearchParams(req.query));
  const where = filters.length ? ` where ${filters.map((f) => f.sql).join(" and ")}` : "";

  const result = await withSession(session, async (sql) => {
    const { rows } = await sql(`delete from "${table}"${where} returning *`, filters.flatMap((f) => f.params));
    return rows;
  });
  res.status(200).json(result);
});

/** Filtros de un query string, reutilizando el parser de PostgREST. */
function parseFiltersFromQuery(query: URLSearchParams) {
  const filters: Array<{ sql: string; params: unknown[] }> = [];
  for (const [key, value] of query.entries()) {
    if (["select", "order", "limit", "offset", "on_conflict"].includes(key)) continue;
    if (key === "or") {
      const inner = value.replace(/^\(|\)$/g, "");
      const parts = inner.split(",");
      const parsed = parts.map((part) => {
        const column = part.split(".")[0];
        const rest = part.slice(part.indexOf(".") + 1);
        return parseFilterCondition(column, rest);
      });
      filters.push({
        sql: `(${parsed.map((p) => p.sql).join(" or ")})`,
        params: parsed.flatMap((p) => p.params),
      });
      continue;
    }
    filters.push(parseFilterCondition(key, value));
  }
  return filters;
}

function parseFilterCondition(column: string, raw: string) {
  const separator = raw.indexOf(".");
  const operator = separator === -1 ? "eq" : raw.slice(0, separator);
  const value = separator === -1 ? raw : raw.slice(separator + 1);
  const col = `"${column.replace(/"/g, '""')}"`;
  const literalValue = /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;

  switch (operator) {
    case "eq":
      return { sql: `${col} = $`, params: [literalValue] };
    case "neq":
      return { sql: `${col} <> $`, params: [literalValue] };
    case "gt":
      return { sql: `${col} > $`, params: [literalValue] };
    case "gte":
      return { sql: `${col} >= $`, params: [literalValue] };
    case "lt":
      return { sql: `${col} < $`, params: [literalValue] };
    case "lte":
      return { sql: `${col} <= $`, params: [literalValue] };
    case "ilike":
      return { sql: `${col} ilike $`, params: [value.replace(/\*/g, "%")] };
    case "like":
      return { sql: `${col} like $`, params: [value.replace(/\*/g, "%")] };
    case "is":
      return value === "null" ? { sql: `${col} is null`, params: [] } : { sql: `${col} is not null`, params: [] };
    case "in": {
      const items = value.replace(/^\(|\)$/g, "").split(",");
      return { sql: `${col} in (${items.map(() => "$").join(", ")})`, params: items };
    }
    case "not": {
      if (value === "is.null") return { sql: `${col} is not null`, params: [] };
      return { sql: `not (${col} = $)`, params: [literalValue] };
    }
    default:
      return { sql: `${col} = $`, params: [literalValue] };
  }
}

// ============================================================================
// STORAGE
// ============================================================================
function storagePath(bucket: string, name: string): string {
  return join(STORAGE_DIR, bucket, name);
}

app.put(
  "/storage/v1/object/:bucket/*",
  // El cuerpo es el archivo binario: se lee crudo, con cualquier content-type.
  express.raw({ type: () => true, limit: "30mb" }),
  async (req, res) => {
  const session = sessionFromRequest(req);
  const bucket = req.params.bucket;
  const name = decodeURIComponent((req.params as any)[0] ?? "");
  const body = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}));

  const folder = name.split("/")[0];
  const allowed = await withSession(session, async (sql) => {
    const { rows } = await sql(
      `select count(*)::int as total from storage.objects
       where bucket_id = $1 and (storage.foldername(name))[1] = $2`,
      [bucket, folder],
    );
    return Number(rows[0]?.total ?? 0) > 0;
  });
  if (!allowed) {
    res.status(400).json({ message: "no tenÃ©s permiso para escribir en esa carpeta" });
    return;
  }

  mkdirSync(dirname(storagePath(bucket, name)), { recursive: true });
  writeFileSync(storagePath(bucket, name), body);

  await withSession(session, async (sql) => {
    await sql(
      `insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3::uuid)
       on conflict do nothing`,
      [bucket, name, session.sub],
    );
  });

  res.status(200).json({ Key: `${bucket}/${name}` });
  },
);

app.post("/storage/v1/object/sign/:bucket/*", async (req, res) => {
  const session = sessionFromRequest(req);
  const bucket = req.params.bucket;
  const name = decodeURIComponent((req.params as any)[0] ?? "");

  const visible = await withSession(session, async (sql) => {
    const { rows } = await sql(
      `select count(*)::int as total from storage.objects where bucket_id = $1 and name = $2`,
      [bucket, name],
    );
    return Number(rows[0]?.total ?? 0) > 0;
  });
  if (!visible) {
    res.status(400).json({ message: "no tenÃ©s permiso para acceder a ese archivo" });
    return;
  }

  const expiresIn = Number(req.body?.expiresIn ?? 60);
  const token = signJwt({
    sub: session.sub ?? "anon",
    role: "storage",
    aud: `${bucket}/${name}`,
    exp: Math.floor(Date.now() / 1000) + expiresIn,
  });
  res.json({ signedURL: `/object/sign/${bucket}/${name}?token=${token}` });
});

app.get("/storage/v1/object/sign/:bucket/*", async (req, res) => {
  const bucket = req.params.bucket;
  const name = decodeURIComponent((req.params as any)[0] ?? "");
  const payload = verifyJwt(String(req.query.token ?? ""));
  if (!payload || payload.aud !== `${bucket}/${name}`) {
    res.status(400).json({ message: "enlace invÃ¡lido o vencido" });
    return;
  }
  const file = storagePath(bucket, name);
  if (!existsSync(file)) {
    res.status(404).json({ message: "archivo no encontrado" });
    return;
  }
  res.type("application/octet-stream");
  res.send(readFileSync(file));
});

app.delete("/storage/v1/object/:bucket/*", async (req, res) => {
  const session = sessionFromRequest(req);
  const bucket = req.params.bucket;
  const name = decodeURIComponent((req.params as any)[0] ?? "");
  const file = storagePath(bucket, name);
  if (existsSync(file)) rmSync(file);
  await withSession(session, async (sql) => {
    await sql(`delete from storage.objects where bucket_id = $1 and name = $2`, [bucket, name]);
  });
  res.status(200).json([]);
});

// ============================================================================
// EDGE FUNCTIONS
// ============================================================================
app.post("/functions/v1/:name", async (req, res) => {
  const session = sessionFromRequest(req);
  const ip = req.ip ?? "local";
  const outcome = await handleConsultation(req.body, {
    async consumeRateLimit() {
      const allowed = await asServiceRole(async (sql) => {
        const { rows } = await sql("select public.consume_rate_limit($1, 5, 3600) as allowed", [
          `consulta:${ip}`,
        ]);
        return rows[0]?.allowed !== false;
      });
      return allowed;
    },
    async insertConsultation(data) {
      return asServiceRole(async (sql) => {
        const { rows } = await sql(
          `insert into public.legal_consultations
             (full_name, email, phone, category_id, subject, description, status, is_new, privacy_accepted_at)
           values ($1, $2, $3, $4::uuid, $5, $6, 'nueva', true, now())
           returning reference_code`,
          [
            data.fullName,
            data.email,
            data.phone ?? null,
            data.categoryId ?? null,
            data.subject,
            data.description,
          ],
        );
        return rows[0].reference_code as string;
      });
    },
  });

  if (!outcome.ok) {
    res.status(outcome.status).json({ error: outcome.error });
    return;
  }
  res.json({ ok: true, referenceCode: outcome.referenceCode });
});

// ============================================================================
// SITIO ESTÃTICO
// ============================================================================
if (existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get("*", (_req, res) => {
    const index = join(DIST, "index.html");
    if (!existsSync(index)) {
      res.status(503).send("Falta compilar el sitio: npm run build:static");
      return;
    }
    res.sendFile(index);
  });
} else {
  app.get("*", (_req, res) => {
    res.status(503).send("Falta compilar el sitio: npm run build:static");
  });
}

// ============================================================================
// Arranque
// ============================================================================
async function findUserByEmail(email: string): Promise<(AuthUser & { password_hash: string | null }) | null> {
  const { rows } = await asServiceRole(async (sql) =>
    sql(`select id, email, password_hash, raw_user_meta_data, created_at, confirmed_at from auth.users where lower(email) = lower($1)`, [email]),
  );
  return (rows[0] as any) ?? null;
}

async function findUserById(id: string): Promise<(AuthUser & { password_hash: string | null }) | null> {
  const { rows } = await asServiceRole(async (sql) =>
    sql(`select id, email, password_hash, raw_user_meta_data, created_at, confirmed_at from auth.users where id = $1::uuid`, [id]),
  );
  return (rows[0] as any) ?? null;
}

async function main() {
  await getDb();
  await seedLocalDatabase();

  app.listen(PORT, "127.0.0.1", () => {
    console.log(`\n  Estudio JurÃ­dico Casoratti â€” entorno local`);
    console.log(`  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€`);
    console.log(`  Sitio y API:  http://127.0.0.1:${PORT}`);
    console.log(`  Clave anon:  ${ANON_KEY}`);
    console.log(`\n  Cuentas de prueba (contraseÃ±a: ${DEMO_PASSWORD})`);
    for (const account of DEMO_ACCOUNTS) {
      console.log(`   Â· ${account.label.padEnd(18)} ${account.email}`);
    }
    console.log();
  });
}

main().catch((error) => {
  console.error("No se pudo iniciar el entorno local:", error);
  process.exit(1);
});


