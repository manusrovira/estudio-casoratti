/**
 * Pruebas de RLS — gestor integral de imágenes (Casoratti / Supabase).
 *
 * Todo corre contra las MIGRACIONES REALES aplicadas en un PostgreSQL 17
 * (PGlite). Las consultas se ejecutan con `set local role authenticated` (o
 * `anon`), exactamente igual que PostgREST, de modo que las políticas RLS son
 * las que deciden qué se ve y quién escribe.
 *
 * Qué se demuestra acá:
 *   - el inventario de medios (`site_media`) es exclusivo del administrador;
 *   - `anon` no lee las tablas: sólo usa el RPC público de overrides;
 *   - la bitácora `media_activity` es de sólo lectura y su autor sale de la
 *     sesión (nunca del cliente), sin credenciales en el detalle;
 *   - el bucket `site-media` sólo se escribe con sesión de administrador.
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
const OUTSIDER = "44444444-4444-4444-8444-444444444444";

/** Ejecuta un bloque como un usuario con sesión, con el rol de la request. */
const asUser = <T>(sub: string, fn: (sql: Sql) => Promise<T>) =>
  asSession(db, { sub, role: "authenticated" }, fn);

const asAnon = <T>(fn: (sql: Sql) => Promise<T>) =>
  asSession(db, { sub: null, role: "anon" }, fn);

const asService = <T>(fn: (sql: Sql) => Promise<T>) => asServiceRole(db, fn);

/** Roles que no administran el estudio: no pueden tocar el gestor. */
const NO_ADMIN = [
  { label: "un abogado", sub: LAWYER },
  { label: "un cliente", sub: CLIENT },
  { label: "un usuario registrado", sub: OUTSIDER },
];

beforeAll(async () => {
  db = await createTestDatabase();

  // --- identidades (disparan el trigger handle_new_user) --------------------
  await createAuthUser(db, { id: ADMIN, email: "admin@estudiocasoratti.com.ar", fullName: "Administración" });
  await createAuthUser(db, { id: LAWYER, email: "abogado@estudiocasoratti.com.ar", fullName: "Abogado" });
  await createAuthUser(db, { id: CLIENT, email: "cliente@example.com", fullName: "Cliente" });
  await createAuthUser(db, { id: OUTSIDER, email: "registrado@example.com", fullName: "Usuario Registrado" });

  // --- roles (asignados fuera del frontend) --------------------------------
  await setRole(db, ADMIN, "admin");
  await setRole(db, LAWYER, "abogado");
  await setRole(db, CLIENT, "cliente");
  // OUTSIDER queda con el rol por defecto 'usuario' que crea el trigger.

  // --- inventario de medios ------------------------------------------------
  await asService(async (sql) => {
    // Override activo: es lo que el sitio público debe resolver.
    await sql(
      `insert into public.site_media
         (logical_path, storage_path, source, original_name, mime_type, format, size_bytes)
       values
         ('assets/casoratti-hero.jpg', 'overrides/casoratti-hero.jpg', 'override',
          'casoratti-hero.jpg', 'image/jpeg', 'jpg', 245760),
         ('images/equipo/equipo.jpg', 'images/equipo/equipo.jpg', 'upload',
          'equipo.jpg', 'image/webp', 'webp', 51200),
         ('images/general/en-papelera.jpg', 'images/general/en-papelera.jpg', 'upload',
          'en-papelera.jpg', 'image/png', 'png', 10240),
         ('images/general/sin-storage.jpg', null, 'bundled',
          'sin-storage.jpg', 'image/jpeg', 'jpg', 20480)`,
    );
    // La de papelera va a la basura: no debe aparecer en el mapa público.
    await sql(
      `update public.site_media
         set status = 'trashed', deleted_at = now()
       where logical_path = 'images/general/en-papelera.jpg'`,
    );
    // La bitácora arranca con un registro anterior (append-only).
    await sql(
      `insert into public.media_activity (action, media_path, actor_id, result, detail)
       values ('upload', 'images/equipo/equipo.jpg', '${ADMIN}', 'success',
               '{"carpeta":"images/equipo"}'::jsonb)`,
    );
  });
}, 180_000);

afterAll(async () => {
  await db?.close();
});

