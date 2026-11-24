// Reunión del equipo: familia, laboral, previsional, penal y mediación.
import reunionImage from "@/assets/equipo-reunion.jpg";
// Sala de juntas: sucesiones, propiedad, societario y daños y perjuicios.
import salaImage from "@/assets/equipo-sala.jpg";
// Integrantes del estudio: civil, gestiones administrativas, consumidor y gestoría.
import pasilloImage from "@/assets/equipo-pasillo.jpg";
// Audiencia: daños y perjuicios, penal y penal económico.
import audienceImage from "@/assets/equipo-audiencia-horizontal.jpg";

export type PracticeArea = {
  slug: string;
  number: string;
  label: string;
  title: string;
  short: string;
  description: string;
  matters: string[];
  image: string;
};

/**
 * El orden del array es el orden de presentación y de numeración (01-14).
 * La numeración es secuencial a propósito: la grilla de "/areas" y la lista
 * de la home muestran los mismos números, sin saltos.
 */
export const practiceAreas: PracticeArea[] = [
  {
    slug: "familia",
    number: "01",
    label: "Personas",
    title: "Derecho de familia",
    short: "Acompañamiento claro y humano en decisiones que impactan en la vida cotidiana.",
    description:
      "Brindamos asesoramiento y patrocinio letrado en divorcios de mutuo acuerdo o contenciosos, liquidación de la sociedad conyugal, medidas cautelares para proteger el patrimonio, fijación, aumento, cesación o disminución de la cuota alimentaria, tenencias, regímenes de visitas, tenencias compartidas, adopciones, tutelas y curatelas, juicios de filiación y reconocimiento de hijos, y casos de violencia familiar. Cuando la situación es urgente, la prioridad es la seguridad de las personas involucradas.",
    matters: ["Divorcios y convenciones", "Cuota alimentaria", "Tenencias compartidas", "Adopciones, tutelas y curatelas", "Filiación y reconocimiento", "Violencia familiar"],
    image: reunionImage,
  },
  {
    slug: "sucesiones",
    number: "02",
    label: "Patrimonio familiar",
    title: "Sucesiones",
    short: "Ordenamos el proceso hereditario para que cada decisión tenga respaldo.",
    description:
      "Intervenimos en sucesiones testamentarias e intestadas, desde el relevamiento de la documentación hasta la declaratoria de herederos, la partición y las inscripciones. También trabajamos en cesiones de derechos y en la homologación de acuerdos celebrados extrajudicialmente. Cuando la mediación no alcanza, litigamos en defensa de los intereses del cliente. Sumamos asistencia psicológica paralela a cargo de psicoterapeutas privados y derivación a grupos de autoayuda gratuitos.",
    matters: ["Sucesión ab intestato", "Sucesión testamentaria", "Declaratoria de herederos", "Partición y adjudicación", "Cesión de derechos", "Homologación de acuerdos"],
    image: salaImage,
  },
  {
    slug: "danos-y-seguros",
    number: "03",
    label: "Responsabilidad",
    title: "Daños y perjuicios",
    short: "Evaluación integral del daño, la cobertura y las vías de reparación.",
    description:
      "Trabajamos en accidentes de tránsito, mala praxis profesional, incumplimiento contractual, daños estéticos y responsabilidad civil en general. Estudiamos la relación entre el hecho, el daño, la cobertura asegurativa y las posibilidades de reparación. La primera entrevista permite ordenar la cronología, preservar evidencia y detectar los pasos urgentes.",
    matters: ["Accidentes de tránsito", "Mala praxis profesional", "Incumplimiento contractual", "Daños estéticos", "Reclamos a aseguradoras", "Responsabilidad civil"],
    image: audienceImage,
  },
  {
    slug: "previsional",
    number: "04",
    label: "Seguridad social",
    title: "Derecho previsional",
    short: "Reclamos previsionales con seguimiento administrativo y judicial.",
    description:
      "Gestionamos jubilaciones ordinarias, anticipadas, postergadas y sin aportes, prestaciones compensatorias y adicionales, pensiones por fallecimiento, retiros por invalidez y reconocimiento de servicios. Presentamos amparos y apelaciones contra denegatorias de jubilación, pensión o invalidez, reajustes de haberes ante la ANSES y las AFJP, y moratorias con planes de pago para monotributistas y autónomos. Incluye el cálculo del derecho a jubilación y del haber previsional.",
    matters: ["Jubilaciones y pensiones", "Reajuste de haberes", "Amparos y apelaciones", "Invalidez y retiro", "Reconocimiento de servicios", "Monotributo y moratoria"],
    image: reunionImage,
  },
  {
    slug: "civil-y-comercial",
    number: "05",
    label: "Patrimonial",
    title: "Derecho civil y comercial",
    short: "Contratos, obligaciones y decisiones patrimoniales acompañadas con criterio preventivo.",
    description:
      "Asesoramos a personas, familias y empresas en la organización jurídica de sus relaciones patrimoniales: contratos y sus incumplimientos, locaciones de servicios y de obra, alquileres, desalojos, convenios de desocupación, ocupación ilegal y comodatos, cobro de pesos y responsabilidad civil. Incluye ejecuciones prendarias e hipotecarias, ejecución de documentos, cheques, pagarés y reconocimientos de deuda.",
    matters: ["Contratos y acuerdos", "Alquileres y desalojos", "Ejecuciones y reconocimientos de deuda", "Cobro de pesos", "Locaciones de servicios y obra", "Responsabilidad civil"],
    image: pasilloImage,
  },
  {
    slug: "derecho-de-la-propiedad",
    number: "06",
    label: "Inmuebles",
    title: "Derecho de la propiedad",
    short: "Escrituras, dominio y conflictos entre propietarios y consorcios.",
    description:
      "Asesoramos en juicios de escrituración, ejecuciones hipotecarias, boletos de compraventa inmobiliaria, prescripción adquisitiva de dominio, responsabilidad civil y desocupaciones. En propiedad horizontal acompañamos a administraciones de consorcios con abonos y a consorcistas con la ejecución de expensas, filtraciones, ruidos molestos y el cumplimiento del reglamento de copropiedad.",
    matters: ["Escrituración y dominio", "Boletos de compraventa", "Usucapión y prescripción", "Ejecuciones hipotecarias", "Expensas y consorcios", "Responsabilidad civil inmobiliaria"],
    image: salaImage,
  },
  {
    slug: "laboral",
    number: "07",
    label: "Trabajo",
    title: "Derecho laboral",
    short: "Defensa de derechos laborales y asesoramiento preventivo para empleadores.",
    description:
      "Acompañamos a trabajadores y empleadores en conflictos individuales, desvinculaciones, intimaciones y acuerdos. El análisis de cada caso parte de la relación real, la documentación disponible y las comunicaciones realizadas. En el plano preventivo, el estudio asesora a empresas y a profesionales en la organización de sus relaciones laborales.",
    matters: ["Despidos y liquidaciones", "Intimaciones laborales", "Accidentes de trabajo", "Registración", "Acuerdos", "Asesoramiento a empresas"],
    image: reunionImage,
  },
  {
    slug: "penal",
    number: "08",
    label: "Defensa",
    title: "Derecho penal",
    short: "Estrategia, reserva y defensa técnica desde la primera consulta.",
    description:
      "Brindamos asistencia y defensa en investigaciones y procesos penales, con intervención temprana, revisión de antecedentes y comunicación directa sobre la situación procesal. Cada estrategia se define con base en los hechos y la evidencia disponible.",
    matters: ["Defensa penal", "Querellas", "Denuncias", "Medidas cautelares", "Audiencias", "Ejecución penal"],
    image: audienceImage,
  },
  {
    slug: "gestiones-administrativas",
    number: "09",
    label: "Estado y trámites",
    title: "Gestiones administrativas",
    short: "Trámites, datos y reclamos frente a organismos públicos y privados.",
    description:
      "Gestionamos trámites ante la AFIP-DGI-DGA, la ANSES y las AFJP, y consultas ante el VERAZ. Atendemos expedientes de derechos municipales y de juzgados de faltas, y los reclamos vinculados a la protección de datos personales y a la limpieza de datos personales. Analizamos actos administrativos, identificamos el organismo competente y definimos si corresponde gestión, reclamo, recurso, amparo u otra vía.",
    matters: ["Trámites ante AFIP y DGA", "Consultas ante el VERAZ", "Expedientes municipales", "Juzgados de faltas", "Protección de datos personales", "Limpieza de datos personales"],
    image: pasilloImage,
  },
  {
    slug: "consumidor",
    number: "10",
    label: "Relaciones de consumo",
    title: "Defensa del consumidor",
    short: "Soluciones para reclamos de productos, servicios y contratos de consumo.",
    description:
      "Ayudamos a identificar incumplimientos, reunir comprobantes y elegir la vía más conveniente para reclamar. La estrategia puede incluir una gestión previa, mediación o la instancia judicial que corresponda.",
    matters: ["Productos defectuosos", "Servicios incumplidos", "Bancos y seguros", "Planes y suscripciones", "Telecomunicaciones", "Daño al consumidor"],
    image: pasilloImage,
  },
  {
    slug: "societario-y-empresarial",
    number: "11",
    label: "Negocios",
    title: "Societario y empresarial",
    short: "Decisiones de negocio con claridad jurídica y mirada de largo plazo.",
    description:
      "Asesoramos emprendimientos y empresas en contratos, organización interna, relaciones entre socios y prevención de conflictos. Buscamos que el derecho sea una herramienta de gestión, no una barrera para crecer.",
    matters: ["Constitución y reformas", "Acuerdos entre socios", "Contratos comerciales", "Gobierno corporativo", "Prevención de conflictos", "Negociaciones"],
    image: salaImage,
  },
  {
    slug: "penal-economico",
    number: "12",
    label: "Defensa especializada",
    title: "Derecho penal económico",
    short: "Defensa técnica en delitos económicos, tributarios y aduaneros.",
    description: "Intervenimos en la prevención y defensa de investigaciones relacionadas con delitos económicos, tributarios y aduaneros, con análisis reservado de la documentación y la evidencia.",
    matters: ["Delitos económicos", "Delitos tributarios", "Delitos aduaneros", "Defensa preventiva", "Investigaciones", "Medidas cautelares"],
    image: audienceImage,
  },
  {
    slug: "mediacion-y-negociacion",
    number: "13",
    label: "Prevención",
    title: "Mediación y negociación",
    short: "Construir acuerdos sostenibles cuando el diálogo todavía es posible.",
    description:
      "Antes de judicializar, evaluamos si existe una alternativa de negociación o mediación que proteja mejor el tiempo, los recursos y los vínculos. Un acuerdo eficaz necesita objetivos claros y una redacción que anticipe escenarios.",
    matters: ["Negociación asistida", "Mediaciones", "Acuerdos patrimoniales", "Prevención de litigios", "Homologaciones", "Estrategias de salida"],
    image: reunionImage,
  },
  {
    slug: "gestoria-automotor",
    number: "14",
    label: "Gestoría",
    title: "Gestoría automotor",
    short: "Informes y gestiones registrales para resolver trámites automotores con claridad.",
    description: "Acompañamos trámites vinculados al Registro de la Propiedad del Automotor y consultas ante la DNRPA, ordenando la documentación y los pasos necesarios para cada gestión.",
    matters: ["Informes RPI", "DNRPA", "Transferencias", "Informes de dominio", "Denuncias de venta", "Regularización documental"],
    image: pasilloImage,
  },
];

