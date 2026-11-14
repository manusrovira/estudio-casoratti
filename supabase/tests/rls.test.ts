/**
 * Pruebas de seguridad — Casoratti / Supabase.
 *
 * Cada prueba corresponde a un punto del apartado 15 del encargo
 * ("comprobar que ..."), sobre el sistema real.
 *
 * Todo corre contra las MIGRACIONES REALES aplicadas en un PostgreSQL 17
 * (PGlite). Las consultas se ejecutan con `set local role authenticated`,
 * exactamente igual que PostgREST, de modo que las políticas RLS son las que
 * deciden qué se ve. Un mock no probaría nada de esto.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asServiceRole, asSession, createAuthUser, createTestDatabase, setRole, type Sql } from "./harness";

let db: PGlite;

const ADMIN = "11111111-1111-4111-8111-111111111111";
const LAWYER = "22222222-2222-4222-8222-222222222222";
const CLIENT_A = "33333333-3333-4333-8333-333333333333";
const CLIENT_B = "44444444-4444-4444-8444-444444444444";
const OUTSIDER = "55555555-5555-4555-8555-555555555555";

const LAWYER_PROFILE = "22222222-2222-4222-8222-222222222222";
const CLIENT_A_PROFILE = "33333333-3333-4333-8333-333333333333";
const CLIENT_B_PROFILE = "44444444-4444-4444-8444-444444444444";

const CLIENT_A_ROW = "cccccccc-0000-4000-8000-000000000001";
const CLIENT_B_ROW = "cccccccc-0000-4000-8000-000000000002";
const LAWYER_ROW = "aaaaaaaa-0000-4000-8000-000000000001";

/** Ejecuta un bloque como el usuario indicado, con el rol de la request. */
const asUser = <T>(sub: string, fn: (sql: Sql) => Promise<T>) =>
  asSession(db, { sub, role: "authenticated" }, fn);

const asAnon = <T>(fn: (sql: Sql) => Promise<T>) =>
  asSession(db, { sub: null, role: "anon" }, fn);

const asService = <T>(fn: (sql: Sql) => Promise<T>) => asServiceRole(db, fn);

