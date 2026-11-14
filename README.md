# Estudio Jurídico Casoratti

React / Express / tRPC / Drizzle starter, adapted from the Sandbox web-db-user template.

- `pnpm dev`: development server; honors `PORT` (default 3000).
- `pnpm build` / `pnpm start`: build and serve `dist/index.js` and `dist/public/`.
- `pnpm db:migrate`: apply checked-in migrations. `pnpm db:push`: generate and apply new schema changes.
- `pnpm check` / `pnpm test`: types and application tests.

Start with the Webdev skill's default-template guide. Platform login, storage, payments and service contracts live in its shared references; read the relevant capability before extending its helper.

`server/_core/publicConfig.ts` exposes only named public runtime values. Private keys stay server-side. The platform serves managed `/manus-storage/` assets; the application does not register a second proxy.

Platform configuration is readable and editable through `webdev.config`. Default settings are initial values, not enforced constraints. The agent may modify the files, commands and configuration or follow the flexible guide for another stack.

---

## Estado en producción

| Pieza | Identificador |
|---|---|
| Sitio público | **https://estudio-casoratti.vercel.app** |
| Panel de administración | **https://estudio-casoratti.vercel.app/panel** (sólo administrador) |
| Repositorio | **https://github.com/manusrovira/estudio-casoratti** (rama `main`) |
| Proyecto Supabase | `estudio-casoratti` · ref `hebooqzvbnwuabujkbff` · `https://hebooqzvbnwuabujkbff.supabase.co` |

Cuentas reales creadas (password única: `casoratti2026`):

| Email | Rol |
|---|---|
| `admin@estudiocasoratti.com.ar` | **administrador** |
| `abogado@estudiocasoratti.com.ar` | abogado |
| `cliente@ejemplo.com` | cliente |
| `carlos@ejemplo.com` | cliente |
| `registrado@ejemplo.com` | usuario registrado |

> **Pendiente:** la Edge Function `submit-consultation` todavía no está desplegada en el
> proyecto real (requiere un *access token* de cuenta Supabase con alcance
> `edge_functions_write` y los secretos `SITE_ORIGIN` y `RATE_LIMIT_SALT`). Hasta que se
> despliegue, el formulario de contacto del sitio no puede guardar consultas.

---

## Plataforma de gestión jurídica (Supabase)

Encima del sitio institucional se agregó una plataforma privada con base de datos
real: autenticación, roles, consultas, clientes, expedientes, documentos y panel de
administración. **El sitio público no cambió**: es aditivo.

- **Base de datos y seguridad**: PostgreSQL en Supabase, con Row Level Security como
  perímetro de acceso. Migraciones versionadas en `supabase/migrations/`.
- **Backend**: el navegador llama directo a la API de Supabase con la clave pública;
  el alta de consultas públicas pasa por una Edge Function (validación + rate limiting).
- **Rutas privadas**: `/ingresar`, `/registro`, `/mi-cuenta` (área de cliente) y
  `/panel/*` (sólo administrador).

### Puesta en marcha

```bash
npm install --legacy-peer-deps   # ver nota de peer deps más abajo
cp .env.example .env             # completá VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
npx vite --host 127.0.0.1 --port 3000
```

Guía completa de instalación en Supabase (proyecto, Google OAuth, Storage, Edge
Function, primer administrador): **`docs/SUPABASE_SETUP.md`**.

### Documentación

| Documento | Contenido |
|---|---|
| `docs/ARCHITECTURE.md` | decisiones de diseño y alternativas descartadas |
| `docs/SUPABASE_SETUP.md` | instalación paso a paso |
| `docs/TECHNICAL_REPORT.md` | informe técnico: tablas, policies, pruebas y resultados |
| `supabase/migrations/` | esquema, funciones, triggers, RLS, Storage y seed |

### Pruebas

```bash
npx vitest run
```

La suite de `supabase/tests/rls.test.ts` aplica las migraciones reales sobre un
PostgreSQL 17 embebido (PGlite) y verifica las políticas RLS de verdad: aislamiento
entre clientes, notas internas invisibles para el cliente, documentos privados,
imposibilidad de auto-asignarse privilegios y auditoría de sólo lectura.

### Nota sobre peer deps

`@builder.io/vite-plugin-jsx-loc` declara `vite@^4 || ^5` y el proyecto usa Vite 7.
El plugin sólo agrega info de líneas al source map en desarrollo, así que se instala
con `--legacy-peer-deps` sin impacto en el sitio.

### Lo que quedó intacto

La capa Drizzle/MySQL y la autenticación de la plataforma Manus no se usan para la
plataforma nueva (que es independiente), pero **no se eliminaron**: siguen en el
repositorio y no afectan al sitio publicado, que es estático.