export type AreaDetailInfo = {
  scope: string;
  approach: string;
  process: string[];
  documents: string[];
  questions: { question: string; answer: string }[];
};

/**
 * Texto alternativo de la foto de cada área. Describe qué se ve en la imagen
 * y la speciality a la que corresponde, para que la foto no sea decorativa.
 */
export const areaImageAlt: Record<string, string> = {
  familia: "Reunión del equipo del estudio para el área de derecho de familia",
  sucesiones: "Sala de juntas del estudio, utilizada en el área de sucesiones",
  "danos-y-seguros": "El equipo del estudio durante una instancia de audiencia en asuntos de daños y perjuicios",
  previsional: "Reunión del equipo del estudio para el área de derecho previsional",
  "civil-y-comercial": "Integrantes del estudio durante una jornada de trabajo en asuntos civiles y comerciales",
  "derecho-de-la-propiedad": "Sala de juntas del estudio, utilizada en el área de derecho de la propiedad",
  laboral: "Reunión del equipo del estudio para el área de derecho laboral",
  penal: "El equipo del estudio durante una instancia de audiencia en materia penal",
  "gestiones-administrativas": "Integrantes del estudio durante una jornada de trabajo en gestiones administrativas",
  consumidor: "Integrantes del estudio durante una jornada de trabajo en defensa del consumidor",
  "societario-y-empresarial": "Sala de juntas del estudio, utilizada en el área societaria y empresarial",
  "penal-economico": "El equipo del estudio durante una instancia de audiencia en derecho penal económico",
  "mediacion-y-negociacion": "Reunión del equipo del estudio para el área de mediación y negociación",
  "gestoria-automotor": "Integrantes del estudio durante una jornada de trabajo en gestoría automotor",
};

