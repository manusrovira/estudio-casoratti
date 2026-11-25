import { useEffect, useMemo, useState } from "react";
import { useAuthContext } from "@/contexts/AuthContext";
import { canAccessAdminPanel } from "@/lib/rbac";
import { getSupabase } from "@/lib/supabase";
import {
  PASSWORD_REQUIREMENTS,
  evaluatePasswordStrength,
  validatePasswordChange,
} from "./security-utils";

/**
 * Seguridad · Cambiar contraseña.
 *
 * El cambio de contraseña es una operación delicada: por eso el módulo
 * verifica la contraseña actual contra el servidor **antes** de escribir
 * cualquier cosa, y recién después aplica la nueva.
 *
 * Reglas de seguridad que este módulo respeta:
 *
 * - La contraseña sólo existe en el estado local de esta pantalla. Al cambiar
 *   de usuario se borra y al desmontar React descarta el estado con la
 *   pantalla. Nunca se escribe en el `console`, en un atributo `data-*`, en
 *   el estado global ni en la red fuera de la llamada de autenticación.
 * - Los errores que vuelven de Supabase se muestran con un texto propio: no
 *   se vuelca el objeto crudo del error al usuario.
 * - La operación queda registrada en `media_activity` mediante el RPC
 *   `log_media_action`, sin ningún dato de la contraseña.
 */

type Feedback = { kind: "ok" | "error"; text: string };

/** Nivel visual de la fortaleza, para las clases CSS. */
const STRENGTH_LEVELS = ["debil", "debil", "media", "fuerte", "muy-fuerte"] as const;

/** Mensaje de éxito exigido por el contrato del módulo. */
const SUCCESS_MESSAGE = "La contraseña se actualizó correctamente";

