# Guía de instalación — Estudio Jurídico Casoratti

Todo lo que hay que hacer en Supabase para que la plataforma funcione, en orden.
Al final vas a tener: base de datos con RLS, autenticación (Google + email),
buckets privados, Edge Function publicada y las variables de entorno del sitio.

---

## 1. Crear el proyecto

1. Entrá a <https://supabase.com/dashboard> y creá un proyecto (Free o Pro).
2. Anotá la **Project URL** (`https://XXXX.supabase.co`) y la **service role key**
   (Settings → API → Secret keys → `sb_secret_...`).

> La **service role key nunca va en el frontend**. Sólo se usa en la CLI y en las
> Edge Functions. Si alguna vez se filtra, rotala en el panel.

## 2. Aplicar las migraciones

Las migraciones viven en `supabase/migrations/` y están escritas en SQL puro.

### Opción A — desde el panel (sin instalar nada)
1. Abrí **SQL Editor → New query**.
2. Pegá el contenido de cada archivo, **en orden**:

```
20260114000100_schema.sql
20260114000200_functions_triggers.sql
20260114000300_rls.sql
20260114000400_storage.sql
20260114000500_seed.sql
20260114000600_rate_limit.sql
```

3. Ejecutá cada uno. Deben terminar sin errores.

### Opción B — con la CLI (recomendado, deja historial)
```bash
npm install -g supabase
supabase login
supabase link --project-ref TU_PROJECT_REF
supabase db push          # aplica las migraciones versionadas
supabase functions deploy submit-consultation --no-verify-jwt
```

### Verificación rápida
```sql
-- Todas las tablas del dominio deben tener RLS activa
select relname, relrowsecurity from pg_class
join pg_namespace on pg_namespace.oid = pg_class.relnamespace
where nspname = 'public' and relkind = 'r' order by relname;

-- Con la sesión de un usuario normal, esto debe devolver 0 filas
set role authenticated;
select count(*) from public.legal_consultations;
```

## 3. Autenticación

### 3.1 Correo y contraseña
**Authentication → Providers → Email**: activá el provider.
- `Enable email signup` = ON
- `Confirm email` = ON (recomendado: exige verificación de correo)
- `Secure password change` = ON

### 3.2 Google OAuth
1. En <https://console.cloud.google.com> creá un proyecto y activá **Google+ / Google Identity Services**.
2. Configurá el cliente OAuth:
   - **Application type**: Web application
   - **Authorized redirect URI**: `https://TU-PROYECTO.supabase.co/auth/v1/callback`
   - **Authorized JavaScript origin**: `https://TU-PROYECTO.supabase.co`
3. Copiá el **Client ID** y el **Client Secret**.
4. En Supabase: **Authentication → Providers → Google** → activá y pegá ambas claves.
5. En **Authentication → URL Configuration**:
   - **Site URL**: la URL donde vive el sitio (en desarrollo: `http://localhost:3000`)
   - **Redirect URLs**: agregá
     - `http://localhost:3000/mi-cuenta`
     - `http://localhost:3000/ingresar`
     - y la URL de producción, p. ej. `https://tu-sitio/mi-cuenta`

> El trigger `handle_new_user` crea el perfil en `public.profiles` y asigna el rol
> `usuario` en el momento del alta, tanto si viene de Google como de email.

## 4. Storage

Las migraciones ya crean los buckets privados (`client-documents` y
`case-documents`) con sus políticas. Si preferís crearlos a mano:

1. **Storage → Buckets → New bucket** → `client-documents`, **Public = OFF**.
2. Repetir con `case-documents`.
3. Límite de tamaño: 25 MB por archivo.

Convención de paths (obligatoria, las policies dependen de ella):
```
client-documents/{client_id}/{archivo}
case-documents/{case_id}/{archivo}
```

Las descargas se hacen con **URLs firmadas de 60 segundos**, nunca con enlaces
públicos.

## 5. Edge Function

```bash
supabase functions deploy submit-consultation --no-verify-jwt
```

O desde el panel: **Edge Functions → Deploy** / subir `supabase/functions/submit-consultation/index.ts`.

Variables de entorno de la función (Settings → Edge Functions → Secrets):
- `SUPABASE_URL` — lo inyecta Supabase automáticamente
- `SUPABASE_SERVICE_ROLE_KEY` — lo inyecta Supabase automáticamente
- `SITE_ORIGIN` — la URL del sitio, para el CORS (ej. `https://tu-sitio`)
- `RATE_LIMIT_SALT` — string aleatorio largo (ancla del hash de IP)

## 6. Variables de entorno del sitio

Copiá `.env.example` a `.env` y completá:

```
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=...
```

La clave pública es la **anon key** o la **publishable key** (`sb_publishable_...`),
nunca la `service_role`.

## 7. Crear el primer administrador

El rol `admin` **no se puede auto-asignar** (es una de las políticas RLS). Se
otorga desde un entorno protegido. Ejecutá en **SQL Editor** con tu usuario real:

```sql
-- 1. Registrate primero en el sitio con Google o con email.
-- 2. Copiá el UUID de tu usuario (Authentication → Users) y reemplazá abajo:
update public.user_roles
set role = 'admin', granted_by = auth.uid()
where user_id = 'UUID-DE-TU-USUARIO';
```

Verificación:
```sql
select p.full_name, r.role
from public.profiles p join public.user_roles r on r.user_id = p.id;
```

## 8. Correr la suite de pruebas

```bash
npm test
```

La suite ejecuta las migraciones reales sobre un PostgreSQL embebido (PGlite) y
verifica las políticas RLS de verdad: aislamiento entre clientes, notas internas
invisibles para el cliente, documentos privados, imposibilidad de auto-asignarse
privilegios, etc.

Cuando tengas credenciales reales, la verificación contra la API de Supabase se
hace con:

```bash
# Con las variables de entorno cargadas
npx vitest run supabase/tests/
```

## 9. Despliegue del sitio

El sitio es una SPA estática: se compila y se sirve como archivos.

```bash
npm run build:static     # genera dist/public
```

`dist/public` contiene:
- `index.html` y `404.html` (fallback de rutas del cliente)
- `_redirects` (Netlify / Cloudflare Pages)
- los assets con hash

Cualquier hosting estático sirve. Si usás Vercel/Netlify/Cloudflare Pages, el
directorio de publicación es `dist/public`.

## Checklist final

- [ ] Migraciones aplicadas sin errores
- [ ] `select relname, relrowsecurity` devuelve `true` para todas las tablas del dominio
- [ ] Google OAuth configurado con el redirect URI de Supabase
- [ ] Buckets privados creados
- [ ] Edge Function desplegada y con `SITE_ORIGIN` configurado
- [ ] `.env` con `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`
- [ ] Tu usuario con rol `admin`
- [ ] `npm test` en verde
