-- =============================================================================
-- 007 · Panel de administración de consultas
--
--  - Guarda la IP de origen de cada consulta (control de solicitudes).
--  - Da un código de referencia por defecto (la Edge Function no lo generaba).
--  - Alta atómica con ventana móvil de 24 h y máximo 5 consultas por IP.
--  - Estadísticas reales para el panel (KPIs, serie diaria, estados e IPs).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Origen de la consulta
-- ---------------------------------------------------------------------------
alter table public.legal_consultations
  add column if not exists ip_address text,
  add column if not exists user_agent text;

create index if not exists legal_consultations_ip_idx
  on public.legal_consultations (ip_address);

create index if not exists legal_consultations_received_at_idx
  on public.legal_consultations (received_at desc);

create index if not exists legal_consultations_status_received_idx
  on public.legal_consultations (status, received_at desc);

-- El código de referencia se genera en la base: así ninguna vía de alta puede
-- insertar una consulta sin código (la función lo pedía y no existía default).
alter table public.legal_consultations
  alter column reference_code set default (
    'CONS-' || to_char((now() at time zone 'America/Argentina/Buenos_Aires'), 'YYMMDD') || '-' ||
    upper(substr(md5(gen_random_uuid()::text), 1, 6))
  );

-- ---------------------------------------------------------------------------
-- 2. Alta de consulta con límite por IP (ventana móvil de 24 horas)
--
--    El control vive acá, no en el navegador: el conteo y la inserción ocurren
--    en la misma transacción y con un lock por IP, así que dos envíos
--    simultáneos desde la misma dirección no pueden pasarse el límite.
-- ---------------------------------------------------------------------------
create or replace function public.submit_consultation(
  p_full_name text,
  p_email text,
  p_phone text,
  p_category_id uuid,
  p_subject text,
  p_description text,
  p_ip text,
  p_user_agent text default null,
  p_max integer default 5,
  p_window interval default interval '24 hours'
)
returns table (
  allowed boolean,
  reference_code text,
  used integer,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used integer := 0;
  v_oldest timestamptz;
  v_now timestamptz := now();
  v_reference text;
begin
  -- Validación mínima en el servidor: el navegador no es una garantía.
  if coalesce(length(trim(p_full_name)), 0) < 3 then
    raise exception 'nombre invalido' using errcode = '22023';
  end if;
  if p_email is null or p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'email invalido' using errcode = '22023';
  end if;
  if coalesce(length(trim(p_subject)), 0) < 3 then
    raise exception 'asunto invalido' using errcode = '22023';
  end if;
  if coalesce(length(p_description), 0) < 10 or length(p_description) > 5000 then
    raise exception 'descripcion invalida' using errcode = '22023';
  end if;

  -- Sin IP no se puede aplicar el límite por dirección: se acepta el envío
  -- (la IP se registra igual para poder controlarla desde el panel).
  if p_ip is null or btrim(p_ip) = '' then
    insert into public.legal_consultations (
      full_name, email, phone, category_id, subject, description,
      status, is_new, privacy_accepted_at, ip_address, user_agent
    ) values (
      trim(p_full_name), lower(trim(p_email)), nullif(btrim(coalesce(p_phone, '')), ''),
      p_category_id, trim(p_subject), p_description,
      'nueva', true, v_now, null, p_user_agent
    )
    returning public.legal_consultations.reference_code into v_reference;

    return query select true, v_reference, 0, 0;
    return;
  end if;

  -- Serializa las altas de la misma IP.
  perform pg_advisory_xact_lock(hashtext('consulta:' || p_ip));

  select count(*)::integer, min(received_at)
    into v_used, v_oldest
    from public.legal_consultations
   where ip_address = p_ip
     and received_at > v_now - p_window;

  if v_used >= p_max then
    return query
      select false,
             null::text,
             v_used,
             greatest(0, extract(epoch from (v_oldest + p_window - v_now))::integer);
    return;
  end if;

  insert into public.legal_consultations (
    full_name, email, phone, category_id, subject, description,
    status, is_new, privacy_accepted_at, ip_address, user_agent
  ) values (
    trim(p_full_name), lower(trim(p_email)), nullif(btrim(coalesce(p_phone, '')), ''),
    p_category_id, trim(p_subject), p_description,
    'nueva', true, v_now, p_ip, p_user_agent
  )
  returning public.legal_consultations.reference_code into v_reference;

  return query select true, v_reference, v_used + 1, 0;
end;
$$;

revoke all on function public.submit_consultation(text, text, text, uuid, text, text, text, text, integer, interval)
  from public, anon, authenticated;
grant execute on function public.submit_consultation(text, text, text, uuid, text, text, text, text, integer, interval)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. Estadísticas del panel (sólo administradores)
-- ---------------------------------------------------------------------------
create or replace function public.admin_consultation_stats(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 30), 365));
  v_today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'generado_en', now(),
    'limite_por_ip', 5,
    'ventana_horas', 24,
    'total', (select count(*) from public.legal_consultations),
    'nuevas', (select count(*) from public.legal_consultations where is_new),
    'hoy', (select count(*) from public.legal_consultations
             where (received_at at time zone 'America/Argentina/Buenos_Aires')::date = v_today),
    'ultimos_7', (select count(*) from public.legal_consultations
                    where received_at > now() - interval '7 days'),
    'ultimos_30', (select count(*) from public.legal_consultations
                     where received_at > now() - interval '30 days'),
    'en_analisis', (select count(*) from public.legal_consultations where status = 'en_analisis'),
    'respondidas', (select count(*) from public.legal_consultations
                     where status in ('respondida', 'cerrada')),
    'ips_24h', (select count(distinct ip_address) from public.legal_consultations
                 where received_at > now() - interval '24 hours'
                   and ip_address is not null),
    'por_dia', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object('fecha', to_char(x.dia, 'YYYY-MM-DD'), 'total', x.total)
          order by x.dia
        ),
        '[]'::jsonb
      )
      from (
        select d.dia::date as dia, count(lc.id)::integer as total
          from generate_series(
                 v_today - (v_days - 1),
                 v_today,
                 interval '1 day'
               ) as d(dia)
          left join public.legal_consultations lc
            on (lc.received_at at time zone 'America/Argentina/Buenos_Aires')::date = d.dia::date
         group by d.dia
      ) x
    ),
    'por_estado', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object('estado', s.status::text, 'total', s.total)
          order by s.total desc
        ),
        '[]'::jsonb
      )
      from (
        select status, count(*)::integer as total
          from public.legal_consultations
         group by status
      ) s
    ),
    'por_ip', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object('ip', i.ip, 'total_24h', i.total_24h, 'total', i.total)
          order by i.total_24h desc, i.total desc
        ),
        '[]'::jsonb
      )
      from (
        select ip_address as ip,
               count(*) filter (where received_at > now() - interval '24 hours')::integer as total_24h,
               count(*)::integer as total
          from public.legal_consultations
         where ip_address is not null
         group by ip_address
         order by total_24h desc, total desc
         limit 10
      ) i
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_consultation_stats(integer) from public, anon;
grant execute on function public.admin_consultation_stats(integer) to authenticated;
