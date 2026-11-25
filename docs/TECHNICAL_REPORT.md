# Informe técnico — Plataforma de gestión jurídica
## Estudio Jurídico Casoratti · Posadas, Misiones

**Fecha:** 14 de noviembre de 2026
**Base del proyecto:** sitio institucional estático (React 19 + Vite 7 + Tailwind 4 + wouter)
**Motor de base de datos:** PostgreSQL 17 sobre Supabase (PostgREST + Auth + Storage + Edge Functions)

---

## 1. Arquitectura implementada

```
                         ┌───────────────────────────────┐
  Visitante ─────────────▶│  SPA estática (Vite build)    │
                         │  React + wouter               │
                         └───────────┬───────────────────┘
                                     │
                    ┌────────────────┴─────────────────┐
                    │                                  │
        ┌───────────▼────────────┐        ┌────────────▼─────────────┐
        │ Edge Function          │        │ supabase-js (anon key)   │
        │ submit-consultation    │        │ desde el navegador       │
        │ · validación Zod       │        └────────────┬─────────────┘
        │ · rate limit por IP    │                     │
        │ · honeypot             │                     │
        │ · service role (server)│                     │
        └───────────┬────────────┘                     │
                    │                                  │
                    └────────────────┬─────────────────┘
                                     ▼
                         ┌───────────────────────────────┐
                         │  PostgreSQL (Supabase)        │
                         │  · RLS en todas las tablas   │
                         │  · triggers de auditoría      │
                         │  · notificaciones automáticas│
                         │  · Storage privado            │
                         └───────────────────────────────┘
```

Decisión de fondo: **Postgres es el backend y también el perímetro de seguridad.** El
navegador llama directo a la API de Supabase con la clave pública; cada request es
evaluado por las políticas RLS con el JWT del usuario. No existe una capa de API
propia que revalide permisos (sería duplicar lo que la base ya garantiza).

**Lo que NO se modificó:** ninguna página pública, ningún estilo del sitio, la capa
Drizzle/MySQL existente, la autenticación Manus existente, `server/`, `drizzle/`,
`patches/` ni el Dockerfile. La plataforma nueva es puramente aditiva.

## 2. Tablas creadas

15 tablas en el esquema `public`, con RLS habilitada en todas:

| Tabla | Propósito | Filas iniciales |
|---|---|---|
| `profiles` | identidad del usuario (FK a `auth.users`) | automático por trigger |
| `user_roles` | rol efectivo por usuario | automático (`usuario`) |
| `lawyers` | datos profesionales del equipo | 0 |
| `clients` | fichas de clientes | 0 |
| `consultation_categories` | áreas jurídicas configurables | **12** (áreas reales del estudio) |
| `legal_consultations` | consultas recibidas | 0 |
| `consultation_notes` | notas internas (nunca del cliente) | 0 |
| `consultation_messages` | mensajes estudio ↔ cliente | 0 |
| `legal_cases` | expedientes | 0 |
| `case_documents` | metadatos de archivos de expedientes | 0 |
| `client_documents` | metadatos de archivos de clientes | 0 |
| `audit_logs` | trail de operaciones (append-only) | automático por trigger |
| `notifications` | avisos del sistema | automático por trigger |
| `rate_limits` | contador de la Edge Function | automático |

> Las 12 filas de `consultation_categories` son **datos de configuración** (los nombres
> de las áreas que el estudio publica), no clientes, consultas ni expedientes de
> ejemplo. No se cargó ningún dato ficticio de personas.

**Enumerados:** `app_role` (admin, abogado, cliente, usuario), `consultation_status`
(7 estados), `client_status` (3), `case_status` (5).

## 3. Relaciones de PostgreSQL

```
auth.users ──1:1──▶ profiles ──1:1──▶ user_roles
                        │
                        │ user_id (único, opcional)
                        ▼
lawyers ──1:N──▶ clients ──1:N──▶ legal_cases ──1:N──▶ case_documents
   │                 │                   │
   │                 │                   └── legal_consultations.legal_case_id
   │                 ├──▶ client_documents
   │                 └──▶ legal_consultations.client_id
   │
   └── assigned_lawyer_id (en clients, legal_cases, legal_consultations)

legal_consultations ──1:N──▶ consultation_notes      (internas)
                      └──1:N──▶ consultation_messages  (con el cliente)
consultation_categories ──1:N──▶ legal_consultations
```

- PK `uuid` con `default gen_random_uuid()` en todas las entidades de negocio.
- `profiles.id` y `user_roles.user_id` referencian `auth.users(id) on delete cascade`.
- `on delete cascade` en notas, mensajes y documentos; `on delete set null` en las
  asignaciones de abogado (desvincular un abogado no borra su historial).
- `legal_cases.client_id` es `NOT NULL`: un expediente siempre tiene cliente.
- `legal_consultations.email` tiene un `CHECK` de formato.
- `reference_code` y `case_number` son únicos (secuencia `consultation_reference_seq`).

**Índices** (30 en total) sobre los accesos reales: estado, área, fecha de recepción,
cliente, abogado, nombre y email en minúsculas de consultas; índices parciales para
`is_new` y notificaciones no leídas; índices sobre `audit_logs(actor_id)`,
`audit_logs(entity_type, entity_id)` y `audit_logs(created_at desc)`.

## 4. Políticas RLS

RLS habilitada en las 14 tablas del dominio (`rate_limits` queda sin policies a
propósito: sólo la service role la toca).

