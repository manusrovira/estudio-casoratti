import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";

/**
 * Registro de actividad de la biblioteca de imágenes.
 *
 * Lee `media_activity` (append-only, con RLS de administrador). Muestra la
 * fecha, el tipo de acción, el identificador del administrador y el
 * resultado. Nunca se registra una contraseña.
 */

type ActivityRow = {
  id: string;
  action: string;
  media_path: string | null;
  actor_id: string | null;
  result: string;
  detail: Record<string, unknown> | null;
  created_at: string;
};

const ACTION_LABELS: Record<string, string> = {
  upload: "Carga",
  replace: "Reemplazo",
  edit: "Edición",
  delete: "Eliminación",
  restore: "Restauración",
  purge: "Borrado definitivo",
  folder_create: "Carpeta creada",
  metadata_update: "Metadatos",
  password_change: "Cambio de contraseña",
};

const dateFormatter = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return dateFormatter.format(parsed);
}

export function MediaActivityPanel() {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: queryError } = await getSupabase()
        .from("media_activity")
        .select("id, action, media_path, actor_id, result, detail, created_at")
        .order("created_at", { ascending: false })
        .limit(150);

      if (queryError) {
        setError(queryError.message);
        setRows([]);
        setLoading(false);
        return;
      }

      setRows((data ?? []) as ActivityRow[]);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudo cargar el registro de actividad.",
      );
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="admin-card">
      <div className="admin-card-head">
        <div>
          <h2 className="admin-card-title">Registro de actividad</h2>
          <p className="admin-card-sub">
            Cada operación sobre la biblioteca queda registrada con su autor y
            su resultado.
          </p>
        </div>
        <button
          type="button"
          className="admin-button admin-button-ghost admin-button-small"
          onClick={() => void load()}
          disabled={loading}
        >
          Actualizar
        </button>
      </div>

      <div className="admin-card-body">
        {error && <div className="admin-error">{error}</div>}
        {loading && <div className="admin-empty">Cargando el registro…</div>}

        {!loading && !rows.length && !error && (
          <div className="admin-empty">
            <strong>Todavía no hay actividad registrada</strong>
            Las cargas, reemplazos y eliminaciones quedan anotadas acá.
          </div>
        )}

        {!loading && rows.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Acción</th>
                  <th>Imagen</th>
                  <th>Administrador</th>
                  <th>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id}>
                    <td className="cell-muted">{formatDate(row.created_at)}</td>
                    <td className="admin-media-activity-action">
                      {ACTION_LABELS[row.action] ?? row.action}
                    </td>
                    <td className="cell-muted admin-media-mono">
                      {row.media_path ?? "—"}
                    </td>
                    <td className="admin-media-activity-actor">
                      {row.actor_id ?? "—"}
                    </td>
                    <td
                      className={
                        row.result === "success"
                          ? "admin-media-result-ok"
                          : "admin-media-result-error"
                      }
                    >
                      {row.result === "success" ? "Éxito" : "Error"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
