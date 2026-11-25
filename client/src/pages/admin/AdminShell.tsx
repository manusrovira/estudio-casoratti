import {
  Briefcase,
  FileText,
  FolderOpen,
  Images,
  LayoutDashboard,
  MessageSquare,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Link, Route, Switch, useLocation } from "wouter";
import { useAuthContext } from "@/contexts/AuthContext";
import { canAccessAdminPanel, ROLE_LABELS } from "@/lib/rbac";
import { AuditModule } from "./AuditModule";
import { CasesModule } from "./CasesModule";
import { ClientsModule } from "./ClientsModule";
import { ConsultationsAdminModule } from "./ConsultationsAdminModule";
import { DashboardModule } from "./DashboardModule";
import { DocumentsModule } from "./DocumentsModule";
import { ImageLibraryModule } from "./images/ImageLibraryModule";
import { SecurityModule } from "./SecurityModule";
import { SettingsModule } from "./SettingsModule";
import { UsersModule } from "./UsersModule";

/**
 * Panel de Administración.
 *
 * La guarda real está en Postgres: el usuario que no es admin recibe cero
 * filas y cero permisos de escritura aunque conozca la URL. Esta comprobación
 * en el frontend sólo evita mostrar una pantalla vacía.
 */

const navItems = [
  { href: "/panel", label: "Dashboard", icon: LayoutDashboard },
  { href: "/panel/seguridad", label: "Seguridad", icon: ShieldCheck },
  { href: "/panel/imagenes", label: "Imágenes", icon: Images },
  { href: "/panel/usuarios", label: "Usuarios", icon: Users },
  { href: "/panel/clientes", label: "Clientes", icon: Briefcase },
  { href: "/panel/consultas", label: "Consultas", icon: MessageSquare },
  { href: "/panel/expedientes", label: "Expedientes", icon: FolderOpen },
  { href: "/panel/documentacion", label: "Documentación", icon: FileText },
  { href: "/panel/auditoria", label: "Auditoría", icon: ScrollText },
  { href: "/panel/configuracion", label: "Configuración", icon: Settings },
];

const pageMeta: Record<string, { title: string; subtitle: string }> = {
  "/panel": {
    title: "Dashboard",
    subtitle: "Resumen general del funcionamiento del estudio.",
  },
  "/panel/seguridad": {
    title: "Seguridad",
    subtitle:
      "Cambio de contraseña del administrador y control de acceso a la cuenta.",
  },
  "/panel/imagenes": {
    title: "Biblioteca de imágenes",
    subtitle:
      "Inventario completo de las imágenes del sitio: ubicación, referencias, carga, edición y eliminación.",
  },
  "/panel/usuarios": {
    title: "Usuarios",
    subtitle: "Cuentas registradas, roles y estado de cada usuario.",
  },
  "/panel/clientes": {
    title: "Clientes",
    subtitle: "Fichas de clientes del estudio y su vínculo con la plataforma.",
  },
  "/panel/consultas": {
    title: "Administración de consultas",
    subtitle:
      "Consultas recibidas desde el sitio: listado paginado, estadísticas, control por IP e historial. Sólo se ven aquí.",
  },
  "/panel/expedientes": {
    title: "Expedientes",
    subtitle: "Asuntos jurídicos y su documentación asociada.",
  },
  "/panel/documentacion": {
    title: "Documentación",
    subtitle: "Archivos privados de clientes y expedientes.",
  },
  "/panel/auditoria": {
    title: "Auditoría",
    subtitle: "Registro de operaciones administrativas. Sólo lectura.",
  },
  "/panel/configuracion": {
    title: "Configuración",
    subtitle: "Áreas jurídicas y equipo profesional.",
  },
};

function AccessDenied() {
  return (
    <div className="admin-content">
      <div className="admin-card">
        <div className="admin-card-body">
          <h2 className="admin-card-title">Acceso restringido</h2>
          <p className="admin-card-sub" style={{ marginTop: ".8rem" }}>
            Esta sección es exclusiva del administrador del estudio. Si creés que
            es un error, escribinos y lo revisamos.
          </p>
          <div className="admin-row" style={{ marginTop: "1.4rem" }}>
            <Link className="admin-button admin-button-ghost" href="/">
              Volver al sitio
            </Link>
            <Link className="admin-button" href="/contacto">
              Contactar al estudio
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminShell() {
  const { user, role, loading, configured, signOut } = useAuthContext();
  const [location] = useLocation();
  const meta = pageMeta[location] ?? pageMeta["/panel"];

  if (!configured) {
    return (
      <div className="admin-content">
        <div className="admin-info">
          Supabase no está configurado. Definí <code>VITE_SUPABASE_URL</code> y{" "}
          <code>VITE_SUPABASE_ANON_KEY</code> en el archivo <code>.env</code> para
          habilitar el panel.
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="admin-content">
        <div className="admin-empty">Verificando permisos…</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="admin-content">
        <div className="admin-empty">
          <strong>Necesitás iniciar sesión</strong>
          <Link className="admin-button admin-button-copper" href="/ingresar" style={{ marginTop: "1rem" }}>
            Iniciar sesión
          </Link>
        </div>
      </div>
    );
  }

  if (!canAccessAdminPanel(role)) {
    return <AccessDenied />;
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <span className="admin-brand-mark">C</span>
          <span>
            <strong>CASORATTI</strong>
            <small>Administración</small>
          </span>
        </div>

        <nav className="admin-nav" aria-label="Módulos del panel">
          <span className="admin-nav-label">Gestión</span>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === "/panel" ? location === "/panel" : location.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={isActive ? "admin-nav-link active" : "admin-nav-link"}
              >
                <Icon size={15} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="admin-sidebar-foot">
          <span>
            Sesión de
            <br />
            <strong>{user.email ?? "administrador"}</strong>
            <br />
            {role ? ROLE_LABELS[role] : ""}
          </span>
          <button type="button" onClick={() => void signOut()}>
            Cerrar sesión
          </button>
          <button type="button" onClick={() => (window.location.href = "/")}>
            Ver el sitio público
          </button>
        </div>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar">
          <div>
            <h1>{meta.title}</h1>
            <p>{meta.subtitle}</p>
          </div>
          <div className="admin-topbar-actions">
            <Link className="admin-button admin-button-ghost admin-button-small" href="/">
              Ver sitio
            </Link>
          </div>
        </header>

        <div className="admin-content">
          <Switch>
            <Route path="/panel" component={DashboardModule} />
            <Route path="/panel/seguridad" component={SecurityModule} />
            <Route path="/panel/imagenes" component={ImageLibraryModule} />
            <Route path="/panel/usuarios" component={UsersModule} />
            <Route path="/panel/clientes" component={ClientsModule} />
            <Route path="/panel/consultas" component={ConsultationsAdminModule} />
            <Route path="/panel/expedientes" component={CasesModule} />
            <Route path="/panel/documentacion" component={DocumentsModule} />
            <Route path="/panel/auditoria" component={AuditModule} />
            <Route path="/panel/configuracion" component={SettingsModule} />
            <Route component={DashboardModule} />
          </Switch>
        </div>
      </main>
    </div>
  );
}
