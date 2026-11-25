import { useState } from "react";
import { updateMediaMetadata } from "./media-service";
import type { InventoryItem } from "./media-inventory";

/**
 * Ficha descriptiva de una imagen.
 *
 * El texto alternativo es lo que leen los lectores de pantalla y lo que
 * usan los buscadores: va primero y se explica por qué importa. Nada se
 * guarda sin confirmación.
 */

type MediaMetadataDialogProps = {
  item: InventoryItem;
  onClose: () => void;
  onSaved: (message: string) => void;
};

type Feedback = { kind: "ok" | "error"; text: string };

export function MediaMetadataDialog({
  item,
  onClose,
  onSaved,
}: MediaMetadataDialogProps) {
  const [altText, setAltText] = useState(item.metadata.altText ?? "");
  const [title, setTitle] = useState(item.metadata.title ?? "");
  const [description, setDescription] = useState(item.metadata.description ?? "");
  const [category, setCategory] = useState(item.metadata.category ?? "");
  const [tags, setTags] = useState(item.metadata.tags.join(", "));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const canSave = Boolean(item.rowId);

  const save = async () => {
    if (!item.rowId) return;
    setBusy(true);
    setFeedback(null);

    const parsedTags = tags
      .split(",")
      .map(tag => tag.trim())
      .filter(Boolean);

    const result = await updateMediaMetadata(item.rowId, {
      alt_text: altText.trim() || null,
      title: title.trim() || null,
      description: description.trim() || null,
      category: category.trim() || null,
      tags: parsedTags,
    });

    setBusy(false);
    if (!result.ok) {
      setFeedback({ kind: "error", text: result.error });
      return;
    }

    setConfirming(false);
    setFeedback({ kind: "ok", text: "Se guardó la información de la imagen." });
    onSaved(`Se actualizó la ficha de ${item.name}.`);
  };

  return (
    <div
      className="admin-media-modal"
      role="dialog"
      aria-modal="true"
      aria-label={`Información de ${item.name}`}
    >
      <div className="admin-media-modal-panel narrow">
        <div className="admin-media-modal-head">
          <div>
            <h2>Información de la imagen</h2>
            <p>{item.logicalPath}</p>
          </div>
          <button
            type="button"
            className="admin-close"
            aria-label="Cerrar la ficha de la imagen"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="admin-media-modal-body">
          {feedback && (
            <div className={feedback.kind === "ok" ? "admin-ok" : "admin-error"}>
              {feedback.text}
            </div>
          )}

          {!canSave && (
            <div className="admin-info">
              Este asset forma parte del build del sitio y no tiene ficha en la
              base: sus datos descriptivos se editan en el código del
              proyecto, no desde el panel.
            </div>
          )}

          <div className="filter-field">
            <label htmlFor="media-meta-title">Nombre descriptivo / título</label>
            <input
              id="media-meta-title"
              className="admin-input"
              type="text"
              value={title}
              disabled={!canSave}
              onChange={event => setTitle(event.target.value)}
            />
          </div>

          <div className="filter-field">
            <label htmlFor="media-meta-alt">
              Texto alternativo (ALT) — describe la imagen para quien no la ve
            </label>
            <textarea
              id="media-meta-alt"
              className="admin-textarea"
              value={altText}
              disabled={!canSave}
              onChange={event => setAltText(event.target.value)}
            />
          </div>

          <div className="filter-field">
            <label htmlFor="media-meta-description">Descripción</label>
            <textarea
              id="media-meta-description"
              className="admin-textarea"
              value={description}
              disabled={!canSave}
              onChange={event => setDescription(event.target.value)}
            />
          </div>

          <div className="admin-grid-2">
            <div className="filter-field">
              <label htmlFor="media-meta-category">Categoría</label>
              <input
                id="media-meta-category"
                className="admin-input"
                type="text"
                placeholder="institucional, equipo, servicios…"
                value={category}
                disabled={!canSave}
                onChange={event => setCategory(event.target.value)}
              />
            </div>
            <div className="filter-field">
              <label htmlFor="media-meta-tags">Etiquetas (separadas por coma)</label>
              <input
                id="media-meta-tags"
                className="admin-input"
                type="text"
                placeholder="estudio,[Casa], fotos"
                value={tags}
                disabled={!canSave}
                onChange={event => setTags(event.target.value)}
              />
            </div>
          </div>

          {confirming && (
            <div className="admin-media-warning">
              <strong>¿Guardar estos cambios?</strong>
              <p style={{ margin: ".4rem 0 0" }}>
                La ficha de «{item.name}» se actualiza con los datos que
                acabás de cargar.
              </p>
            </div>
          )}
        </div>

        <div className="admin-media-modal-foot">
          <button
            type="button"
            className="admin-button admin-button-ghost"
            onClick={onClose}
            disabled={busy}
          >
            Cerrar
          </button>
          {!confirming ? (
            <button
              type="button"
              className="admin-button admin-button-copper"
              onClick={() => setConfirming(true)}
              disabled={!canSave || busy}
            >
              Guardar cambios
            </button>
          ) : (
            <>
              <button
                type="button"
                className="admin-button admin-button-ghost"
                onClick={() => setConfirming(false)}
                disabled={busy}
              >
                Volver
              </button>
              <button
                type="button"
                className="admin-button admin-button-copper"
                onClick={() => void save()}
                disabled={busy}
              >
                {busy ? "Guardando…" : "Sí, guardar"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