| Tabla | SELECT | INSERT/UPDATE/DELETE |
|---|---|---|
| `profiles` | el propio + admin | el propio (sólo columnas permitidas) + admin |
| `user_roles` | el propio + admin | **sólo admin** |
| `lawyers` | staff + el propio | sólo admin |
| `clients` | admin, abogado asignado, el cliente | sólo admin |
| `consultation_categories` | **público** (lectura) | sólo admin |
| `legal_consultations` | admin, abogado asignado, cliente vinculado | sólo admin (alta pública vía Edge Function) |
| `consultation_notes` | admin + abogado asignado | admin + abogado asignado / delete: admin |
| `consultation_messages` | los que pueden ver la consulta | los que pueden ver la consulta / update+delete: admin |
| `legal_cases` | admin, abogado asignado, cliente | sólo admin |
| `case_documents` | los del expediente | admin + abogado asignado / delete: admin |
| `client_documents` | los del cliente | sólo admin |
| `audit_logs` | **sólo admin, sólo lectura** | sólo admin (sin update ni delete) |
| `notifications` | el destinatario (update: sólo `read_at`) | admin |
| `storage.objects` | según el folder (`{owner_id}/archivo`) | según el folder / delete: admin |

Funciones auxiliares (`SECURITY DEFINER`, `search_path` fijo) que evitan la recursión
de RLS y devuelven booleanos, no datos:
`current_role()`, `is_admin()`, `is_staff()`, `is_client()`, `current_lawyer_id()`,
`can_read_client(id)`, `can_read_case(id)`, `can_read_consultation(id)`,
`can_access_client_folder(text)`, `can_access_case_folder(text)`.

**Restricciones de privilegio** (revoke/grant a nivel de columna):
- `profiles`: el usuario sólo puede actualizar `full_name`, `phone`, `document_id`, `avatar_url`.
- `notifications`: el usuario sólo puede actualizar `read_at`.
- `anon` no tiene permisos de escritura ni de lectura sobre ninguna tabla del dominio.

## 5. Sistema de autenticación

Supabase Auth, con dos métodos:

| Función | Implementación |
|---|---|
| Google OAuth | `signInWithOAuth({ provider: "google" })` → redirección al proveedor |
| Registro por email | `signUp()` con metadata (`full_name`, `accepted_terms`) |
| Login email + contraseña | `signInWithPassword()` |
| Recuperación de clave | `resetPasswordForEmail()` + `updateUser({ password })` |
| Verificación de email | `Confirm email` activado en Supabase |
| Cierre de sesión | `signOut()` + limpieza de estado local |
| Persistencia de sesión | `persistSession: true` + `autoRefreshToken: true` + `detectSessionInUrl` |

**Vínculo automático con PostgreSQL:** el trigger `handle_new_user` sobre
`auth.users` inserta en `profiles` (nombre, email, avatar, aceptación de términos) y
en `user_roles` con el rol `usuario`. Corre igual para altas por Google y por email.

**Protección de rutas privadas:** doble capa. En el cliente, `AdminShell` verifica el
rol antes de renderizar; en el servidor, las policies RLS garantizan que un usuario
sin rol `admin` recibe **cero filas y cero permisos de escritura** aunque conozca la
URL. La comprobación del cliente es sólo de experiencia de usuario.

## 6. Roles y permisos

| | Administrador | Abogado | Cliente | Usuario |
|---|---|---|---|---|
| Panel de administración | ✅ | ❌ | ❌ | ❌ |
| Ver todas las consultas | ✅ | las asignadas | las propias | ❌ |
| Crear/editar clientes | ✅ | ❌ | ❌ | ❌ |
| Crear expedientes | ✅ | ❌ | ❌ | ❌ |
| Ver expedientes | ✅ | los asignados | los propios | ❌ |
| Notas internas | ✅ | las asignadas | ❌ | ❌ |
| Mensajes con el cliente | ✅ | los asignados | ✅ | ❌ |
| Documentos privados | ✅ | los asignados | los propios | ❌ |
| Auditoría | ✅ (lectura) | ❌ | ❌ | ❌ |
| Cambiar roles | ✅ | ❌ | ❌ | ❌ |
| Configuración (áreas, abogados) | ✅ | ❌ | ❌ | ❌ |

El rol se guarda **siempre** en `public.user_roles` y se valida en Postgres. El
frontend nunca lo inventa, no lo persiste en `localStorage` y no lo toma de variables
de estado.

**Procedimiento seguro de alta de administrador:** un usuario no puede auto-asignarse
el rol `admin` (no existe policy de INSERT/UPDATE para no-admins, y el panel además
rechaza explícitamente cambiar el propio rol). El primer admin se otorga desde un
entorno protegido (SQL Editor o CLI), documentado en `docs/SUPABASE_SETUP.md`.

## 7. Módulos administrativos

Rutas bajo `/panel`, con marco propio (sidebar + topbar) y carga diferida del chunk:

