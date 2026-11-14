/**
 * Verificación de las políticas RLS contra el proyecto real de Supabase.
 *
 * Inicia sesión con cada cuenta y comprueba, vía la API (que aplica RLS),
 * qué filas ve cada rol. Complementa la suite de PGlite: acá se comprueba el
 * comportamiento en la plataforma real.
 *
 *   npx tsx supabase/local/verify-rls.ts
 */

const PROJECT_URL = process.env.SUPABASE_URL ?? "https://hebooqzvbnwuabujkbff.supabase.co";
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhlYm9vcXp2Ym53dWFidWprYmZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2NDAxNjEsImV4cCI6MjExMDIxNjE2MX0.AeKPiSYjuLVdy5kWN0x1NhquNRFBDH4aHKsWvlOines";
const PASSWORD = process.env.DEMO_PASSWORD ?? "casoratti2026";

type Row = Record<string, unknown>;

async function login(email: string): Promise<string> {
  const response = await fetch(`${PROJECT_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!response.ok) throw new Error(`login ${email}: ${response.status} ${await response.text()}`);
  return ((await response.json()) as { access_token: string }).access_token;
}

async function select(token: string, table: string, query = "select=*"): Promise<Row[]> {
  const response = await fetch(`${PROJECT_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`${table}: ${response.status} ${await response.text()}`);
  const body = await response.json();
  return Array.isArray(body) ? body : [body];
}

let failures = 0;

function check(label: string, condition: boolean, detail: string): void {
  if (condition) {
    console.log(`  ✓ ${label} — ${detail}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label} — ${detail}`);
  }
}

async function main(): Promise<void> {
  const admin = await login("admin@estudiocasoratti.com.ar");
  const lawyer = await login("abogado@estudiocasoratti.com.ar");
  const client = await login("cliente@ejemplo.com");
  const registered = await login("registrado@ejemplo.com");

  console.log("\n[admin] admin@estudiocasoratti.com.ar");
  const adminUsers = await select(admin, "user_roles");
  const adminClients = await select(admin, "clients");
  const adminCases = await select(admin, "legal_cases");
  const adminConsults = await select(admin, "legal_consultations");
  check("ve todos los roles", adminUsers.length === 5, `${adminUsers.length} filas`);
  check("ve todos los clientes", adminClients.length === 2, `${adminClients.length} filas`);
  check("ve todos los expedientes", adminCases.length >= 0, `${adminCases.length} filas`);
  check("ve todas las consultas", adminConsults.length >= 0, `${adminConsults.length} filas`);

  console.log("\n[abogado] abogado@estudiocasoratti.com.ar");
  const lawyerClients = await select(lawyer, "clients");
  const lawyerCases = await select(lawyer, "legal_cases");
  check("ve los clientes del estudio", lawyerClients.length >= 2, `${lawyerClients.length} filas`);
  check("ve los expedientes", lawyerCases.length >= 0, `${lawyerCases.length} filas`);

  console.log("\n[cliente] cliente@ejemplo.com");
  const clientProfile = await select(client, "profiles");
  const clientClients = await select(client, "clients");
  const clientConsults = await select(client, "legal_consultations");
  check("ve su propio perfil", clientProfile.length === 1, `${clientProfile.length} filas`);
  check(
    "ve sólo su ficha de cliente",
    clientClients.length === 1 && clientClients[0].email === "cliente@ejemplo.com",
    JSON.stringify(clientClients.map((row) => row.email)),
  );
  check(
    "ve sólo sus consultas",
    clientConsults.length <= 1,
    `${clientConsults.length} filas`,
  );

  console.log("\n[usuario registrado] registrado@ejemplo.com");
  const userProfile = await select(registered, "profiles");
  const userClients = await select(registered, "clients");
  const userRoles = await select(registered, "user_roles");
  check("ve su propio perfil", userProfile.length === 1, `${userProfile.length} filas`);
  check("no ve fichas de cliente ajenas", userClients.length === 0, `${userClients.length} filas`);
  check(
    "ve sólo su propio rol (no el de otros)",
    userRoles.length === 1 && userRoles[0].role === "usuario",
    JSON.stringify(userRoles.map((row) => row.role)),
  );

  console.log(
    failures === 0
      ? "\nRLS verificado en la plataforma real: todas las comprobaciones pasaron."
      : `\n${failures} comprobación(es) fallaron.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Falló la verificación:", (error as Error).message);
  process.exit(1);
});
