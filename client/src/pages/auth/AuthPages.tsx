import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuthContext } from "@/contexts/AuthContext";

/**
 * Pantallas de acceso: ingreso, registro y recuperación de clave.
 * Autenticación delegada a Supabase Auth (Google OAuth + correo y contraseña).
 */

function Aside() {
  return (
    <aside className="auth-aside">
      <div>
        <Link to="/" className="wordmark">
          <span className="wordmark-mark">C</span>
          <span>
            <strong>CASORATTI</strong>
            <small>ESTUDIO JURÍDICO</small>
          </span>
        </Link>
        <h2>
          Tu consulta, <em style={{ color: "var(--copper-light)" }}>acompañada.</em>
        </h2>
        <p>
          Acceso de clientes y del equipo del estudio. Desde acá seguís el estado de
          tus consultas, los intercambios con el estudio y la documentación habilitada.
        </p>
      </div>
      <p style={{ fontSize: ".7rem", letterSpacing: ".14em", textTransform: "uppercase" }}>
        Posadas · Misiones · Argentina
      </p>
    </aside>
  );
}

function GoogleButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="admin-button admin-button-ghost" onClick={onClick} disabled={disabled}>
      <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#4285F4"
          d="M23.5 12.3c0-.9-.1-1.5-.2-2.2H12v4.1h6.5c-.1 1.1-.8 2.8-2.4 3.9l-.1.1 3.6 2.8.2.1c2.3-2.1 3.7-5.2 3.7-8.8z"
        />
        <path
          fill="#34A853"
          d="M12 24c3.2 0 6-1.1 8-2.9l-3.8-2.9c-1 .7-2.4 1.2-4.2 1.2-3.2 0-5.9-2.1-6.8-5l-.1.1-3.7 2.9-.1.1C3.5 21.2 7.4 24 12 24z"
        />
        <path fill="#FBBC05" d="M5.2 14.4c-.2-.7-.4-1.4-.4-2.4s.1-1.7.4-2.4V9.5L1.4 6.6C.5 8.3 0 10.1 0 12s.5 3.7 1.4 5.4l3.8-3z" />
        <path
          fill="#EA4335"
          d="M12 4.8c2.3 0 3.8.9 4.7 1.8l3.4-3.4C18 1.2 15.2 0 12 0 7.4 0 3.5 2.8 1.4 6.6l3.8 3c.9-2.9 3.6-4.8 6.8-4.8z"
        />
      </svg>
      Continuar con Google
    </button>
  );
}