| Ruta | Módulo | Funcionalidad |
|---|---|---|
| `/panel` | **Dashboard** | 8 KPIs (consultas totales, nuevas, abiertas, clientes, clientes activos, expedientes abiertos, usuarios, notificaciones sin leer) + consultas recientes + actividad reciente |
| `/panel/seguridad` | **Seguridad** | Cambio de contraseña del administrador: verificación de la contraseña actual por reautenticación, mínimos de seguridad (10 caracteres, minúscula, mayúscula, número, símbolo), rechazo de la reutilización, medidor de fortaleza, cierre de las sesiones abiertas en otros dispositivos y registro en la bitácora (sin datos de la contraseña) |
| `/panel/imagenes` | **Biblioteca de imágenes** | Inventario real (8 imágenes del proyecto + las cargadas en Storage), KPIs, buscador, filtros por formato / ubicación / estado, vista cuadrícula o lista, detalle con rutas (física, pública, nombre original, nombre almacenado, directorio, URL pública, proveedor) y referencias, **carga** por arrastre o selección múltiple con vista previa, progreso, cancelación, validación de contenido real y detección de duplicados, **editor** con recorte / ajuste / encuadre y vista previa contextual, reemplazo con copia de seguridad, eliminación con aviso cuando está en uso, **papelera** con restauración y borrado definitivo con doble confirmación, metadatos (ALT, título, descripción, categoría, etiquetas) y registro de actividad |
| `/panel/usuarios` | **Usuarios** | Listado con nombre, **email**, identificador, rol y ficha de cliente vinculada; búsqueda por nombre y email; cambio de rol (con bloqueo del propio) |
| `/panel/clientes` | **Clientes** | Alta/edición (nombre, documento, email, teléfono, domicilio, estado, abogado, notas internas), filtro por texto y estado, vinculación de cuenta registrada, conteos de consultas y expedientes |
| `/panel/consultas` | **Administración de consultas** | KPIs (totales, nuevas, recibidas hoy, últimos 7 y 30 días, en análisis, tasa de respuesta, IPs distintas en 24 h), serie diaria de 30 días, distribución por estado, **listado paginado en el servidor (10 por página)**, buscador (nombre, email, asunto o código) y filtros (área, estado, desde/hasta, IP, sólo nuevas), **control de solicitudes por IP** con el límite 5/24 h, ficha lateral con IP y navegador, cambio de estado, asignación de abogado, vinculación a cliente/expediente, conversión de consulta en cliente, **notas internas**, **mensajes al cliente** e **historial administrativo** |
| `/panel/expedientes` | **Expedientes** | Listado y filtros, alta/edición completa (número, carátula, cliente, abogado, fuero, jurisdicción, juzgado, estado), documentos asociados y vínculo con la consulta origen |
| `/panel/documentacion` | **Documentación** | Subida a buckets privados con validación (pdf/docx/imágenes, 25 MB), paths `{owner_id}/{archivo}`, descarga por **URL firmada de 60 s**, borrado de archivo + metadato |
| `/panel/auditoria` | **Auditoría** | Registro de operaciones con filtro por tipo de entidad y rango de fechas, paginado, **sólo lectura** |
| `/panel/configuracion` | **Configuración** | CRUD de áreas jurídicas (nombre, slug, orden, activa) y del equipo de abogados (especialidades, matrícula, activo/inactivo) |

Estados de consulta implementados: `nueva`, `pendiente`, `en_analisis`, `en_seguimiento`,
`respondida`, `cerrada`, `rechazada`.

Área de cliente (`/mi-cuenta`): consultas con su estado, expedientes, documentos
habilitados (descarga con URL firmada) y actualización de los datos permitidos.

## 8. Variables de entorno

| Variable | Dónde | Para qué |
|---|---|---|
| `VITE_SUPABASE_URL` | frontend | URL del proyecto |
| `VITE_SUPABASE_ANON_KEY` | frontend | clave pública (anon / publishable) |
| `SUPABASE_URL` | servidor / Edge Function | lo inyecta Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | servidor / Edge Function | **nunca en el frontend** |
| `RATE_LIMIT_SALT` | Edge Function | ancla del hash de IP del rate limiting |
| `SITE_ORIGIN` | Edge Function | CORS: origen permitido |

`PORT` es opcional (servidor de desarrollo). Todas documentadas en `.env.example`.

## 9. Configuración de Supabase — estado real

El proyecto de producción existe y está configurado. Este es el estado verificado
contra el panel y contra la API real:

| # | Paso | Estado |
|---|---|---|
| 1 | Proyecto creado | ✅ `estudio casoratti` · ref `tdlmritilgtwnxbxkrze` · org "Estudio Casoratti" · plan Free · región us-west-2 |
| 2 | Migraciones aplicadas | ✅ 10 migraciones aplicadas desde el editor SQL del panel: `20260114000100` … `20260115000300` |
| 3 | Provider de email + confirmación | ✅ activo |
| 4 | Google OAuth | ⛔ **no configurado** (ver 12.1) |
| 5 | URLs de redirección permitidas | ✅ `/mi-cuenta`, `/ingresar` y la URL pública de Vercel |
| 6 | Buckets privados | ✅ `client-documents` y `case-documents` (creados por la migración 00400) |
| 7 | Edge Function `submit-consultation` | ✅ **desplegada y verificada** (alta real contra la API, CORS acotado al origen de producción) |
| 8 | Secretos `RATE_LIMIT_SALT` / `SITE_ORIGIN` | ✅ configurados en el proyecto |
| 9 | `.env` del sitio con URL y clave pública | ✅ apuntando al proyecto `tdlmritilgtwnxbxkrze` |
| 10 | Primer rol `admin` | ✅ otorgado por SQL directo (ver 10.7) |
| 11 | `npm test` contra la API real | ✅ RLS verificado contra la API de producción |
| 12 | Límite de consultas por IP | ✅ **5 por IP cada 24 h**, aplicado en PostgreSQL (`public.submit_consultation`, `SECURITY DEFINER` + `pg_advisory_xact_lock`) |

El paso a paso genérico está en **`docs/SUPABASE_SETUP.md`**.

## 10. Pruebas realizadas y resultados reales

### 10.1 Suite de políticas RLS sobre PostgreSQL real — 34/34 ✅

Las migraciones reales se aplican sobre un **PostgreSQL 17 embebido (PGlite, WASM)**
y las consultas se ejecutan con `set local role authenticated` + el claim JWT de la
request, exactamente como hace PostgREST. Los shims de `auth` y `storage` replican el
comportamiento de Supabase. Un mock no probaría nada de esto.

