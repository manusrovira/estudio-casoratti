-- =============================================================================
-- Estudio Jurídico Casoratti — Esquema base (PostgreSQL / Supabase)
-- 001: enums, tablas, claves foráneas, índices y restricciones de integridad.
-- Idempotente: se puede reejecutar sobre una base ya migrada sin romperla.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tipos enumerados
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.app_role as enum ('admin', 'abogado', 'cliente', 'usuario');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.consultation_status as enum (
    'nueva', 'pendiente', 'en_analisis', 'en_seguimiento',
    'respondida', 'cerrada', 'rechazada'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.client_status as enum ('activo', 'potencial', 'inactivo');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.case_status as enum (
    'inicial', 'en_tramitacion', 'suspendido', 'archivado', 'cerrado'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. profiles — identidad de cada usuario de Supabase Auth
--    El id coincide con auth.users.id (FK). El rol NO vive acá: vive en
--    user_roles, para que un usuario nunca pueda auto-asignarse privilegios
--    escribiendo su propia fila de perfil.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  full_name          text,
  phone              text,
  document_id        text,
  avatar_url         text,
  accepted_terms_at  timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. user_roles — un rol efectivo por usuario
-- ---------------------------------------------------------------------------
create table if not exists public.user_roles (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  role        public.app_role not null,
  granted_by  uuid references auth.users (id) on delete set null,
  granted_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 4. lawyers — datos profesionales del equipo jurídico
-- ---------------------------------------------------------------------------
create table if not exists public.lawyers (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid unique references public.profiles (id) on delete set null,
  full_name       text not null,
  license_number  text,
  email           text,
  specialties     text[] not null default '{}',
  bio             text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 5. clients — ficha de cliente del estudio
--    user_id permite vincular un usuario registrado con su ficha; un cliente
--    puede no tener cuenta en la plataforma.
-- ---------------------------------------------------------------------------
create table if not exists public.clients (
  id                   uuid primary key default gen_random_uuid(),
  full_name            text not null,
  document_id          text,
  email                text,
  phone                text,
  address              text,
  status               public.client_status not null default 'activo',
  assigned_lawyer_id   uuid references public.lawyers (id) on delete set null,
  user_id              uuid unique references public.profiles (id) on delete set null,
  internal_notes       text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 6. consultation_categories — áreas jurídicas configurables desde admin
-- ---------------------------------------------------------------------------
create table if not exists public.consultation_categories (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  slug         text not null unique,
  description  text,
  is_active    boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 7. legal_cases — expedientes / asuntos jurídicos
-- ---------------------------------------------------------------------------
create table if not exists public.legal_cases (
  id                   uuid primary key default gen_random_uuid(),
  case_number          text not null unique,
  title                text not null,
  client_id            uuid not null references public.clients (id) on delete cascade,
  assigned_lawyer_id   uuid references public.lawyers (id) on delete set null,
  fuero                text,
  jurisdiction         text,
  court                text,
  court_case_number    text,
  status               public.case_status not null default 'inicial',
  description          text,
  internal_notes       text,
  started_at           date not null default current_date,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 8. legal_consultations — consultas recibidas desde el formulario público
--    El insert público lo hace la Edge Function con service role (ver
--    supabase/functions/submit-consultation). No hay policy de INSERT para
--    anon: nadie escribe directo en esta tabla desde el navegador.
-- ---------------------------------------------------------------------------
create table if not exists public.legal_consultations (
  id                   uuid primary key default gen_random_uuid(),
  reference_code       text not null unique,
  full_name            text not null,
  email                text not null,
  phone                text,
  category_id          uuid references public.consultation_categories (id) on delete set null,
  subject              text not null,
  description          text not null,
  status               public.consultation_status not null default 'nueva',
  assigned_lawyer_id   uuid references public.lawyers (id) on delete set null,
  client_id            uuid references public.clients (id) on delete set null,
  legal_case_id        uuid references public.legal_cases (id) on delete set null,
  privacy_accepted_at  timestamptz not null default now(),
  is_new               boolean not null default true,
  received_at          timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint legal_consultations_email_format check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

-- ---------------------------------------------------------------------------
-- 9. consultation_notes — notas internas del estudio (nunca visibles al
--    cliente). Separadas de consultation_messages a propósito.
-- ---------------------------------------------------------------------------
create table if not exists public.consultation_notes (
  id               uuid primary key default gen_random_uuid(),
  consultation_id  uuid not null references public.legal_consultations (id) on delete cascade,
  author_id        uuid references public.profiles (id) on delete set null,
  body             text not null,
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 10. consultation_messages — mensajes estudio ↔ cliente (visibles al cliente)
-- ---------------------------------------------------------------------------
create table if not exists public.consultation_messages (
  id               uuid primary key default gen_random_uuid(),
  consultation_id  uuid not null references public.legal_consultations (id) on delete cascade,
  author_id        uuid references public.profiles (id) on delete set null,
  body             text not null,
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 11. case_documents / client_documents — metadatos de los archivos privados.
--     El binario vive en Supabase Storage (buckets privados).
-- ---------------------------------------------------------------------------
create table if not exists public.case_documents (
  id             uuid primary key default gen_random_uuid(),
  legal_case_id  uuid not null references public.legal_cases (id) on delete cascade,
  storage_path   text not null,
  file_name      text not null,
  mime_type      text,
  size_bytes     bigint,
  uploaded_by    uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now()
);

create table if not exists public.client_documents (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients (id) on delete cascade,
  storage_path text not null,
  file_name    text not null,
  mime_type    text,
  size_bytes   bigint,
  uploaded_by  uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 12. audit_logs — trazabilidad de operaciones administrativas
-- ---------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references public.profiles (id) on delete set null,
  action       text not null,
  entity_type  text not null,
  entity_id    uuid,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 13. notifications — notificaciones del sistema (respetan permisos)
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text,
  link       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 14. rate_limits — contador de intentos por ventana (Edge Function)
-- ---------------------------------------------------------------------------
create table if not exists public.rate_limits (
  key               text primary key,
  window_started_at timestamptz not null default now(),
  count             integer not null default 1
);

-- ---------------------------------------------------------------------------
-- 15. Índices — de acuerdo a los accesos reales del panel y del área de
--     cliente (filtros por estado, área, fecha, cliente y abogado).
-- ---------------------------------------------------------------------------
create index if not exists idx_consultations_status      on public.legal_consultations (status);
create index if not exists idx_consultations_category    on public.legal_consultations (category_id);
create index if not exists idx_consultations_received     on public.legal_consultations (received_at desc);
create index if not exists idx_consultations_client      on public.legal_consultations (client_id);
create index if not exists idx_consultations_lawyer      on public.legal_consultations (assigned_lawyer_id);
create index if not exists idx_consultations_full_name   on public.legal_consultations (lower(full_name));
create index if not exists idx_consultations_email       on public.legal_consultations (lower(email));
create index if not exists idx_consultations_new         on public.legal_consultations (is_new) where is_new;

create index if not exists idx_notes_consultation        on public.consultation_notes (consultation_id);
create index if not exists idx_messages_consultation     on public.consultation_messages (consultation_id, created_at);

create index if not exists idx_cases_client              on public.legal_cases (client_id);
create index if not exists idx_cases_lawyer              on public.legal_cases (assigned_lawyer_id);
create index if not exists idx_cases_status              on public.legal_cases (status);

create index if not exists idx_clients_lawyer            on public.clients (assigned_lawyer_id);
create index if not exists idx_clients_status            on public.clients (status);
create index if not exists idx_clients_email             on public.clients (lower(email));

create index if not exists idx_case_documents_case       on public.case_documents (legal_case_id);
create index if not exists idx_client_documents_client   on public.client_documents (client_id);

create index if not exists idx_audit_logs_actor          on public.audit_logs (actor_id);
create index if not exists idx_audit_logs_entity         on public.audit_logs (entity_type, entity_id);
create index if not exists idx_audit_logs_created        on public.audit_logs (created_at desc);

create index if not exists idx_notifications_user        on public.notifications (user_id, created_at desc);
create index if not exists idx_notifications_unread     on public.notifications (user_id) where read_at is null;

create index if not exists idx_profiles_email            on public.profiles (lower(full_name));
