-- =============================================================================
-- Estudio Jurídico Casoratti — 002: funciones, triggers, auditoría y
-- notificaciones. Todo lo que muta datos de forma sensible pasa por acá.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Secuencia y código de referencia de consultas
-- ---------------------------------------------------------------------------
create sequence if not exists public.consultation_reference_seq;

create or replace function public.next_reference_code()
returns text
language sql
volatile
set search_path = public
as $$
  select 'CAS-' || to_char(now(), 'YY') || '-' || lpad(nextval('public.consultation_reference_seq')::text, 5, '0');
$$;

-- El código de referencia lo genera la base: el cliente nunca lo elige (y así
-- no puede colisionar ni inventar uno).
alter table public.legal_consultations
  alter column reference_code set default public.next_reference_code();

-- ---------------------------------------------------------------------------
-- 2. Helpers de rol.
--    SECURITY DEFINER + search_path fijo: se usan dentro de policies RLS sobre
--    user_roles, y sin esto PostgreSQL entraría en recursión infinita.
-- ---------------------------------------------------------------------------
create or replace function public.current_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select r.role
  from public.user_roles r
  where r.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_role() = 'admin', false);
$$;

-- admin + abogado: el equipo del estudio
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_role() in ('admin', 'abogado'), false);
$$;

create or replace function public.is_client()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_role() = 'cliente', false);
$$;

-- ---------------------------------------------------------------------------
-- 3. updated_at automático
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists trg_clients_updated_at on public.clients;
create trigger trg_clients_updated_at before update on public.clients
  for each row execute function public.set_updated_at();

drop trigger if exists trg_consultations_updated_at on public.legal_consultations;
create trigger trg_consultations_updated_at before update on public.legal_consultations
  for each row execute function public.set_updated_at();

drop trigger if exists trg_cases_updated_at on public.legal_cases;
create trigger trg_cases_updated_at before update on public.legal_cases
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Alta automática de perfil + rol por defecto al crearse un usuario en
--    Supabase Auth (Google OAuth o email). Es el vínculo identity ↔ Postgres.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, avatar_url, accepted_terms_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url',
    case
      when coalesce(new.raw_user_meta_data ->> 'accepted_terms', 'false') = 'true' then now()
      else null
    end
  )
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'usuario')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 5. Auditoría: registra toda operación administrativa o sensible.
--    actor_id sale de auth.uid() — el rol no viene del frontend.
-- ---------------------------------------------------------------------------
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity_id uuid;
  v_action    text;
  v_row       jsonb;
begin
  v_row       := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  -- La clave primaria no siempre se llama 'id' (user_roles usa user_id).
  v_entity_id := nullif(coalesce(v_row ->> 'id', v_row ->> 'user_id'), '')::uuid;
  v_action    := lower(tg_op) || '_' || tg_table_name;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    v_action,
    tg_table_name,
    v_entity_id,
    jsonb_build_object(
      'changed_columns',
      coalesce(
        (select jsonb_agg(key) from jsonb_each(v_row)),
        '[]'::jsonb
      )
    )
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_audit_consultations on public.legal_consultations;
create trigger trg_audit_consultations after insert or update or delete on public.legal_consultations
  for each row execute function public.audit_row_change();

drop trigger if exists trg_audit_clients on public.clients;
create trigger trg_audit_clients after insert or update or delete on public.clients
  for each row execute function public.audit_row_change();

drop trigger if exists trg_audit_cases on public.legal_cases;
create trigger trg_audit_cases after insert or update or delete on public.legal_cases
  for each row execute function public.audit_row_change();

