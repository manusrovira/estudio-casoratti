/**
 * Pruebas de RLS — inventario de apariciones de imágenes (Casoratti / Supabase).
 *
 * Corre contra las MIGRACIONES REALES aplicadas en un PostgreSQL 17 (PGlite).
 * Las consultas se ejecutan con `set local role authenticated` (o `anon`),
 * exactamente igual que PostgREST, de modo que las políticas RLS son las que
 * deciden qué se ve y quién escribe.
 *
 * Qué se demuestra acá:
 *   - una aparición (`occurrence_id` no nulo) es tan sólo del administrador,
 *     igual que el resto del inventario;
 *   - el RPC público devuelve las tres secciones: `occurrences`, `files` y
 *     `hidden`, y cada fila cae en la sección que le corresponde;
 *   - un cliente no escribe ni en el inventario ni en la bitácora;
 *   - `media_activity` sigue siendo de sólo lectura;
 *   - no se pueden registrar dos apariciones con el mismo `occurrence_id`;
 *   - `log_media_action` sigue exigiendo `is_admin()` y la lista blanca.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MIGRATIONS_DIR,
  asServiceRole,
  asSession,
  createAuthUser,
  createTestDatabase,
  setRole,
  type Sql,
} from "./harness";

let db: PGlite;

const ADMIN = "11111111-1111-4111-8111-111111111111";
const LAWYER = "22222222-2222-4222-8222-222222222222";
const CLIENT = "33333333-3333-4333-8333-333333333333";

/** Ejecuta un bloque como un usuario con sesión, con el rol de la request. */
const asUser = <T>(sub: string, fn: (sql: Sql) => Promise<T>) =>
  asSession(db, { sub, role: "authenticated" }, fn);

const asAnon = <T>(fn: (sql: Sql) => Promise<T>) =>
  asSession(db, { sub: null, role: "anon" }, fn);

const asService = <T>(fn: (sql: Sql) => Promise<T>) => asServiceRole(db, fn);

beforeAll(async () => {
  db = await createTestDatabase();

  // --- identidades (disparan el trigger handle_new_user) --------------------
  await createAuthUser(db, { id: ADMIN, email: "admin@estudiocasoratti.com.ar", fullName: "Administración" });
  await createAuthUser(db, { id: LAWYER, email: "abogado@estudiocasoratti.com.ar", fullName: "Abogado" });
  await createAuthUser(db, { id: CLIENT, email: "cliente@example.com", fullName: "Cliente" });

  // --- roles (asignados fuera del frontend) --------------------------------
  await setRole(db, ADMIN, "admin");
  await setRole(db, LAWYER, "abogado");
  await setRole(db, CLIENT, "cliente");

  // --- inventario: apariciones y archivos físicos --------------------------
  await asService(async (sql) => {
    await sql(
      `insert into public.site_media
         (logical_path, storage_path, occurrence_id, source, original_name, mime_type, format, size_bytes)
       values
         -- Aparición activa: el sitio la resuelve por su occurrence_id.
         ('occurrence/home-hero', 'occurrences/home-hero.jpg', 'home-hero', 'override',
          'home-hero.jpg', 'image/jpeg', 'jpg', 245760),
         -- Aparición oculta: se quitó del sitio, sin ruta de Storage.
         ('occurrence/values-intro', null, 'values-intro', 'override',
          'values-intro.jpg', 'image/jpeg', 'jpg', 245760),
         -- Aparición en papelera: ni visible ni oculta.
         ('occurrence/faq-intro', 'occurrences/faq-intro.jpg', 'faq-intro', 'override',
          'faq-intro.jpg', 'image/jpeg', 'jpg', 245760),
         -- Archivo físico (sin aparición): se resuelve por su ruta lógica.
         ('assets/casoratti-hero.jpg', 'overrides/casoratti-hero.jpg', null, 'override',
          'casoratti-hero.jpg', 'image/jpeg', 'jpg', 245760)`,
    );
    await sql(
      `update public.site_media
         set status = 'hidden', deleted_at = now()
       where occurrence_id = 'values-intro'`,
    );
    await sql(
      `update public.site_media
         set status = 'trashed', deleted_at = now()
       where occurrence_id = 'faq-intro'`,
    );
    // La bitácora arranca con un registro anterior (append-only).
    await sql(
      `insert into public.media_activity (action, media_path, actor_id, result, detail)
       values ('upload', 'occurrence/home-hero', '${ADMIN}', 'success',
               '{"carpeta":"occurrences"}'::jsonb)`,
    );
  });
}, 180_000);

afterAll(async () => {
  await db?.close();
});

