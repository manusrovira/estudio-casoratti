/**
 * Provisionamiento de las cuentas del estudio en el proyecto real de Supabase.
 *
 * Inserta los usuarios en `auth.users` con el mismo formato que usa GoTrue
 * (bcrypt + `raw_app_meta_data` con el provider) y asigna los roles en
 * `public.user_roles` desde este entorno protegido: el frontend nunca puede
 * auto-asignarse un rol.
 *
 *   DB_PASSWORD=... npx tsx supabase/local/provision.ts
 *
 * Es una operación de una sola vez para el alta inicial de las cuentas.
 */

import { Client } from "pg";
import bcrypt from "bcryptjs";

const PROJECT_REF = "hebooqzvbnwuabujkbff";
const PASSWORD = process.env.DEMO_PASSWORD ?? "casoratti2026";

const ACCOUNTS = [
  { email: "admin@estudiocasoratti.com.ar", fullName: "Dirección del estudio", role: "admin" },
  { email: "abogado@estudiocasoratti.com.ar", fullName: "Dr. Julián Casoratti", role: "abogado" },
  { email: "cliente@ejemplo.com", fullName: "Ana Gómez", role: "cliente" },
  { email: "carlos@ejemplo.com", fullName: "Carlos Duarte", role: "cliente" },
  { email: "registrado@ejemplo.com", fullName: "Laura Benítez", role: "usuario" },
] as const;

const CLIENTS = [
  { email: "cliente@ejemplo.com", name: "Ana Gómez", doc: "28945678", phone: "+543764110001", address: "Av. San Martín 1420, Posadas" },
  { email: "carlos@ejemplo.com", name: "Carlos Duarte", doc: "32456789", phone: "+543764110002", address: "Av. Brasil 890, Posadas" },
];

async function main(): Promise<void> {
  const client = new Client({
    connectionString: `postgresql://postgres:${encodeURIComponent(
      process.env.DB_PASSWORD ?? "",
    )}@db.${PROJECT_REF}.supabase.co:5432/postgres`,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  // bcrypt con coste 10: el mismo que usa GoTrue por defecto.
  const encryptedPassword = bcrypt.hashSync(PASSWORD, 10);
  const ids: string[] = [];

  for (const account of ACCOUNTS) {
    const { rows: existing } = await client.query<{ id: string }>(
      `select id from auth.users where email = $1 limit 1`,
      [account.email],
    );

    if (existing.length > 0) {
      ids.push(existing[0].id);
      // Se actualiza la contraseña para que el acceso sea siempre el esperado.
      await client.query(
        `update auth.users
            set encrypted_password = $2,
                email_confirmed_at = coalesce(email_confirmed_at, now()),
                updated_at = now()
          where id = $1::uuid`,
        [existing[0].id, encryptedPassword],
      );
      console.log(`· ya existía ${account.email} (${existing[0].id}) — contraseña actualizada`);
      continue;
    }

    const { rows: inserted } = await client.query<{ id: string }>(
      `insert into auth.users (
         instance_id, id, aud, role, email, encrypted_password,
         email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
         created_at, updated_at, confirmation_token, email_change,
         email_change_token_new, recovery_token
       )
       values (
         '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
         $1, $2, now(),
         '{"provider":"email","providers":["email"]}'::jsonb,
         $3::jsonb, now(), now(), '', '', '', ''
       )
       returning id`,
      [
        account.email,
        encryptedPassword,
        JSON.stringify({
          full_name: account.fullName,
          name: account.fullName,
          accepted_terms: "true",
          provider: "email",
        }),
      ],
    );
    ids.push(inserted[0].id);
    console.log(`✓ creado ${account.email} (${inserted[0].id})`);
  }

  const adminId = ids[0];

  for (const [index, account] of ACCOUNTS.entries()) {
    await client.query(
      `insert into public.user_roles (user_id, role, granted_by)
       values ($1::uuid, $2::public.app_role, $3::uuid)
       on conflict (user_id) do update set role = excluded.role, granted_by = excluded.granted_by`,
      [ids[index], account.role, adminId],
    );
    console.log(`· rol ${account.role} → ${account.email}`);
  }

  // El abogado del estudio, con su ficha profesional.
  await client.query(
    `insert into public.lawyers (profile_id, full_name, email, license_number, specialties, bio)
     values ($1::uuid, $2, $3, $4, $5, $6)
     on conflict (profile_id) do update
       set full_name = excluded.full_name, email = excluded.email, license_number = excluded.license_number`,
    [
      ids[1],
      "Dr. Julián Casoratti",
      "abogado@estudiocasoratti.com.ar",
      "MP-4451",
      ["Derecho civil y comercial", "Derecho de familia", "Mediación"],
      "Más de quince años de ejercicio en Posadas, con foco en derecho civil y familia.",
    ],
  );

  const { rows: lawyer } = await client.query<{ id: string }>(
    `select id from public.lawyers where profile_id = $1::uuid limit 1`,
    [ids[1]],
  );

  for (const [index, clientAccount] of CLIENTS.entries()) {
    // `clients.user_id` es la clave única de negocio (el email no lo es).
    await client.query(
      `insert into public.clients (full_name, document_id, email, phone, address, status, assigned_lawyer_id, user_id)
       values ($1, $2, $3, $4, $5, 'activo', $6::uuid, $7::uuid)
       on conflict (user_id) do update
         set full_name = excluded.full_name,
             document_id = excluded.document_id,
             email = excluded.email,
             phone = excluded.phone,
             address = excluded.address,
             assigned_lawyer_id = excluded.assigned_lawyer_id`,
      [
        clientAccount.name,
        clientAccount.doc,
        clientAccount.email,
        clientAccount.phone,
        clientAccount.address,
        lawyer[0]?.id ?? null,
        ids[index + 2],
      ],
    );
  }
  console.log("· fichas de clientes cargadas");

  const { rows: summary } = await client.query(`
    select
      (select count(*)::int from auth.users) as usuarios,
      (select count(*)::int from public.profiles) as perfiles,
      (select count(*)::int from public.user_roles) as roles,
      (select count(*)::int from public.clients) as clientes,
      (select count(*)::int from public.lawyers) as abogados,
      (select count(*)::int from public.consultation_categories) as categorias
  `);

  console.log("\nResumen:", summary[0]);
  await client.end();
}

main().catch((error) => {
  console.error("Falló el provisionamiento:", (error as Error).message);
  process.exit(1);
});
