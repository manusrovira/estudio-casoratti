import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ALLOWED_MEDIA_FOLDERS,
  MAX_IMAGE_BYTES,
  normalizeMediaName,
  validateImageFile,
} from "./media-validator";
import { createFolder, listMedia, updateMediaMetadata, uploadImage } from "./media-service";
import { findDuplicateMedia, type InventoryItem } from "./media-inventory";

/**
 * Carga de imágenes al bucket `site-media`.
 *
 * Se valida cada archivo antes de subirlo (extensión, tipo declarado y
 * bytes mágicos), se avisa de los nombres duplicados sin sobrescribir nada
 * salvo que el administrador lo confirme, y se puede cancelar la cola de
 * cargas pendientes.
 */

type MediaUploadPanelProps = {
  folders: string[];
  items: InventoryItem[];
  onFoldersChanged: () => void;
  onUploaded: () => void;
  onClose: () => void;
};

type EntryStatus = "ready" | "uploading" | "done" | "error" | "cancelled";

type UploadEntry = {
  id: string;
  file: File;
  previewUrl: string;
  status: EntryStatus;
  message: string;
  overwrite: boolean;
};

type Feedback = { kind: "ok" | "error" | "info"; text: string };

let sequence = 0;

function nextId(): string {
  sequence += 1;
  return `upload-${sequence}`;
}