export const areaDetailInfo: Record<string, AreaDetailInfo> = {
  familia: {
    scope: "Las decisiones familiares tienen una dimensión jurídica y humana inseparable. En un divorcio, un reclamo de alimentos o una medida de protección conviven el interés del caso y la vida de quienes lo atraviesan. Priorizamos acuerdos claros, protección de derechos y una comunicación que reduzca la incertidumbre en momentos sensibles.",
    approach: "Analizamos la situación de cada integrante, los acuerdos posibles y las medidas urgentes que correspondan, procurando evitar la exposición innecesaria y el agravamiento del conflicto. Cuando la vía judicial es inevitable, preparamos el caso con foco en el resultado práctico: liquidación, cuidado, alimentos y seguridad.",
    process: ["Escuchamos el contexto familiar y detectamos prioridades inmediatas.", "Ordenamos información sobre hijos, vivienda, ingresos y bienes.", "Evaluamos acuerdos, mediación y medidas de protección disponibles.", "Redactamos, negociamos o presentamos lo necesario con seguimiento cercano."],
    documents: ["DNI y partidas que acrediten vínculos familiares.", "Acuerdos previos, resoluciones o denuncias existentes.", "Comprobantes de ingresos, gastos y necesidades de los hijos.", "Mensajes, informes médicos o escolares y demás evidencia pertinente."],
    questions: [{ question: "¿Se puede acordar un régimen de cuidado sin judicializar?", answer: "Sí, muchas familias pueden construir un convenio. Para que sea útil debe ser concreto, posible de cumplir y contemplar comunicación, gastos, vacaciones y cambios de rutina." }, { question: "¿Qué hago si existe una situación de violencia?", answer: "La prioridad es la seguridad. Contactanos cuanto antes y, ante un riesgo inmediato, recurrí a los servicios de emergencia y a los organismos de protección correspondientes." }]
  },
  sucesiones: {
    scope: "Una sucesión permite ordenar la transmisión de bienes, derechos y obligaciones. El diagnóstico inicial evita avanzar con información incompleta y ayuda a identificar inmuebles, vehículos, cuentas, deudas y posibles herederos. Cuando interviene un acuerdo extrajudicial, la homologación evita el litigio posterior.",
    approach: "Acompañamos el expediente desde la documentación inicial hasta la declaratoria, la inscripción, la partición o la adjudicación que corresponda. Sumamos acompañamiento psicológico paralelo a cargo de psicoterapeutas privados y derivación a grupos de autoayuda gratuitos para las personas que atraviesan el duelo.",
    process: ["Reconstruimos vínculos, bienes, deudas y la existencia de testamento.", "Reunimos partidas, títulos e informes necesarios para iniciar.", "Impulsamos las etapas procesales y comunicamos cada avance.", "Coordinamos inscripciones, acuerdos de partición y cierre documental."],
    documents: ["Partida de defunción y partidas que acrediten parentescos.", "DNI y datos de todos los posibles herederos.", "Escrituras, informes de dominio, automotores y documentación bancaria.", "Testamento, deudas, impuestos y constancias de gastos del acervo."],
    questions: [{ question: "¿Es necesario iniciar una sucesión para disponer de un inmueble?", answer: "En general, la transmisión registral requiere el proceso sucesorio y las inscripciones correspondientes. El camino exacto depende del título, de los herederos y de la situación del bien." }, { question: "¿Qué ocurre si aparece otro heredero?", answer: "La información debe incorporarse al expediente y analizarse la legitimación correspondiente. Por eso es importante relevar los vínculos antes de cerrar acuerdos." }]
  },
  "danos-y-seguros": {
    scope: "Un reclamo por daños exige conectar el hecho, las lesiones o pérdidas, la responsabilidad y la cobertura asegurativa. La documentación temprana es clave para preservar prueba y dimensionar el perjuicio, tanto en accidentes de tránsito como en casos de mala praxis profesional o incumplimiento contractual.",
    approach: "Evaluamos la cronología, las pólizas, los informes médicos o técnicos y las posibilidades de negociación o reclamo, sin perder de vista los plazos de denuncia aplicables.",
    process: ["Reconstruimos el hecho y delimitamos daños materiales y personales.", "Revisamos cobertura, denuncia y respuesta de la aseguradora.", "Preservamos informes, presupuestos, fotografías y testimonios.", "Definimos reclamo, mediación o acción según la evidencia disponible."],
    documents: ["Póliza, denuncia de siniestro y respuesta de la aseguradora.", "Fotos, presupuestos, facturas y constancias de reparación.", "Historias clínicas, certificados e informes de especialistas.", "Actas, datos de testigos, vehículos y autoridades intervinientes."],
    questions: [{ question: "¿Debo aceptar la primera oferta de la aseguradora?", answer: "Antes de aceptar conviene revisar alcance, daños futuros, franquicias y documentación. La conveniencia depende de cada caso y de la suficiencia de la propuesta." }, { question: "¿Qué hago después de un accidente?", answer: "Priorizá la seguridad y la atención médica, registrá datos y preservá evidencia. Luego informá el siniestro dentro de los plazos de la póliza y consultá." }]
  },
  previsional: {
    scope: "Los reclamos previsionales se deciden sobre documentación: historia laboral, aportes, jubilaciones previas y el acto que se impugna. Un reclamo denegado en la vía administrativa puede reabrirse en sede judicial, y el cálculo del haber determina el núcleo de la discusión.",
    approach: "Revisamos el expediente previsional completo, reconstruimos la situación laboral y evaluamos si corresponde un reclamo administrativo, un amparo o una apelación judicial.",
    process: ["Relevamos historia laboral, aportes, jubilaciones previas y el acto de denegatoria.", "Verificamos la vía aplicable: gestión administrativa, amparo o apelación.", "Preparamos la presentación con fundamentos, cálculos y documentación respaldatoria.", "Seguimos el expediente y empujamos la vía siguiente si no hay respuesta."],
    documents: ["Historia laboral, recibos de sueldo y constancias de aportes.", "Resoluciones, cartas de denegatoria y notificaciones de la ANSES o la AFJP.", "Documentación de servicios y de aportes realizados.", "Informes médicos y administrativos vinculados al reclamo."],
    questions: [{ question: "¿Qué hago si me denegaron la jubilación?", answer: "La denegatoria puede revisarse. Hay que revisar el acto, verificar la historia laboral y evaluar un reclamo administrativo previo o una acción judicial con la documentación correcta." }, { question: "¿Conviene esperar a la jubilación ordinaria si ya tengo la edad?", answer: "Depende del caso. Hay que comparar el derecho a pensión, el monto del haber y el impacto de una moratoria o de un retiro por invalidez antes de decidir." }]
  },
  "civil-y-comercial": {
    scope: "Una obligación incumplida, un contrato ambiguo o un daño pueden afectar patrimonio, vínculos y decisiones futuras. El análisis comienza por reconstruir los hechos, identificar obligaciones y medir alternativas antes de elegir una vía.",
    approach: "Trabajamos con una mirada preventiva cuando todavía es posible ordenar la relación, y con estrategia de conflicto cuando ya existe un incumplimiento o una controversia abierta. En locaciones de servicios y de obra, el relevamiento previo evita costos difíciles de revertir después.",
    process: ["Relevamos la relación jurídica, los hechos y los plazos relevantes.", "Revisamos contratos, comunicaciones y evidencia disponible.", "Comparamos negociación, intimación, mediación y acción judicial.", "Definimos próximos pasos, riesgos y responsabilidades de cada etapa."],
    documents: ["Contrato, presupuesto, factura o comprobante de la operación.", "Mensajes, correos, cartas documento y reclamos previos.", "Pruebas del pago, de la entrega, del incumplimiento o del daño.", "Datos completos de las personas o empresas involucradas."],
    questions: [{ question: "¿Conviene intimar antes de iniciar una demanda?", answer: "Depende del contrato, la prueba y los plazos. Una intimación bien dirigida puede constituir en mora y abrir una instancia de solución, pero no debe enviarse sin revisar sus consecuencias." }, { question: "¿Qué pasa si no tengo un contrato firmado?", answer: "La existencia de una relación puede acreditarse por otros medios: pagos, mensajes, entregas, facturas, testigos y conductas posteriores. Evaluamos el conjunto de la evidencia." }]
  },
  "derecho-de-la-propiedad": {
    scope: "Los conflictos sobre inmuebles combinan título, posesión, uso y deuda. Una escritura pendiente, un boleto de compraventa, una expensa impaga o el reclamo de un tercero pueden convertir una operación civil en un litigio registral.",
    approach: "Revisamos la documentación del inmueble y la calidad del título antes de recomendar una vía. En propiedad horizontal trabajamos con las comisiones directivas y con los consorcistas, evaluando la vía judicial y la administrativa.",
    process: ["Relevamos el título, la situación dominial y los gravámenes.", "Verificamos impuestos, expensas y estado de la documentación.", "Definimos la vía: gestión, escritura, ejecución, usucapión o reclamo.", "Coordinamos la presentación y el seguimiento hasta el resultado."],
    documents: ["Escrituras, boletos de compraventa y contratos.", "Informe de dominio, informe de expensas y recibos.", "Reglamento de copropiedad, actas y documentación de la administración.", "Datos de la administración, del expensado y de terceros interesados."],
    questions: [{ question: "¿Puedo obtener la escritura si compré con boleto?", answer: "El boleto puede ser un título suficiente para demandar la escritura, según las circunstancias. Hay que revisar el título, el pago, la posesión y los gravámenes antes de definir la estrategia." }, { question: "¿Cómo se cobra una expensa impaga?", answer: "La vía usual es el reclamo administrativo y, si no prospera, la ejecución judicial por expensas. El título y la prueba de la mora son determinantes." }]
  },
  laboral: {
    scope: "En materia laboral importan los hechos reales, la registración, las comunicaciones y los plazos. Trabajamos tanto en la defensa de trabajadores como en la prevención y orden interno de empleadores.",
    approach: "Antes de recomendar una acción revisamos la relación laboral completa: tareas, fechas, remuneración, jornada, registración, accidentes y comunicaciones de las partes.",
    process: ["Relevamos la relación real y la urgencia de cada plazo.", "Calculamos conceptos posibles y revisamos la documentación.", "Definimos intimación, negociación, conciliación o reclamo.", "Acompañamos la instancia elegida y dejamos trazabilidad de cada paso."],
    documents: ["Recibos de sueldo, constancias de alta y registros de jornada.", "Carta documento, telegramas, mails y mensajes laborales.", "Certificados médicos, denuncias de accidente y documentación de ART.", "Datos del empleador, testigos y cronología de los hechos."],
    questions: [{ question: "¿Cuánto tiempo tengo para reclamar?", answer: "Los plazos dependen del tipo de reclamo y de las comunicaciones realizadas. Si existe una desvinculación o una intimación, consultá sin demora con las fechas exactas." }, { question: "¿Puedo consultar mientras sigo trabajando?", answer: "Sí. Una consulta preventiva puede ayudar a documentar la situación, conocer derechos y reducir riesgos antes de tomar una decisión." }]
  },
  penal: {
    scope: "Una investigación penal exige reserva, lectura técnica del expediente y decisiones cuidadosas desde el primer contacto con una autoridad. La estrategia depende de la etapa procesal, la evidencia y la posición de la persona involucrada.",
    approach: "Brindamos defensa técnica y acompañamiento claro, evitando conclusiones apresuradas y explicando las alternativas procesales que pueden estar disponibles.",
    process: ["Identificamos la urgencia, la autoridad interviniente y la etapa del caso.", "Revisamos citaciones, actas, denuncias y evidencia disponible.", "Definimos una estrategia de defensa y preservación de prueba.", "Acompañamos audiencias, presentaciones y comunicaciones procesales."],
    documents: ["Citación, acta, denuncia o resolución recibida.", "DNI y datos de la persona involucrada.", "Mensajes, archivos, registros y demás elementos vinculados al hecho.", "Información de testigos, fechas y antecedentes procesales relevantes."],
    questions: [{ question: "¿Qué hago si recibo una citación?", answer: "No la ignores ni declares sin comprender el alcance. Guardá la constancia, verificá la fecha y contactá al estudio con la mayor anticipación posible." }, { question: "¿Puedo borrar mensajes o archivos que me comprometen?", answer: "No. La destrucción o alteración de evidencia puede agravar la situación. Conservá los archivos originales y consultá antes de manipularlos." }]
  },
  "gestiones-administrativas": {
    scope: "Los trámites frente a organismos públicos combinan requisitos, expedientes, notificaciones y plazos. Ordenar la vía administrativa desde el inicio suele ser determinante para evitar demoras y pérdidas de oportunidad. A esto se suma la gestión de datos personales, que exige un tratamiento cuidadoso y específico.",
    approach: "Revisamos el acto o trámite, identificamos el organismo competente y definimos si corresponde gestión, reclamo, recurso, amparo u otra vía. En materia de privacidad, analizamos qué datos se difunden o conservan, qué medidas proceden y cómo se documenta cada actuación.",
    process: ["Reconstruimos el trámite, sus movimientos y la última notificación.", "Verificamos requisitos, aportes, documentación y plazos.", "Preparamos la presentación con fundamentos y respaldo documental.", "Seguimos el expediente y evaluamos la vía posterior si no hay respuesta."],
    documents: ["Resoluciones, notificaciones y número de expediente.", "Constancias de presentación y comprobantes de recepción.", "Documentación respaldatoria de la gestión o del reclamo.", "Información personal a proteger en caso de limpieza de datos."],
    questions: [{ question: "¿Qué puedo hacer si un organismo no responde?", answer: "La respuesta depende del trámite y de los plazos transcurridos. Se puede analizar un pronto despacho, recurso o vía judicial, siempre revisando el expediente concreto." }, { question: "¿En qué consiste la protección de datos personales?", answer: "En revisar qué datos de una persona se difunden o conservan, qué medidas resultan aplicables y cómo se documenta cada actuación. También incluye la limpieza de datos personales que ya no correspondan." }]
  },
  consumidor: {
    scope: "Los problemas de consumo suelen comenzar con una compra, un servicio o un contrato que no cumple lo prometido. La evidencia de la operación y el reclamo previo es central para elegir una vía eficaz.",
    approach: "Ordenamos el reclamo, preservamos comprobantes y evaluamos gestión directa, denuncia administrativa, mediación o acción judicial según el proveedor y la gravedad del daño.",
    process: ["Identificamos proveedor, producto, contrato y obligación incumplida.", "Reunimos comprobantes, condiciones y comunicaciones.", "Redactamos un reclamo claro con una solución concreta.", "Seguimos la respuesta y escalamos la vía si resulta necesario."],
    documents: ["Factura, ticket, contrato, resumen o comprobante de pago.", "Términos y condiciones, publicidad y garantía.", "Fotos, informes técnicos y constancias del defecto.", "Número de reclamo, respuestas y fechas de contacto."],
    questions: [{ question: "¿Tengo que reclamar primero al proveedor?", answer: "Suele ser conveniente dejar constancia del reclamo y permitir una respuesta, aunque la estrategia depende del caso, la urgencia y el perjuicio generado." }, { question: "¿Qué valor tienen las capturas de pantalla?", answer: "Pueden ser útiles si conservan fecha, origen y contexto. Guardá también enlaces, correos y archivos originales cuando sea posible." }]
  },
  "societario-y-empresarial": {
    scope: "Las empresas necesitan decisiones jurídicas que acompañen el negocio: contratos claros, roles definidos, documentación societaria ordenada y mecanismos para prevenir conflictos entre socios o con terceros.",
    approach: "Trabajamos con emprendimientos y empresas para convertir riesgos jurídicos en reglas operativas comprensibles y sostenibles.",
    process: ["Entendemos el modelo de negocio y la decisión a tomar.", "Revisamos contratos, estatutos, poderes y relaciones internas.", "Diseñamos alternativas con sus costos y riesgos jurídicos.", "Documentamos el acuerdo y dejamos reglas claras para su ejecución."],
    documents: ["Estatuto, contrato social, actas y poderes vigentes.", "Contratos comerciales, presupuestos y órdenes de compra.", "Información básica de socios, administradores y proveedores.", "Políticas internas o antecedentes de conflictos relevantes."],
    questions: [{ question: "¿Cuándo conviene formalizar un acuerdo entre socios?", answer: "Antes de que aparezca el conflicto. Un acuerdo puede ordenar aportes, roles, decisiones, salidas, distribución y mecanismos de resolución." }, { question: "¿Pueden revisar un contrato antes de firmarlo?", answer: "Sí. La revisión preventiva permite detectar obligaciones asimétricas, penalidades, plazos, garantías y condiciones de salida antes de asumirlas." }]
  },
  "penal-economico": {
    scope: "Los casos económicos, tributarios y aduaneros suelen involucrar documentación extensa, análisis contable y múltiples actores. La intervención temprana permite preservar información y evitar decisiones descoordinadas.",
    approach: "Combinamos defensa técnica, revisión documental y coordinación con profesionales de otras disciplinas cuando el caso lo exige, siempre con reserva.",
    process: ["Delimitamos el hecho investigado, organismos y personas involucradas.", "Ordenamos documentación societaria, contable, bancaria o aduanera.", "Evaluamos riesgos procesales y estrategia de respuesta.", "Acompañamos presentaciones, audiencias y medidas sobre bienes o documentación."],
    documents: ["Citaciones, requerimientos, actas o resoluciones.", "Contratos, facturas, libros y documentación contable.", "Declaraciones, transferencias y comunicaciones relacionadas.", "Información de asesores, proveedores y funcionarios intervinientes."],
    questions: [{ question: "¿Por qué es importante no responder informalmente?", answer: "En investigaciones complejas una explicación aislada puede contradecir documentos o afectar la estrategia. Conviene centralizar la información y consultar antes de contestar." }, { question: "¿Se puede prevenir un riesgo penal económico?", answer: "Sí, mediante controles, documentación, revisión de operaciones y asesoramiento previo. La prevención no elimina todo riesgo, pero mejora la trazabilidad y la capacidad de respuesta." }]
  },
  "mediacion-y-negociacion": {
    scope: "No todos los conflictos necesitan llegar a juicio. La negociación y la mediación pueden ofrecer una salida más rápida o preservar vínculos, siempre que exista información suficiente y voluntad de construir un acuerdo.",
    approach: "Preparamos la conversación con objetivos, límites y escenarios. Un acuerdo profesional no es solo una promesa: debe ser claro, ejecutable y prever qué ocurre si algo cambia.",
    process: ["Definimos el problema, intereses y margen de acuerdo.", "Reunimos información para negociar con una base real.", "Participamos en intercambios o audiencias con una estrategia clara.", "Redactamos y revisamos el acuerdo, sus plazos y garantías."],
    documents: ["Contrato o relación que originó el conflicto.", "Cronología de hechos, reclamos y propuestas previas.", "Comprobantes de pagos, daños, obligaciones o incumplimientos.", "Datos de las partes y objetivos concretos para una solución."],
    questions: [{ question: "¿Mediar significa renunciar a mis derechos?", answer: "No. Mediar es explorar una solución con información y límites definidos. La participación no obliga a aceptar un acuerdo que no resulte conveniente." }, { question: "¿Qué debe tener un buen acuerdo?", answer: "Debe identificar obligaciones, fechas, forma de cumplimiento, consecuencias del incumplimiento y mecanismos para resolver cambios o diferencias posteriores." }]
  },
  "gestoria-automotor": {
    scope: "Los trámites automotores requieren coincidencia entre titularidad, documentación, informes y situación registral. Una revisión previa ayuda a evitar observaciones, demoras y operaciones con información incompleta.",
    approach: "Acompañamos gestiones ante el Registro de la Propiedad del Automotor y consultas vinculadas a la DNRPA, con seguimiento de la documentación y los pasos de cada trámite.",
    process: ["Identificamos vehículo, titular, comprador y trámite requerido.", "Solicitamos informes y revisamos restricciones o inconsistencias.", "Ordenamos formularios, firmas y documentación respaldatoria.", "Seguimos la presentación hasta su resultado y comunicamos observaciones."],
    documents: ["DNI de titular y adquirente, según el trámite.", "Título, cédula, formulario y comprobantes disponibles.", "Informe de dominio, denuncia de venta o constancias registrales.", "Datos de motor, chasis, domicilio y situación impositiva."],
    questions: [{ question: "¿Qué conviene revisar antes de comprar un vehículo?", answer: "La titularidad, el dominio, prendas, embargos, multas, inhibiciones y coincidencia de datos. Un informe actualizado no reemplaza la revisión integral de la operación." }, { question: "¿Qué hago si vendí el vehículo y no se transfirió?", answer: "Reuní contrato, comprobantes y datos del comprador. Se analiza la denuncia de venta y las medidas necesarias según la situación registral." }]
  }
};