describe("1 · El administrador gestiona el inventario de medios", () => {
  it("ve los medios cargados y las carpetas iniciales", async () => {
    const { rows: medios } = await asUser(ADMIN, (sql) =>
      sql(`select logical_path, status from public.site_media order by logical_path`),
    );
    expect(medios).toHaveLength(4);
    expect(medios.map((m: any) => m.logical_path)).toContain("assets/casoratti-hero.jpg");

    const { rows: carpetas } = await asUser(ADMIN, (sql) =>
      sql(`select path from public.media_folders order by path`),
    );
    expect(carpetas.length).toBeGreaterThanOrEqual(7);
    expect(carpetas.map((c: any) => c.path)).toContain("images/equipo");
  });

  it("inserta, lee, actualiza y borra una imagen", async () => {
    await asUser(ADMIN, (sql) =>
      sql(
        `insert into public.site_media
           (logical_path, storage_path, source, original_name, mime_type, format, size_bytes, alt_text)
         values ('assets/prueba-admin.jpg', 'images/prueba-admin.jpg', 'upload',
                 'prueba-admin.jpg', 'image/jpeg', 'jpg', 1024, 'Texto alternativo')`,
      ),
    );

    const { rows } = await asUser(ADMIN, (sql) =>
      sql(`select alt_text, status from public.site_media where logical_path = 'assets/prueba-admin.jpg'`),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].alt_text).toBe("Texto alternativo");
    expect(rows[0].status).toBe("active");

    await asUser(ADMIN, (sql) =>
      sql(`update public.site_media set alt_text = 'Texto editado'
           where logical_path = 'assets/prueba-admin.jpg'`),
    );
    const { rows: editado } = await asUser(ADMIN, (sql) =>
      sql(`select alt_text from public.site_media where logical_path = 'assets/prueba-admin.jpg'`),
    );
    expect(editado[0].alt_text).toBe("Texto editado");

    await asUser(ADMIN, (sql) =>
      sql(`delete from public.site_media where logical_path = 'assets/prueba-admin.jpg'`),
    );
    const { rows: gone } = await asUser(ADMIN, (sql) =>
      sql(`select id from public.site_media where logical_path = 'assets/prueba-admin.jpg'`),
    );
    expect(gone).toHaveLength(0);
  });
});

