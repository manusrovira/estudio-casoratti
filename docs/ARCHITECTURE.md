# Arquitectura — Estudio Jurídico Casoratti

Cómo se construyó la plataforma de gestión jurídica sobre el sitio institucional
existente, y por qué se tomó cada decisión.

---

## 1. Punto de partida

El proyecto entregado era un sitio institucional **100% estático**:

- React 19 + Vite 7 + Tailwind 4 + wouter (rutas del cliente).
- Las páginas públicas no llamaban a ningún backend: el formulario de contacto
  sólo componía un link de WhatsApp y mostraba un estado de éxito local.
- La capa de datos existente (Drizzle + **MySQL**, tabla `users`) y la
  autenticación (OAuth de la plataforma Manus) existían, pero **ninguna página
  pública las usaba**. El `startLogin()` además lanza error si no hay
  `oauthPortalUrl` configurado, es decir: hoy no se podía iniciar sesión desde
  la web.

**Regla fundamental del encargo:** no eliminar, reemplazar ni alterar el diseño
de la página. Por eso la decisión fue **aditiva**: la plataforma nueva no
depende de la capa Manus ni de MySQL, y el código existente queda intacto. El
sitio público sigue siendo el mismo, con dos agregados: un botón discreto de
acceso en la cabecera y un formulario que ahora guarda de verdad.

## 2. Decisión central: la base de datos es el perímetro de seguridad

El encargo pide PostgreSQL + Supabase + RLS, y también "validación de permisos
en backend". Con Supabase, esas dos cosas son la misma: **Postgres es el
backend**. Cada request llega a PostgREST, que aplica las políticas RLS con el
JWT del usuario. No hay un "backend" en el sentido de una API con
`if (role === 'admin')` escrito a mano.

Consecuencia práctica: el frontend llama directo a la API de Supabase con la
clave pública, y **no existe ningún camino por el que un cliente vea datos de
otro**. Un bug de JavaScript en el panel no puede filtrar información: la
consulta sigue passer por Postgres.

Lo que **no** se hizo, deliberadamente:

- No se escribió una capa de API propia con endpoints y validación duplicada.
- No se copiaron los roles a `localStorage` ni a variables de estado: el rol se
  lee de `public.user_roles` en cada sesión.
- No se desactivó ninguna política RLS "para que anda".

## 3. Mapa de la base

15 tablas en el esquema `public`, todas con RLS habilitada:

| Tabla | Qué guarda | Quién la ve |
|---|---|---|
| `profiles` | datos del usuario vinculado a `auth.users` | el propio + admin |
| `user_roles` | rol efectivo (`admin`/`abogado`/`cliente`/`usuario`) | el propio + admin |
| `lawyers` | datos profesionales del equipo | staff |
| `clients` | ficha de cliente, con vínculo opcional a un usuario | admin, abogado asignado, el propio cliente |
| `consultation_categories` | áreas jurídicas configurables | público (lectura) |
| `legal_consultations` | consultas recibidas | admin, abogado asignado, cliente vinculado |
| `consultation_notes` | notas internas del estudio | **sólo staff** |
| `consultation_messages` | mensajes estudio ↔ cliente | la consulta y sus partes |
| `legal_cases` | expedientes | admin, abogado asignado, cliente |
| `case_documents` | metadatos de archivos de expedientes | los del expediente |
| `client_documents` | metadatos de archivos de clientes | los del cliente |
| `audit_logs` | trail de operaciones | admin, sólo lectura |
| `notifications` | avisos del sistema | el destinatario |
| `rate_limits` | contador de la Edge Function | service role |
| `consultation_categories` | (arriba) | — |

Decisiones de modelado que vale la pena remarcar:

- **`user_roles` con PK `user_id`**: un rol efectivo por usuario. Un modelo
  many-to-many con varios roles por usuario obligaría a definir precedencias
  ("admin > abogado > cliente") y a multiplicar las policies. Con un rol por
  usuario, cada policy es una comparación.
- **`profiles` sin columna de rol**: separar la identidad del privilegio es lo
  que hace imposible el auto-escalamiento. Un usuario que controla su propia
  fila de `profiles` no cambia nada de su rol, porque el rol no está ahí.
- **`consultation_notes` separado de `consultation_messages`**: dos tablas, no
  una con un flag `is_internal`. Así el aislamiento es estructural (RLS sobre
  la tabla) y no condicional (un `where is_internal = false` que alguien puede
  olvidar). Las notas internas no tienen policy de SELECT para clientes.
- **`reference_code` único** con secuencia: cada consulta recibe un identificador
  legible (`CAS-26-00042`) que el estudio puede citar por teléfono.
