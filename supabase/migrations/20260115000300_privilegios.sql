-- =============================================================================
-- Estudio Jurídico Casoratti — privilegios de tabla para los roles de la API.
--
-- Crear la tabla no alcanza: en Supabase los roles `anon`, `authenticated` y
-- `service_role` necesitan permiso explícito sobre cada tabla para poder
-- consultarla. Sin estos GRANT la API responde
--   401/42501 "permission denied for table ..."
-- aunque las políticas RLS estén correctas.
--
-- El control de filas sigue enteramente en RLS: estos GRANT sólo habilitan el
-- acceso a la API, no amplían qué filas se pueden ver ni escribir.
-- =============================================================================

grant usage on schema public to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1) Visitantes sin sesión: sólo el catálogo público de áreas.
--    Las consultas del sitio nunca son visibles para `anon`.
-- ---------------------------------------------------------------------------
grant select on public.consultation_categories to anon;

-- ---------------------------------------------------------------------------
-- 2) Usuarios con sesión: DML completo sobre las tablas del estudio.
--    Las políticas de `20260114000300_rls.sql` filtran fila por fila según el
--    rol (admin, abogado asignado, cliente vinculado).
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on
  public.profiles,
  public.user_roles,
  public.lawyers,
  public.clients,
  public.consultation_categories,
  public.legal_consultations,
  public.consultation_notes,
  public.consultation_messages,
  public.legal_cases,
  public.case_documents,
  public.client_documents,
  public.audit_logs,
  public.notifications
to authenticated;

-- El cliente sólo puede modificar estos campos de su propio perfil.
grant update (full_name, phone, document_id, avatar_url)
  on public.profiles to authenticated;
grant update (read_at)
  on public.notifications to authenticated;

-- ---------------------------------------------------------------------------
-- 3) service_role: lo usa la Edge Function para dar de alta las consultas y
--    aplicar el rate limiting por IP. Es el único rol con escritura sobre
--    `legal_consultations` desde la API pública.
-- ---------------------------------------------------------------------------
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- ---------------------------------------------------------------------------
-- 4) Tablas nuevas: heredan los mismos permisos que las actuales.
-- ---------------------------------------------------------------------------
alter default privileges in schema public
  grant select on tables to anon;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) Funciones de servidor: sólo `service_role` las puede ejecutar.
--    `public` y `anon` quedan sin permiso (la Edge Function es el único
--    camino válido para registrar una consulta o consumir el rate limit).
-- ---------------------------------------------------------------------------
grant execute on function public.submit_consultation(text, text, text, uuid, text, text, text, text, integer, interval)
  to service_role;
grant execute on function public.consume_rate_limit(text, integer, integer)
  to service_role;