export const faqItems = [
  { category: "Primer contacto", question: "¿Cómo solicito una consulta?", answer: "Podés escribirnos por WhatsApp o completar el formulario de contacto. Te pediremos una síntesis breve del asunto para orientarte sobre la disponibilidad y la modalidad de la primera entrevista." },
  { category: "Primer contacto", question: "¿La primera conversación es asesoramiento?", answer: "La primera conversación sirve para conocer el caso y definir el alcance de la consulta. La estrategia jurídica se determina luego de revisar la información y la documentación pertinente." },
  { category: "Honorarios", question: "¿La consulta se cobra?", answer: "Sí. La consulta se cobra. Antes de la cita te informamos el valor y la modalidad de honorarios, para que la decisión de continuar sea informada y sin sorpresas." },
  { category: "Honorarios", question: "¿Cómo se informan los honorarios?", answer: "Luego de comprender el trabajo requerido explicamos el alcance de la intervención, la modalidad de honorarios y los gastos previsibles. La propuesta se conversa con claridad antes de comenzar." },
  { category: "Pagos", question: "¿Qué formas de pago aceptan?", answer: "Aceptamos efectivo en pesos, dólares, tarjetas de débito y crédito, transferencias bancarias, depósitos, Mercado Pago, Rápipago y Pago Fácil. Coordinamos el medio de pago más cómodo para cada caso." },
  { category: "Documentación", question: "¿Qué documentación debo llevar?", answer: "Depende del tema. Como regla, reuní DNI, contratos, cartas documento, recibos, resoluciones, partidas, comprobantes y toda comunicación relacionada. No descartes mensajes o archivos que puedan ayudar a reconstruir la situación." },
  { category: "Modalidad", question: "¿Atienden consultas a distancia?", answer: "Sí. Podemos coordinar una entrevista remota cuando el caso y la documentación lo permitan. La atención presencial se realiza en Posadas, con turno previo." },
  { category: "Urgencias", question: "¿Qué hago si tengo un plazo próximo?", answer: "Contactanos cuanto antes e indicá la fecha exacta del vencimiento. Los plazos procesales y administrativos pueden ser decisivos, por eso es importante no demorar la consulta." },
];