describe("1 · Las apariciones son territorio del administrador", () => {
  it("el administrador ve las apariciones y su estado", async () => {
    const { rows } = await asUser(ADMIN, (sql) =>
      sql(
        `select occurrence_id, status, storage_path
         from public.site_media
         where occurrence_id is not null
         order by occurrence_id`,
      ),
    );
    expect(rows).toHaveLength(3);
    expect(rows.map((r: any) => r.occurrence_id)).toEqual([
      "faq-intro",
      "home-hero",
      "values-intro",
    ]);
    expect(rows.map((r: any) => r.status).sort()).toEqual(["active", "hidden", "trashed"]);
  });

  it("un cliente no ve ninguna aparición", async () => {
    const { rows } = await asUser(CLIENT, (sql) =>
      sql(`select occurrence_id from public.site_media where occurrence_id is not null`),
    );
    expect(rows).toHaveLength(0);
  });

  it("un abogado tampoco ve las apariciones", async () => {
    const { rows } = await asUser(LAWYER, (sql) =>
      sql(`select occurrence_id from public.site_media where occurrence_id is not null`),
    );
    expect(rows).toHaveLength(0);
  });

  it("el visitante anónimo no puede leer el inventario", async () => {
    await expect(
      asAnon((sql) => sql(`select occurrence_id from public.site_media`)),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("2 · El RPC público devuelve las tres secciones", () => {
  it("coloca la aparición activa en `occurrences` y la oculta en `hidden`", async () => {
    const { rows } = await asAnon((sql) => sql(`select public.resolve_media_overrides() as mapa`));
    expect(rows).toHaveLength(1);

    const mapa = rows[0].mapa;
    expect(Object.keys(mapa).sort()).toEqual(["files", "hidden", "occurrences"]);

    // La aparición activa: se resuelve por su identificador de aparición.
    expect(mapa.occurrences).toEqual({ "home-hero": "occurrences/home-hero.jpg" });
    // La aparición oculta: el sitio la muestra sin imagen.
    expect(mapa.hidden).toEqual(["values-intro"]);
    // La aparición en papelera no está en ninguna sección.
    expect(mapa.occurrences["faq-intro"]).toBeUndefined();
    expect(mapa.hidden).not.toContain("faq-intro");
  });

  it("el archivo físico aparece en `files`, no en `occurrences`", async () => {
    const { rows } = await asAnon((sql) => sql(`select public.resolve_media_overrides() as mapa`));
    const mapa = rows[0].mapa;

    expect(mapa.files).toEqual({ "assets/casoratti-hero.jpg": "overrides/casoratti-hero.jpg" });
    // La ruta lógica del archivo no se cuela en el mapa de apariciones.
    expect(Object.keys(mapa.occurrences)).not.toContain("assets/casoratti-hero.jpg");
    expect(Object.keys(mapa.files)).not.toContain("home-hero");
  });

  it("un usuario con sesión obtiene el mismo mapa público", async () => {
    const { rows: anon } = await asAnon((sql) => sql(`select public.resolve_media_overrides() as mapa`));
    const { rows: cliente } = await asUser(CLIENT, (sql) =>
      sql(`select public.resolve_media_overrides() as mapa`),
    );
    expect(cliente[0].mapa).toEqual(anon[0].mapa);
  });

  it("el RPC sigue siendo sólo lectura: no admite parámetros ni escrituras", async () => {
    const { rows } = await asService(async (sql) =>
      sql(
        `select p.prosecdef as security_definer, p.provolatile as volatility,
                pg_get_function_result(p.oid) as returns
         from pg_proc p
         where p.oid = 'public.resolve_media_overrides()'::regprocedure`,
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].security_definer).toBe(true);
    expect(rows[0].volatility).toBe("s");
    expect(rows[0].returns).toBe("jsonb");
  });
});

describe("3 · Un cliente no puede escribir", () => {
  it("no inserta apariciones", async () => {
    await expect(
      asUser(CLIENT, (sql) =>
        sql(
          `insert into public.site_media
             (logical_path, storage_path, occurrence_id, source, original_name, mime_type, format)
           values ('occurrence/intruso', 'occurrences/intruso.jpg', 'intruso', 'override',
                   'intruso.jpg', 'image/jpeg', 'jpg')`,
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("no modifica ni borra apariciones", async () => {
    await asUser(CLIENT, (sql) =>
      sql(`update public.site_media set status = 'hidden' where occurrence_id = 'home-hero'`),
    );
    await asUser(CLIENT, (sql) => sql(`delete from public.site_media where occurrence_id = 'home-hero'`));

    const { rows } = await asService(async (sql) =>
      sql(`select status from public.site_media where occurrence_id = 'home-hero'`),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("active");
  });

  it("no escribe en la bitácora con log_media_action", async () => {
    await expect(
      asUser(CLIENT, (sql) =>
        sql(`select public.log_media_action('replace', 'occurrence/home-hero', 'success', '{}'::jsonb)`),
      ),
    ).rejects.toThrow(/solo un administrador/i);
  });

  it("el anónimo ni siquiera puede ejecutar log_media_action", async () => {
    await expect(
      asAnon((sql) => sql(`select public.log_media_action('upload', null, 'success', '{}'::jsonb)`)),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("4 · La bitácora de medios sigue siendo de sólo lectura", () => {
  it("el administrador la lee pero no la puede modificar ni borrar", async () => {
    const { rows: antes } = await asService(async (sql) =>
      sql(`select count(*) as total from public.media_activity`),
    );

    await asUser(ADMIN, (sql) => sql(`update public.media_activity set result = 'error'`));
    await asUser(ADMIN, (sql) => sql(`delete from public.media_activity`));

    const { rows: despues } = await asService(async (sql) =>
      sql(`select count(*) as total from public.media_activity`),
    );
    expect(despues[0].total).toBe(antes[0].total);
    expect(despues[0].total).toBeGreaterThan(0);
  });

  it("un cliente no lee la bitácora", async () => {
    const { rows } = await asUser(CLIENT, (sql) => sql(`select action from public.media_activity`));
    expect(rows).toHaveLength(0);
  });
});

describe("5 · No se repiten apariciones con el mismo identificador", () => {
  it("el administrador no puede registrar dos veces la misma aparición", async () => {
    await expect(
      asUser(ADMIN, (sql) =>
        sql(
          `insert into public.site_media
             (logical_path, storage_path, occurrence_id, source, original_name, mime_type, format)
           values ('occurrence/home-hero-2', 'occurrences/home-hero-2.jpg', 'home-hero', 'override',
                   'home-hero-2.jpg', 'image/jpeg', 'jpg')`,
        ),
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it("el índice único es parcial: los archivos físicos pueden repetirse sin occurrence_id", async () => {
    await asUser(ADMIN, (sql) =>
      sql(
        `insert into public.site_media
           (logical_path, storage_path, occurrence_id, source, original_name, mime_type, format)
         values ('assets/casoratti-hero-2.jpg', 'overrides/casoratti-hero-2.jpg', null, 'override',
                 'casoratti-hero-2.jpg', 'image/jpeg', 'jpg')`,
      ),
    );

    const { rows } = await asService(async (sql) =>
      sql(`select count(*) as total from public.site_media where occurrence_id is null`),
    );
    expect(Number(rows[0].total)).toBe(2);
  });

  it("el estado `hidden` es válido y cualquier otro estado no", async () => {
    await asUser(ADMIN, (sql) =>
      sql(
        `insert into public.site_media
           (logical_path, occurrence_id, status, source, original_name, mime_type, format)
         values ('occurrence/home-split', 'home-split', 'hidden', 'override',
                 'home-split.jpg', 'image/jpeg', 'jpg')`,
      ),
    );

    await expect(
      asUser(ADMIN, (sql) =>
        sql(
          `insert into public.site_media
             (logical_path, occurrence_id, status, source, original_name, mime_type, format)
           values ('occurrence/home-mal', 'home-mal', 'oculto', 'override',
                   'home-mal.jpg', 'image/jpeg', 'jpg')`,
        ),
      ),
    ).rejects.toThrow(/site_media_status_check|violates check constraint/i);
  });
});

describe("6 · log_media_action exige administrador y respeta la lista blanca", () => {
  it("el administrador deja un registro con su identidad", async () => {
    const { rows } = await asUser(ADMIN, (sql) =>
      sql(
        `select public.log_media_action(
           'edit', 'occurrence/home-hero', 'success',
           jsonb_build_object('campo', 'alt_text', 'valor', 'Nuevo texto')) as id`,
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBeTruthy();

    const { rows: registro } = await asService(async (sql) =>
      sql(`select actor_id, action, media_path from public.media_activity where id = '${rows[0].id}'`),
    );
    expect(registro).toHaveLength(1);
    expect(registro[0].actor_id).toBe(ADMIN);
    expect(registro[0].action).toBe("edit");
    expect(registro[0].media_path).toBe("occurrence/home-hero");
  });

  it("rechaza una acción fuera de la lista blanca", async () => {
    const { rows: antes } = await asService(async (sql) =>
      sql(`select count(*) as total from public.media_activity`),
    );

    await expect(
      asUser(ADMIN, (sql) =>
        sql(`select public.log_media_action('drop_table', null, 'success', '{}'::jsonb)`),
      ),
    ).rejects.toThrow(/no permitida/i);

    const { rows: despues } = await asService(async (sql) =>
      sql(`select count(*) as total from public.media_activity`),
    );
    expect(despues[0].total).toBe(antes[0].total);
  });
});

describe("7 · La migración de apariciones es idempotente", () => {
  it("aplicarla dos veces deja el mismo estado", async () => {
    const estado = async () => {
      const { rows } = await asService(async (sql) =>
        sql(
          `select (select count(1) from public.site_media) as medios,
                  (select count(1) from public.site_media
                    where occurrence_id is not null) as apariciones,
                  (select count(1) from pg_indexes
                    where schemaname = 'public' and indexname = 'site_media_occurrence_unique') as indice,
                  (select count(1) from pg_constraint
                    where conname = 'site_media_status_check') as check_estado`,
        ),
      );
      return rows[0];
    };

    const antes = await estado();

    const migracion = readFileSync(join(MIGRATIONS_DIR, "20260116000100_media_occurrences.sql"), "utf8");
    await db.exec(migracion);
    await db.exec(migracion);

    const despues = await estado();
    expect(despues).toEqual(antes);
    expect(Number(antes.indice)).toBe(1);
    expect(Number(antes.check_estado)).toBe(1);
  });
});
