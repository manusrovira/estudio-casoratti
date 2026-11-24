import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowUpRight, Menu, Phone, X } from "lucide-react";
import { useAuthContext } from "@/contexts/AuthContext";
import { canAccessAdminPanel } from "@/lib/rbac";
import { studioContact, whatsappLink } from "@/data/siteContent";

const navItems = [
  { href: "/", label: "Inicio" },
  { href: "/el-estudio", label: "El estudio" },
  { href: "/areas", label: "Áreas de práctica" },
  { href: "/valores", label: "Valores" },
  { href: "/recursos", label: "Recursos" },
  { href: "/preguntas-frecuentes", label: "Preguntas frecuentes" },
];

export default function SiteShell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const { user, role, configured } = useAuthContext();

  useEffect(() => {
    setOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [location]);

  useEffect(() => {
    const elements = document.querySelectorAll<HTMLElement>(".reveal");
    const observer = new IntersectionObserver(
      entries => entries.forEach(entry => entry.isIntersecting && entry.target.classList.add("is-visible")),
      { threshold: 0.08 },
    );
    elements.forEach(element => observer.observe(element));
    const revealFallback = window.setTimeout(() => elements.forEach(element => element.classList.add("is-visible")), 350);
    return () => {
      window.clearTimeout(revealFallback);
      observer.disconnect();
    };
  }, [location]);

  const isActive = (href: string) => href === "/" ? location === "/" : location.startsWith(href);

  return (
    <div className="site-frame">
      <a className="skip-link" href="#contenido">Saltar al contenido</a>
      <header className="site-header">
        <div className="topline">
          <span>Posadas · Misiones · Argentina</span>
          <a className="topline-phone" href={whatsappLink()} target="_blank" rel="noreferrer" aria-label={`Escribir por WhatsApp al ${studioContact.phoneDisplayIntl} para solicitar una consulta`} title="Escribir por WhatsApp">
            <Phone size={13} /> {studioContact.phoneDisplay} <span className="topline-tag">WhatsApp</span>
          </a>
        </div>
        <div className="nav-wrap">
          <Link href="/" className="wordmark" aria-label="Estudio Jurídico Casoratti, inicio">
            <span className="wordmark-mark">C</span>
            <span><strong>CASORATTI</strong><small>ESTUDIO JURÍDICO</small></span>
          </Link>
          <button className="mobile-toggle" aria-label={open ? "Cerrar menú" : "Abrir menú"} onClick={() => setOpen(value => !value)}>
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
          <nav className={open ? "main-nav is-open" : "main-nav"} aria-label="Navegación principal">
            {navItems.map(item => <Link key={item.href} href={item.href} className={isActive(item.href) ? "active" : ""}>{item.label}</Link>)}
            {configured && !user && <Link href="/ingresar" className="nav-account">Acceder</Link>}
            {configured && user && <Link href="/mi-cuenta" className="nav-account">Mi cuenta</Link>}
            {configured && canAccessAdminPanel(role) && <Link href="/panel" className="nav-account">Panel</Link>}
            <Link className="nav-cta" href="/contacto">Coordinar consulta <ArrowUpRight size={15} /></Link>
          </nav>
        </div>
      </header>
      <main id="contenido">{children}</main>
      <footer className="site-footer">
        <div className="footer-main">
          <div className="footer-brand">
            <span className="footer-kicker">Estudio Jurídico Integral</span>
            <h2>Casoratti<span>.</span></h2>
            <p>Derecho con criterio. Atención personalizada en Posadas y en toda la provincia de Misiones.</p>
          </div>
          <div className="footer-column"><span className="footer-label">Explorar</span><Link href="/el-estudio">El estudio</Link><Link href="/areas">Áreas de práctica</Link><Link href="/recursos">Recursos</Link><Link href="/preguntas-frecuentes">Preguntas frecuentes</Link></div>
          <div className="footer-column"><span className="footer-label">Contacto</span><a href="tel:+543764222147">+54 3764 222147</a><a href="mailto:consultas@estudiocasoratti.com.ar">consultas@estudiocasoratti.com.ar</a><a href="https://maps.app.goo.gl/NoHK6voH2tLHuVWr5" target="_blank" rel="noreferrer">Gdor. Bermúdez 2618<br />Posadas, Misiones</a></div>
        </div>
        <div className="footer-bottom"><span>© {new Date().getFullYear()} Estudio Jurídico Casoratti</span></div>
      </footer>
    </div>
  );
}