export const consultationModes = ["Presencial", "Videollamada", "Telefónica"] as const;
export const coverageNote = "Trabajamos en todo Misiones.";

/** Datos de contacto del estudio: teléfono y acceso directo a WhatsApp. */
export const studioContact = {
  phoneE164: "+543764222147",
  phoneDisplay: "3764 222147",
  phoneDisplayIntl: "+54 3764 222147",
  email: "casorattiestudiojuridico@gmail.com",
  whatsappNumber: "543764222147",
  whatsappGreeting:
    "Hola, quiero solicitar una consulta. ¿Me pueden indicar la disponibilidad y cómo coordinar la primera entrevista?",
};

/** Enlace de WhatsApp con mensaje precargado para pedir consulta. */
export const whatsappLink = (message: string = studioContact.whatsappGreeting) =>
  `https://wa.me/${studioContact.whatsappNumber}?text=${encodeURIComponent(message)}`;

/** Datos del estudio actualizados con la información real de la firma. */
export const studioProfile = {
  name: "Estudio Jurídico Integral Casoratti",
  lead: "Dra. Vivian Ethel Casoratti",
  location: "Posadas, Misiones",
  intro:
    "Somos un estudio jurídico integral, con un equipo propio de profesionales y una mirada actualizada en las últimas tendencias del derecho argentino.",
  commitment:
    "Ofrecemos un compromiso firme en los temas centrales, tanto de empresas como de particulares: analizamos el caso, explicamos el riesgo y sostenemos una estrategia clara, con secreto profesional en cada instancia.",
  reach:
    "Acompañamos la gestión ante organismos públicos y privados de toda la provincia y del país, con presencia y seguimiento permanente en cada etapa del proceso.",
};