| # del encargo | Prueba | Resultado |
|---|---|---|
| 1 | El alta crea perfil y rol por defecto en PostgreSQL | ✅ |
| 1b | El mismo camino de identidad sirve al alta con Google OAuth | ✅ |
| 2/3 | Inicio de sesión: perfil propio legible, perfil ajeno invisible | ✅ |
| 3 | El email del usuario queda copiado en `profiles` | ✅ |
| 4 | Un usuario normal no ve roles ajenos ni consultas, clientes, expedientes, auditoría ni notificaciones ajenas | ✅ |
| 5 | Cada cliente ve sólo su ficha; no ve los expedientes del otro | ✅ |
| 6 | La consulta enviada queda guardada con estado `nueva` e `is_new` | ✅ |
| 7a | Un visitante anónimo no ve ninguna consulta | ✅ |
| 7b | Un usuario registrado tampoco | ✅ |
| 7c | El administrador ve y cambia el estado de las consultas | ✅ |
| 7d | Antes de vincularse a un cliente, el cliente no la ve | ✅ |
| 8 | El administrador ve y edita clientes; el cliente no puede editar su propia ficha | ✅ |
| 9 | El cliente no lee ni escribe notas internas; el administrador sí | ✅ |
| 9b | El cliente sí lee los mensajes (separados de las notas) | ✅ |
| 10 | El dueño descarga sus documentos; otro cliente no; un usuario sin ficha tampoco; el abogado ve los asignados | ✅ |
| 11 | Un usuario no puede insertarse ni ascenderse a admin; no puede tocar roles ajenos | ✅ |
| 11b | El administrador sí puede asignar roles | ✅ |
| 12 | Las 12+ tablas del dominio tienen RLS activa | ✅ |
| 12b | Cada sesión corre como rol no privilegiado (`current_user = authenticated`) | ✅ |
| 12c | Anónimo sólo alcanza las áreas públicas configurables | ✅ |
| 12d | Un cliente no lee metadatos de documentos ajenos | ✅ |
| 12e | La auditoría registra operaciones y es de sólo lectura (el borrado no borra) | ✅ |

**Dos bugs reales encontrados y corregidos por esta suite:**
1. El trigger de auditoría usaba `old.id`, pero `user_roles` no tiene columna `id`
   (su PK es `user_id`) → error en runtime. Corregido con un resolutor genérico de
   clave primaria.
2. La semántica de RLS es que un `UPDATE` sobre una fila invisible **no da error:
   afecta 0 filas**. Las aserciones se reescribieron para verificar el efecto real
   (el dato no cambia) en lugar de esperar una excepción.

### 10.2 Resto de la suite — 76/76 ✅

| Archivo | Tests | Qué cubre |
|---|---|---|
| `supabase/tests/rls.test.ts` | 34 | políticas RLS sobre Postgres real |
| `client/src/pages/admin/consultations-utils.test.ts` | 29 | lógica pura del panel de consultas: paginación de 10 filas, filtros combinables, resumen de KPIs, distribución por estado, uso por IP, degradación cuando falta la columna `ip_address` |
| `client/src/lib/rbac.test.ts` | 7 | coherencia entre enums de la base y etiquetas de la UI; guards de rol |
| `server/auth.logout.test.ts` | 5 | cierre de sesión (preexistente) |
| `server/platform.test.ts` | 6 | plataforma Manus (preexistente) |

### 10.3 TypeScript — 0 errores ✅

`npx tsc --noEmit` → exit 0, sin errores (proyecto completo: `client/`, `server/`,
`shared/`, `supabase/tests/`).

### 10.4 Build estático — ✅

`npx vite build` → `dist/public/` generado sin errores.

- `index.html` + **`404.html`** (fallback de rutas del cliente, generado por un plugin
  de Vite) + `_redirects` (Netlify/Cloudflare).
- Bundle principal: **740 kB** (210 kB gzip).
- Panel de administración: chunk aparte de **135 kB** (23 kB gzip), cargado sólo si se
  entra a `/panel` (`React.lazy` + `Suspense`).
- Las 7 imágenes originales se compilan con hash.

### 10.5 Verificación en navegador — ✅

Sobre el dev server (`http://localhost:3000`):

| Ruta | Resultado |
|---|---|
| `/` | Renderiza el hero y la página institucional sin cambios ✅ |
| `/contacto` | El formulario nuevo muestra nombre, email, teléfono, área (12 áreas), asunto, mensaje, aceptación de privacidad y honeypot ✅ |
| `/ingresar` | Pantalla de acceso con botón de Google, email y recuperación de clave ✅ |
| `/mi-cuenta` | Área de cliente; sin credenciales muestra el aviso de configuración faltante ✅ |
| `/panel` | Carga el chunk diferido y muestra el aviso de configuración faltante ✅ |
| Consola del navegador | **0 errores y 0 warnings** en todas las rutas revisadas ✅ |

### 10.6 Verificación en navegador sobre producción — ✅

Sobre **`https://estudio-casoratti.vercel.app`** (sitio publicado, proyecto Supabase real):

| Comprobación | Resultado |
|---|---|
| `/` | Renderiza el sitio institucional ✅ |
| `/panel` | Responde 200; el rewrite SPA de Vercel funciona ✅ |
| `POST /auth/v1/token` desde el dominio de producción | 200, CORS `allow-origin: *` ✅ |
| `GET /auth/v1/user` con la sesión | 200 ✅ |
| Login con `admin@estudiocasoratti.com.ar` | ✅ entra y redirige a `/mi-cuenta` |
| Login con `admin@estudiocasoratti.com.ar` → `/panel/usuarios` | ✅ renderiza el Panel de Administración con la **tabla de 5 cuentas** |
| Enlace "Panel" en la navegación del admin | ✅ visible |
| Auditoría del bundle público | URL real de Supabase presente ✅ · sin URL emulada ✅ · sin password de DB ✅ · sin service role real ✅ |

