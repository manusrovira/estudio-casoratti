/**
 * Harness de pruebas — PostgreSQL real embebido (PGlite, WASM).
 *
 * Por qué PGlite y no mocks: las políticas RLS son código de base de datos.
 * Verificarlas contra un mock no prueba nada. Acá aplicamos las MIGRACIONES
 * REALES (supabase/migrations/*.sql) sobre un Postgres 17 y después ejecutamos
 * las consultas con el mismo mecanismo que usa PostgREST: cada request corre
 * como un rol no privilegiado (`authenticated`) con el JWT del usuario en
 * `request.jwt.claims`. Si las policies están mal, las pruebas fallan.
 *
 * Los shims de `auth` y `storage` replican el comportamiento de Supabase:
 *   - auth.uid()        → lee el `sub` del claim JWT de la request
 *   - auth.users        → tabla de identidades (dispara el trigger de alta)
 *   - storage.objects   → objetos del bucket, con RLS activa
 *   - storage.foldername() → carpetas del path
 */

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = join(HERE, "..", "migrations");

export type Sql = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;

export type Session = {
  /** id del usuario en auth.users (sub del JWT) */
  sub?: string | null;
  /** rol de la request: anon | authenticated */
  role: "anon" | "authenticated";
};

/** Crea la base de datos, aplica los shims y corre todas las migraciones. */
export async function createTestDatabase(): Promise<PGlite> {
  const db = new PGlite();

  // --- roles que usa el cliente final (los mismos de Supabase) --------------
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
  `);

  // --- shim de auth ---------------------------------------------------------
  await db.exec(`
    create schema auth;
    create table auth.users (
      id uuid primary key,
      email text,
      raw_user_meta_data jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid;
    $$;
    create function auth.role() returns text language sql stable as $$
      select coalesce(
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'anon');
    $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(
        nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
    $$;
  `);

  // --- shim de storage ------------------------------------------------------
  await db.exec(`
    create schema storage;
    create table storage.buckets (
      id text primary key,
      name text not null,
      public boolean not null default false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    create table storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text not null references storage.buckets (id),
      name text not null,
      owner uuid,
      created_at timestamptz not null default now()
    );
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$
      select case when position('/' in name) = 0 then array[]::text[]
                  else (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
             end;
    $$;
  `);

  // --- permisos de storage (Supabase los concede por defecto) --------------
  await db.exec(`
    grant usage on schema storage to anon, authenticated;
    grant select on storage.buckets to anon, authenticated;
    grant select, insert, delete on storage.objects to authenticated;
    grant execute on function storage.foldername(text) to anon, authenticated;
  `);

  // --- migraciones reales ---------------------------------------------------
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`Fallo la migración ${file}: ${(error as Error).message}`);
    }
  }

  return db;
}

/**
 * Ejecuta un bloque como un usuario concreto, tal como lo haría PostgREST:
 * `set local role` + el claim JWT de la request. Al salir de la transacción
 * se revierte todo, así cada escenario parte de una base limpia.
 */
/**
 * Ejecuta un bloque como un usuario concreto, tal como lo haría PostgREST:
 * `set local role` + el claim JWT de la request.
 *
 * La transacción se confirma al terminar (como una request real): las
 * escrituras persisten y pueden verificarse desde otra sesión. Si el bloque
 * lanza, se revierte.
 */
export async function asSession<T>(
  db: PGlite,
  session: Session,
  fn: (sql: Sql) => Promise<T>,
): Promise<T> {
  const claims = JSON.stringify({ sub: session.sub ?? "", role: session.role });
  await db.exec("begin");
  try {
    // Así ejecuta PostgREST cada request: rol no privilegiado + claims del JWT.
    await db.exec(`set local role ${session.role}`);
    await db.exec(`select set_config('request.jwt.claims', ${quoteLiteral(claims)}, true)`);

    const sql: Sql = async (text, params) => {
      const result = await db.query(text, (params ?? []) as unknown[]);
      return { rows: result.rows as any[] };
    };

    const output = await fn(sql);
    await db.exec("commit");
    return output;
  } catch (error) {
    await db.exec("rollback").catch(() => undefined);
    throw error;
  }
}

/** Escapa un literal para interpolarlo en SQL sin riesgo de inyección. */
export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Ejecuta una sentencia como superusuario (service role): bypassa RLS. */
export async function asServiceRole<T>(
  db: PGlite,
  fn: (sql: Sql) => Promise<T>,
): Promise<T> {
  const sql: Sql = async (text, params) => {
    const result = await db.query(text, (params ?? []) as unknown[]);
    return { rows: result.rows as any[] };
  };
  return fn(sql);
}

export type SeedUser = {
  id: string;
  email: string;
  role: "admin" | "abogado" | "cliente" | "usuario";
  full_name?: string;
};

/** Crea un usuario en auth.users (dispara el trigger de alta) y devuelve su id. */
export async function createAuthUser(
  db: PGlite,
  user: { id: string; email: string; fullName?: string; provider?: string },
): Promise<void> {
  const meta = JSON.stringify({
    full_name: user.fullName ?? user.email,
    name: user.fullName ?? user.email,
    accepted_terms: "true",
    provider: user.provider ?? "email",
  });
  await db.exec(
    `insert into auth.users (id, email, raw_user_meta_data)
     values ('${user.id}'::uuid, '${user.email}', '${meta.replace(/'/g, "''")}'::jsonb)`,
  );
}

/** Asigna (o reemplaza) el rol del usuario. Sólo lo usa el bootstrap de admin. */
export async function setRole(db: PGlite, userId: string, role: SeedUser["role"]): Promise<void> {
  await db.exec(
    `insert into public.user_roles (user_id, role) values ('${userId}'::uuid, '${role}')
     on conflict (user_id) do update set role = excluded.role`,
  );
}