describe("2 · Nadie más que el administrador entra al gestor", () => {
  for (const { label, sub } of NO_ADMIN) {
    it(`${label} no lee el inventario de medios`, async () => {
      const { rows } = await asUser(sub, (sql) => sql(`select logical_path from public.site_media`));
      expect(rows).toHaveLength(0);
    });

    it(`${label} no inserta imágenes`, async () => {
      await expect(
        asUser(sub, (sql) =>
          sql(
            `insert into public.site_media (logical_path, original_name, mime_type, format)
             values ('assets/intruso-${sub}.jpg', 'intruso.jpg', 'image/jpeg', 'jpg')`,
          ),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it(`${label} no modifica ni borra imágenes`, async () => {
      await asUser(sub, (sql) => sql(`update public.site_media set alt_text = 'hack'`));
      await asUser(sub, (sql) => sql(`delete from public.site_media`));
      const { rows } = await asService(async (sql) =>
        sql(`select count(*) as total from public.site_media where alt_text = 'hack'`),
      );
      expect(rows[0].total).toBe(0);
    });

    it(`${label} no lee las carpetas ni la bitácora`, async () => {
      const { rows: carpetas } = await asUser(sub, (sql) => sql(`select path from public.media_folders`));
      expect(carpetas).toHaveLength(0);
      const { rows: bitacora } = await asUser(sub, (sql) => sql(`select action from public.media_activity`));
      expect(bitacora).toHaveLength(0);
    });
  }
});

describe("3 · El visitante anónimo sólo usa el RPC público", () => {
  it("no puede leer site_media directamente", async () => {
    await expect(asAnon((sql) => sql(`select logical_path from public.site_media`))).rejects.toThrow(
      /permission denied/i,
    );
  });

  it("no puede leer media_folders ni media_activity", async () => {
    await expect(asAnon((sql) => sql(`select path from public.media_folders`))).rejects.toThrow(
      /permission denied/i,
    );
    await expect(asAnon((sql) => sql(`select action from public.media_activity`))).rejects.toThrow(
      /permission denied/i,
    );
  });

  it("no puede escribir en la bitácora con log_media_action", async () => {
    await expect(
      asAnon((sql) => sql(`select public.log_media_action('upload', null, 'success', '{}'::jsonb)`)),
    ).rejects.toThrow(/permission denied/i);
  });

  it("sí puede ejecutar resolve_media_overrides y recibe sólo los medios activos", async () => {
    const { rows } = await asAnon((sql) => sql(`select public.resolve_media_overrides() as mapa`));
    expect(rows).toHaveLength(1);
    // La imagen en papelera y la que no tiene ruta de Storage no aparecen.
    expect(rows[0].mapa).toEqual({
      "assets/casoratti-hero.jpg": "overrides/casoratti-hero.jpg",
      "images/equipo/equipo.jpg": "images/equipo/equipo.jpg",
    });
  });
});

describe("4 · La bitácora de medios es de sólo lectura", () => {
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
});

describe("5 · log_media_action registra el autor real y sanea el detalle", () => {
  it("graba el actor de la sesión y descarta las claves tipo credencial", async () => {
    const { rows } = await asUser(ADMIN, (sql) =>
      sql(
        `select public.log_media_action(
           'edit', 'images/equipo/equipo.jpg', 'success',
           jsonb_build_object(
             'password',        'clave-secreta',
             'new_password',    'otra-clave',
             'current_password','vieja-clave',
             'secret',          's3cr3t',
             'token',           'abc123',
             'api_key',         'key-123',
             'autor_falso',     '${LAWYER}',
             'carpeta',         'images/equipo')) as id`,
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBeTruthy();

    const { rows: registro } = await asService(async (sql) =>
      sql(`select actor_id, action, media_path, detail from public.media_activity where id = '${rows[0].id}'`),
    );
    expect(registro).toHaveLength(1);
    // El autor es el de la sesión: el cliente no puede escribirlo.
    expect(registro[0].actor_id).toBe(ADMIN);
    expect(registro[0].actor_id).not.toBe(LAWYER);
    expect(registro[0].action).toBe("edit");
    expect(registro[0].media_path).toBe("images/equipo/equipo.jpg");

    // Ninguna credencial queda registrada; el resto del detalle sí.
    expect(registro[0].detail.password).toBeUndefined();
    expect(registro[0].detail.new_password).toBeUndefined();
    expect(registro[0].detail.current_password).toBeUndefined();
    expect(registro[0].detail.secret).toBeUndefined();
    expect(registro[0].detail.token).toBeUndefined();
    expect(registro[0].detail.api_key).toBeUndefined();
    expect(registro[0].detail.carpeta).toBe("images/equipo");
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

describe("6 · Las carpetas validan su ruta en el servidor", () => {
  it("rechaza un path con .. (path traversal)", async () => {
    await expect(
      asUser(ADMIN, (sql) => sql(`insert into public.media_folders (path) values ('images/../etc')`)),
    ).rejects.toThrow(/media_folders_path_check|violates check constraint/i);
  });

  it("rechaza un path con caracteres no permitidos", async () => {
    await expect(
      asUser(ADMIN, (sql) => sql(`insert into public.media_folders (path) values ('imágenes/general')`)),
    ).rejects.toThrow(/media_folders_path_check|violates check constraint/i);
  });

  it("acepta una carpeta válida y el administrador puede borrarla", async () => {
    await asUser(ADMIN, (sql) =>
      sql(`insert into public.media_folders (path) values ('images/pruebas')`),
    );
    const { rows } = await asUser(ADMIN, (sql) =>
      sql(`select path from public.media_folders where path = 'images/pruebas'`),
    );
    expect(rows).toHaveLength(1);

    await asUser(ADMIN, (sql) =>
      sql(`delete from public.media_folders where path = 'images/pruebas'`),
    );
    const { rows: quedan } = await asUser(ADMIN, (sql) =>
      sql(`select path from public.media_folders where path = 'images/pruebas'`),
    );
    expect(quedan).toHaveLength(0);
  });
});

describe("7 · El bucket site-media sólo lo escribe un administrador", () => {
  it("el bucket existe con los límites del gestor", async () => {
    const { rows } = await asService(async (sql) =>
      sql(`select id, public, file_size_limit, allowed_mime_types
           from storage.buckets where id = 'site-media'`),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].public).toBe(true);
    expect(Number(rows[0].file_size_limit)).toBe(10485760);
    expect(rows[0].allowed_mime_types).toContain("image/webp");
  });

  it("el administrador sube y lista objetos del bucket", async () => {
    await asUser(ADMIN, (sql) =>
      sql(
        `insert into storage.objects (bucket_id, name, owner)
         values ('site-media', 'images/equipo/subida.webp', '${ADMIN}')`,
      ),
    );
    const { rows } = await asUser(ADMIN, (sql) =>
      sql(`select name from storage.objects where bucket_id = 'site-media' order by name`),
    );
    expect(rows.map((o: any) => o.name)).toContain("images/equipo/subida.webp");
  });

  it("un abogado no puede escribir en el bucket", async () => {
    await expect(
      asUser(LAWYER, (sql) =>
        sql(
          `insert into storage.objects (bucket_id, name, owner)
           values ('site-media', 'images/equipo/intruso.webp', '${LAWYER}')`,
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("sin sesión no se puede leer ni escribir el bucket desde la API", async () => {
    // En producción Supabase el `anon` tiene el privilegio pero no la policy
    // (0 filas); en el harness, además, falta el GRANT (42501). En los dos
    // casos el acceso sin sesión queda rechazado: la lectura pública del
    // bucket la resuelve la URL pública de Storage, no esta tabla.
    await expect(
      asAnon((sql) => sql(`select name from storage.objects where bucket_id = 'site-media'`)),
    ).rejects.toThrow(/permission denied|row-level security/i);
    await expect(
      asAnon((sql) =>
        sql(`insert into storage.objects (bucket_id, name) values ('site-media', 'images/equipo/anon.webp')`),
      ),
    ).rejects.toThrow(/permission denied|row-level security/i);
  });
});

describe("8 · RLS y policies del gestor", () => {
  it("las tres tablas tienen RLS habilitada", async () => {
    const { rows } = await asService(async (sql) =>
      sql(
        `select c.relname, c.relrowsecurity
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relname in ('site_media', 'media_folders', 'media_activity')
         order by c.relname`,
      ),
    );
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.relrowsecurity, `RLS ausente en ${row.relname}`).toBe(true);
    }
  });

  it("site_media y media_folders sólo admiten al administrador; media_activity es sólo lectura", async () => {
    const { rows } = await asService(async (sql) =>
      sql(
        `select p.polrelid::regclass::text as tabla, p.polcmd, p.polname,
                array(select rolname from pg_roles where oid = any(p.polroles)) as roles
         from pg_policy p
         where p.polrelid in ('public.site_media'::regclass,
                              'public.media_folders'::regclass,
                              'public.media_activity'::regclass)
         order by tabla, p.polcmd`,
      ),
    );

    const de = (tabla: string) => rows.filter((r: any) => r.tabla === tabla).map((r: any) => r.polcmd);
    // r = select, a = insert, w = update, d = delete
    expect(de("site_media").sort()).toEqual(["a", "d", "r", "w"]);
    expect(de("media_folders").sort()).toEqual(["a", "d", "r", "w"]);
    // Sin policy de insert/update/delete: la bitácora es append-only.
    expect(de("media_activity")).toEqual(["r"]);

    for (const row of rows) {
      expect(row.roles, `policy ${row.polname} abierta a otros roles`).toEqual(["authenticated"]);
    }
  });
});

describe("9 · La migración se puede reejecutar", () => {
  it("aplicarla dos veces deja el mismo estado (idempotencia)", async () => {
    const estado = async () => {
      const { rows } = await asService(async (sql) =>
        sql(
          `select (select count(1) from public.media_folders) as carpetas,
                  (select count(1) from pg_policy
                    where polrelid in ('public.site_media'::regclass,
                                      'public.media_folders'::regclass,
                                      'public.media_activity'::regclass)) as policies,
                  (select count(1) from storage.buckets where id = 'site-media') as bucket`,
        ),
      );
      return rows[0];
    };

    const antes = await estado();

    const migracion = readFileSync(join(MIGRATIONS_DIR, "20260115000400_media_admin.sql"), "utf8");
    await db.exec(migracion);
    await db.exec(migracion);

    const despues = await estado();
    expect(despues).toEqual(antes);
    // 4 policies por tabla de gestión + 1 de sólo lectura en la bitácora.
    expect(antes.policies).toBe(9);
    expect(antes.bucket).toBe(1);
  });
});