### 10.7 Verificación de RLS contra la API real — ✅

`supabase/local/verify-rls.ts` abre sesión con cada una de las 5 cuentas contra la
API de producción y comprueba qué filas ve cada una:

| Rol | Filas que ve | Resultado |
|---|---|---|
| `admin` | 5 roles · 2 clientes | ✅ |
| `abogado` | 2 clientes (los asignados) | ✅ |
| `cliente` | sólo su perfil y su ficha | ✅ |
| `cliente` (otro) | sólo su perfil y su ficha | ✅ |
| `usuario` | sólo su perfil y **su propio rol** (1 fila `usuario`); 0 fichas ajenas | ✅ |

> Nota: la aserción original esperaba 0 filas de `user_roles` para un usuario normal.
> La reality es que la policy `user_id = auth.uid() or is_admin()` le devuelve
> **exactamente su propio rol**, que es el comportamiento correcto (un usuario puede
> saber qué rol tiene). Se ajustó la aserción, no la policy.

### 10.8 Bug real de login — corregido y verificado en producción

**Síntoma:** el login por correo devolvía token 200 pero el usuario quedaba en
`/ingresar`.

**Causa raíz:** en `supabase-js` v2.119 el `flowType` por defecto es **`pkce`**, no
`implicit`. Un fragmento `#access_token` de flujo implícito es rechazado con
`Not a valid PKCE flow url.`, el cliente terminaba enviando la **anon key** como
Bearer y la API respondía 403 `invalid claim: missing sub claim`.

**Fix** (`client/src/pages/auth/AuthPages.tsx`): nueva función
`resolvePostLoginRedirect()` que **lee el rol en Postgres** (`public.user_roles`) y
redirige a `/panel` si es `admin`, y a `/mi-cuenta` en cualquier otro caso, con
`window.location.href = await resolvePostLoginRedirect()` tras `signInWithEmail()`.

> Por qué leer el rol en Postgres y no desde el estado del contexto: el contexto puede
> no estar listo justo después del login, y el frontend nunca debe ser la fuente de
> verdad del rol. `canAccessAdminPanel` sigue siendo sólo una ayuda de UI; el
> perímetro real es RLS.

**Verificación:** tras el redeploy, el login como administrador redirige correctamente y
`/panel/usuarios` muestra las 5 cuentas con su rol, ficha de cliente, fecha de alta y
selector de gestión.

### 10.9 Lo que NO se pudo verificar (y por qué)

1. **Google OAuth** no está configurado en el proyecto: el botón lleva al `authorize`
   real de Google y falla. El login por correo — que es el método de las 5 cuentas
   reales — funciona correctamente.
2. **La descarga real de un archivo con URL firmada** no se probó en producción: no
   hay documentos cargados en los buckets. La policy de Storage está cubierta por la
   suite RLS (prueba 10 de 10.1) y por la verificación de permisos.
3. El **correo de las notificaciones** no está implementado (queda el punto de
   extensión documentado en 12.2).

### 10.10 Verificación del panel de consultas contra el proyecto real — ✅

Todo lo que sigue se ejecutó contra el proyecto `tdlmritilgtwnxbxkrze`, no contra un
mock:

| Prueba | Resultado |
|---|---|
| Login del administrador (`casorattiestudiojuridico@gmail.com`) contra la API real | ✅ sesión con rol `admin` |
| Alta por la Edge Function con el `Origin` de producción | ✅ `200` · `Access-Control-Allow-Origin: https://estudio-casoratti.vercel.app` · `CONS-261125-F5BE78` |
| Límite por IP: 7 envíos desde la misma IP | ✅ 5 con `200` y las consultas 6 y 7 con `429` + `retryAfterSeconds: 86398` |
| IP guardada en la fila | ✅ `ip_address = 190.183.17.108`, `user_agent` presente |
| Código de referencia generado en la base | ✅ `CONS-261125-C92856` (default `CONS-YYMMDD-XXXXXX`) |
| KPIs y serie diaria (`admin_consultation_stats(30)`) | ✅ `total 32`, `nuevas 9`, `hoy 6`, `ips_24h 2`, serie de 30 días |
| Paginación real (10 por página) | ✅ `Content-Range: 0-9/32`, `10-19/32`, `20-29/32` |
| Filtro por texto | ✅ "María Gómez" → `Mostrando 1–2 de 2 consultas` |
| Filtro por IP | ✅ `203.0.113.20` → `Mostrando 1–9 de 9 consultas` |
| Panel en el navegador | ✅ KPIs, serie, distribución por estado, listado, ficha lateral, notas, mensajes e historial |
| Nota interna guardada desde el panel | ✅ `Nota interna guardada.` con autor y hora |
| RLS: un cliente no ve consultas ajenas | ✅ 0 filas para `cliente@ejemplo.com` |
| RLS: `anon` no puede leer consultas | ✅ `401` `permission denied for table legal_consultations` |
| Limpieza final | ✅ 0 consultas, 0 notas, 0 notificaciones de prueba en la base |

Tres defectos reales aparecieron durante esta verificación y quedaron corregidos en el
repositorio (ver commit `02d2eeb`):

