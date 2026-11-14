-- =============================================================================
-- Estudio Jurídico Casoratti — 005: datos de referencia.
-- Sólo configuración del estudio (áreas jurídicas). No se carga ningún
-- cliente, consulta, expediente ni usuario de ejemplo: el prompt exige datos
-- reales, no simulados. Las áreas son editables desde el Panel de Administración.
-- El slug coincide con el slug de las áreas públicas del sitio
-- (client/src/data/siteContent.ts) para que el formulario y la web hablen
-- el mismo idioma.
-- =============================================================================

insert into public.consultation_categories (name, slug, description, sort_order)
values
  ('Derecho civil y comercial', 'civil-y-comercial',
   'Contratos, obligaciones, daños y perjuicios, locaciones y responsabilidad civil.', 10),
  ('Derecho de familia', 'familia',
   'Divorcios, convenios, alimentos, cuidado personal y violencia familiar.', 20),
  ('Sucesiones', 'sucesiones',
   'Sucesiones testamentarias e intestadas, declaratoria de herederos y partición.', 30),
  ('Derecho laboral', 'laboral',
   'Relaciones de trabajo, despido, reclamos e indemnizaciones.', 40),
  ('Derecho penal', 'penal',
   'Defensa penal, medidas de fuerza y procedimiento.', 50),
  ('Administrativo y previsional', 'administrativo-y-previsional',
   'Procedimientos administrativos, seguridad social y previsional.', 60),
  ('Defensa del consumidor', 'consumidor',
   'Relaciones de consumo, reclamos y responsabilidad de proveedores.', 70),
  ('Societario y empresarial', 'societario-y-empresarial',
   'Constitución, gobierno, contratos corporativos y operaciones comerciales.', 80),
  ('Gestoría automotor', 'gestoria-automotor',
   'Trámites de vehículos: transferencias, titularidad y gestión documental.', 90),
  ('Derecho penal económico', 'penal-economico',
   'Delitos económicos, lavado, defraudación y responsabilidad corporativa.', 100),
  ('Daños y seguros', 'danos-y-seguros',
   'Siniestros, cobertura de seguros y reclamo de indemnizaciones.', 110),
  ('Mediación y negociación', 'mediacion-y-negociacion',
   'Resolución pacífica de conflictos y acuerdo extrajudicial.', 120)
on conflict (slug) do update
  set name = excluded.name,
      description = excluded.description,
      sort_order = excluded.sort_order;
