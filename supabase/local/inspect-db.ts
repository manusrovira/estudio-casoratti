import { Client } from "pg";

const client = new Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(
    process.env.DB_PASSWORD ?? "",
  )}@db.hebooqzvbnwuabujkbff.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

async function show(label: string, sql: string): Promise<void> {
  const { rows } = await client.query(sql);
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(rows, null, 2));
}

await show("auth.users columnas", `select column_name, data_type, is_nullable, column_default
  from information_schema.columns where table_schema='auth' and table_name='users' order by ordinal_position`);

await show("auth.identities columnas", `select column_name, data_type, is_nullable, column_default
  from information_schema.columns where table_schema='auth' and table_name='identities' order by ordinal_position`);

await show("tablas public", `select table_name from information_schema.tables where table_schema='public' order by table_name`);

await show("triggers sobre auth.users", `select tgname, pg_get_triggerdef(oid) as def
  from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal`);

await show("config auth", `select * from auth.config`);

await show("funciones current_role", `select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('current_role','is_admin','is_staff','is_client','next_reference_code')`);

await client.end();