export function Login() {
  const { signInWithGoogle, signInWithEmail, sendPasswordReset, updatePassword, configured } =
    useAuthContext();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "forgot" | "reset">("login");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [location] = useLocation();

  useEffect(() => {
    if (window.location.hash.includes("type=recovery")) setMode("reset");
  }, [location]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setOk(null);
    setBusy(true);
    try {
      if (mode === "login") {
        await signInWithEmail(email, password);
      } else if (mode === "forgot") {
        await sendPasswordReset(email);
        setOk("Te enviamos un correo con el enlace para restablecer tu clave.");
      } else {
        await updatePassword(password);
        setOk("Tu clave fue actualizada. Ya podés entrar.");
        setMode("login");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos completar la operación.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <Aside />
      <main className="auth-main">
        <div className="auth-form">
          <h1>
            {mode === "login" ? "Iniciar sesión" : mode === "forgot" ? "Recuperar clave" : "Nueva clave"}
          </h1>
          <p>
            {mode === "login"
              ? "Accedé con tu cuenta de Google o con tu correo y contraseña."
              : mode === "forgot"
                ? "Escribí tu correo y te enviamos el enlace de recuperación."
                : "Definí la clave que vas a usar para entrar."}
          </p>

          {!configured && (
            <div className="auth-alert">
              El acceso está deshabilitado porque Supabase no está configurado en este
              entorno.
            </div>
          )}
          {error && <div className="auth-alert">{error}</div>}
          {ok && <div className="auth-alert ok">{ok}</div>}

          {mode !== "reset" && (
            <GoogleButton onClick={() => void signInWithGoogle()} disabled={!configured || busy} />
          )}

          {mode !== "reset" && (
            <div className="admin-row" style={{ margin: "1.2rem 0 .4rem", gap: ".8rem" }}>
              <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
              <span style={{ color: "var(--muted)", fontSize: ".68rem", letterSpacing: ".14em" }}>
                O CON CORREO
              </span>
              <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {mode !== "reset" && (
              <div className="auth-field">
                <label htmlFor="login-email">Correo electrónico</label>
                <input
                  id="login-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            )}

            {mode !== "forgot" && (
              <div className="auth-field">
                <label htmlFor="login-password">Contraseña</label>
                <input
                  id="login-password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete={mode === "reset" ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {mode === "login" && <small>Mínimo 8 caracteres.</small>}
              </div>
            )}

            <div className="auth-actions">
              <button type="submit" className="admin-button admin-button-copper" disabled={!configured || busy}>
                {mode === "login" ? "Entrar" : mode === "forgot" ? "Enviar enlace" : "Guardar clave"}
              </button>
            </div>
          </form>

          <p className="auth-link">
            {mode === "login" ? (
              <>
                ¿Olvidaste tu clave?{" "}
                <button type="button" onClick={() => setMode("forgot")}>
                  Recuperarla
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setMode("login")}>
                Volver al inicio de sesión
              </button>
            )}
          </p>
          <p className="auth-link">
            ¿Todavía no tenés cuenta? <Link to="/registro">Registrate</Link>
          </p>
        </div>
      </main>
    </div>
  );
}

export function Register() {
  const { signUpWithEmail, signInWithGoogle, configured } = useAuthContext();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setOk(null);
    setBusy(true);
    try {
      const { needsEmailConfirmation } = await signUpWithEmail(email, password, fullName);
      if (needsEmailConfirmation) {
        setOk(
          "Creamos tu cuenta. Revisá tu correo para confirmar el email y después ya podés entrar.",
        );
      } else {
        window.location.href = "/mi-cuenta";
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos crear la cuenta.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <Aside />
      <main className="auth-main">
        <div className="auth-form">
          <h1>Crear una cuenta</h1>
          <p>Registrate para consultar el estado de tus consultas y Expedientes.</p>

          {!configured && (
            <div className="auth-alert">
              El registro está deshabilitado porque Supabase no está configurado en este
              entorno.
            </div>
          )}
          {error && <div className="auth-alert">{error}</div>}
          {ok && <div className="auth-alert ok">{ok}</div>}

          <GoogleButton onClick={() => void signInWithGoogle()} disabled={!configured || busy} />

          <div className="admin-row" style={{ margin: "1.2rem 0 .4rem", gap: ".8rem" }}>
            <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
            <span style={{ color: "var(--muted)", fontSize: ".68rem", letterSpacing: ".14em" }}>
              O CON CORREO
            </span>
            <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
          </div>

          <form onSubmit={handleSubmit}>
            <div className="auth-field">
              <label htmlFor="reg-name">Nombre y apellido</label>
              <input
                id="reg-name"
                required
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>
            <div className="auth-field">
              <label htmlFor="reg-email">Correo electrónico</label>
              <input
                id="reg-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="auth-field">
              <label htmlFor="reg-password">Contraseña</label>
              <input
                id="reg-password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <small>Mínimo 8 caracteres.</small>
            </div>

            <label className="auth-terms">
              <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
              <span>
                Acepto la política de privacidad y los términos de uso del Estudio Jurídico
                Casoratti.
              </span>
            </label>

            <div className="auth-actions">
              <button
                type="submit"
                className="admin-button admin-button-copper"
                disabled={!configured || busy || !terms}
              >
                Crear cuenta
              </button>
            </div>
          </form>

          <p className="auth-link">
            ¿Ya tenés cuenta? <Link to="/ingresar">Ingresá</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
