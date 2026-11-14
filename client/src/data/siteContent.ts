// Gavel: civil/comercial, penal, penal económico y daños/seguros.
import gavelImage from "@/assets/gavel.jpg";
// Meeting: familia, laboral y mediación/negociación.
import meetingImage from "@/assets/meeting.jpg";
// Office: defensa del consumidor y gestoría automotor.
import officeImage from "@/assets/office.jpg";
// Office wide: sucesiones y societario/empresarial.
import officeWideImage from "@/assets/office-wide.jpg";
// Sign: administrativo y previsional.
import signImage from "@/assets/sign.jpg";

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

export const practiceAreas: PracticeArea[] = [
  {
    slug: "civil-y-comercial",
    number: "01",
    label: "Patrimonial",
    title: "Derecho civil y comercial",
    short: "Contratos, obligaciones y decisiones patrimoniales acompañadas con criterio preventivo.",
    description:
      "Asesoramos a personas, familias y empresas en la organización jurídica de sus relaciones patrimoniales. El trabajo combina análisis documental, prevención de contingencias y representación cuando el conflicto ya se encuentra planteado.",
    matters: ["Contratos y acuerdos", "Daños y perjuicios", "Cobro de pesos", "Incumplimientos", "Locaciones", "Responsabilidad civil"],
    image: gavelImage,
  },
  {
    slug: "familia",
    number: "02",
    label: "Personas",
    title: "Derecho de familia",
    short: "Acompañamiento claro y humano en decisiones que impactan en la vida cotidiana.",
    description:
      "En los asuntos de familia priorizamos la escucha, la confidencialidad y el cuidado de las personas involucradas. Explicamos escenarios, alternativas y próximos pasos con lenguaje comprensible.",
    matters: ["Divorcios y convenios", "Cuota alimentaria", "Cuidado personal", "Régimen de comunicación", "Filiación", "Violencia familiar"],
    image: meetingImage,
  },
  {
    slug: "sucesiones",
    number: "03",
    label: "Patrimonio familiar",
    title: "Sucesiones",
    short: "Ordenamos el proceso hereditario para que cada decisión tenga respaldo.",
    description:
      "Intervenimos en sucesiones testamentarias e intestadas, desde la evaluación inicial de la documentación hasta las inscripciones y particiones que correspondan. La información oficial argentina explica que la herencia comprende bienes, derechos y obligaciones del causante, por lo que cada expediente requiere un diagnóstico completo.",
    matters: ["Sucesión ab intestato", "Sucesión testamentaria", "Declaratoria de herederos", "Partición y adjudicación", "Tracto sucesivo", "Planificación patrimonial"],
    image: officeWideImage,
  },
  {
    slug: "laboral",
    number: "04",
    label: "Trabajo",
    title: "Derecho laboral",
    short: "Defensa de derechos laborales y asesoramiento preventivo para empleadores.",
    description:
      "Acompañamos a trabajadores y empleadores en conflictos individuales, desvinculaciones, intimaciones y acuerdos. El análisis de cada caso parte de la relación real, la documentación disponible y las comunicaciones realizadas.",
    matters: ["Despidos y liquidaciones", "Intimaciones laborales", "Accidentes de trabajo", "Registración", "Acuerdos", "Asesoramiento a empresas"],
    image: meetingImage,
  },
  {
    slug: "penal",
    number: "05",
    label: "Defensa",
    title: "Derecho penal",
    short: "Estrategia, reserva y defensa técnica desde la primera consulta.",
    description:
      "Brindamos asistencia y defensa en investigaciones y procesos penales, con intervención temprana, revisión de antecedentes y comunicación directa sobre la situación procesal. Cada estrategia se define con base en los hechos y la evidencia disponible.",
    matters: ["Defensa penal", "Querellas", "Denuncias", "Medidas cautelares", "Audiencias", "Ejecución penal"],
    image: gavelImage,
  },
  {
    slug: "administrativo-y-previsional",
    number: "06",
    label: "Estado y seguridad social",
    title: "Administrativo y previsional",
    short: "Gestiones y reclamos frente a organismos públicos con seguimiento responsable.",
    description:
      "Analizamos actos administrativos, trámites previsionales y reclamos ante organismos públicos. El objetivo es ordenar la vía adecuada, los plazos y la documentación necesaria antes de avanzar.",
    matters: ["Jubilaciones y pensiones", "Reclamos administrativos", "Amparos", "Empleo público", "Multas y sanciones", "Acceso a prestaciones"],
    image: signImage,
  },
  {
    slug: "consumidor",
    number: "07",
    label: "Relaciones de consumo",
    title: "Defensa del consumidor",
    short: "Soluciones para reclamos de productos, servicios y contratos de consumo.",
    description:
      "Ayudamos a identificar incumplimientos, reunir comprobantes y elegir la vía más conveniente para reclamar. La estrategia puede incluir una gestión previa, mediación o la instancia judicial que corresponda.",
    matters: ["Productos defectuosos", "Servicios incumplidos", "Bancos y seguros", "Planes y suscripciones", "Telecomunicaciones", "Daño al consumidor"],
    image: officeImage,
  },
  {
    slug: "societario-y-empresarial",
    number: "08",
    label: "Negocios",
    title: "Societario y empresarial",
    short: "Decisiones de negocio con claridad jurídica y mirada de largo plazo.",
    description:
      "Asesoramos emprendimientos y empresas en contratos, organización interna, relaciones entre socios y prevención de conflictos. Buscamos que el derecho sea una herramienta de gestión, no una barrera para crecer.",
    matters: ["Constitución y reformas", "Acuerdos entre socios", "Contratos comerciales", "Gobierno corporativo", "Prevención de conflictos", "Negociaciones"],
    image: officeWideImage,
  },
  {
    slug: "gestoria-automotor",
    number: "11",
    label: "Gestoría",
    title: "Gestoría automotor",
    short: "Informes y gestiones registrales para resolver trámites automotores con claridad.",
    description: "Acompañamos trámites vinculados al Registro de la Propiedad del Automotor y consultas ante la DNRPA, ordenando la documentación y los pasos necesarios para cada gestión.",
    matters: ["Informes RPI", "DNRPA", "Transferencias", "Informes de dominio", "Denuncias de venta", "Regularización documental"],
    image: officeImage,
  },
  {
    slug: "penal-economico",
    number: "12",
    label: "Defensa especializada",
    title: "Derecho penal económico",
    short: "Defensa técnica en delitos económicos, tributarios y aduaneros.",
    description: "Intervenimos en la prevención y defensa de investigaciones relacionadas con delitos económicos, tributarios y aduaneros, con análisis reservado de la documentación y la evidencia.",
    matters: ["Delitos económicos", "Delitos tributarios", "Delitos aduaneros", "Defensa preventiva", "Investigaciones", "Medidas cautelares"],
    image: gavelImage,
  },
  {
    slug: "danos-y-seguros",
    number: "09",
    label: "Responsabilidad",
    title: "Daños y seguros",
    short: "Evaluación integral de daños, cobertura y vías de reparación.",
    description:
      "Estudiamos la relación entre el hecho, el daño, la cobertura y las posibilidades de reparación. La primera entrevista permite ordenar la cronología, preservar evidencia y detectar los pasos urgentes.",
    matters: ["Siniestros viales", "Lesiones", "Reclamos a aseguradoras", "Responsabilidad profesional", "Daño patrimonial", "Daño extrapatrimonial"],
    image: gavelImage,
  },
  {
    slug: "mediacion-y-negociacion",
    number: "10",
    label: "Prevención",
    title: "Mediación y negociación",
    short: "Construir acuerdos sostenibles cuando el diálogo todavía es posible.",
    description:
      "Antes de judicializar, evaluamos si existe una alternativa de negociación o mediación que proteja mejor el tiempo, los recursos y los vínculos. Un acuerdo eficaz necesita objetivos claros y una redacción que anticipe escenarios.",
    matters: ["Negociación asistida", "Mediaciones", "Acuerdos patrimoniales", "Prevención de litigios", "Homologaciones", "Estrategias de salida"],
    image: meetingImage,
  },
];