drop trigger if exists trg_audit_user_roles on public.user_roles;
create trigger trg_audit_user_roles after insert or update or delete on public.user_roles
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------------
-- 6. Notificaciones del sistema
-- ---------------------------------------------------------------------------
create or replace function public.notify_user(
  p_user_id uuid,
  p_type    text,
  p_title   text,
  p_body    text default null,
  p_link    text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (user_id, type, title, body, link)
  values (p_user_id, p_type, p_title, p_body, p_link);
$$;

-- Notifica a todos los administradores del estudio.
create or replace function public.notify_admins(
  p_type  text,
  p_title text,
  p_body  text default null,
  p_link  text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (user_id, type, title, body, link)
  select r.user_id, p_type, p_title, p_body, p_link
  from public.user_roles r
  where r.role = 'admin';
$$;

-- Nueva consulta recibida → administradores (+ abogado asignado, si hubiere).
create or replace function public.on_consultation_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.notify_admins(
    'consultation_created',
    'Nueva consulta recibida',
    new.full_name || ' — ' || new.subject,
    '/panel/consultas?ref=' || new.reference_code
  );

  if new.assigned_lawyer_id is not null then
    insert into public.notifications (user_id, type, title, body, link)
    select l.profile_id, 'consultation_assigned', 'Consulta asignada',
           new.reference_code || ' — ' || new.subject,
           '/panel/consultas?ref=' || new.reference_code
    from public.lawyers l
    where l.id = new.assigned_lawyer_id and l.profile_id is not null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_consultation_created on public.legal_consultations;
create trigger trg_consultation_created after insert on public.legal_consultations
  for each row execute function public.on_consultation_created();

-- Cambio de estado → cliente vinculado y abogado responsable.
create or replace function public.on_consultation_status_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.client_id is not null then
    insert into public.notifications (user_id, type, title, body, link)
    select c.user_id, 'consultation_status', 'Tu consulta cambió de estado',
           new.reference_code || ' — ' || new.status::text,
           '/mi-cuenta/consultas/' || new.id
    from public.clients c
    where c.id = new.client_id and c.user_id is not null;
  end if;

  if new.assigned_lawyer_id is not null then
    insert into public.notifications (user_id, type, title, body, link)
    select l.profile_id, 'consultation_status', 'Consulta actualizada',
           new.reference_code || ' — ' || new.status::text,
           '/panel/consultas?ref=' || new.reference_code
    from public.lawyers l
    where l.id = new.assigned_lawyer_id and l.profile_id is not null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_consultation_status on public.legal_consultations;
create trigger trg_consultation_status
  after update of status on public.legal_consultations
  for each row execute function public.on_consultation_status_changed();

-- Respuesta del estudio → cliente.
create or replace function public.on_consultation_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, type, title, body, link)
  select c.user_id, 'consultation_reply', 'Recibiste una respuesta',
         left(new.body, 160),
         '/mi-cuenta/consultas/' || new.consultation_id
  from public.legal_consultations lc
  join public.clients c on c.id = lc.client_id
  where lc.id = new.consultation_id and c.user_id is not null;

  return new;
end;
$$;

drop trigger if exists trg_consultation_message on public.consultation_messages;
create trigger trg_consultation_message after insert on public.consultation_messages
  for each row execute function public.on_consultation_message();

-- Documento disponible → cliente del expediente + abogado responsable.
create or replace function public.on_case_document_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case public.legal_cases%rowtype;
begin
  select * into v_case from public.legal_cases where id = new.legal_case_id;

  if v_case.client_id is not null then
    insert into public.notifications (user_id, type, title, body, link)
    select c.user_id, 'document_available', 'Nuevo documento disponible',
           new.file_name, '/mi-cuenta/documentos'
    from public.clients c
    where c.id = v_case.client_id and c.user_id is not null;
  end if;

  if v_case.assigned_lawyer_id is not null then
    insert into public.notifications (user_id, type, title, body, link)
    select l.profile_id, 'document_available', 'Nuevo documento en un expediente',
           new.file_name, '/panel/documentacion'
    from public.lawyers l
    where l.id = v_case.assigned_lawyer_id and l.profile_id is not null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_case_document_created on public.case_documents;
create trigger trg_case_document_created after insert on public.case_documents
  for each row execute function public.on_case_document_created();

-- Actualización de expediente → cliente y abogado.
create or replace function public.on_case_updated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.client_id is not null then
    insert into public.notifications (user_id, type, title, body, link)
    select c.user_id, 'case_updated', 'Tu expediente se actualizó',
           new.case_number || ' — ' || new.title,
           '/mi-cuenta/expedientes'
    from public.clients c
    where c.id = new.client_id and c.user_id is not null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_case_updated on public.legal_cases;
create trigger trg_case_updated after update on public.legal_cases
  for each row execute function public.on_case_updated();