| Defecto | Causa | Corrección |
|---|---|---|
| La Edge Function devolvía `500` en toda alta | `time zone "America/Argentina" not recognized`: ese nombre no existe en el tzdata de Postgres | `America/Argentina/Buenos_Aires` en el default de `reference_code` y en las estadísticas |
| La API devolvía `42501` en cualquier lectura | Las tablas se crearon sin `GRANT`: los roles de la API sólo quedaban con `REFERENCES, TRIGGER, TRUNCATE` | Migración `20260115000300_privilegios.sql`: `anon` lee sólo el catálogo de áreas, `authenticated` opera con RLS, `service_role` escribe |
| El catálogo tenía 15 áreas y una con texto corrupto | El slug `danos-y-seguiros` convivía con `danos-y-seguros`; además el SQL se había pegado con la codificación equivocada | Slug unificado en `danos-y-seguros` (el que usa el sitio) y borrado de la fila duplicada; todo el texto re-aplicado en UTF-8 |

### 10.11 Módulos «Seguridad» y «Biblioteca de imágenes» — verificación real ✅

Todo lo que sigue se ejecutó contra el proyecto `tdlmritilgtwnxbxkrze` y contra la
aplicación real, no contra mocks.

**Base de datos (migración `20260115000400_media_admin.sql`, aplicada en el panel)**

| Comprobación | Resultado |
|---|---|
| Bucket `site-media` creado | ✅ público, 10 MB, 5 MIME admitidos |
| Tablas `site_media`, `media_folders`, `media_activity` | ✅ con RLS activa |
| Carpetas iniciales | ✅ 7 (`assets`, `overrides` y las 5 de `images/*`) |
| `anon` lee `site_media` | ✅ bloqueado (401) |
| Un cliente lee o escribe `site_media` | ✅ bloqueado |
| `media_activity` es de sólo lectura | ✅ ni el administrador puede modificarla |
| `log_media_action` con un cliente | ✅ bloqueado: exige `public.is_admin()` |
| `log_media_action` con una acción inventada | ✅ bloqueado: lista blanca |
| El `detail` de la bitácora guarda la contraseña | ✅ **nunca**: se descartan las claves de tipo credencial |
| `resolve_media_overrides` (RPC público) | ✅ expone sólo medios activos |

**Ciclo real de la imagen (36/36 comprobaciones contra la API de producción)**

| Comprobación | Resultado |
|---|---|
| Carga de un JPEG real en `site-media` | ✅ `200` |
| El bucket rechaza un `.txt` con contenido `text/plain` | ✅ |
| Un cliente intenta escribir en `site-media` | ✅ `403` |
| La imagen cargada se sirve por URL pública | ✅ y los bytes coinciden con el archivo original |
| Registro en `site_media` | ✅ con dimensiones, peso y metadatos |
| La bitácora guarda el autor real de la sesión | ✅ `actor_id` = uid de la sesión, no un parámetro del cliente |
| El RPC público incluye el medio recién cargado | ✅ |
| El medio pasa a la papelera | ✅ `status = trashed` |
| El RPC público **excluye** lo que está en la papelera | ✅ |
| Borrado definitivo (fila + objeto de Storage) | ✅ y el objeto ya no figura en el bucket |
| La URL pública deja de servir el objeto | ✅ |
| Base limpia al final | ✅ 0 medios, 0 filas de bitácora |

**En el navegador (build local, panel con sesión de administrador)**

| Prueba | Resultado |
|---|---|
| Inventario con datos reales | ✅ 8 imágenes · 6 utilizadas · 2 sin referencias · 1,3 MB · rutas, formatos, pesos, dimensiones y fechas reales |
| Manifiesto generado en el build | ✅ `media-manifest.json` con la URL pública real que emite Vite y las referencias con archivo y línea |
| Creación de carpeta desde el panel | ✅ «Se creó la carpeta «images/prueba-panel»» y aparece en el desplegable de destino |
| Carga múltiple desde el panel | ✅ «Se subieron 2 imágenes a «images/prueba-panel»» |
| Detección de duplicados | ✅ «Ya existe «team-room.jpg» en assets» con confirmación expresa antes de sobrescribir |
| Detalle con rutas y copiado | ✅ ruta del proveedor, ruta física, URL pública, nombre original, nombre almacenado, directorio y «dónde se usa» |
| Eliminación con confirmación | ✅ «¿Eliminar «prueba-carga-casoratti.jpg»? La imagen va a la papelera y se puede restaurar.» |
| Restauración desde la papelera | ✅ «Se restauró…» y la papelera queda vacía |
| Borrado definitivo | ✅ doble confirmación con casilla «Entiendo que esta acción no se puede deshacer» |
| Registro de actividad | ✅ fecha, acción, imagen, administrador y resultado por operación |
| Persistencia tras recargar | ✅ el inventario sigue mostrando lo cargado |

**Módulo de Seguridad**

| Prueba | Resultado |
|---|---|
| Contraseña actual verificada por reautenticación | ✅ contra Supabase Auth |
| Contraseña nueva establecida | ✅ `updateUser` |
| Sesiones anteriores revocadas | ✅ `signOut({ scope: "others" })` → `204` |
| Ingreso con la contraseña nueva | ✅ `200` |
| Ingreso con la contraseña anterior | ✅ `400` (rechazada) |
| La operación queda registrada | ✅ `password_change`, sin datos de la contraseña |

**Dos defectos reales encontrados y corregidos**

| Defecto | Causa | Corrección |
|---|---|---|
| «Actualizar contraseña» no respondía y el motivo no se veía | El mensaje de validación se renderizaba **arriba** del formulario, fuera de la vista al pulsar el botón; y el estado de cada requisito («cumple» / «falta») sólo existía en un texto para lectores de pantalla, así que un requisito pendiente se confundía con un separador | El bloque de errores se mueve **justo encima del botón** (con `role="alert"`) y cada requisito muestra su estado en texto visible |
| `log_media_action` acepta cualquier usuario autenticado | El RPC sólo exigía la lista blanca de acciones, no el rol | `if not public.is_admin() then raise exception …` (42501), aplicado también en la base desplegada |