beforeAll(async () => {
  db = await createTestDatabase();

  // --- identidades (disparan el trigger handle_new_user) --------------------
  await createAuthUser(db, { id: ADMIN, email: "admin@estudiocasoratti.com.ar", fullName: "Administración" });
  await createAuthUser(db, { id: LAWYER, email: "abogado@estudiocasoratti.com.ar", fullName: "Abogado Responsable" });
  await createAuthUser(db, { id: CLIENT_A, email: "cliente.a@example.com", fullName: "Cliente A" });
  await createAuthUser(db, { id: CLIENT_B, email: "cliente.b@example.com", fullName: "Cliente B" });
  await createAuthUser(db, { id: OUTSIDER, email: "registrado@example.com", fullName: "Usuario Registrado" });

  // --- roles (asignados fuera del frontend, como exige el encargo) ---------
  await setRole(db, ADMIN, "admin");
  await setRole(db, LAWYER, "abogado");
  await setRole(db, CLIENT_A, "cliente");
  await setRole(db, CLIENT_B, "cliente");
  // OUTSIDER queda con el rol por defecto 'usuario' que crea el trigger.

  // --- datos de estudio ----------------------------------------------------
  await asService(async (sql) => {
    await sql(
      `insert into public.lawyers (id, profile_id, full_name, email, specialties)
       values ('${LAWYER_ROW}', '${LAWYER_PROFILE}',
               'Abogado Responsable', 'abogado@estudiocasoratti.com.ar', array['Derecho civil y comercial'])`,
    );
    await sql(
      `insert into public.clients (id, full_name, email, phone, user_id, assigned_lawyer_id)
       values
        ('${CLIENT_A_ROW}', 'Cliente A', 'cliente.a@example.com', '+543764000001',
         '${CLIENT_A_PROFILE}', '${LAWYER_ROW}'),
        ('${CLIENT_B_ROW}', 'Cliente B', 'cliente.b@example.com', '+543764000002',
         '${CLIENT_B_PROFILE}', '${LAWYER_ROW}')`,
    );
    await sql(
      `insert into public.legal_cases (id, case_number, title, client_id, assigned_lawyer_id, fuero)
       values
        ('dddddddd-0000-4000-8000-000000000001', 'EXP-2026-001', 'Contrato de arrendamiento',
         '${CLIENT_A_ROW}', '${LAWYER_ROW}', 'Civil y Comercial'),
        ('dddddddd-0000-4000-8000-000000000002', 'EXP-2026-002', 'Reclamo por daños',
         '${CLIENT_B_ROW}', '${LAWYER_ROW}', 'Civil y Comercial')`,
    );
    // Consulta pública: la inserta la Edge Function con service role.
    await sql(
      `insert into public.legal_consultations
         (reference_code, full_name, email, phone, category_id, subject, description)
       values ('CAS-26-00001', 'Visitante Web', 'visitante@example.com', '+549000000000',
               (select id from public.consultation_categories where slug = 'civil-y-comercial'),
               'Consulta sobre un contrato', 'Necesito orientación sobre un contrato de arrendamiento.')`,
    );
    await sql(
      `insert into public.consultation_notes (consultation_id, author_id, body)
       select id, '${ADMIN}', 'Nota interna: revisar plazos.' from public.legal_consultations
       where reference_code = 'CAS-26-00001'`,
    );
    await sql(
      `insert into public.consultation_messages (consultation_id, author_id, body)
       select id, '${ADMIN}', 'Respuesta visible para el cliente.' from public.legal_consultations
       where reference_code = 'CAS-26-00001'`,
    );
    // Objetos en el bucket privado; el folder es el client_id.
    await sql(
      `insert into storage.objects (bucket_id, name, owner)
       values
        ('client-documents', '${CLIENT_A_ROW}/contrato.pdf', '${CLIENT_A_PROFILE}'),
        ('client-documents', '${CLIENT_B_ROW}/acta.pdf', '${CLIENT_B_PROFILE}')`,
    );
  });
}, 180_000);

afterAll(async () => {
  await db?.close();
});

describe("1-3 · Identidad: alta de usuario y perfil en PostgreSQL", () => {
  it("1. el alta de un usuario crea su perfil y su rol por defecto en PostgreSQL", async () => {
    const { rows } = await asService(async (sql) =>
      sql(
        `select p.id, p.full_name, p.email, r.role
         from public.profiles p
         left join public.user_roles r on r.user_id = p.id
         where p.id = '${OUTSIDER}'`,
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].full_name).toBe("Usuario Registrado");
    expect(rows[0].role).toBe("usuario");
    // El email queda copiado en el perfil: es la única forma de mostrarlo
    // desde el navegador (auth.users no es consultable sin service role).
    expect(rows[0].email).toBe("registrado@example.com");
  });

  it("1b. el mismo camino de identidad sirve al alta con Google OAuth", async () => {
    const googleUser = "66666666-6666-4666-8666-666666666666";
    await createAuthUser(db, {
      id: googleUser,
      email: "gmail.user@example.com",
      fullName: "Usuario Google",
      provider: "google",
    });
    const { rows } = await asService(async (sql) =>
      sql(
        `select p.full_name, r.role, p.accepted_terms_at is not null as terms
         from public.profiles p join public.user_roles r on r.user_id = p.id
         where p.id = '${googleUser}'`,
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("usuario");
    expect(rows[0].terms).toBe(true);
  });

  it("3. el usuario autenticado puede leer su propio perfil", async () => {
    const { rows } = await asUser(OUTSIDER, (sql) =>
      sql(`select full_name from public.profiles where id = '${OUTSIDER}'`),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].full_name).toBe("Usuario Registrado");
  });

  it("3b. el usuario autenticado NO puede leer el perfil de otro usuario", async () => {
    const { rows } = await asUser(OUTSIDER, (sql) =>
      sql(`select id from public.profiles where id = '${ADMIN}'`),
    );
    expect(rows).toHaveLength(0);
  });
});

describe("4 · Un usuario normal no puede acceder al panel administrativo", () => {
  it("no ve los roles de los demás", async () => {
    const { rows } = await asUser(OUTSIDER, (sql) =>
      sql(`select user_id, role from public.user_roles`),
    );
    expect(rows).toHaveLength(1); // sólo el suyo
    expect(rows[0].user_id).toBe(OUTSIDER);
  });

  it("no ve consultas, clientes, expedientes, auditoría ni notificaciones ajenas", async () => {
    const { rows } = await asUser(OUTSIDER, (sql) =>
      sql(
        `select
           (select count(*) from public.legal_consultations) as consultas,
           (select count(*) from public.clients) as clientes,
           (select count(*) from public.legal_cases) as expedientes,
           (select count(*) from public.audit_logs) as auditoria,
           (select count(*) from public.notifications) as notificaciones`,
      ),
    );
    expect(rows[0]).toMatchObject({
      consultas: 0,
      clientes: 0,
      expedientes: 0,
      auditoria: 0,
      notificaciones: 0,
    });
  });
});

describe("5 · Un cliente no puede consultar información de otro cliente", () => {
  it("cada cliente ve sólo su propia ficha", async () => {
    const { rows } = await asUser(CLIENT_A, (sql) =>
      sql(`select full_name, email from public.clients`),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("cliente.a@example.com");
  });

  it("el cliente B tampoco ve la ficha del cliente A", async () => {
    const { rows } = await asUser(CLIENT_B, (sql) =>
      sql(`select full_name from public.clients`),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].full_name).toBe("Cliente B");
  });

  it("el cliente no ve los expedientes del otro cliente", async () => {
    const { rows } = await asUser(CLIENT_A, (sql) =>
      sql(`select case_number, title from public.legal_cases`),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].case_number).toBe("EXP-2026-001");
  });
});

