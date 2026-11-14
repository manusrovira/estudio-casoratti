-- =============================================================================
-- Estudio Jurídico Casoratti — 006: rate limiting de la Edge Function.
--
-- La tabla `rate_limits` no tiene políticas RLS: sólo la service role la
-- toca, a través de esta función SECURITY DEFINER. Así el contador se
-- incrementa de forma atómica (upsert) y nunca queda en manos del navegador.
-- =============================================================================

create or replace function public.consume_rate_limit(
  p_key             text,
  p_max             integer,
  p_window_seconds  integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count  integer;
  v_window timestamptz;
begin
  insert into public.rate_limits (key, window_started_at, count)
  values (p_key, now(), 1)
  on conflict (key) do update
    set count = case
                  when public.rate_limits.window_started_at
                       < now() - make_interval(secs => p_window_seconds)
                    then 1
                  else public.rate_limits.count + 1
                end,
        window_started_at = case
                  when public.rate_limits.window_started_at
                       < now() - make_interval(secs => p_window_seconds)
                    then now()
                  else public.rate_limits.window_started_at
                end
  returning public.rate_limits.count, public.rate_limits.window_started_at
    into v_count, v_window;

  return v_count <= p_max;
end;
$$;

revoke execute on function public.consume_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer)
  to service_role;