export type AreaDetailInfo = {
  scope: string;
  approach: string;
  process: string[];
  documents: string[];
  questions: { question: string; answer: string }[];
};

export const areaDetailInfo: Record<string, AreaDetailInfo> = {
  "civil-y-comercial": {
    scope: "Una obligación incumplida, un contrato ambiguo o un daño pueden afectar patrimonio, vínculos y decisiones futuras. El análisis comienza por reconstruir los hechos, identificar obligaciones y medir alternativas antes de elegir una vía.",
    approach: "Trabajamos con una mirada preventiva cuando todavía es posible ordenar la relación, y con estrategia de conflicto cuando ya existe un incumplimiento o una controversia abierta.",
    process: ["Relevamos la relación jurídica, los hechos y los plazos relevantes.", "Revisamos contratos, comunicaciones y evidencia disponible.", "Comparamos negociación, intimación, mediación y acción judicial.", "Definimos próximos pasos, riesgos y responsabilidades de cada etapa."],
    documents: ["Contrato, presupuesto, factura o comprobante de la operación.", "Mensajes, correos, cartas documento y reclamos previos.", "Pruebas del pago, entrega, incumplimiento o daño.", "Datos completos de las personas o empresas involucradas."],
    questions: [{ question: "¿Conviene intimar antes de iniciar una demanda?", answer: "Depende del contrato, la prueba y los plazos. Una intimación bien dirigida puede constituir en mora, ordenar el reclamo y abrir una instancia de solución, pero no debe enviarse sin revisar sus consecuencias." }, { question: "¿Qué pasa si no tengo un contrato firmado?", answer: "La existencia de una relación puede acreditarse por otros medios: pagos, mensajes, entregas, facturas, testigos y conductas posteriores. Evaluamos el conjunto de la evidencia." }]
  },
  familia: {
    scope: "Las decisiones familiares tienen una dimensión jurídica y humana inseparable. Priorizamos acuerdos claros, protección de derechos y una comunicación que reduzca la incertidumbre en momentos sensibles.",
    approach: "Analizamos la situación de cada integrante, los acuerdos posibles y las medidas urgentes que correspondan, procurando evitar la exposición innecesaria y el agravamiento del conflicto.",
    process: ["Escuchamos el contexto familiar y detectamos prioridades inmediatas.", "Ordenamos información sobre hijos, vivienda, ingresos y bienes.", "Evaluamos acuerdos, mediación y medidas de protección disponibles.", "Redactamos, negociamos o presentamos lo necesario con seguimiento cercano."],
    documents: ["DNI y partidas que acrediten vínculos familiares.", "Acuerdos previos, resoluciones o denuncias existentes.", "Comprobantes de ingresos, gastos y necesidades de hijos.", "Mensajes, informes médicos o escolares y demás evidencia pertinente."],
    questions: [{ question: "¿Se puede acordar un régimen de cuidado sin judicializar?", answer: "Sí, muchas familias pueden construir un convenio. Para que sea útil debe ser concreto, posible de cumplir y contemplar comunicación, gastos, vacaciones y cambios de rutina." }, { question: "¿Qué hago si existe una situación de violencia?", answer: "La prioridad es la seguridad. Contactanos cuanto antes y, ante un riesgo inmediato, recurrí a los servicios de emergencia y organismos de protección correspondientes." }]
  },
  sucesiones: {
    scope: "Una sucesión permite ordenar la transmisión de bienes, derechos y obligaciones. El diagnóstico inicial evita avanzar con información incompleta y ayuda a identificar inmuebles, vehículos, cuentas, deudas y posibles herederos.",
    approach: "Acompañamos el expediente desde la documentación inicial hasta la declaratoria, inscripción, partición o adjudicación que corresponda según el caso.",
    process: ["Reconstruimos vínculos, bienes, deudas y existencia de testamento.", "Reunimos partidas, títulos e informes necesarios para iniciar.", "Impulsamos las etapas procesales y comunicamos cada avance.", "Coordinamos inscripciones, acuerdos de partición y cierre documental."],
    documents: ["Partida de defunción y partidas que acrediten parentescos.", "DNI y datos de todos los posibles herederos.", "Escrituras, informes de dominio, automotores y documentación bancaria.", "Testamento, deudas, impuestos y constancias de gastos del acervo."],
    questions: [{ question: "¿Es necesario iniciar una sucesión para disponer de un inmueble?", answer: "En general, la transmisión registral requiere el proceso sucesorio y las inscripciones correspondientes. El camino exacto depende del título, los herederos y la situación del bien." }, { question: "¿Qué ocurre si aparece otro heredero?", answer: "La información debe incorporarse al expediente y analizarse la legitimación correspondiente. Por eso es importante relevar vínculos antes de cerrar acuerdos." }]
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
  "administrativo-y-previsional": {
    scope: "Los trámites frente a organismos públicos combinan requisitos, expedientes, notificaciones y plazos. Ordenar la vía administrativa desde el inicio suele ser determinante para evitar demoras y pérdidas de oportunidad.",
    approach: "Revisamos el acto o trámite, identificamos el organismo competente y definimos si corresponde gestión, reclamo, recurso, amparo u otra vía.",
    process: ["Reconstruimos el trámite, sus movimientos y la última notificación.", "Verificamos requisitos, aportes, documentación y plazos.", "Preparamos la presentación con fundamentos y respaldo documental.", "Seguimos el expediente y evaluamos la vía posterior si no hay respuesta."],
    documents: ["Resoluciones, notificaciones y número de expediente.", "DNI, historia laboral, recibos y constancias de aportes.", "Presentaciones previas y comprobantes de recepción.", "Informes médicos, certificados o documentación específica del beneficio."],
    questions: [{ question: "¿Qué puedo hacer si un organismo no responde?", answer: "La respuesta depende del trámite y de los plazos transcurridos. Se puede analizar un pronto despacho, recurso o vía judicial, siempre revisando el expediente concreto." }, { question: "¿Puedo iniciar una jubilación si me falta documentación?", answer: "Primero conviene reconstruir la historia laboral y detectar qué períodos o pruebas faltan. Con esa información se define la estrategia más segura." }]
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
  "gestoria-automotor": {
    scope: "Los trámites automotores requieren coincidencia entre titularidad, documentación, informes y situación registral. Una revisión previa ayuda a evitar observaciones, demoras y operaciones con información incompleta.",
    approach: "Acompañamos gestiones ante el Registro de la Propiedad del Automotor y consultas vinculadas a la DNRPA, con seguimiento de la documentación y los pasos de cada trámite.",
    process: ["Identificamos vehículo, titular, comprador y trámite requerido.", "Solicitamos informes y revisamos restricciones o inconsistencias.", "Ordenamos formularios, firmas y documentación respaldatoria.", "Seguimos la presentación hasta su resultado y comunicamos observaciones."],
    documents: ["DNI de titular y adquirente, según el trámite.", "Título, cédula, formulario y comprobantes disponibles.", "Informe de dominio, denuncia de venta o constancias registrales.", "Datos de motor, chasis, domicilio y situación impositiva."],
    questions: [{ question: "¿Qué conviene revisar antes de comprar un vehículo?", answer: "La titularidad, el dominio, prendas, embargos, multas, inhibiciones y coincidencia de datos. Un informe actualizado no reemplaza la revisión integral de la operación." }, { question: "¿Qué hago si vendí el vehículo y no se transfirió?", answer: "Reuní contrato, comprobantes y datos del comprador. Se analiza la denuncia de venta y las medidas necesarias según la situación registral." }]
  },
  "penal-economico": {
    scope: "Los casos económicos, tributarios y aduaneros suelen involucrar documentación extensa, análisis contable y múltiples actores. La intervención temprana permite preservar información y evitar decisiones descoordinadas.",
    approach: "Combinamos defensa técnica, revisión documental y coordinación con profesionales de otras disciplinas cuando el caso lo exige, siempre con reserva.",
    process: ["Delimitamos el hecho investigado, organismos y personas involucradas.", "Ordenamos documentación societaria, contable, bancaria o aduanera.", "Evaluamos riesgos procesales y estrategia de respuesta.", "Acompañamos presentaciones, audiencias y medidas sobre bienes o documentación."],
    documents: ["Citaciones, requerimientos, actas o resoluciones.", "Contratos, facturas, libros y documentación contable.", "Declaraciones, transferencias y comunicaciones relacionadas.", "Información de asesores, proveedores y funcionarios intervinientes."],
    questions: [{ question: "¿Por qué es importante no responder informalmente?", answer: "En investigaciones complejas una explicación aislada puede contradecir documentos o afectar la estrategia. Conviene centralizar la información y consultar antes de contestar." }, { question: "¿Se puede prevenir un riesgo penal económico?", answer: "Sí, mediante controles, documentación, revisión de operaciones y asesoramiento previo. La prevención no elimina todo riesgo, pero mejora la trazabilidad y la capacidad de respuesta." }]
  },
  "danos-y-seguros": {
    scope: "Un reclamo por daños exige conectar el hecho, las lesiones o pérdidas, la responsabilidad y la cobertura asegurativa. La documentación temprana es clave para preservar prueba y dimensionar el perjuicio.",
    approach: "Evaluamos la cronología, las pólizas, los informes médicos o técnicos y las posibilidades de negociación o reclamo, sin perder de vista los plazos aplicables.",
    process: ["Reconstruimos el hecho y delimitamos daños materiales y personales.", "Revisamos cobertura, denuncias y comunicaciones de la aseguradora.", "Preservamos informes, presupuestos, fotografías y testimonios.", "Definimos reclamo, mediación o acción según la evidencia disponible."],
    documents: ["Póliza, denuncia de siniestro y respuesta de la aseguradora.", "Fotos, presupuestos, facturas y constancias de reparación.", "Historias clínicas, certificados e informes de especialistas.", "Actas, datos de testigos, vehículos y autoridades intervinientes."],
    questions: [{ question: "¿Debo aceptar la primera oferta de la aseguradora?", answer: "Antes de aceptar conviene revisar alcance, daños futuros, franquicias y documentación. La conveniencia depende del caso y de la suficiencia de la propuesta." }, { question: "¿Qué hago después de un accidente?", answer: "Priorizá la seguridad y la atención médica, registrá datos y preservá evidencia. Luego informá el siniestro dentro de los plazos de la póliza y consultá." }]
  },
  "mediacion-y-negociacion": {
    scope: "No todos los conflictos necesitan llegar a juicio. La negociación y la mediación pueden ofrecer una salida más rápida o preservar vínculos, siempre que exista información suficiente y voluntad de construir un acuerdo.",
    approach: "Preparamos la conversación con objetivos, límites y escenarios. Un acuerdo profesional no es solo una promesa: debe ser claro, ejecutable y prever qué ocurre si algo cambia.",
    process: ["Definimos el problema, intereses y margen de acuerdo.", "Reunimos información para negociar con una base real.", "Participamos en intercambios o audiencias con una estrategia clara.", "Redactamos y revisamos el acuerdo, sus plazos y garantías."],
    documents: ["Contrato o relación que originó el conflicto.", "Cronología de hechos, reclamos y propuestas previas.", "Comprobantes de pagos, daños, obligaciones o incumplimientos.", "Datos de las partes y objetivos concretos para una solución."],
    questions: [{ question: "¿Mediar significa renunciar a mis derechos?", answer: "No. Mediar es explorar una solución con información y límites definidos. La participación no obliga a aceptar un acuerdo que no resulte conveniente." }, { question: "¿Qué debe tener un buen acuerdo?", answer: "Debe identificar obligaciones, fechas, forma de cumplimiento, consecuencias del incumplimiento y mecanismos para resolver cambios o diferencias posteriores." }]
  }
};

export const faqItems = [
  { category: "Primer contacto", question: "¿Cómo solicito una consulta?", answer: "Podés escribirnos por WhatsApp o completar el formulario de contacto. Te pediremos una síntesis breve del asunto para orientarte sobre la disponibilidad y la modalidad de la primera entrevista." },
  { category: "Primer contacto", question: "¿La primera conversación es asesoramiento?", answer: "La primera conversación sirve para conocer el caso y definir el alcance de la consulta. La estrategia jurídica se determina luego de revisar la información y la documentación pertinente." },
  { category: "Documentación", question: "¿Qué documentación debo llevar?", answer: "Depende del tema. Como regla, reuní DNI, contratos, cartas documento, recibos, resoluciones, partidas, comprobantes y toda comunicación relacionada. No descartes mensajes o archivos que puedan ayudar a reconstruir la situación." },
  { category: "Modalidad", question: "¿Atienden consultas a distancia?", answer: "Sí. Podemos coordinar una entrevista remota cuando el caso y la documentación lo permitan. La atención presencial se realiza en Posadas, con turno previo." },
  { category: "Honorarios", question: "¿Cómo se informan los honorarios?", answer: "Luego de comprender el trabajo requerido explicamos el alcance de la intervención, la modalidad de honorarios y los gastos previsibles. La propuesta se conversa con claridad antes de comenzar." },
  { category: "Urgencias", question: "¿Qué hago si tengo un plazo próximo?", answer: "Contactanos cuanto antes e indicá la fecha exacta del vencimiento. Los plazos procesales y administrativos pueden ser decisivos, por eso es importante no demorar la consulta." },
];

export const consultationModes = ["Presencial", "Videollamada", "Telefónica"] as const;
export const coverageNote = "Trabajamos en todo Misiones.";

export const resources = [
  { title: "Cómo preparar una primera consulta jurídica", tag: "Guía práctica", text: "Una buena consulta empieza por una cronología breve: qué ocurrió, cuándo, quiénes participaron y qué documentación existe. Llevar esa información ordenada permite aprovechar mejor el encuentro." },
  { title: "Contratos: leer antes de firmar", tag: "Prevención", text: "Antes de firmar, revisá objeto, obligaciones, plazos, formas de rescisión, penalidades, jurisdicción y mecanismos de solución de controversias. Las preguntas a tiempo suelen evitar conflictos posteriores." },
  { title: "Sucesiones: ordenar la documentación", tag: "Familia", text: "Para iniciar una conversación sobre una sucesión suele ser útil reunir partida de defunción, partidas que acrediten vínculos, títulos, informes y datos de otros posibles herederos." },
  { title: "Comunicación laboral y evidencia", tag: "Trabajo", text: "Guardá recibos, mensajes, correos y comunicaciones formales. La forma, la fecha y el contexto de cada intercambio pueden ser relevantes para evaluar derechos y próximos pasos." },
];
