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
| Proyecto Supabase | `estudio casoratti` · ref `tdlmritilgtwnxbxkrze` · `https://tdlmritilgtwnxbxkrze.supabase.co` · región us-west-2 |

Cuentas reales creadas (password única inicial: `casoratti2026`):

| Email | Rol | Password |
|---|---|---|
| `casorattiestudiojuridico@gmail.com` | **administrador** (es el correo de contacto del estudio) | `DraCasoratti2026.` (cambiada desde el propio panel) |
| `abogado@estudiocasoratti.com.ar` | abogado | `casoratti2026` |
| `cliente@ejemplo.com` | cliente | `casoratti2026` |
| `carlos@ejemplo.com` | cliente | `casoratti2026` |
| `registrado@ejemplo.com` | usuario registrado | `casoratti2026` |

> **Edge Function `submit-consultation`: desplegada y verificada** en el proyecto real, con
> los secretos `SITE_ORIGIN` y `RATE_LIMIT_SALT`. El alta pública de consultas está
> protegida en el servidor: **máximo 5 consultas por IP cada 24 horas**, con ventana
> móvil (la capacidad se libera de a una cuando la consulta más antigua sale de la
> ventana). El límite se aplica dentro de una transacción en PostgreSQL
> (`public.submit_consultation`), no en el navegador.

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
- **Administración de consultas** (`/panel/consultas`): listado paginado en el servidor
  (10 filas por página), buscador y filtros (área, estado, fechas, IP, sólo nuevas),
  KPIs, serie diaria de 30 días, distribución por estado, detalle con notas internas,
  mensajes con el cliente, historial administrativo, vinculación a cliente / expediente /
  abogado y control de solicitudes por IP.

- **Seguridad** (`/panel/seguridad`): cambio de contraseña del administrador desde el
  propio panel. Verifica la contraseña actual reautenticando contra Supabase Auth,
  exige mínimos de seguridad (10 caracteres, minúscula, mayúscula, número y símbolo),
  rechaza la reutilización de la contraseña actual, cierra las sesiones abiertas en
  otros dispositivos y deja la operación registrada en la bitácora — **sin** guardar
  ni registrar jamás la contraseña.
- **Biblioteca de imágenes** (`/panel/imagenes`): administrador integral de todos los
  recursos gráficos del sitio, organizado por **apariciones**: cada lugar del sitio
  donde se usa una imagen es un registro independiente, con su propia página,
  sección y componente, y se edita, reemplaza o quita **sin afectar a las demás
  apariciones** del mismo archivo. Incluye el inventario real generado en el build
  (8 archivos físicos y 24 apariciones con ruta física, URL pública, formato, peso,
  dimensiones, fecha y referencias en el código), carga por arrastre o selección
  múltiple con vista previa, progreso y cancelación, detección de duplicados que
  no sobrescribe sin confirmación, editor visual con recorte (libre, 1:1, 16:9, 4:3,
  3:4, 9:16), encuadre (marco, radio, borde, `cover`/`contain`/`fill`) y vista previa
  contextual, reemplazo con copia de la versión original, eliminación de una
  aparición (que no borra el archivo), borrado del archivo físico bloqueado
  mientras tenga apariciones vivas, papelera con restauración y borrado definitivo
  con doble confirmación, y metadatos (ALT, título, descripción, categoría,
  etiquetas). La navegación del panel muestra el total: `Imágenes (24)`.

### Apariciones y archivos físicos: dos conceptos distintos

| | Archivos físicos | Apariciones |
|---|---|---|
| Qué es | el recurso gráfico como archivo | cada lugar del sitio donde se usa |
| Cuántos | 8 (6 en uso, 2 sin referencias) | 24 |
| Identificador | ruta lógica (`assets/equipo-reunion.jpg`) | id de aparición (`studio-intro`, `area-detail-familia`, …) |
| Dónde se administra | pestaña **Archivos** | pestaña **Apariciones** (la principal) |
| Qué pasa al editarlo | cambia el recurso para todos sus usos | cambia **sólo** ese lugar del sitio |

Las 10 apariciones estáticas y las 14 dinámicas de área salen del código real:
las detecta el escáner del build, que cruza el registro de apariciones con los
sitios de render y expande las áreas contra los slugs reales de `practiceAreas`.

### Dónde viven las imágenes administradas

El sitio se despliega en Vercel como **sitio estático**: el sistema de archivos de
producción es de sólo lectura, así que un asset compilado por Vite no se puede
sobrescribir desde el panel. Por eso el gestor trabaja sobre el bucket
`site-media` de Supabase Storage, que es el almacenamiento persistente real:

| Procedencia | Dónde está | Cómo se sirve |
|---|---|---|
| Asset compilado | `client/src/assets/` | Vite lo emite con hash (`/assets/hero-zHES6NpP.jpg`) |
| Imagen cargada | bucket `site-media` (público) | `…/storage/v1/object/public/site-media/<ruta>` |
| Reemplazo de una aparición | bucket `site-media`, con el id de la aparición | el sitio lo resuelve con `useMediaSrc(occurrenceId, …)` |
| Reemplazo del archivo | bucket `site-media`, misma ruta lógica | el sitio lo resuelve con `useMediaSrc(null, rutaLógica, …)` |

El manifiesto (`media-manifest.json`, generado en cada build por un plugin de Vite)
es el inventario: archivos físicos, apariciones, rutas lógicas, rutas físicas, URL
pública real y las referencias detectadas en el código. La resolución tiene dos
nivios —primero el override de la **aparición**, después el del **archivo**— y
si no hay ninguno se sigue usando el asset compilado: **el diseño no cambia
nunca**.

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