/** La consulta se cobra: el estudio lo informa antes de la cita. */
export const consultationPolicy = {
  charged: true,
  headline: "La consulta se cobra.",
  detail:
    "La primera entrevista sirve para comprender el asunto y definir el alcance del trabajo. Antes de la cita informamos el valor de la consulta y la modalidad de honorarios, de modo que la decisión de continuar sea siempre informada.",
};

/** Formas de pago aceptadas por el estudio. */
export const paymentMethods = [
  "Efectivo en pesos (ARS)",
  "Dólares (USD)",
  "Tarjeta de débito",
  "Tarjeta de crédito",
  "Transferencias bancarias",
  "Depósitos",
  "Mercado Pago",
  "Rápipago",
  "Pago Fácil",
];

export const resources = [
  { title: "Cómo preparar una primera consulta jurídica", tag: "Guía práctica", text: "Una buena consulta empieza por una cronología breve: qué ocurrió, cuándo, quiénes participaron y qué documentación existe. Llevar esa información ordenada permite aprovechar mejor el encuentro." },
  { title: "Contratos: leer antes de firmar", tag: "Prevención", text: "Antes de firmar, revisá objeto, obligaciones, plazos, formas de rescisión, penalidades, jurisdicción y mecanismos de solución de controversias. Las preguntas a tiempo suelen evitar conflictos posteriores." },
  { title: "Sucesiones: ordenar la documentación", tag: "Familia", text: "Para iniciar una conversación sobre una sucesión suele ser útil reunir partida de defunción, partidas que acrediten vínculos, títulos, informes y datos de otros posibles herederos." },
  { title: "Comunicación laboral y evidencia", tag: "Trabajo", text: "Guardá recibos, mensajes, correos y comunicaciones formales. La forma, la fecha y el contexto de cada intercambio pueden ser relevantes para evaluar derechos y próximos pasos." },
  { title: "Jubilaciones: revisar tu historia laboral", tag: "Previsional", text: "Antes de iniciar un reclamo previsional conviene tener a mano tu historia laboral, los recibos de sueldo y las resoluciones del organismo. Con esa información se define la vía más segura." },
];

