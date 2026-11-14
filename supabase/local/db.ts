/**
 * Base de datos del entorno local.
 *
 * Corre un PostgreSQL 17 real (PGlite, compilado a WASM) con exactamente las
 * mismas migraciones y las mismas políticas RLS que usa Supabase. Cada request
 * abre una transacción, fija el rol (`anon` / `authenticated` / `service_role`)
 * y el claim JWT, de la misma forma que PostgREST: por eso las políticas se
 * evalúan exactamente igual que en producción.
 */

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = join(HERE, "..", "migrations");

export type Session = {
  /** id del usuario (sub del JWT) o null para visitantes. */
  sub: string | null;
  role: "anon" | "authenticated" | "service_role";
  email?: string;
};

let db: PGlite | null = null;
/** PGlite tiene una sola conexión: las requests se serializan. */
let queue: Promise<unknown> = Promise.resolve();

export async function getDb(): Promise<PGlite> {
  if (db) return db;
  const dataDir = join(HERE, "..", "..", ".local-data", "pgdata");
  mkdirSync(join(HERE, "..", "..", ".local-data"), { recursive: true });
  db = new PGlite(dataDir);
  await db.exec(`
    create table if not exists public._local_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    );
    do $$ begin
      create role anon nologin;
    exception when duplicate_object then null; end $$;
    do $$ begin
      create role authenticated nologin;
    exception when duplicate_object then null; end $$;
    do $$ begin
      create role service_role nologin bypassrls;
    exception when duplicate_object then null; end $$;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  `);

  // Shim de `auth`: en Supabase la gestiona la plataforma. Acá se replica lo
  // que necesitan las migraciones y el login (identidades, metadata y hash).
  await db.exec(`
    create schema if not exists auth;
    create table if not exists auth.users (
      id uuid primary key,
      email text,
      password_hash text,
      raw_user_meta_data jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      confirmed_at timestamptz
    );
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid;
    $$;
    create or replace function auth.role() returns text language sql stable as $$
      select coalesce(
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'anon');
    $$;
    create or replace function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(
        nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
    $$;
    -- En Supabase la plataforma administra estos permisos. Acá hay que
    -- replicarlos: las políticas RLS llaman a auth.uid()/auth.role() y el
    -- seed (service_role) lee auth.users.
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    grant select on auth.users to service_role;
  `);

  await ensureStorageSchema(db);
  await runMigrations(db);
  await ensureGrants(db);
  return db;
}

/**
 * `bypassrls` no exime de los permisos de tabla: hay que concederlos
 * explícitamente. `alter default privileges` sólo alcanza a los objetos
 * creados después, por eso se re-aplican los permisos sobre todo el schema.
 */
async function ensureGrants(database: PGlite): Promise<void> {
  await database.exec(`
    do $$
    declare
      r record;
    begin
      for r in select tablename from pg_tables where schemaname = 'public'
      loop
        execute format('grant all on table public.%I to anon, authenticated, service_role', r.tablename);
      end loop;
      for r in select sequence_name from information_schema.sequences where sequence_schema = 'public'
      loop
        execute format('grant all on sequence public.%I to anon, authenticated, service_role', r.sequence_name);
      end loop;
    end $$;
    grant all on all tables in schema auth to service_role;
    grant all on all sequences in schema auth to service_role;
    grant all on all tables in schema storage to service_role;
    grant all on all sequences in schema storage to service_role;
  `);
}

/** Aplica las migraciones que falten (idempotente). */
async function runMigrations(database: PGlite): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const { rows } = await database.query(
      "select name from public._local_migrations where name = $1",
      [file],
    );
    if (rows.length > 0) continue;

    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    try {
      await database.exec(sql);
    } catch (error) {
      throw new Error(`Falló la migración ${file}: ${(error as Error).message}`);
    }
    await database.query("insert into public._local_migrations (name) values ($1)", [file]);
  }
}

/** Tablas de storage que en Supabase maneja la plataforma. */
async function ensureStorageSchema(database: PGlite): Promise<void> {
  await database.exec(`
    create schema if not exists storage;
    create table if not exists storage.buckets (
      id text primary key,
      name text not null,
      public boolean not null default false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    create table if not exists storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text not null references storage.buckets (id),
      name text not null,
      owner uuid,
      created_at timestamptz not null default now()
    );
    alter table storage.objects enable row level security;
    create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
      select case when position('/' in name) = 0 then array[]::text[]
                  else (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
             end;
    $$;
    grant usage on schema storage to anon, authenticated, service_role;
    grant select on storage.buckets to anon, authenticated;
    grant select, insert, delete on storage.objects to authenticated;
    grant execute on function storage.foldername(text) to anon, authenticated;
  `);
}

/**
 * Ejecuta una función como una sesión concreta. Todo lo que ocurre dentro ve
 * las políticas RLS según el rol de esa sesión.
 */
export async function withSession<T>(
  session: Session,
  fn: (sql: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>) => Promise<T>,
): Promise<T> {
  const run = async (): Promise<T> => {
    const database = await getDb();
    const claims = JSON.stringify({
      sub: session.sub ?? "",
      email: session.email ?? "",
      role: session.role === "service_role" ? "service_role" : session.role,
    });

    await database.exec("begin");
    try {
      await database.exec(`set local role ${session.role}`);
      await database.exec(
        `select set_config('request.jwt.claims', ${quoteLiteral(claims)}, true)`,
      );
      const sql = async (text: string, params: unknown[] = []) => {
        const result = await database.query(text, params as never[]);
        return { rows: result.rows as any[] };
      };
      const output = await fn(sql);
      await database.exec("commit");
      return output;
    } catch (error) {
      await database.exec("rollback").catch(() => undefined);
      throw error;
    }
  };

  // Serializa las requests: PGlite tiene una única conexión.
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}

/** Acceso sin RLS (service role): sólo para el seed y el mantenimiento. */
export async function asServiceRole<T>(
  fn: (sql: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>) => Promise<T>,
): Promise<T> {
  return withSession({ sub: null, role: "service_role" }, fn);
}

export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Identificadores: tabla o columna. Se valida para que no rompan la query. */
export function quoteIdent(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) {
    throw new Error(`Identificador inválido: ${value}`);
  }
  return `"${value}"`;
}