describe("6-7 · Las consultas se guardan y sólo aparecen en el módulo administrativo", () => {
  it("6. la consulta enviada desde el sitio queda guardada en PostgreSQL", async () => {
    const { rows } = await asService(async (sql) =>
      sql(
        `select reference_code, full_name, email, subject, status, is_new
         from public.legal_consultations where reference_code = 'CAS-26-00001'`,
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("nueva");
    expect(rows[0].is_new).toBe(true);
  });

  it("7a. un visitante anónimo no ve ninguna consulta", async () => {
    const { rows } = await asAnon((sql) => sql(`select * from public.legal_consultations`));
    expect(rows).toHaveLength(0);
  });

  it("7b. un usuario registrado tampoco las ve", async () => {
    const { rows } = await asUser(OUTSIDER, (sql) =>
      sql(`select * from public.legal_consultations`),
    );
    expect(rows).toHaveLength(0);
  });

  it("7c. el administrador sí las ve y las gestiona (cambio de estado)", async () => {
    const { rows } = await asUser(ADMIN, (sql) =>
      sql(`select reference_code, status, is_new from public.legal_consultations`),
    );
    expect(rows).toHaveLength(1);

    await asUser(ADMIN, (sql) =>
      sql(
        `update public.legal_consultations
         set status = 'en_analisis', is_new = false
         where reference_code = 'CAS-26-00001'`,
      ),
    );

    const { rows: after } = await asService(async (sql) =>
      sql(`select status, is_new from public.legal_consultations where reference_code = 'CAS-26-00001'`),
    );
    expect(after[0].status).toBe("en_analisis");
    expect(after[0].is_new).toBe(false);
  });

  it("7d. antes de vincular la consulta a un cliente, el cliente no la ve", async () => {
    const { rows } = await asUser(CLIENT_A, (sql) =>
      sql(`select reference_code from public.legal_consultations`),
    );
    expect(rows).toHaveLength(0);
  });
});

describe("8 · Los administradores pueden gestionar clientes y expedientes", () => {
  it("el administrador ve todos los clientes y puede editarlos", async () => {
    const { rows } = await asUser(ADMIN, (sql) => sql(`select full_name from public.clients`));
    expect(rows).toHaveLength(2);

    await asUser(ADMIN, (sql) =>
      sql(`update public.clients set internal_notes = 'VIP' where full_name = 'Cliente A'`),
    );

    const { rows: after } = await asService(async (sql) =>
      sql(`select internal_notes from public.clients where full_name = 'Cliente A'`),
    );
    expect(after[0].internal_notes).toBe("VIP");
  });

  it("un cliente NO puede editar su propia ficha de cliente", async () => {
    // RLS filtra la fila en el UPDATE: la operación afecta 0 filas y el dato
    // queda intacto (no es un error, es una escritura que no ocurre).
    await asUser(CLIENT_A, (sql) =>
      sql(`update public.clients set internal_notes = 'hack' where full_name = 'Cliente A'`),
    );
    const { rows } = await asService(async (sql) =>
      sql(`select internal_notes from public.clients where full_name = 'Cliente A'`),
    );
    expect(rows[0].internal_notes).toBe("VIP");
  });
});

describe("9 · Las notas internas no son visibles para el cliente", () => {
  it("el cliente no lee notas internas", async () => {
    const { rows } = await asUser(CLIENT_A, (sql) =>
      sql(`select body from public.consultation_notes`),
    );
    expect(rows).toHaveLength(0);
  });

  it("el cliente no puede escribir notas internas", async () => {
    const { rows: antes } = await asService(async (sql) =>
      sql(`select count(*) as total from public.consultation_notes`),
    );
    // El INSERT ... SELECT no ve consultas ajenas: 0 filas, 0 notas nuevas.
    await asUser(CLIENT_A, (sql) =>
      sql(
        `insert into public.consultation_notes (consultation_id, author_id, body)
         select id, '${CLIENT_A}', 'nota' from public.legal_consultations limit 1`,
      ),
    );
    const { rows: despues } = await asService(async (sql) =>
      sql(`select count(*) as total from public.consultation_notes`),
    );
    expect(despues[0].total).toBe(antes[0].total);
  });

  it("el administrador sí lee las notas internas", async () => {
    const { rows } = await asUser(ADMIN, (sql) =>
      sql(`select body from public.consultation_notes`),
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it("el cliente sí lee los mensajes de su consulta (no son notas internas)", async () => {
    await asService(async (sql) =>
      sql(
        `update public.legal_consultations
         set client_id = '${CLIENT_A_ROW}'
         where reference_code = 'CAS-26-00001'`,
      ),
    );
    const { rows } = await asUser(CLIENT_A, (sql) =>
      sql(`select body from public.consultation_messages`),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toContain("visible para el cliente");
  });
});

describe("10 · Los documentos privados no se descargan sin autorización", () => {
  it("el dueño del bucket de un cliente descarga sus documentos", async () => {
    const { rows } = await asUser(CLIENT_A, (sql) =>
      sql(`select name from storage.objects where bucket_id = 'client-documents'`),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toContain("contrato.pdf");
  });

  it("otro cliente no descarga los documentos ajenos", async () => {
    const { rows } = await asUser(CLIENT_B, (sql) =>
      sql(`select name from storage.objects where bucket_id = 'client-documents'`),
    );
    // Sólo el suyo: el del cliente A queda oculto.
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toContain("acta.pdf");
  });

  it("un usuario sin ficha no descarga nada", async () => {
    const { rows } = await asUser(OUTSIDER, (sql) => sql(`select name from storage.objects`));
    expect(rows).toHaveLength(0);
  });

  it("el abogado ve los documentos de los clientes que tiene asignados", async () => {
    const { rows } = await asUser(LAWYER, (sql) =>
      sql(`select name from storage.objects where bucket_id = 'client-documents'`),
    );
    expect(rows).toHaveLength(2);
  });
});

describe("11 · Ningún usuario puede asignarse privilegios administrativos", () => {
  it("un usuario normal no puede insertarse un rol admin", async () => {
    await expect(
      asUser(OUTSIDER, (sql) =>
        sql(`insert into public.user_roles (user_id, role) values ('${OUTSIDER}', 'admin')`),
      ),
    ).rejects.toThrow(/row-level security|violates/i);
  });

  it("un usuario normal no puede ascenderse a admin sobre su propia fila", async () => {
    await asUser(OUTSIDER, (sql) =>
      sql(`update public.user_roles set role = 'admin' where user_id = '${OUTSIDER}'`),
    );
    const { rows } = await asService(async (sql) =>
      sql(`select role from public.user_roles where user_id = '${OUTSIDER}'`),
    );
    expect(rows[0].role).toBe("usuario");
  });

  it("un cliente no puede escribir sobre los roles ajenos", async () => {
    await asUser(CLIENT_A, (sql) =>
      sql(`update public.user_roles set role = 'usuario' where user_id = '${ADMIN}'`),
    );
    const { rows } = await asService(async (sql) =>
      sql(`select role from public.user_roles where user_id = '${ADMIN}'`),
    );
    expect(rows[0].role).toBe("admin");
  });

  it("un cliente no puede cambiar su propio rol a admin", async () => {
    await asUser(CLIENT_A, (sql) =>
      sql(`update public.user_roles set role = 'admin' where user_id = '${CLIENT_A}'`),
    );
    const { rows } = await asService(async (sql) =>
      sql(`select role from public.user_roles where user_id = '${CLIENT_A}'`),
    );
    expect(rows[0].role).toBe("cliente");
  });

  it("el administrador sí puede asignar roles (procedimiento autorizado)", async () => {
    await asUser(ADMIN, (sql) =>
      sql(`update public.user_roles set role = 'abogado' where user_id = '${OUTSIDER}'`),
    );
    const { rows } = await asService(async (sql) =>
      sql(`select role from public.user_roles where user_id = '${OUTSIDER}'`),
    );
    expect(rows[0].role).toBe("abogado");
  });
});

describe("12 · Las políticas RLS funcionan ante solicitudes directas a la API", () => {
  it("todas las tablas del dominio tienen RLS habilitada", async () => {
    const { rows } = await asService(async (sql) =>
      sql(
        `select c.relname, c.relrowsecurity
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'rate_limits'
         order by c.relname`,
      ),
    );
    expect(rows.length).toBeGreaterThanOrEqual(12);
    for (const row of rows) {
      expect(row.relrowsecurity, `RLS ausente en ${row.relname}`).toBe(true);
    }
  });

  it("cada sesión corre como rol no privilegiado (no hay bypass de RLS)", async () => {
    const { rows } = await asUser(CLIENT_A, (sql) =>
      sql(`select current_user as user`),
    );
    expect(rows[0].user).toBe("authenticated");
  });

  it("las consultas anónimas sólo alcanzan las áreas públicas configurables", async () => {
    const { rows } = await asAnon((sql) =>
      sql(`select name, slug from public.consultation_categories order by sort_order`),
    );
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(rows.map((r: any) => r.slug)).toContain("civil-y-comercial");
  });

  it("un cliente no lee los metadatos de documentos de otro cliente", async () => {
    const { rows } = await asUser(CLIENT_B, (sql) =>
      sql(`select file_name from public.client_documents`),
    );
    expect(rows).toHaveLength(0);
  });

  it("la auditoría registra las operaciones administrativas y es de sólo lectura", async () => {
    const { rows } = await asUser(ADMIN, (sql) =>
      sql(`select action, entity_type from public.audit_logs order by created_at desc limit 5`),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r: any) => r.entity_type)).toContain("clients");

    const { rows: antes } = await asUser(ADMIN, (sql) =>
      sql(`select count(*) as total from public.audit_logs`),
    );
    // Sin policy de DELETE la fila se filtra: el historial no se puede reescribir.
    await asUser(ADMIN, (sql) => sql(`delete from public.audit_logs`));
    const { rows: despues } = await asUser(ADMIN, (sql) =>
      sql(`select count(*) as total from public.audit_logs`),
    );
    expect(despues[0].total).toBe(antes[0].total);
  });
});
