-- =============================================================================
-- Estudio Jurídico Casoratti — 007: email en el perfil.
--
-- `auth.users` guarda el email, pero esa tabla no es consultable desde el
-- cliente (exige service role). Sin una copia en `profiles`, el panel no
-- puede mostrar a qué cuenta corresponde un usuario registrado, ni el área de
-- cliente puede indicar su correo.
--
-- La copia se mantiene sincronizada por el trigger de alta y por un
-- backfill para las cuentas ya creadas.
-- =============================================================================

alter table public.profiles add column if not exists email text;

update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id and p.email is null and u.email is not null;

create index if not exists idx_profiles_email_lookup on public.profiles (lower(email));

-- El trigger de alta guarda también el email.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, avatar_url, accepted_terms_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.email,
    new.raw_user_meta_data ->> 'avatar_url',
    case
      when coalesce(new.raw_user_meta_data ->> 'accepted_terms', 'false') = 'true' then now()
      else null
    end
  )
  on conflict (id) do update
    set email = coalesce(excluded.email, public.profiles.email);

  insert into public.user_roles (user_id, role)
  values (new.id, 'usuario')
  on conflict (user_id) do nothing;

  return new;
end;
$$;