export function MediaUploadPanel({
  folders,
  items,
  onFoldersChanged,
  onUploaded,
  onClose,
}: MediaUploadPanelProps) {
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const [folder, setFolder] = useState(folders[0] ?? ALLOWED_MEDIA_FOLDERS[0]);
  const [newFolder, setNewFolder] = useState("");
  const [maxMb, setMaxMb] = useState(Math.round(MAX_IMAGE_BYTES / (1024 * 1024)));
  const [altText, setAltText] = useState("");
  const [title, setTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [dragging, setDragging] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const entriesRef = useRef<UploadEntry[]>([]);
  entriesRef.current = entries;

  // Las vistas previas se liberan recién al cerrar el panel: si se liberaran
  // en cada cambio de la lista, las imágenes ya agregadas quedarían rotas.
  useEffect(
    () => () => {
      for (const entry of entriesRef.current) URL.revokeObjectURL(entry.previewUrl);
    },
    [],
  );

  const limitBytes = Math.max(1, Math.round(maxMb * 1024 * 1024));

  const updateEntry = useCallback((id: string, patch: Partial<UploadEntry>) => {
    setEntries(current =>
      current.map(entry => (entry.id === id ? { ...entry, ...patch } : entry)),
    );
  }, []);

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const incoming = Array.from(files);
      if (!incoming.length) return;
      setFeedback(null);

      for (const file of incoming) {
        const id = nextId();
        const previewUrl = URL.createObjectURL(file);

        if (file.size > limitBytes) {
          setEntries(current => [
            ...current,
            {
              id,
              file,
              previewUrl,
              status: "error",
              message: `Supera el límite de ${maxMb} MB.`,
              overwrite: false,
            },
          ]);
          continue;
        }

        const validation = await validateImageFile(file);
        if (!validation.ok) {
          setEntries(current => [
            ...current,
            {
              id,
              file,
              previewUrl,
              status: "error",
              message: validation.error,
              overwrite: false,
            },
          ]);
          continue;
        }

        setEntries(current => [
          ...current,
          {
            id,
            file,
            previewUrl,
            status: "ready",
            message: "",
            overwrite: false,
          },
        ]);
      }
    },
    [limitBytes, maxMb],
  );

  const removeEntry = useCallback((id: string) => {
    setEntries(current => {
      const target = current.find(entry => entry.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter(entry => entry.id !== id);
    });
  }, []);

  /** Duplicado de cada archivo, calculado con la carpeta de destino actual. */
  const duplicates = useMemo(() => {
    const map = new Map<string, InventoryItem | null>();
    for (const entry of entries) {
      map.set(entry.id, findDuplicateMedia(items, folder, entry.file.name));
    }
    return map;
  }, [entries, folder, items]);

  const makeFolder = useCallback(async () => {
    const path = newFolder.trim();
    if (!path) {
      setFeedback({ kind: "error", text: "Escribí el nombre de la carpeta nueva." });
      return;
    }
    setFeedback(null);
    const result = await createFolder(path);
    if (!result.ok) {
      setFeedback({ kind: "error", text: result.error });
      return;
    }
    setNewFolder("");
    setFeedback({ kind: "ok", text: `Se creó la carpeta «${path}».` });
    onFoldersChanged();
  }, [newFolder, onFoldersChanged]);

  const applyMetadata = useCallback(
    async (logicalPath: string) => {
      if (!altText.trim() && !title.trim()) return;
      try {
        const rows = await listMedia();
        const row = rows.find(item => item.logical_path === logicalPath);
        if (!row) return;
        await updateMediaMetadata(row.id, {
          alt_text: altText.trim() || null,
          title: title.trim() || null,
        });
      } catch {
        /* La imagen ya está subida: el metadato se puede volver a cargar. */
      }
    },
    [altText, title],
  );

  const startUpload = useCallback(async () => {
    const pending = entries.filter(entry => entry.status === "ready");
    if (!pending.length) {
      setFeedback({
        kind: "info",
        text: "No hay imágenes listas para subir.",
      });
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setUploading(true);
    setFeedback(null);

    let uploaded = 0;
    let failed = 0;

    for (const entry of pending) {
      if (controller.signal.aborted) {
        updateEntry(entry.id, { status: "cancelled", message: "Carga cancelada." });
        continue;
      }

      const duplicate = duplicates.get(entry.id) ?? null;
      if (duplicate && !entry.overwrite) {
        updateEntry(entry.id, {
          status: "error",
          message: `Ya existe «${duplicate.name}» en esa carpeta. Confirmá el reemplazo para continuar.`,
        });
        failed += 1;
        continue;
      }

      updateEntry(entry.id, { status: "uploading", message: "" });
      const result = await uploadImage(entry.file, folder, {
        overwrite: Boolean(entry.overwrite),
      });

      if (!result.ok) {
        updateEntry(entry.id, { status: "error", message: result.error });
        failed += 1;
        continue;
      }

      updateEntry(entry.id, { status: "done", message: `Subida como ${result.logicalPath}.` });
      uploaded += 1;
      await applyMetadata(result.logicalPath);
    }

    abortRef.current = null;
    setUploading(false);

    if (uploaded) onUploaded();

    if (uploaded && !failed) {
      setFeedback({
        kind: "ok",
        text: `Se subieron ${uploaded} ${
          uploaded === 1 ? "imagen" : "imágenes"
        } a «${folder}».`,
      });
    } else if (uploaded && failed) {
      setFeedback({
        kind: "error",
        text: `Se subieron ${uploaded} imágenes y ${failed} quedaron sin subir.`,
      });
    } else if (failed) {
      setFeedback({
        kind: "error",
        text: "Ninguna imagen se pudo subir. Revisá los avisos de cada archivo.",
      });
    }
  }, [applyMetadata, duplicates, entries, folder, onUploaded, updateEntry]);

  const cancelPending = useCallback(() => {
    abortRef.current?.abort();
    setEntries(current =>
      current.map(entry =>
        entry.status === "ready"
          ? { ...entry, status: "cancelled", message: "Carga cancelada." }
          : entry,
      ),
    );
    setFeedback({
      kind: "info",
      text: "Se cancelaron las cargas pendientes. La imagen que se estaba subiendo termina de completarse.",
    });
  }, []);

  const readyCount = entries.filter(entry => entry.status === "ready").length;
  const doneCount = entries.filter(entry => entry.status === "done").length;
  const totalCount = entries.length;
  const batchPercent = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;

  return (
    <div
      className="admin-media-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Subir imágenes"
    >
      <div className="admin-media-modal-panel">
        <div className="admin-media-modal-head">
          <div>
            <h2>Subir imágenes</h2>
            <p>
              Los archivos se validan (extensión, tipo y contenido real) antes de
              subir al bucket site-media.
            </p>
          </div>
          <button
            type="button"
            className="admin-close"
            aria-label="Cerrar la carga de imágenes"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="admin-media-modal-body">
          {feedback && (
            <div
              className={
                feedback.kind === "ok"
                  ? "admin-ok"
                  : feedback.kind === "error"
                  ? "admin-error"
                  : "admin-info"
              }
            >
              {feedback.text}
            </div>
          )}

          <div
            className={dragging ? "admin-media-drop is-over" : "admin-media-drop"}
            onDragOver={event => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={event => {
              event.preventDefault();
              setDragging(false);
              if (event.dataTransfer?.files?.length) {
                void addFiles(event.dataTransfer.files);
              }
            }}
          >
            <strong>Arrastrá las imágenes acá</strong>
            <p className="admin-media-hint" style={{ marginBottom: ".8rem" }}>
              JPG, PNG, WEBP, AVIF o SVG. Máximo {maxMb} MB por archivo.
            </p>
            <input
              className="admin-input"
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,image/avif,image/svg+xml"
              aria-label="Elegir imágenes desde el ordenador"
              onChange={event => {
                if (event.target.files?.length) void addFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </div>

          <div className="admin-media-field-grid">
            <div className="filter-field">
              <label htmlFor="media-upload-folder">Carpeta de destino</label>
              <select
                id="media-upload-folder"
                className="admin-select"
                value={folder}
                onChange={event => setFolder(event.target.value)}
              >
                {(folders.length ? folders : ALLOWED_MEDIA_FOLDERS).map(option => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            <div className="filter-field">
              <label htmlFor="media-upload-limit">Límite por imagen (MB)</label>
              <input
                id="media-upload-limit"
                className="admin-input"
                type="number"
                min={1}
                max={50}
                value={maxMb}
                onChange={event => setMaxMb(Number(event.target.value))}
              />
            </div>
            <div className="filter-field">
              <label htmlFor="media-upload-newfolder">Crear carpeta nueva</label>
              <div className="admin-row">
                <input
                  id="media-upload-newfolder"
                  className="admin-input"
                  type="text"
                  placeholder="images/mi-carpeta"
                  value={newFolder}
                  onChange={event => setNewFolder(event.target.value)}
                />
                <button
                  type="button"
                  className="admin-button admin-button-ghost admin-button-small"
                  onClick={() => void makeFolder()}
                >
                  Crear
                </button>
              </div>
            </div>
            <div className="filter-field">
              <label htmlFor="media-upload-alt">Texto alternativo (ALT)</label>
              <input
                id="media-upload-alt"
                className="admin-input"
                type="text"
                placeholder="Descripción de la imagen"
                value={altText}
                onChange={event => setAltText(event.target.value)}
              />
            </div>
            <div className="filter-field">
              <label htmlFor="media-upload-title">Nombre descriptivo</label>
              <input
                id="media-upload-title"
                className="admin-input"
                type="text"
                placeholder="Título de la imagen"
                value={title}
                onChange={event => setTitle(event.target.value)}
              />
            </div>
          </div>

          {entries.length > 0 && (
            <div>
              <div className="admin-row" style={{ marginBottom: ".6rem" }}>
                <span className="cell-muted">
                  {doneCount} de {totalCount} imágenes subidas
                </span>
                <div
                  className="admin-media-progress"
                  style={{ flex: "1 1 180px" }}
                  role="progressbar"
                  aria-valuenow={batchPercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Avance de la carga"
                >
                  <div
                    className="admin-media-progress-fill"
                    style={{ width: `${batchPercent}%` }}
                  />
                </div>
              </div>

              <div className="admin-media-queue">
                {entries.map(entry => {
                  const duplicate = duplicates.get(entry.id) ?? null;
                  return (
                    <div className="admin-media-file" key={entry.id}>
                      <img src={entry.previewUrl} alt={`Vista previa de ${entry.file.name}`} />
                      <span className="admin-media-file-name">{entry.file.name}</span>
                      <span className="admin-media-file-meta">
                        Nombre final: {normalizeMediaName(entry.file.name)} ·{" "}
                        {(entry.file.size / 1024).toFixed(0)} KB
                      </span>

                      {duplicate && (
                        <span className="admin-media-file-dup">
                          Ya existe «{duplicate.name}» en {folder}.
                        </span>
                      )}

                      {duplicate && (
                        <label className="admin-media-check">
                          <input
                            type="checkbox"
                            checked={entry.overwrite}
                            onChange={event =>
                              updateEntry(entry.id, { overwrite: event.target.checked })
                            }
                          />
                          Confirmo el reemplazo de la imagen existente.
                        </label>
                      )}

                      {entry.message && (
                        <span
                          className={
                            entry.status === "done"
                              ? "admin-media-file-meta"
                              : "admin-media-file-error"
                          }
                        >
                          {entry.message}
                        </span>
                      )}

                      <div
                        className={
                          entry.status === "uploading"
                            ? "admin-media-progress is-indeterminate"
                            : "admin-media-progress"
                        }
                        role="progressbar"
                        aria-valuenow={
                          entry.status === "done"
                            ? 100
                            : entry.status === "uploading"
                            ? undefined
                            : 0
                        }
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`Carga de ${entry.file.name}`}
                      >
                        <div
                          className={
                            entry.status === "done"
                              ? "admin-media-progress-fill is-done"
                              : entry.status === "error"
                              ? "admin-media-progress-fill is-error"
                              : "admin-media-progress-fill"
                          }
                          style={
                            entry.status === "done"
                              ? { width: "100%" }
                              : entry.status === "error"
                              ? { width: "100%" }
                              : undefined
                          }
                        />
                      </div>

                      {entry.status !== "uploading" && (
                        <button
                          type="button"
                          className="admin-button admin-button-ghost admin-button-small"
                          onClick={() => removeEntry(entry.id)}
                        >
                          Quitar
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="admin-media-modal-foot">
          <button
            type="button"
            className="admin-button admin-button-ghost"
            onClick={onClose}
            disabled={uploading}
          >
            Cerrar
          </button>
          {uploading && (
            <button
              type="button"
              className="admin-button admin-button-danger"
              onClick={cancelPending}
            >
              Cancelar pendientes
            </button>
          )}
          <button
            type="button"
            className="admin-button admin-button-copper"
            onClick={() => void startUpload()}
            disabled={uploading || readyCount === 0}
          >
            {uploading
              ? "Subiendo…"
              : readyCount
              ? `Subir ${readyCount} ${readyCount === 1 ? "imagen" : "imágenes"}`
              : "Subir imágenes"}
          </button>
        </div>
      </div>
    </div>
  );
}