La suite completa quedó en **231 pruebas en verde sobre 11 archivos**, `tsc --noEmit`
sin errores y el build estático sin errores.

## 11. Archivos agregados

```
supabase/
  config.toml                              configuración del proyecto Supabase
  migrations/
    20260114000100_schema.sql              enums, 15 tablas, FKs, índices
    20260114000200_functions_triggers.sql  helpers, triggers, auditoría, notificaciones
    20260114000300_rls.sql                 políticas RLS por rol
    20260114000400_storage.sql             buckets privados + policies
    20260114000500_seed.sql                12 áreas jurídicas
    20260114000600_rate_limit.sql          RPC de rate limiting
    20260114000700_profiles_email.sql      email en el perfil + backfill
    20260115000100_areas_actualizadas.sql  catálogo real de 14 áreas
    20260115000200_panel_consultas.sql     ip_address, código de referencia, RPC de
                                           alta atómica con límite por IP, KPIs
    20260115000300_privilegios.sql         GRANT de los roles de la API
    20260115000400_media_admin.sql          bucket site-media, site_media, media_folders,
                                           media_activity, RPC de bitácora y de overrides
  functions/submit-consultation/
    index.ts                               Edge Function (Deno): IP real, CORS, RPC
    handler.ts                             validación y reglas puras (Deno + Node)
  tests/harness.ts                         harness PGlite (shims auth/storage)
  tests/rls.test.ts                        34 pruebas de seguridad
  tests/media-rls.test.ts                  31 pruebas de seguridad de medios

client/src/
  lib/supabase.ts                          cliente + constantes
  lib/rbac.ts                              tipos, roles, etiquetas
  lib/rbac.test.ts                         7 pruebas unitarias
  lib/mediaManifest.ts                     tipos del inventario (seguro para el navegador)
  lib/mediaManifest.server.ts              escáner real del repositorio + dimensiones
  lib/mediaManifest.server.test.ts         21 pruebas del escáner
  lib/mediaManifestPlugin.ts               plugin de Vite que emite media-manifest.json
  lib/mediaAssets.ts                       asset compilado ↔ ruta lógica estable
  lib/mediaResolver.ts                     resolución de reemplazos en el sitio público
  contexts/AuthContext.tsx                 sesión, perfil y rol
  pages/auth/AuthPages.tsx                 ingreso, registro, recuperación
  pages/account/AccountArea.tsx            área de cliente
  pages/admin/AdminShell.tsx               marco del panel + rutas
  pages/admin/ConsultationsAdminModule.tsx administración de consultas
  pages/admin/consultations-utils.ts       paginación, filtros, KPIs, uso por IP
  pages/admin/consultations-utils.test.ts  29 pruebas de la lógica del panel
  pages/admin/SecurityModule.tsx           seguridad y cambio de contraseña
  pages/admin/security-utils.ts            fortaleza, requisitos y validación
  pages/admin/security-utils.test.ts       20 pruebas de la lógica de contraseñas
  pages/admin/images/ImageLibraryModule.tsx   biblioteca de imágenes (interfaz)
  pages/admin/images/ImageEditorModal.tsx      editor: recorte, ajuste y encuadre
  pages/admin/images/MediaUploadPanel.tsx      carga con progreso y cancelación
  pages/admin/images/MediaTrashPanel.tsx       papelera
  pages/admin/images/MediaMetadataDialog.tsx   metadatos y ALT
  pages/admin/images/MediaActivityPanel.tsx    registro de actividad
  pages/admin/images/media-service.ts          servicios contra Storage y Postgres
  pages/admin/images/media-validator.ts        validación MIME, magic bytes y SVG
  pages/admin/images/media-editor.ts           matemática del editor
  pages/admin/images/media-inventory.ts         fusión y filtros del inventario
  pages/admin/images/*.test.ts                 52 + 31 pruebas de la lógica de medios
  components/MediaImg.tsx                  imagen del sitio que resuelve reemplazos
  styles/admin.css                         sistema visual del panel
  styles/admin-consultations.css           estilos propios del módulo de consultas
  styles/admin-security.css                estilos propios del módulo de seguridad
  styles/admin-images.css                  estilos propios de la biblioteca de imágenes

docs/
  ARCHITECTURE.md                          decisiones y alternativas descartadas
  SUPABASE_SETUP.md                        guía de instalación paso a paso
  SPEC_MODULOS_ADMIN.md                    especificación de los dos módulos nuevos
  TECHNICAL_REPORT.md                      este informe

.env.example                               variables de entorno
client/public/_redirects                   fallback SPA (Netlify/Cloudflare)
```

**Archivos modificados:** `client/src/App.tsx`, `client/src/components/SiteShell.tsx`,
`client/src/pages/SitePages.tsx` (sólo el componente `Contact` y las 5 imágenes del
sitio, que ahora pasan por `MediaImg`), `client/src/index.css` (2 reglas de estilo
para el acceso), `client/src/lib/rbac.ts`, `vite.config.ts` (plugin de fallback SPA
y el del manifiesto), `vitest.config.ts`, `tsconfig.json`,
`client/public/manus-routes.json`, `client/src/pages/admin/AdminShell.tsx`
(registro de los dos módulos nuevos en la navegación).

## 12. Limitaciones conocidas

1. **Google OAuth no está configurado.** El botón "Continuar con Google" lleva al
   `authorize` real de Google y falla. El login por correo (el método de las 5 cuentas
   reales) funciona.
2. El **correo de las notificaciones** no está implementado: las notificaciones se
   guardan en la tabla y se ven en la plataforma. El prompt lo planteaba como
   "se podrá incorporar", así que queda el punto de extensión (`supabase/functions/`
   con un proveedor como Resend, configurado desde variables de entorno).
