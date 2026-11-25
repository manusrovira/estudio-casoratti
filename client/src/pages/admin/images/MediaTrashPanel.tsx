import { useState } from "react";
import { formatMediaBytes } from "@/lib/mediaManifest";
import { purgeMedia, restoreMedia, type MediaRow } from "./media-service";

/**
 * Papelera de la biblioteca de imágenes.
 *
 * Las imágenes eliminadas no se borran del bucket enseguida: primero quedan
 * acá, con su ruta original y la fecha de eliminación, y se pueden restaurar.
 * El borrado definitivo pide una confirmación aparte.
 */

type MediaTrashPanelProps = {
  rows: MediaRow[];
  onChanged: () => void;
};

type Feedback = { kind: "ok" | "error"; text: string };

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

export function MediaTrashPanel({ rows, onChanged }: MediaTrashPanelProps) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const restore = async (row: MediaRow) => {
    setBusy(true);
    setFeedback(null);
    const result = await restoreMedia(row.id);
    setBusy(false);
    if (!result.ok) {
      setFeedback({ kind: "error", text: result.error });
      return;
    }
    setFeedback({
      kind: "ok",
      text: `Se restauró «${row.original_name}».`,
    });
    onChanged();
  };

  const purge = async (row: MediaRow) => {
    setBusy(true);
    setFeedback(null);
    const result = await purgeMedia(row.id);
    setBusy(false);
    if (!result.ok) {
      setFeedback({ kind: "error", text: result.error });
      return;
    }
    setPendingId(null);
    setConfirmed(false);
    setFeedback({
      kind: "ok",
      text: `Se eliminó definitivamente «${row.original_name}».`,
    });
    onChanged();
  };

  return (
    <div className="admin-card">
      <div className="admin-card-head">
        <div>
          <h2 className="admin-card-title">Papelera</h2>
          <p className="admin-card-sub">
            Imágenes eliminadas: se pueden restaurar o borrar de forma definitiva.
          </p>
        </div>
      </div>

      <div className="admin-card-body">
        {feedback && (
          <div className={feedback.kind === "ok" ? "admin-ok" : "admin-error"}>
            {feedback.text}
          </div>
        )}

        {!rows.length && (
          <div className="admin-empty">
            <strong>La papelera está vacía</strong>
            Las imágenes que elimines quedan acá hasta que las borres de forma
            definitiva.
          </div>
        )}

        {rows.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Imagen</th>
                  <th>Ruta original</th>
                  <th>Proveedor</th>
                  <th>Peso</th>
                  <th>Eliminada</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id}>
                    <td className="cell-strong">{row.original_name}</td>
                    <td className="cell-muted admin-media-mono">{row.logical_path}</td>
                    <td className="cell-muted">{row.provider}</td>
                    <td className="cell-muted">{formatMediaBytes(row.size_bytes)}</td>
                    <td className="cell-muted">{formatDate(row.deleted_at)}</td>
                    <td>
                      <div className="cell-actions">
                        <button
                          type="button"
                          className="admin-button admin-button-ghost admin-button-small"
                          disabled={busy}
                          onClick={() => void restore(row)}
                        >
                          Restaurar
                        </button>
                        <button
                          type="button"
                          className="admin-button admin-button-danger admin-button-small"
                          disabled={busy}
                          onClick={() => {
                            setPendingId(row.id);
                            setConfirmed(false);
                          }}
                        >
                          Eliminar definitivamente
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pendingId && (
          <div className="admin-media-warning" style={{ marginTop: "1rem" }}>
            <strong>Confirmación adicional: borrado definitivo.</strong>
            <p style={{ margin: ".4rem 0 .6rem" }}>
              La imagen y su archivo van a desaparecer del bucket. No se puede
              deshacer.
            </p>
            <label className="admin-media-check">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={event => setConfirmed(event.target.checked)}
              />
              Entiendo que esta acción no se puede deshacer.
            </label>
            <div className="admin-row" style={{ marginTop: ".8rem" }}>
              <button
                type="button"
                className="admin-button admin-button-danger"
                disabled={!confirmed || busy}
                onClick={() => {
                  const row = rows.find(item => item.id === pendingId);
                  if (row) void purge(row);
                }}
              >
                Sí, eliminar definitivamente
              </button>
              <button
                type="button"
                className="admin-button admin-button-ghost"
                onClick={() => {
                  setPendingId(null);
                  setConfirmed(false);
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
