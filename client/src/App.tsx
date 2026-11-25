import { lazy, Suspense } from "react";
import { Route, Switch, useLocation } from "wouter";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AuthProvider } from "./contexts/AuthContext";
import SiteShell from "./components/SiteShell";
import { Areas, AreaDetail, Contact, FAQ, Home, Resources, Studio, Values } from "./pages/SitePages";
import { Login, Register } from "./pages/auth/AuthPages";
import { AccountArea } from "./pages/account/AccountArea";
import NotFound from "./pages/NotFound";
import "./styles/admin.css";
import "./styles/admin-consultations.css";
import "./styles/admin-security.css";
import "./styles/admin-images.css";

// El panel de administración se carga sólo cuando hace falta: son 8 módulos
// que ningún visitante del sitio público necesita.
const AdminShell = lazy(() => import("./pages/admin/AdminShell"));

function Router() {
  return <Switch>
    <Route path="/" component={Home} />
    <Route path="/el-estudio" component={Studio} />
    <Route path="/areas" component={Areas} />
    <Route path="/areas/:slug" component={AreaDetail} />
    <Route path="/valores" component={Values} />
    <Route path="/recursos" component={Resources} />
    <Route path="/preguntas-frecuentes" component={FAQ} />
    <Route path="/contacto" component={Contact} />
    <Route path="/ingresar" component={Login} />
    <Route path="/registro" component={Register} />
    <Route path="/mi-cuenta" component={AccountArea} />
    <Route path="/panel" component={AdminShell} />
    <Route path="/panel/:rest*" component={AdminShell} />
    <Route path="/404" component={NotFound} />
    <Route component={NotFound} />
  </Switch>;
}

export default function App() {
  const [location] = useLocation();
  // El panel y las pantallas de acceso tienen su propia marco: no llevan la
  // cabecera ni el pie del sitio institucional.
  const standalone =
    location.startsWith("/panel") ||
    location === "/ingresar" ||
    location === "/registro";

  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <AuthProvider>
            <Suspense
              fallback={
                <div className="admin-empty" style={{ padding: "4rem 1.5rem" }}>
                  Cargando…
                </div>
              }
            >
              {standalone ? <Router /> : <SiteShell><Router /></SiteShell>}
            </Suspense>
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