3. El **formulario no adjunta archivos**: la carga de documentos es desde el panel.
4. La **recuperación de clave** depende de que el proveedor de email esté configurado
   en Supabase.
5. El **área de abogado** no tiene escritorio propio (se priorizó el panel y el área
   de cliente, según lo definido); el abogado opera sobre los clientes y
   expedientes que tiene asignados desde el panel.
6. El **límite por IP** es por dirección, no por persona: varias personas detrás del
   mismo NAT comparten cuota, y una persona que cambia de IP puede volver a escribir.
   Es el criterio pedido y evita eltrackers que un límite por cookie rompería.
7. **Un asset compilado por Vite no se puede sobrescribir en producción**: el despliegue
   en Vercel es un sitio estático y su sistema de archivos es de sólo lectura. Por eso
   un reemplazo se guarda en el bucket `site-media` con la **misma ruta lógica** y el
   sitio lo resuelve en tiempo de ejecución (`useMediaSrc`); si no hay reemplazo, el
   sitio sigue usando el asset compilado. Un asset protegido (`assets/`, `backups/`)
   no se elimina desde el panel: se reemplaza.
8. **La carga desde el panel no muestra progreso por byte**: `uploadImage` no expone
   un callback de progreso, así que la barra es determinista a nivel de lote y la
   cancelación aborta la cola pendiente.
9. **No hay comprobación de contraseñas comprometidas** contra listas de filtraciones:
   no hay un proveedor de ese tipo en la infraestructura. Lo que sí se comprueba es la
   reutilización de la contraseña actual y los mínimos de seguridad.
10. El **hash de las contraseñas** lo produce la infraestructura existente (Supabase
   Auth / GoTrue), no el código del proyecto: no se implementa hashing propio y jamás
   se guarda una contraseña en claro.
11. `scales.webp` y `team-room.jpg` no los referencia ningún archivo del sitio, así
    que Vite no los emite: aparecen en el inventario sin URL pública ni vista previa.

## 13. Despliegue en producción

| Pieza | Identificador | Estado |
|---|---|---|
| Repositorio | `https://github.com/manusrovira/estudio-casoratti` (rama `main`) | ✅ commits `84609ff` → `bb9dda5` |
| Sitio público | `https://estudio-casoratti.vercel.app` | ✅ |
| Proyecto Vercel | `cimiaproyect/estudio-casoratti` (plan Hobby) | ✅ deployments "Ready" (integración con GitHub: cada push a `main` despliega) |
| Proyecto Supabase | `estudio casoratti` · ref `tdlmritilgtwnxbxkrze` · org "Estudio Casoratti" | ✅ Healthy · región us-west-2 |
| Edge Function | `submit-consultation` | ✅ desplegada, con secretos `SITE_ORIGIN` y `RATE_LIMIT_SALT` |
| Variables en Vercel | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | ✅ (sólo las dos públicas, tipo Config) |
| Bucket multimedia | `site-media` (público, 10 MB) | ✅ creado y verificado |

**Configuración de build en Vercel** (`vercel.json`):

```json
{
  "buildCommand": "npm run build:static",
  "outputDirectory": "dist/public",
  "installCommand": "npm install --legacy-peer-deps",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

El `rewrite` catch-all es indispensable: el sitio es una SPA y `/panel/usuarios`
tiene que servir `index.html` con un 200 directo (verificado).

**Cuentas reales creadas** (password inicial única para las cinco: `casoratti2026`):

| Email | Rol | Ficha vinculada | Password actual |
|---|---|---|---|
| `casorattiestudiojuridico@gmail.com` | **admin** | — | `DraCasoratti2026.` (cambiada desde el panel) |
| `abogado@estudiocasoratti.com.ar` | abogado | Dr. Julián Casoratti (MP-4451) | `casoratti2026` |
| `cliente@ejemplo.com` | cliente | Ana Gómez | `casoratti2026` |
| `carlos@ejemplo.com` | cliente | Carlos Duarte | `casoratti2026` |
| `registrado@ejemplo.com` | usuario | — | `casoratti2026` |

Los roles se insertaron en `public.user_roles` (clave primaria `user_id`, un único rol
efectivo por usuario) con `granted_by` = administrador. **Ninguna cuenta se auto-asignó
el rol `admin`**: el alta se hizo por SQL directo desde un entorno protegido.

### Verificación del despliegue de los módulos nuevos

| Comprobación | Resultado |
|---|---|
| Push a `main` | ✅ `bb9dda5` (`16bb29f..bb9dda5 main -> main`) |
| Deploy en Vercel | ✅ «Ready» en producción |
| `/media-manifest.json` en producción | ✅ `200`, 6.660 bytes, 8 entradas con las mismas rutas, dimensiones y referencias que el build local |
| `/panel/imagenes` y `/panel/seguridad` | ✅ `200` (SPA con rewrite) |
| Chunk de administración en producción | ✅ contiene «Biblioteca de imágenes», «Actualizar contraseña», «La contraseña se actualizó correctamente», «Mover a la papelera», «Confirmo el reemplazo» y «Entiendo que esta acción no se puede deshacer» |
| CSS de los módulos en producción | ✅ `admin-media-tab` y `admin-sec-requirement` presentes |
| Variables de entorno en producción | ✅ el bundle apunta a `tdlmritilgtwnxbxkrze` y **no** al proyecto anterior |
| Clave de servicio en el bundle | ✅ **no** hay ninguna: la única aparición de `sb_secret_` es el código de la librería que distingue el tipo de clave |
| Imágenes del sitio público | ✅ `/` y `/recursos` cargan sin ninguna petición fallida (imágenes, scripts y CSS) |
