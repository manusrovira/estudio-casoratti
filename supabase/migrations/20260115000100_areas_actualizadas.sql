-- =============================================================================
-- Estudio Jurídico Casoratti — 006: actualización de las áreas jurídicas.
--
-- El contenido del estudio se reorganizó: el área "Administrativo y previsional"
-- se separó en dos (Gestiones administrativas / Derecho previsional) y se
-- agregó "Derecho de la propiedad". El orden y los nombres siguen el orden de
-- presentación del sitio (client/src/data/siteContent.ts), de modo que el
-- formulario de consulta y la web pública hablen el mismo idioma.
--
-- Sólo se tocan filas de configuración (áreas). No se inserta ningún cliente,
-- consulta, expediente ni usuario de ejemplo.
-- =============================================================================

-- 1) Renombrar el área existente. Se renombra en lugar de borrarse para
--    conservar el historial de consultas que ya tuvieran esa categoría.
update public.consultation_categories
   set name = 'Gestiones administrativas',
       slug = 'gestiones-administrativas',
       description = 'Trámites ante AFIP-DGI-DGA, ANSES y AFJP, consultas ante el VERAZ, expedientes municipales, juzgados de faltas y protección de datos personales.',
       sort_order = 90,
       is_active = true
 where slug = 'administrativo-y-previsional';

-- 2) Sincronizar el catálogo completo con el orden del sitio.
insert into public.consultation_categories (name, slug, description, sort_order, is_active)
values
  ('Derecho de familia', 'familia',
   'Divorcios y convenciones, cuota alimentaria, tenencias compartidas, adopciones, tutelas, filiación y violencia familiar.', 10, true),
  ('Sucesiones', 'sucesiones',
   'Sucesiones testamentarias e intestadas, declaratoria de herederos, partición, cesión de derechos y homologación de acuerdos.', 20, true),
  ('Daños y perjuicios', 'danos-y-seguros',
   'Accidentes de tránsito, mala praxis profesional, incumplimiento contractual, daños estéticos y reclamos a aseguradoras.', 30, true),
  ('Derecho previsional', 'previsional',
   'Jubilaciones y pensiones, reajustes de haberes, amparos y apelaciones, invalidez, reconocimiento de servicios y monotributo.', 40, true),
  ('Derecho civil y comercial', 'civil-y-comercial',
   'Contratos, obligaciones, locaciones, alquileres, desalojos, cobros, ejecuciones prendarias e hipotecarias y responsabilidad civil.', 50, true),
  ('Derecho de la propiedad', 'derecho-de-la-propiedad',
   'Escrituración, boletos de compraventa, usucapión, ejecuciones hipotecarias, expensas y conflictos de propiedad horizontal.', 60, true),
  ('Derecho laboral', 'laboral',
   'Relaciones de trabajo, despido, reclamos e indemnizaciones, accidentes de trabajo y asesoramiento a empresas.', 70, true),
  ('Derecho penal', 'penal',
   'Defensa penal, querellas, denuncias, medidas cautelares, audiencias y ejecución penal.', 80, true),
  ('Gestiones administrativas', 'gestiones-administrativas',
   'Trámites ante AFIP-DGI-DGA, ANSES y AFJP, consultas ante el VERAZ, expedientes municipales, juzgados de faltas y protección de datos personales.', 90, true),
  ('Defensa del consumidor', 'consumidor',
   'Relaciones de consumo, reclamos y responsabilidad de proveedores.', 100, true),
  ('Societario y empresarial', 'societario-y-empresarial',
   'Constitución, gobierno, contratos corporativos y operaciones comerciales.', 110, true),
  ('Derecho penal económico', 'penal-economico',
   'Delitos económicos, lavado, defraudación y responsabilidad corporativa.', 120, true),
  ('Mediación y negociación', 'mediacion-y-negociacion',
   'Resolución pacífica de conflictos y acuerdo extrajudicial.', 130, true),
  ('Gestoría automotor', 'gestoria-automotor',
   'Trámites de vehículos: transferencias, titularidad y gestión documental.', 140, true)
on conflict (slug) do update
  set name = excluded.name,
      description = excluded.description,
      sort_order = excluded.sort_order,
      is_active = excluded.is_active;

-- 3) Una versión anterior de este archivo usó el slug 'danos-y-seguiros' para
--    "Daños y perjuicios". El sitio público y el catálogo usan 'danos-y-seguros',
--    así que la fila con el slug mal escrito se retira para que el catálogo
--    quede con las 14 áreas reales. Sólo se borra si ninguna consulta la
--    referencia, para no romper el historial.
delete from public.consultation_categories
 where slug = 'danos-y-seguiros'
   and not exists (
     select 1 from public.legal_consultations c
      where c.category_id = public.consultation_categories.id
   );