- **UUID como PK**: las URLs de expedientes y consultas no adivinan IDs
  secuenciales.

## 4. Seguridad

### 4.1 Helpers de rol

Las policies no pueden consultar `user_roles` directamente (eso sería recursión
infinita de RLS). Se resolvió con funciones `SECURITY DEFINER` con
`search_path` fijo:

```
current_role()      → app_role del usuario autenticado
is_admin()          → current_role() = 'admin'
is_staff()          → admin o abogado
current_lawyer_id() → lawyer.id del abogado autenticado
can_read_client(id) / can_read_case(id) / can_read_consultation(id)
```

Estas funciones devuelven **booleanos**, no datos: no filtran información a
quien no le corresponde.

### 4.2 El punto que más se vigila: el auto-escalamiento

`user_roles` sólo tiene policies de INSERT/UPDATE/DELETE para `is_admin()`. Un
usuario normal que intente `insert into user_roles (user_id, role) values (mi_id, 'admin')`
choca contra la política y Postgres rechaza la operación. Además, la columna
`role` no está entre las columnas que un usuario puede actualizar en `profiles`,
y el `GRANT` de columna sobre `notifications` impide tocar campos ajenos.

El primer administrador se otorga desde SQL Editor con un `update` ejecutado por
el rol propietario de la base (procedimiento protegido, como pide el encargo).

### 4.3 Rate limiting y spam

La Edge Function `submit-consultation` es el único camino de alta de
consultas. Hace, en el servidor:

1. Validación con Zod (largo, formato de correo, privacidad aceptada).
2. Honeypot (`website`): si viene completo, se responde OK pero no se guarda nada.
3. Rate limiting por IP: hash SHA-256 con sal → `consume_rate_limit()` (upsert
   atómico) → máximo 5 consultas por hora y IP. **Nunca se guarda la IP en
   claro.**
4. Inserción con la service role (que nunca sale del servidor).

El `service_role` **no** está en el bundle del navegador: `SUPABASE_SERVICE_ROLE_KEY`
es una variable de entorno del servidor, y `client/src/lib/supabase.ts` sólo usa
`VITE_SUPABASE_ANON_KEY`.

### 4.4 Documentos

Buckets privados con paths `{owner_id}/{archivo}`. Las policies de
`storage.objects` reutilizan los mismos helpers de visibilidad, así que un
cliente no puede descargar el documento de otro. El panel genera URLs firmadas
con 60 segundos de vigencia.

## 5. Frontend

```
client/src/
  lib/supabase.ts          cliente + constantes de buckets/funciones
  lib/rbac.ts              tipos, roles, etiquetas de estado
  contexts/AuthContext.tsx sesión + perfil + rol (leído de Postgres)
  pages/auth/AuthPages.tsx ingreso, registro, recuperación
  pages/account/AccountArea.tsx  área de cliente
  pages/admin/*.tsx        panel de administración (8 módulos)
  styles/admin.css         sistema visual del panel
```

El panel tiene su propio marco (`.admin-shell`): no es la web pública con una
sidebar pegada. Comparte el ADN —tinta, cobre, marfil, Georgia— pero con
densidad de herramienta de trabajo.

Rutas nuevas, sin tocar las existentes:

| Ruta | Quién entra |
|---|---|
| `/ingresar`, `/registro` | público |
| `/mi-cuenta` | cliente (y staff) |
| `/panel/*` | sólo admin (la guarda real está en RLS) |

## 6. Qué NO se tocó

- Todas las páginas públicas y su diseño: intactas.
- La capa Drizzle/MySQL y la autenticación Manus: intactas (no son necesarias
  para la plataforma nueva, pero borrarlas rompería la regla de no eliminar
  funcionalidades y no hacía falta para el objetivo).
- `server/`, `drizzle/`, `patches/` y la imagen de Docker: sin cambios.

## 7. Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| API propia en Express que revalida permisos | Duplica el control de acceso que ya hace RLS y agrega una superficie de ataque. El encargo pide explícitamente que las policies se prueben contra la API. |
| Guardar el rol en `localStorage` o en el estado de React | El frontend sería la fuente de la verdad del privilegio: exactamente el escalamiento que hay que impedir. |
| Un solo bucket de documentos | Impide separar las policies de clientes y expedientes, y obliga a permisos más laxos. |
| Un `is_internal` en la tabla de mensajes | El aislamiento queda en manos de un `where` que un error puede borrar; con dos tablas es estructural. |
| Enviar las consultas con la anon key desde el navegador | Habría que abrir una policy de INSERT a `anon`, que expone la tabla a spam y a la escritura directa. Con la Edge Function hay rate limiting y validación en un solo lugar. |