export function SecurityModule() {
  const { user, role, configured } = useAuthContext();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const userId = user?.id ?? null;

  /**
   * Cambio de usuario: se limpia todo el estado local. La contraseña no
   * sobrevive a un cambio de sesión.
   */
  useEffect(() => {
    setCurrent("");
    setNext("");
    setConfirm("");
    setVisible(false);
    setErrors([]);
    setFeedback(null);
    setNotice(null);
  }, [userId]);

  const strength = useMemo(() => evaluatePasswordStrength(next), [next]);
  const level = STRENGTH_LEVELS[strength.score];

  /** Registro de la operación. Nunca incluye datos de la contraseña. */
  async function logPasswordChange(): Promise<void> {
    try {
      const { error } = await getSupabase().rpc("log_media_action", {
        p_action: "password_change",
        p_media_path: null,
        p_result: "success",
        p_detail: { metodo: "supabase-auth" },
      });
      // Si el RPC todavía no existe (lo crea la migración de medios), la
      // contraseña ya quedó cambiada: un registro pendiente no puede
      // interrumpir el flujo ni hacérnoslo perder.
      if (error) return;
    } catch {
      // Ídem: el registro es un efecto secundario, no un requisito.
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    setFeedback(null);
    setNotice(null);
    setErrors([]);

    const validation = validatePasswordChange({ current, next, confirm });
    if (validation.length > 0) {
      setErrors(validation);
      return;
    }

    const email = user?.email;
    if (!email) {
      setFeedback({
        kind: "error",
        text: "No pudimos identificar la cuenta para verificar tu contraseña actual.",
      });
      return;
    }

    setBusy(true);
    try {
      const supabase = getSupabase();

      // 1) Verificación de la contraseña actual. Si falla, se aborta acá: la
      //    nueva contraseña no se aplica.
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email,
        password: current,
      });
      if (reauthError) {
        setFeedback({ kind: "error", text: "La contraseña actual no es correcta" });
        return;
      }

      // 2) Aplicación de la contraseña nueva.
      const { error: updateError } = await supabase.auth.updateUser({
        password: next,
      });
      if (updateError) {
        setFeedback({
          kind: "error",
          text: "No pudimos actualizar la contraseña. Probá de nuevo en unos minutos.",
        });
        return;
      }

      // 3) Registro de la operación, antes de tocar las sesiones.
      await logPasswordChange();

      // 4) Revocación de las sesiones anteriores. La versión instalada de
      //    @supabase/supabase-js (2.119) soporta el alcance "others": se
      //    cierran las demás sesiones y la actual sigue viva, así que el
      //    administrador ve la confirmación y no pierde el panel.
      const { error: signOutError } = await supabase.auth.signOut({
        scope: "others",
      });

      setFeedback({ kind: "ok", text: SUCCESS_MESSAGE });
      if (signOutError) {
        // La contraseña ya quedó actualizada: se avisa sin romper el flujo.
        setNotice(
          "No pudimos cerrar automáticamente las sesiones abiertas en otros dispositivos. Si creés que alguien más tuvo acceso, cerrá sesión desde ese dispositivo.",
        );
      }

      // Se limpian los campos: la contraseña no queda en la pantalla.
      setCurrent("");
      setNext("");
      setConfirm("");
      setVisible(false);
    } catch {
      setFeedback({
        kind: "error",
        text: "Ocurrió un problema inesperado al actualizar la contraseña. Probá de nuevo.",
      });
    } finally {
      setBusy(false);
    }
  }

  if (!configured) {
    return (
      <div className="admin-info">
        Supabase no configurado. Definí <code>VITE_SUPABASE_URL</code> y{" "}
        <code>VITE_SUPABASE_ANON_KEY</code> en el archivo <code>.env</code> para
        habilitar el cambio de contraseña.
      </div>
    );
  }

  if (!canAccessAdminPanel(role)) {
    return (
      <div className="admin-error">
        Acceso restringido. Esta sección es exclusiva del administrador del
        estudio.
      </div>
    );
  }

  return (
    <div className="admin-card">
      <div className="admin-card-head">
        <div>
          <h2 className="admin-card-title">Cambiar contraseña</h2>
          <p className="admin-card-sub">
            Actualizá la contraseña de la cuenta administradora del estudio. Por
            seguridad, primero se verifica la contraseña actual.
          </p>
        </div>
      </div>

      <form
        className="admin-card-body admin-stack admin-sec-form"
        onSubmit={handleSubmit}
        noValidate
      >
        {feedback && (
          <div className={feedback.kind === "ok" ? "admin-ok" : "admin-error"}>
            {feedback.text}
          </div>
        )}

        {notice && <div className="admin-info">{notice}</div>}

        <div className="filter-field">
          <label htmlFor="security-current">Contraseña actual</label>
          <input
            id="security-current"
            name="current-password"
            className="admin-input"
            type={visible ? "text" : "password"}
            autoComplete="current-password"
            spellCheck={false}
            value={current}
            disabled={busy}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </div>

        <div className="filter-field">
          <label htmlFor="security-next">Nueva contraseña</label>
          <input
            id="security-next"
            name="new-password"
            className="admin-input"
            type={visible ? "text" : "password"}
            autoComplete="new-password"
            spellCheck={false}
            value={next}
            disabled={busy}
            onChange={(event) => setNext(event.target.value)}
          />
        </div>

        <div className="filter-field">
          <label htmlFor="security-confirm">Confirmar nueva contraseña</label>
          <input
            id="security-confirm"
            name="confirm-password"
            className="admin-input"
            type={visible ? "text" : "password"}
            autoComplete="new-password"
            spellCheck={false}
            value={confirm}
            disabled={busy}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </div>

        <div className="admin-row">
          <button
            type="button"
            className="admin-button admin-button-ghost admin-button-small"
            aria-pressed={visible}
            aria-label={
              visible ? "Ocultar contraseñas" : "Mostrar contraseñas"
            }
            disabled={busy}
            onClick={() => setVisible((previous) => !previous)}
          >
            {visible ? "Ocultar contraseñas" : "Mostrar contraseñas"}
          </button>
          <span className="admin-sec-hint">
            La contraseña nueva se valida en el navegador y el servidor la vuelve
            a validar antes de guardarla.
          </span>
        </div>

        {next.length > 0 && (
          <div className="admin-sec-strength">
            <div className="admin-sec-strength-head">
              <span className="admin-sec-strength-label">Fortaleza</span>
              <span className={`admin-sec-strength-value is-${level}`}>
                {strength.label}
              </span>
            </div>
            <div className="admin-sec-meter" aria-hidden="true">
              {[1, 2, 3, 4].map((step) => (
                <span
                  key={step}
                  className={`admin-sec-meter-step${step <= strength.score ? " is-on" : ""} is-${level}`}
                />
              ))}
            </div>
          </div>
        )}

        <ul className="admin-sec-requirements">
          {PASSWORD_REQUIREMENTS.map((requirement) => {
            const met = strength.checks[requirement.key];
            return (
              <li
                key={requirement.key}
                className={met ? "admin-sec-requirement is-met" : "admin-sec-requirement"}
              >
                <span className="admin-sec-mark" aria-hidden="true">
                  {met ? "✓" : "!"}
                </span>
                <span>{requirement.label}</span>
                <span className="admin-sec-requirement-state">
                  {met ? "cumple" : "falta"}
                </span>
              </li>
            );
          })}
        </ul>

        {errors.length > 0 && (
          <div className="admin-error" role="alert" aria-live="polite">
            <strong>Revisá los datos antes de continuar:</strong>
            <ul className="admin-sec-errors">
              {errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="admin-row">
          <button
            type="submit"
            className="admin-button admin-button-copper"
            disabled={busy}
          >
            {busy ? "Actualizando…" : "Actualizar contraseña"}
          </button>
          <span className="admin-sec-hint">
            Al cambiar la contraseña se cierran las sesiones abiertas en otros
            dispositivos.
          </span>
        </div>
      </form>
    </div>
  );
}
