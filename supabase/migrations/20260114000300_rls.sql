-- =============================================================================
-- Estudio Jurídico Casoratti — 003: Row Level Security.
-- Toda tabla con datos privados queda bloqueada por defecto; el acceso se
-- abre únicamente por policy, evaluada por Postgres en cada request.
-- Regla: un usuario NUNCA puede cambiar su propio rol ni leer datos de otro.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Helpers de visibilidad (SECURITY DEFINER: evitan recursión de RLS y
--    devuelven booleanos, no datos, para no filtrar información).
-- ---------------------------------------------------------------------------
create or replace function public.current_lawyer_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select l.id from public.lawyers l where l.profile_id = auth.uid() limit 1;
$$;

create or replace function public.can_read_client(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.is_admin()
    or (public.current_role() = 'abogado' and exists (
         select 1 from public.clients c
         where c.id = p_client_id and c.assigned_lawyer_id = public.current_lawyer_id()))
    or exists (
         select 1 from public.clients c
         where c.id = p_client_id and c.user_id = auth.uid())
  , false);
$$;

create or replace function public.can_read_case(p_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.is_admin()
    or exists (
         select 1 from public.legal_cases lc
         where lc.id = p_case_id and lc.assigned_lawyer_id = public.current_lawyer_id())
    or exists (
         select 1 from public.legal_cases lc
         join public.clients c on c.id = lc.client_id
         where lc.id = p_case_id and c.user_id = auth.uid())
  , false);
$$;

create or replace function public.can_read_consultation(p_consultation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.is_admin()
    or exists (
         select 1 from public.legal_consultations lc
         where lc.id = p_consultation_id and lc.assigned_lawyer_id = public.current_lawyer_id())
    or exists (
         select 1 from public.legal_consultations lc
         join public.clients c on c.id = lc.client_id
         where lc.id = p_consultation_id and c.user_id = auth.uid())
  , false);
$$;

-- ---------------------------------------------------------------------------
-- 2. RLS ON en todas las tablas
-- ---------------------------------------------------------------------------
alter table public.profiles               enable row level security;
alter table public.user_roles             enable row level security;
alter table public.lawyers                enable row level security;
alter table public.clients                enable row level security;
alter table public.consultation_categories enable row level security;
alter table public.legal_consultations     enable row level security;
alter table public.consultation_notes      enable row level security;
alter table public.consultation_messages   enable row level security;
alter table public.legal_cases            enable row level security;
alter table public.case_documents         enable row level security;
alter table public.client_documents       enable row level security;
alter table public.audit_logs             enable row level security;
alter table public.notifications          enable row level security;
alter table public.rate_limits            enable row level security;

-- ---------------------------------------------------------------------------
-- 3. profiles
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 4. user_roles — el punto crítico: solo un admin concede roles.
--    Un usuario normal no tiene policy de INSERT/UPDATE/DELETE, por lo que
--    ni siquiera puede auto-asignarse el rol admin.
-- ---------------------------------------------------------------------------
drop policy if exists user_roles_select_self_or_admin on public.user_roles;
create policy user_roles_select_self_or_admin on public.user_roles
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists user_roles_admin_insert on public.user_roles;
create policy user_roles_admin_insert on public.user_roles
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists user_roles_admin_update on public.user_roles;
create policy user_roles_admin_update on public.user_roles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists user_roles_admin_delete on public.user_roles;
create policy user_roles_admin_delete on public.user_roles
  for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 5. lawyers
-- ---------------------------------------------------------------------------
drop policy if exists lawyers_select_staff on public.lawyers;
create policy lawyers_select_staff on public.lawyers
  for select to authenticated
  using (public.is_staff() or profile_id = auth.uid());

drop policy if exists lawyers_admin_write on public.lawyers;
create policy lawyers_admin_write on public.lawyers
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 6. clients
-- ---------------------------------------------------------------------------
drop policy if exists clients_select_scoped on public.clients;
create policy clients_select_scoped on public.clients
  for select to authenticated
  using (public.can_read_client(id));

drop policy if exists clients_admin_insert on public.clients;
create policy clients_admin_insert on public.clients
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists clients_admin_update on public.clients;
create policy clients_admin_update on public.clients
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists clients_admin_delete on public.clients;
create policy clients_admin_delete on public.clients
  for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 7. consultation_categories — datos públicos (áreas del estudio)
-- ---------------------------------------------------------------------------
drop policy if exists categories_public_read on public.consultation_categories;
create policy categories_public_read on public.consultation_categories
  for select to anon, authenticated
  using (true);

drop policy if exists categories_admin_write on public.consultation_categories;
create policy categories_admin_write on public.consultation_categories
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 8. legal_consultations — nunca visibles en la web pública.
--    Sin policy de INSERT para anon: el alta pública la hace la Edge Function
--    con service role (que además aplica rate limiting y validación).
-- ---------------------------------------------------------------------------
drop policy if exists consultations_select_scoped on public.legal_consultations;
create policy consultations_select_scoped on public.legal_consultations
  for select to authenticated
  using (public.can_read_consultation(id));

drop policy if exists consultations_admin_insert on public.legal_consultations;
create policy consultations_admin_insert on public.legal_consultations
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists consultations_admin_update on public.legal_consultations;
create policy consultations_admin_update on public.legal_consultations
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists consultations_admin_delete on public.legal_consultations;
create policy consultations_admin_delete on public.legal_consultations
  for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 9. consultation_notes — internas del estudio. El cliente no las ve:
--    no existe policy de select para usuarios finales.
-- ---------------------------------------------------------------------------
drop policy if exists notes_select_staff on public.consultation_notes;
create policy notes_select_staff on public.consultation_notes
  for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.legal_consultations lc
    where lc.id = consultation_notes.consultation_id
      and lc.assigned_lawyer_id = public.current_lawyer_id()));

drop policy if exists notes_insert_staff on public.consultation_notes;
create policy notes_insert_staff on public.consultation_notes
  for insert to authenticated
  with check (public.is_admin() or exists (
    select 1 from public.legal_consultations lc
    where lc.id = consultation_notes.consultation_id
      and lc.assigned_lawyer_id = public.current_lawyer_id()));

drop policy if exists notes_admin_delete on public.consultation_notes;
create policy notes_admin_delete on public.consultation_notes
  for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 10. consultation_messages — estudio ↔ cliente (ambos pueden escribir)
-- ---------------------------------------------------------------------------
drop policy if exists messages_select_scoped on public.consultation_messages;
create policy messages_select_scoped on public.consultation_messages
  for select to authenticated
  using (public.can_read_consultation(consultation_id));

drop policy if exists messages_insert_scoped on public.consultation_messages;
create policy messages_insert_scoped on public.consultation_messages
  for insert to authenticated
  with check (public.can_read_consultation(consultation_id));

drop policy if exists messages_admin_update on public.consultation_messages;
create policy messages_admin_update on public.consultation_messages
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists messages_admin_delete on public.consultation_messages;
create policy messages_admin_delete on public.consultation_messages
  for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 11. legal_cases
-- ---------------------------------------------------------------------------
drop policy if exists cases_select_scoped on public.legal_cases;
create policy cases_select_scoped on public.legal_cases
  for select to authenticated
  using (public.can_read_case(id));

drop policy if exists cases_admin_insert on public.legal_cases;
create policy cases_admin_insert on public.legal_cases
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists cases_admin_update on public.legal_cases;
create policy cases_admin_update on public.legal_cases
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists cases_admin_delete on public.legal_cases;
create policy cases_admin_delete on public.legal_cases
  for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 12. documentos (metadatos). El binario se autoriza en storage.objects.
-- ---------------------------------------------------------------------------
drop policy if exists case_documents_select_scoped on public.case_documents;
create policy case_documents_select_scoped on public.case_documents
  for select to authenticated
  using (public.can_read_case(legal_case_id));

drop policy if exists case_documents_insert_staff on public.case_documents;
create policy case_documents_insert_staff on public.case_documents
  for insert to authenticated
  with check (public.is_admin() or exists (
    select 1 from public.legal_cases lc
    where lc.id = case_documents.legal_case_id
      and lc.assigned_lawyer_id = public.current_lawyer_id()));

drop policy if exists case_documents_delete_admin on public.case_documents;
create policy case_documents_delete_admin on public.case_documents
  for delete to authenticated
  using (public.is_admin());

drop policy if exists client_documents_select_scoped on public.client_documents;
create policy client_documents_select_scoped on public.client_documents
  for select to authenticated
  using (public.can_read_client(client_id));

drop policy if exists client_documents_insert_admin on public.client_documents;
create policy client_documents_insert_admin on public.client_documents
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists client_documents_delete_admin on public.client_documents;
create policy client_documents_delete_admin on public.client_documents
  for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 13. audit_logs — solo lectura para administradores. Append-only: no hay
--     policy de UPDATE ni DELETE, por lo que nadie puede reescribir el
--     historial (ni siquiera un admin).
-- ---------------------------------------------------------------------------
drop policy if exists audit_logs_select_admin on public.audit_logs;
create policy audit_logs_select_admin on public.audit_logs
  for select to authenticated
  using (public.is_admin());

drop policy if exists audit_logs_admin_insert on public.audit_logs;
create policy audit_logs_admin_insert on public.audit_logs
  for insert to authenticated
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 14. notifications — cada usuario ve las suyas.
-- ---------------------------------------------------------------------------
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists notifications_insert_admin on public.notifications;
create policy notifications_insert_admin on public.notifications
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists notifications_delete_admin on public.notifications;
create policy notifications_delete_admin on public.notifications
  for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 15. rate_limits — sin policies: solo el service role (Edge Function) toca
--     esta tabla. RLS habilitada + sin policy = acceso denegado.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 16. Privilegios de columna: un cliente sólo actualiza sus datos permitidos,
--     nunca campos de control. Y anon no toca nada del dominio privado.
-- ---------------------------------------------------------------------------
revoke update on public.profiles from authenticated;
grant update (full_name, phone, document_id, avatar_url) on public.profiles to authenticated;

revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

revoke insert, update, delete on public.legal_consultations from anon;
revoke insert, update, delete on public.consultation_notes from anon;
revoke insert, update, delete on public.consultation_messages from anon;
revoke insert, update, delete on public.clients from anon;
revoke insert, update, delete on public.legal_cases from anon;
revoke insert, update, delete on public.audit_logs from anon;
revoke select on public.rate_limits from anon, authenticated;
