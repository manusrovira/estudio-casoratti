/**
 * Datos de demostración del entorno local.
 *
 * Crea cuentas con las que iniciar sesión (un administrador y varias normales)
 * y datos de estudio para que el panel no arranque vacío. Es material de
 * PRUEBA, exclusivo del entorno local: en Supabase real la base arranca vacía
 * y las cuentas las crea el estudio.
 */

import { asServiceRole } from "./db";
import { hashPassword } from "./auth";

export const DEMO_PASSWORD = "casoratti2026";

export const DEMO_ACCOUNTS = [
  {
    role: "admin",
    email: "admin@estudiocasoratti.com.ar",
    fullName: "Dirección del estudio",
    label: "Administrador",
  },
  {
    role: "abogado",
    email: "abogado@estudiocasoratti.com.ar",
    fullName: "Dr. Julián Casoratti",
    label: "Abogado",
  },
  {
    role: "cliente",
    email: "cliente@ejemplo.com",
    fullName: "Ana Gómez",
    label: "Cliente",
  },
  {
    role: "cliente",
    email: "carlos@ejemplo.com",
    fullName: "Carlos Duarte",
    label: "Cliente",
  },
  {
    role: "usuario",
    email: "registrado@ejemplo.com",
    fullName: "Laura Benítez",
    label: "Usuario registrado",
  },
] as const;

/** UUIDs fijos para que los datos sean reproducibles entre corridas. */
const IDS = {
  admin: "11111111-1111-4111-8111-111111111111",
  lawyer: "22222222-2222-4222-8222-222222222222",
  lawyerProfile: "22222222-2222-4222-8222-222222222222",
  clientA: "33333333-3333-4333-8333-333333333333",
  clientB: "44444444-4444-4444-8444-444444444444",
  user: "55555555-5555-4555-8555-555555555555",
  lawyerRow: "aaaaaaaa-0000-4000-8000-000000000001",
  clientRowA: "cccccccc-0000-4000-8000-000000000001",
  clientRowB: "cccccccc-0000-4000-8000-000000000002",
  caseA: "dddddddd-0000-4000-8000-000000000001",
  caseB: "dddddddd-0000-4000-8000-000000000002",
};

