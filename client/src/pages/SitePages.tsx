import { FormEvent, useEffect, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { ArrowDown, ArrowUpRight, BookOpen, BriefcaseBusiness, CheckCircle2, ChevronDown, ChevronRight, Clock3, ExternalLink, FileText, Gavel, HeartHandshake, Landmark, MapPin, MessageCircle, Phone, Quote, Scale, Send, ShieldCheck, Users } from "lucide-react";
import { areaDetailInfo, coverageNote, consultationModes, faqItems, practiceAreas, resources, type PracticeArea } from "@/data/siteContent";
import { getSupabase, isSupabaseConfigured, SUBMIT_CONSULTATION_FUNCTION } from "@/lib/supabase";
// Imagen principal del primer pantallazo: hero premium de Inicio.
import premiumHeroImage from "@/assets/casoratti-hero.jpg";
// Biblioteca/espacios del estudio: Inicio, El estudio y Preguntas frecuentes.
import officeImage from "@/assets/office-wide.jpg";
// Equipo y valores: galería de El estudio y página Valores.
import teamImage from "@/assets/team.jpg";
// Reunión de trabajo: galería de El estudio, Familia, Laboral, Mediación y Contacto.
import detailImage from "@/assets/meeting.jpg";
// Imagen institucional jurídica: índice de Áreas, Recursos y varias especialidades.
import lawImage from "@/assets/gavel.jpg";

// Este mapa permite que cada página reutilice una imagen con una intención clara.
const images = { hero: premiumHeroImage, office: officeImage, team: teamImage, detail: detailImage, law: lawImage };

function Eyebrow({ children }: { children: React.ReactNode }) { return <span className="eyebrow"><i />{children}</span>; }
function ArrowLink({ href, children, light = false }: { href: string; children: React.ReactNode; light?: boolean }) { return <Link className={light ? "arrow-link light" : "arrow-link"} href={href}>{children}<ArrowUpRight size={16} /></Link>; }
function PageIntro({ eyebrow, title, description, image }: { eyebrow: string; title: React.ReactNode; description: string; image?: string }) {
  return <section className="page-intro"><div className="page-intro-copy"><Eyebrow>{eyebrow}</Eyebrow><h1>{title}</h1><p>{description}</p></div>{image && <div className="page-intro-image"><img src={image} alt="Interior del Estudio Jurídico Casoratti" /><span className="image-caption">Posadas · Misiones</span></div>}</section>;
}
function SectionHeading({ eyebrow, title, text }: { eyebrow: string; title: React.ReactNode; text?: string }) { return <div className="section-heading reveal"><Eyebrow>{eyebrow}</Eyebrow><h2>{title}</h2>{text && <p>{text}</p>}</div>; }

export function Home() {
  return <>
    <section className="hero hero-premium">
      <div className="hero-copy reveal"><Eyebrow>Estudio Jurídico · Posadas</Eyebrow><h1>La ley, <em>cuando más importa.</em></h1><p>Un estudio de atención personalizada para decisiones que necesitan claridad, estrategia y respaldo.</p><div className="hero-actions"><Link className="button button-copper" href="/contacto">Coordinar una consulta <ArrowUpRight size={17} /></Link><Link className="text-link" href="/areas">Conocer nuestras áreas <ArrowDown size={16} /></Link></div></div>
      <div className="hero-visual reveal"><div className="hero-image-wrap"><img src={images.hero} alt="Balanza dorada y biblioteca del Estudio Jurídico Casoratti" /><div className="hero-stamp"><Scale size={23} /><span>Derecho<br /><strong>con precisión</strong></span></div></div><div className="hero-side-note">01 <span>Un enfoque<br />cercano y riguroso</span></div></div>
      <div className="hero-scroll"><span>Descubrir</span><div className="scroll-line" /></div>
    </section>
    <section className="statement-section"><div className="statement-mark">“</div><div className="statement-copy reveal"><Eyebrow>La diferencia Casoratti</Eyebrow><h2>El derecho no es solo una respuesta. Es una forma de <em>avanzar con certeza.</em></h2><p>Conocemos la importancia de ser escuchado. Por eso traducimos la complejidad jurídica en decisiones comprensibles y acompañamos cada paso con responsabilidad.</p><ArrowLink href="/el-estudio">Conocer el estudio</ArrowLink></div><div className="statement-number">02</div></section>
    <section className="practice-preview section-pad"><SectionHeading eyebrow="Áreas de práctica" title={<>Una mirada <em>integral.</em></>} text="Todas las ramas del derecho, una misma forma de trabajar: atención dedicada, análisis profundo y comunicación clara."/><div className="practice-list">{practiceAreas.slice(0, 6).map(area => <PracticeRow key={area.slug} area={area} />)}</div><div className="center-link"><ArrowLink href="/areas">Ver todas las áreas de práctica</ArrowLink></div></section>
    <section className="split-feature"><div className="split-image reveal"><img src={images.office} alt="Biblioteca y espacio de trabajo del estudio" /><div className="vertical-label">CASORATTI / 2026</div></div><div className="split-copy reveal"><Eyebrow>Cómo trabajamos</Eyebrow><h2>La confianza se construye <em>en cada conversación.</em></h2><p>Primero escuchamos. Después ordenamos la información, explicamos las alternativas y definimos una estrategia posible. Sin fórmulas enlatadas. Sin respuestas automáticas.</p><div className="principle-list"><div><span>01</span><strong>Escucha activa</strong><p>Entender el problema antes de proponer el camino.</p></div><div><span>02</span><strong>Visión estratégica</strong><p>Anticipar escenarios y cuidar lo importante.</p></div><div><span>03</span><strong>Lenguaje claro</strong><p>Que sepas dónde estás y qué sigue.</p></div></div><ArrowLink href="/valores">Nuestros valores</ArrowLink></div></section>
    <section className="contact-band"><div className="contact-band-inner"><div><Eyebrow>Hablemos de tu caso</Eyebrow><h2>Un primer paso<br /><em>puede cambiarlo todo.</em></h2></div><Link className="circle-cta" href="/contacto"><ArrowUpRight size={27} /><span>Coordinar<br />consulta</span></Link></div></section>
  </>;
}

function PracticeRow({ area }: { area: PracticeArea }) { return <Link href={`/areas/${area.slug}`} className="practice-row reveal"><span className="practice-number">{area.number}</span><div className="practice-title"><span>{area.label}</span><h3>{area.title}</h3></div><p>{area.short}</p><span className="practice-arrow"><ChevronRight size={18} /></span></Link>; }

export function Studio() {
  return <><PageIntro eyebrow="El estudio" title={<>Un estudio que <em>acompaña.</em></>} description="Estudio Jurídico Casoratti nace de una convicción simple: cada persona merece comprender sus opciones antes de tomar una decisión jurídica." image={images.office}/><section className="content-section narrow reveal"><div className="content-lead"><span className="large-index">01</span><h2>Una práctica jurídica con <em>mirada humana.</em></h2></div><div className="prose"><p>Trabajamos con personas, familias, profesionales y empresas que buscan algo más que una respuesta puntual. Buscan un equipo que pueda leer el contexto, ordenar lo urgente y acompañar decisiones de largo plazo.</p><p>La experiencia jurídica importa, pero también importa cómo se la comparte. Por eso, cada asunto se aborda con confidencialidad, tiempos de respuesta acordes y un lenguaje que permita participar de verdad en el proceso.</p></div></section><section className="studio-gallery"><div className="gallery-main reveal"><img src={images.team} alt="Parte del equipo del estudio"/><div className="gallery-overlay">Casoratti<br /><span>personas detrás de cada caso</span></div></div><div className="gallery-aside reveal"><div className="quote-card"><Quote size={25}/><p>“La mejor estrategia empieza por entender qué está realmente en juego.”</p><span>— Principio de trabajo</span></div><img src={images.detail} alt="Reunión de trabajo en el estudio"/></div></section><section className="timeline-section"><SectionHeading eyebrow="Nuestra forma de estar" title={<>Cercanía que se vuelve <em>criterio.</em></>}/><div className="timeline"><div className="timeline-item reveal"><span>01</span><div><h3>Escuchar sin apuro</h3><p>La primera entrevista abre el espacio para contar lo que pasó, incluso aquello que parece menor.</p></div></div><div className="timeline-item reveal"><span>02</span><div><h3>Traducir la complejidad</h3><p>Explicamos derechos, riesgos y alternativas con palabras concretas y escenarios posibles.</p></div></div><div className="timeline-item reveal"><span>03</span><div><h3>Actuar con propósito</h3><p>Definimos una hoja de ruta realista y la revisamos cuando el caso lo exige.</p></div></div></div></section></>;
}

export function Areas() {
  return <><PageIntro eyebrow="Áreas de práctica" title={<>Una respuesta para cada <em>desafío.</em></>} description="Nuestro trabajo abarca las principales ramas del derecho para ofrecer una mirada completa, coordinada y cercana." image={images.law}/><section className="areas-index section-pad"><div className="areas-intro reveal"><span className="large-index">02</span><p>El derecho se cruza con la vida real. Un conflicto familiar puede involucrar patrimonio; una decisión comercial, obligaciones laborales. Por eso pensamos cada asunto sin compartimentos estancos.</p></div><div className="area-grid">{practiceAreas.map(area => <Link key={area.slug} href={`/areas/${area.slug}`} className="area-card reveal"><span className="area-card-number">{area.number}</span><span className="area-card-label">{area.label}</span><h2>{area.title}</h2><p>{area.short}</p><span className="area-card-link">Ver especialidad <ArrowUpRight size={15}/></span></Link>)}</div></section><section className="info-strip"><div><ShieldCheck size={24}/><span>Confidencialidad<br /><strong>en cada etapa</strong></span></div><div><Users size={24}/><span>Atención<br /><strong>personalizada</strong></span></div><div><CompassIcon/><span>Posadas y<br /><strong>toda Misiones</strong></span></div></section></>;
}
function CompassIcon() { return <Landmark size={24}/>; }

export function AreaDetail() {
  const [, params] = useRoute<{ slug: string }>("/areas/:slug");
  const area = practiceAreas.find(item => item.slug === params?.slug);
  if (!area) return <PageIntro eyebrow="Área no encontrada" title={<>Volvamos a <em>empezar.</em></>} description="La especialidad que buscás no está disponible en este índice."/>;
  const detail = areaDetailInfo[area.slug];
  return <><PageIntro eyebrow={`Área ${area.number} · ${area.label}`} title={<>{area.title.split(" ").slice(0, -1).join(" ")} <em>{area.title.split(" ").slice(-1)}</em></>} description={area.description} image={area.image}/><section className="detail-section"><div className="detail-sidebar"><span className="large-index">{area.number}</span><span className="sidebar-label">En esta especialidad</span><a href="#alcance">Alcance</a><a href="#asuntos">Situaciones frecuentes</a><a href="#metodo">Cómo trabajamos</a><a href="#documentacion">Documentación</a><a href="#preguntas">Preguntas habituales</a><Link href="/contacto">Contactar al estudio <ArrowUpRight size={15}/></Link></div><div className="detail-body"><section id="alcance" className="detail-block"><Eyebrow>Alcance de la práctica</Eyebrow><h2>Una mirada completa para <em>decidir mejor.</em></h2><p>{detail.scope}</p><p>{detail.approach}</p><div className="matter-grid">{area.matters.map((matter, index) => <div key={matter}><span>{String(index + 1).padStart(2, "0")}</span><strong>{matter}</strong></div>)}</div></section><section id="metodo" className="detail-method"><div><Eyebrow>Cómo trabajamos</Eyebrow><h2>Del primer dato a un <em>próximo paso claro.</em></h2></div><div className="detail-step-list">{detail.process.map((step, index) => <div key={step}><span>0{index + 1}</span><p>{step}</p></div>)}</div></section><section id="documentacion" className="detail-documents"><div><Eyebrow>Para la primera conversación</Eyebrow><h2>Qué conviene <em>reunir.</em></h2><p>No hace falta tener todo resuelto. Esta lista es orientativa y nos ayuda a aprovechar mejor el encuentro.</p></div><ul>{detail.documents.map(document => <li key={document}><CheckCircle2 size={17}/><span>{document}</span></li>)}</ul></section><section id="preguntas" className="detail-faq"><Eyebrow>Preguntas habituales</Eyebrow>{detail.questions.map(item => <details key={item.question}><summary>{item.question}<ChevronDown size={17}/></summary><p>{item.answer}</p></details>)}</section><section id="consulta" className="detail-callout"><MessageCircle size={27}/><div><h3>¿Querés conversar sobre este tema?</h3><p>Compartinos una síntesis de tu situación y coordinamos una primera conversación.</p><Link href="/contacto">Solicitar orientación <ArrowUpRight size={15}/></Link></div></section><p className="detail-disclaimer"><FileText size={16}/> La información de esta página es general y no reemplaza el análisis profesional de un caso concreto.</p></div></section></>;
}

export function Values() {
  const values = [{ icon: HeartHandshake, title: "Cercanía", text: "Acompañamos con atención real, sin perder de vista la dimensión humana detrás de cada expediente." }, { icon: ShieldCheck, title: "Confidencialidad", text: "Cuidamos la información y la confianza como parte esencial de la relación profesional." }, { icon: Gavel, title: "Rigor", text: "Analizamos hechos, documentos y normas con el nivel de detalle que cada decisión merece." }, { icon: CompassIcon, title: "Criterio", text: "No se trata de hacer más, sino de definir qué camino tiene sentido para ese caso." }];
  return <><PageIntro eyebrow="Equipo y valores" title={<>La forma de hacer las cosas <em>también importa.</em></>} description="Nuestro trabajo se apoya en principios que orientan cada conversación, cada escrito y cada decisión." image={images.team}/><section className="values-section section-pad"><SectionHeading eyebrow="Lo que nos guía" title={<>Cuatro ideas. <em>Un mismo compromiso.</em></>}/><div className="values-grid">{values.map(({ icon: Icon, title, text }, index) => <div className="value-card reveal" key={title}><span className="value-number">0{index + 1}</span><Icon size={28}/><h3>{title}</h3><p>{text}</p></div>)}</div></section><section className="manifesto"><div className="manifesto-inner reveal"><Eyebrow>Manifiesto</Eyebrow><h2>“La confianza no se pide.<br /><em>Se demuestra en el proceso.”</em></h2><p>Estudio Jurídico Casoratti</p></div></section></>;
}

export function Resources() { return <><PageIntro eyebrow="Centro de recursos" title={<>Información para <em>avanzar.</em></>} description="Guías breves para ordenar una primera conversación jurídica y tomar decisiones con más contexto." image={images.law}/><section className="resources-section section-pad"><div className="resource-feature reveal"><div><Eyebrow>Para empezar</Eyebrow><h2>La información correcta en el momento <em>correcto.</em></h2><p>Estos contenidos son generales y orientativos. Cada caso requiere analizar sus circunstancias, documentación y plazos.</p></div><BookOpen size={42}/></div><div className="resource-list">{resources.map((resource, index) => <article className="resource-item reveal" key={resource.title}><span className="resource-index">0{index + 1}</span><div><span className="resource-tag">{resource.tag}</span><h3>{resource.title}</h3><p>{resource.text}</p></div><ArrowUpRight size={19}/></article>)}</div><div className="resource-note"><FileText size={20}/><p>Para conocer la normativa oficial, consultá el <a href="https://www.argentina.gob.ar/justicia/derechofacil" target="_blank" rel="noreferrer">portal Derecho Fácil</a> y la legislación publicada por organismos públicos.</p></div></section></>;
}

export function FAQ() {
  const [open, setOpen] = useState<number | null>(0);

  return <>
    <PageIntro eyebrow="Preguntas frecuentes" title={<>Lo esencial, <em>claro.</em></>} description="Respuestas a las preguntas que suelen aparecer antes de una primera consulta." image={images.office}/>
    <section className="faq-section section-pad">
      <div className="faq-intro reveal"><Eyebrow>Antes de escribirnos</Eyebrow><h2>Un poco de contexto puede hacer la conversación <em>más simple.</em></h2><p>Si no encontrás la respuesta que buscás, escribinos. Cada situación merece una orientación particular.</p><Link className="button button-dark" href="/contacto">Hacer una consulta <ArrowUpRight size={16}/></Link></div>
      <div className="faq-list" aria-label="Preguntas frecuentes">
        {faqItems.map((item, index) => {
          const isOpen = open === index;
          return <div className={isOpen ? "faq-item is-open" : "faq-item"} key={item.question}>
            <button type="button" onClick={() => setOpen(isOpen ? null : index)} aria-expanded={isOpen} aria-controls={`faq-answer-${index}`}>
              <span className="faq-category">{item.category}</span><span>{item.question}</span><ChevronDown size={18}/>
            </button>
            <div id={`faq-answer-${index}`} className="faq-answer" role="region" aria-hidden={!isOpen}><p>{item.answer}</p></div>
          </div>;
        })}
      </div>
    </section>
  </>;
}

export function Contact() {
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [privacy, setPrivacy] = useState(false);
  const [website, setWebsite] = useState("");
  const [form, setForm] = useState({ name: "", email: "", phone: "", topic: "", subject: "", message: "" });
  const mapUrl = "https://maps.app.goo.gl/NoHK6voH2tLHuVWr5";
  const mapEmbedUrl = "https://www.google.com/maps?q=-27.3743273,-55.9038514&z=17&output=embed";

  // Las áreas jurídicas se leen de la base: son configurables desde el panel.
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await getSupabase()
          .from("consultation_categories")
          .select("id, name")
          .eq("is_active", true)
          .order("sort_order", { ascending: true });
        if (!cancelled && data?.length) {
          setCategories(data as Array<{ id: string; name: string }>);
        }
      } catch {
        // Si las áreas no se pueden leer, el formulario usa las del sitio.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!isSupabaseConfigured) {
      setError(
        "El envío de consultas en línea no está disponible en este entorno. Escribinos por WhatsApp o llamanos al 3764 222147.",
      );
      return;
    }

    setSending(true);
    try {
      const { data, error: fnError } = await getSupabase().functions.invoke(
        SUBMIT_CONSULTATION_FUNCTION,
        {
          body: {
            fullName: form.name,
            email: form.email,
            phone: form.phone,
            categoryId: form.topic,
            subject: form.subject,
            description: form.message,
            privacyAccepted: privacy,
            website,
          },
        },
      );

      if (fnError) throw fnError;
      if (data && typeof data === "object" && "error" in data && data.error) {
        throw new Error(String(data.error));
      }

      setReference((data as { referenceCode?: string } | null)?.referenceCode ?? null);
      setSent(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No pudimos registrar tu consulta. Probá de nuevo o escribinos por WhatsApp.",
      );
    } finally {
      setSending(false);
    }
  }

  const areaOptions = categories.length
    ? categories.map((category) => ({ id: category.id, name: category.name }))
    : practiceAreas.map((area) => ({ id: area.slug, name: area.title }));

  return <>
    <PageIntro eyebrow="Contacto y ubicación" title={<>Hablemos de lo que <em>importa.</em></>} description="Estamos en Posadas. Coordiná una primera conversación y contanos brevemente qué necesitás resolver." image={images.detail}/>
    <section className="contact-section section-pad">
      <div className="contact-info reveal"><Eyebrow>Encontranos</Eyebrow><h2>Atención personalizada,<br /><em>cerca tuyo.</em></h2><div className="contact-detail"><MapPin size={19}/><div><strong>Gobernador Bermúdez 2618</strong><span>N3300 Posadas, Misiones</span></div></div><div className="contact-detail"><Phone size={19}/><div><strong>+54 3764 222147</strong><span>Llamadas y WhatsApp</span></div></div><div className="contact-detail"><Clock3 size={19}/><div><strong>Lunes a viernes</strong><span>Atención con turno previo</span></div></div><div className="contact-detail"><MapPin size={19}/><div><strong>{coverageNote}</strong><span>{consultationModes.join(" · ")}</span></div></div><a className="map-link" href={mapUrl} target="_blank" rel="noreferrer">Abrir ubicación en Google Maps <ExternalLink size={15}/></a></div>
      <div className="contact-form-wrap reveal">{sent ? <div className="success-state"><CheckCircle2 size={40}/><Eyebrow>Mensaje recibido</Eyebrow><h2>Gracias, {form.name || "por escribirnos"}.</h2><p>Tu consulta quedó registrada{reference ? <> con el número <strong>{reference}</strong></> : ""}. Te vamos a responder por el medio que indiques. Para una respuesta más rápida, también podés escribirnos directamente por WhatsApp.</p><a className="button button-copper" href={`https://wa.me/543764222147?text=${encodeURIComponent(`Hola, soy ${form.name}. ${form.message}`)}`} target="_blank" rel="noreferrer">Continuar por WhatsApp <ArrowUpRight size={16}/></a><button className="reset-link" onClick={() => setSent(false)}>Enviar otra consulta</button></div> : <form className="contact-form" onSubmit={submit}><Eyebrow>Primera conversación</Eyebrow><h2>Contanos brevemente<br /><em>qué necesitás.</em></h2>{error && <div className="admin-error">{error}</div>}<label>Nombre y apellido<input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Tu nombre" /></label><label>Correo electrónico<input required type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="nombre@correo.com" /></label><label>Teléfono<input type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="Opcional" /></label><label>Área de consulta<select value={form.topic} onChange={e => setForm({ ...form, topic: e.target.value })}><option value="">Seleccionar área</option>{areaOptions.map(area => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label><label>Asunto<input required value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} placeholder="Sobre qué necesitás ayuda" /></label><label>Mensaje<textarea required rows={4} value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} placeholder="Contanos brevemente qué ocurrió y qué necesitás resolver." /></label><label className="auth-terms"><input type="checkbox" checked={privacy} onChange={e => setPrivacy(e.target.checked)} /><span>Acepto la política de privacidad y los términos de uso. La información se trata de forma confidencial.</span></label><input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} style={{ position: "absolute", left: "-9999px", opacity: 0 }} aria-hidden="true" /><button className="button button-dark" type="submit" disabled={sending || !privacy}>{sending ? "Enviando…" : <>Enviar consulta <Send size={16}/></>}</button><small>La información será tratada de forma confidencial. Este formulario no reemplaza una consulta profesional urgente.</small></form>}</div>
    </section>
    <section className="map-panel" aria-labelledby="map-title">
      <div className="map-embed-shell">
        <iframe className="map-iframe" title="Mapa de ubicación del Estudio Jurídico Integral Casoratti" src={mapEmbedUrl} loading="lazy" allowFullScreen referrerPolicy="no-referrer-when-downgrade" />
        <div className="map-details">
          <div><Eyebrow>Ubicación oficial</Eyebrow><h2 id="map-title">Estudio Jurídico Integral Casoratti</h2><p>Gobernador Bermúdez 2618<br />Posadas, Misiones, Argentina.</p></div>
          <a className="button button-copper" href={mapUrl} target="_blank" rel="noreferrer">Cómo llegar <ArrowUpRight size={16}/></a>
        </div>
      </div>
    </section>
  </>;
}