export async function seedLocalDatabase(): Promise<void> {
  await asServiceRole(async (sql) => {
    const { rows } = await sql("select count(*)::int as total from auth.users");
    if (Number(rows[0]?.total ?? 0) > 0) return; // ya sembrado

    const passwordHash = hashPassword(DEMO_PASSWORD);
    const accounts = [
      { id: IDS.admin, email: DEMO_ACCOUNTS[0].email, name: DEMO_ACCOUNTS[0].fullName },
      { id: IDS.lawyer, email: DEMO_ACCOUNTS[1].email, name: DEMO_ACCOUNTS[1].fullName },
      { id: IDS.clientA, email: DEMO_ACCOUNTS[2].email, name: DEMO_ACCOUNTS[2].fullName },
      { id: IDS.clientB, email: DEMO_ACCOUNTS[3].email, name: DEMO_ACCOUNTS[3].fullName },
      { id: IDS.user, email: DEMO_ACCOUNTS[4].email, name: DEMO_ACCOUNTS[4].fullName },
    ];

    for (const account of accounts) {
      const meta = JSON.stringify({
        full_name: account.name,
        name: account.name,
        accepted_terms: "true",
        provider: "email",
      });
      await sql(
        `insert into auth.users (id, email, raw_user_meta_data, password_hash)
         values ($1::uuid, $2, $3::jsonb, $4)`,
        [account.id, account.email, meta, passwordHash],
      );
    }

    // Roles (los asigna un administrador, no el propio usuario).
    const roles = [
      [IDS.admin, "admin"],
      [IDS.lawyer, "abogado"],
      [IDS.clientA, "cliente"],
      [IDS.clientB, "cliente"],
      [IDS.user, "usuario"],
    ];
    for (const [userId, role] of roles) {
      await sql(
        `update public.user_roles set role = $2, granted_by = $3 where user_id = $1::uuid`,
        [userId, role, IDS.admin],
      );
    }

    // Equipo y clientes.
    await sql(
      `insert into public.lawyers (id, profile_id, full_name, email, license_number, specialties, bio)
       values ($1::uuid, $2::uuid, 'Dr. Julián Casoratti', 'abogado@estudiocasoratti.com.ar',
               'MP-4451', array['Derecho civil y comercial','Derecho de familia','Mediación'],
               'Más de quince años de ejercicio en Posadas, con foco en derecho civil y familia.')`,
      [IDS.lawyerRow, IDS.lawyerProfile],
    );

    await sql(
      `insert into public.clients (id, full_name, document_id, email, phone, address, status, assigned_lawyer_id, user_id, internal_notes)
       values
        ($1::uuid, 'Ana Gómez', '28945678', 'cliente@ejemplo.com', '+543764110001', 'Av. San Martín 1420, Posadas', 'activo', $3::uuid, $4::uuid, 'Prefiere ser contactada por la mañana.'),
        ($2::uuid, 'Carlos Duarte', '32456789', 'carlos@ejemplo.com', '+543764110002', 'Av. Brasil 890, Posadas', 'activo', $3::uuid, $5::uuid, NULL)`,
      [IDS.clientRowA, IDS.clientRowB, IDS.lawyerRow, IDS.clientA, IDS.clientB],
    );

    // Expedientes.
    await sql(
      `insert into public.legal_cases (id, case_number, title, client_id, assigned_lawyer_id, fuero, jurisdiction, court, status, description, started_at)
       values
        ($1::uuid, 'EXP-2026-001', 'Desahucio por falta de pago', $3::uuid, $4::uuid,
         'Civil y Comercial', 'Posadas, Misiones', 'Juzgado Civil y Comercial N° 3', 'en_tramitacion',
         'Desahucio por renta impaga. Se trabaja con el contrato de locación y las comprobaciones.', current_date - 45),
        ($2::uuid, 'EXP-2026-002', 'División de bienes en común', $5::uuid, $4::uuid,
         'Familia', 'Posadas, Misiones', 'Juzgado de Familia N° 1', 'inicial',
         'Liquidación de un bien inmueble en común. Faltan tasaciones.', current_date - 12)`,
      [IDS.caseA, IDS.caseB, IDS.clientRowA, IDS.lawyerRow, IDS.clientRowB],
    );

    // Consultas recibidas.
    const consultations = [
      [
        "Consulto por un contrato de arrendamiento que no quiero firmar",
        "cliente@ejemplo.com",
        "Ana Gómez",
        "Necesito que revisen las cláusulas de un contrato de alquiler antes de firmarlo.",
        "nueva",
        true,
        null,
      ],
      [
        "Descuento de horas no laboradas",
        "carlos@ejemplo.com",
        "Carlos Duarte",
        "Mi empleador no me abonó las horas extra del mes pasado. ¿Qué puedo hacer?",
        "pendiente",
        false,
        "cliente",
      ],
      [
        "Consulta sobre sucesión de padres",
        "visitante@ejemplo.com",
        "Visitante Web",
        "Mis padres fallecieron y necesito información sobre el proceso sucesorio.",
        "en_analisis",
        false,
        null,
      ],
      [
        "Reclamo por daños en el vehículo",
        "reclamo@ejemplo.com",
        "Reclamante",
        "Tengo un seguro de auto y me hacen esperar dos meses por un SIN.",
        "respondida",
        false,
        "cliente",
      ],
      [
        "Consulta sobre contrato de servicios",
        "empresa@ejemplo.com",
        "Responsable de empresa",
        "Somos una pyme y queremos revisar el contrato con un proveedor.",
        "cerrada",
        false,
        null,
      ],
    ];

    for (const [subject, email, fullName, description, status, isNew, clientKey] of consultations) {
      const clientId =
        clientKey === "cliente"
          ? IDS.clientRowA
          : clientKey === "clienteB"
            ? IDS.clientRowB
            : null;
      await sql(
        `insert into public.legal_consultations
           (reference_code, full_name, email, phone, category_id, subject, description, status, is_new, client_id, received_at)
         values (
           public.next_reference_code(), $1, $2, '+549000000000',
           (select id from public.consultation_categories where slug = 'civil-y-comercial'),
           $3, $4, $5::public.consultation_status, $6, $7::uuid, now() - (random() * interval '20 days')
         )`,
        [fullName, email, subject, description, status, isNew, clientId],
      );
    }

    // Notas internas (nunca visibles para el cliente).
    await sql(
      `insert into public.consultation_notes (consultation_id, author_id, body)
       select id, $1::uuid, 'Verificar plazos de prescripción antes de responder.' from public.legal_consultations order by received_at limit 2`,
      [IDS.admin],
    );

    // Mensajes con el cliente.
    await sql(
      `insert into public.consultation_messages (consultation_id, author_id, body)
       select id, $1::uuid, 'Gracias por escribirnos. Estamos revisando tu consulta y te respondemos a la brevedad.' from public.legal_consultations order by received_at limit 2`,
      [IDS.admin],
    );

    // Documentos privados.
    await sql(
      `insert into public.client_documents (id, client_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
       values
        ('eeeeeeee-0000-4000-8000-000000000001', $1::uuid, $1::uuid || '/contrato-alquiler.pdf', 'contrato-alquiler.pdf', 'application/pdf', 284913, $2::uuid)`,
      [IDS.clientRowA, IDS.admin],
    );

    // Un objeto real en storage, para que la descarga firmada tenga contenido.
    await sql(
      `insert into storage.objects (bucket_id, name, owner)
       values ('client-documents', $1::uuid || '/contrato-alquiler.pdf', $2::uuid)`,
      [IDS.clientRowA, IDS.clientA],
    );
  });
}
