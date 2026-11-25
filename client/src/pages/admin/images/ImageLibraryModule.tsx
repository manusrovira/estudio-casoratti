import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchMediaManifest,
  formatMediaBytes,
  type MediaManifest,
} from "@/lib/mediaManifest";
import { listFolders, listMedia, trashMedia, type MediaRow } from "./media-service";
import {
  MEDIA_USAGE_LABELS,
  filterMediaInventory,
  mediaDeleteBlockers,
  mediaFormatOptions,
  mediaFolderOptions,
  mediaUsageWarning,
  mergeMediaInventory,
  summarizeMediaInventory,
  withCacheVersion,
  type InventoryItem,
  type MediaUsageStatus,
} from "./media-inventory";
import { ImageEditorModal } from "./ImageEditorModal";
import { MediaActivityPanel } from "./MediaActivityPanel";
import { MediaMetadataDialog } from "./MediaMetadataDialog";
import { MediaTrashPanel } from "./MediaTrashPanel";
import { MediaUploadPanel } from "./MediaUploadPanel";

/**
 * Biblioteca de imágenes del estudio.
 *
 * El inventario junta dos fuentes reales: el manifiesto que se genera en el
 * build (los assets compilados y sus referencias en el código) y las filas de
 * `site_media` (los objetos del bucket `site-media`). No hay datos
 * simulados: si el manifiesto todavía no está, se lo dice.
 */

type Tab = "inventario" | "papelera" | "actividad";
type View = "grid" | "list";
type Feedback = { kind: "ok" | "error"; text: string };

const STATUS_FILTERS: { value: MediaUsageStatus | "all"; label: string }[] = [
  { value: "all", label: "Todas" },
  { value: "in-use", label: "En uso" },
  { value: "unused", label: "Sin referencias" },
  { value: "replaced", label: "Reemplazada" },
  { value: "trashed", label: "En papelera" },
];

const dateFormatter = new Intl.DateTimeFormat("es-AR", { dateStyle: "medium" });

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return dateFormatter.format(parsed);
}

function dimensionsOf(item: InventoryItem): string {
  if (!item.width || !item.height) return "—";
  return `${item.width}×${item.height} px`;
}

export function ImageLibraryModule() {
  /* ------------------------------------------------------------- datos */

  const [manifest, setManifest] = useState<MediaManifest | null>(null);
  const [manifestAvailable, setManifestAvailable] = useState<boolean | null>(null);
  const [rows, setRows] = useState<MediaRow[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cacheVersion, setCacheVersion] = useState(() => Date.now());

  /* ----------------------------------------------------------- filtros */

  const [search, setSearch] = useState("");
  const [format, setFormat] = useState("");
  const [folder, setFolder] = useState("");
  const [status, setStatus] = useState<MediaUsageStatus | "all">("all");
  const [view, setView] = useState<View>("grid");
  const [tab, setTab] = useState<Tab>("inventario");

  /* ---------------------------------------------------------- selección */

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [editorKey, setEditorKey] = useState<string | null>(null);
  const [metadataKey, setMetadataKey] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  /* ------------------------------------------------------------- carga */

  const loadDatabase = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mediaRows, folderList] = await Promise.all([
        listMedia(),
        listFolders(),
      ]);
      setRows(mediaRows);
      setFolders(folderList);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudo cargar la biblioteca de imágenes.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const loadManifest = useCallback(async () => {
    const result = await fetchMediaManifest();
    setManifest(result);
    setManifestAvailable(Boolean(result));
  }, []);

  useEffect(() => {
    void loadDatabase();
  }, [loadDatabase]);

  useEffect(() => {
    void loadManifest();
  }, [loadManifest, cacheVersion]);

  const refresh = useCallback(async () => {
    setCacheVersion(Date.now());
    await loadDatabase();
  }, [loadDatabase]);

  /* --------------------------------------------------------- inventario */

  const items = useMemo(
    () => mergeMediaInventory(manifest, rows),
    [manifest, rows],
  );

  const filters = useMemo(
    () => ({ search, format, folder, status }),
    [search, format, folder, status],
  );

  const visible = useMemo(
    () => filterMediaInventory(items, filters),
    [items, filters],
  );

  const summary = useMemo(() => summarizeMediaInventory(items), [items]);
  const formats = useMemo(() => mediaFormatOptions(items), [items]);
  const locations = useMemo(() => mediaFolderOptions(items), [items]);
  const trashedRows = useMemo(
    () => rows.filter(row => row.status === "trashed"),
    [rows],
  );

  const selected = useMemo(
    () => items.find(item => item.key === selectedKey) ?? null,
    [items, selectedKey],
  );
  const editorItem = useMemo(
    () => items.find(item => item.key === editorKey) ?? null,
    [items, editorKey],
  );
  const metadataItem = useMemo(
    () => items.find(item => item.key === metadataKey) ?? null,
    [items, metadataKey],
  );

  /* ------------------------------------------------------------- ações */

  const copy = useCallback(async (value: string, key: string) => {
    if (!value) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const area = document.createElement("textarea");
        area.value = value;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        document.body.removeChild(area);
      }
      setCopied(key);
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 2200);
    } catch {
      setFeedback({
        kind: "error",
        text: "No se pudo copiar al portapapeles.",
      });
    }
  }, []);

  const moveToTrash = useCallback(
    async (item: InventoryItem) => {
      if (!item.rowId) {
        setFeedback({
          kind: "error",
          text:
            "Esta imagen no tiene ficha en la base: no se puede eliminar desde el panel.",
        });
        return;
      }
      setBusy(true);
      const result = await trashMedia(item.rowId);
      setBusy(false);
      if (!result.ok) {
        setFeedback({ kind: "error", text: result.error });
        return;
      }
      setFeedback({
        kind: "ok",
        text: `«${item.name}» se movió a la papelera.`,
      });
      setConfirmDelete(false);
      setSelectedKey(null);
      await refresh();
    },
    [refresh],
  );

  const previewUrl = useCallback(
    (item: InventoryItem) => withCacheVersion(item.publicUrl, cacheVersion),
    [cacheVersion],
  );

  /* ----------------------------------------------------------- render */

  const blockers = selected ? mediaDeleteBlockers(selected) : [];
  const usageWarning = selected ? mediaUsageWarning(selected) : null;

  return (
    <div className="admin-stack">
      <div className="admin-media-tabs">
        <button
          type="button"
          className={tab === "inventario" ? "admin-media-tab active" : "admin-media-tab"}
          onClick={() => setTab("inventario")}
        >
          Inventario
        </button>
        <button
          type="button"
          className={tab === "papelera" ? "admin-media-tab active" : "admin-media-tab"}
          onClick={() => setTab("papelera")}
        >
          Papelera{trashedRows.length ? ` (${trashedRows.length})` : ""}
        </button>
        <button
          type="button"
          className={tab === "actividad" ? "admin-media-tab active" : "admin-media-tab"}
          onClick={() => setTab("actividad")}
        >
          Actividad
        </button>
      </div>

      {tab === "inventario" && (
        <>
          <div className="admin-card">
            <div className="admin-card-head">
              <div>
                <h2 className="admin-card-title">Biblioteca de imágenes</h2>
                <p className="admin-card-sub">
                  Imágenes del sitio y del banco de imágenes: dónde están, dónde
                  se usan y cuánto ocupan.
                </p>
              </div>
              <button
                type="button"
                className="admin-button admin-button-copper"
                onClick={() => setUploadOpen(true)}
              >
                Subir imágenes
              </button>
            </div>

            <div className="admin-card-body">
              <div className="admin-media-kpis">
                <div className="admin-media-kpi">
                  <span className="admin-media-kpi-label">Total de imágenes</span>
                  <span className="admin-media-kpi-value">{summary.total}</span>
                  <span className="admin-media-kpi-hint">
                    {summary.active} activas · {summary.trashed} en papelera
                  </span>
                </div>
                <div className="admin-media-kpi admin-media-kpi-accent">
                  <span className="admin-media-kpi-label">Utilizadas</span>
                  <span className="admin-media-kpi-value">{summary.inUse}</span>
                  <span className="admin-media-kpi-hint">
                    Con al menos una referencia en el sitio
                  </span>
                </div>
                <div className="admin-media-kpi">
                  <span className="admin-media-kpi-label">Sin referencias</span>
                  <span className="admin-media-kpi-value">{summary.unused}</span>
                  <span className="admin-media-kpi-hint">
                    No se detectaron usos en el código
                  </span>
                </div>
                <div className="admin-media-kpi admin-media-kpi-strong">
                  <span className="admin-media-kpi-label">Espacio ocupado</span>
                  <span className="admin-media-kpi-value">
                    {formatMediaBytes(summary.bytes)}
                  </span>
                  <span className="admin-media-kpi-hint">
                    Suma del tamaño real de los archivos
                  </span>
                </div>
              </div>
            </div>
          </div>

          {feedback && (
            <div className={feedback.kind === "ok" ? "admin-ok" : "admin-error"}>
              {feedback.text}
            </div>
          )}

          {error && <div className="admin-error">{error}</div>}

          {manifestAvailable === false && (
            <div className="admin-info">
              El inventario se genera en el build; todavía no está disponible.
              Se muestran los medios guardados en el banco de imágenes.
            </div>
          )}

          <div className="admin-card">
            <div className="admin-media-filters">
              <div className="filter-field admin-media-search">
                <label htmlFor="media-search">Buscar</label>
                <input
                  id="media-search"
                  className="admin-input"
                  type="search"
                  placeholder="Nombre de archivo o ruta…"
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                />
              </div>

              <div className="filter-field">
                <label htmlFor="media-filter-format">Formato</label>
                <select
                  id="media-filter-format"
                  className="admin-select"
                  value={format}
                  onChange={event => setFormat(event.target.value)}
                >
                  <option value="">Todos</option>
                  {formats.map(option => (
                    <option key={option} value={option}>
                      {option.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>

              <div className="filter-field">
                <label htmlFor="media-filter-folder">Ubicación</label>
                <select
                  id="media-filter-folder"
                  className="admin-select"
                  value={folder}
                  onChange={event => setFolder(event.target.value)}
                >
                  <option value="">Todas</option>
                  {locations.map(option => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>

              <div className="filter-field">
                <label htmlFor="media-filter-status">Estado</label>
                <select
                  id="media-filter-status"
                  className="admin-select"
                  value={status}
                  onChange={event =>
                    setStatus(event.target.value as MediaUsageStatus | "all")
                  }
                >
                  {STATUS_FILTERS.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="filter-field">
                <span className="admin-media-field-legend">Vista</span>
                <div className="admin-media-view" role="group" aria-label="Tipo de vista">
                  <button
                    type="button"
                    className={view === "grid" ? "active" : ""}
                    aria-pressed={view === "grid"}
                    onClick={() => setView("grid")}
                  >
                    Cuadrícula
                  </button>
                  <button
                    type="button"
                    className={view === "list" ? "active" : ""}
                    aria-pressed={view === "list"}
                    onClick={() => setView("list")}
                  >
                    Lista
                  </button>
                </div>
              </div>
            </div>

            <div className="admin-card-body">
              {loading && <div className="admin-empty">Cargando el inventario…</div>}

              {!loading && !visible.length && (
                <div className="admin-empty">
                  <strong>No hay imágenes que coincidan</strong>
                  {items.length
                    ? "Probá con otro buscador o cambiá los filtros."
                    : "Todavía no hay imágenes registradas."}
                </div>
              )}

              {!loading && visible.length > 0 && view === "grid" && (
                <div className="admin-media-grid">
                  {visible.map(item => (
                    <article className="admin-media-card" key={item.key}>
                      <div className="admin-media-thumb">
                        {item.publicUrl ? (
                          <img
                            src={previewUrl(item)}
                            alt={item.metadata.altText ?? item.name}
                            loading="lazy"
                          />
                        ) : (
                          <span className="admin-media-thumb-empty">
                            Sin vista previa disponible
                          </span>
                        )}
                      </div>
                      <div className="admin-media-card-body">
                        <h3 className="admin-media-name">{item.name}</h3>
                        <dl className="admin-media-meta">
                          <dt>Formato</dt>
                          <dd>{item.format.toUpperCase()}</dd>
                          <dt>Peso</dt>
                          <dd>{formatMediaBytes(item.bytes)}</dd>
                          <dt>Medidas</dt>
                          <dd>{dimensionsOf(item)}</dd>
                          <dt>Estado</dt>
                          <dd>
                            <span
                              className={`admin-media-status admin-media-status-${item.status}`}
                            >
                              {MEDIA_USAGE_LABELS[item.status]}
                            </span>
                          </dd>
                          <dt>Referencias</dt>
                          <dd>{item.referenceCount}</dd>
                          <dt>Modificada</dt>
                          <dd>{formatDate(item.modifiedAt)}</dd>
                        </dl>
                        <p className="admin-media-path">{item.physicalPath}</p>
                        <div className="admin-media-actions">
                          <button
                            type="button"
                            className="admin-button admin-button-ghost admin-button-small"
                            onClick={() => {
                              setSelectedKey(item.key);
                              setConfirmDelete(false);
                              setFeedback(null);
                            }}
                          >
                            Ver detalles
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}

              {!loading && visible.length > 0 && view === "list" && (
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Vista previa</th>
                        <th>Archivo</th>
                        <th>Formato</th>
                        <th>Peso</th>
                        <th>Medidas</th>
                        <th>Ruta</th>
                        <th>Modificada</th>
                        <th>Estado</th>
                        <th>Referencias</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map(item => (
                        <tr key={item.key}>
                          <td>
                            {item.publicUrl ? (
                              <img
                                className="admin-media-thumb-sm"
                                src={previewUrl(item)}
                                alt={item.metadata.altText ?? item.name}
                                loading="lazy"
                              />
                            ) : (
                              <span className="cell-muted">—</span>
                            )}
                          </td>
                          <td className="cell-strong">{item.name}</td>
                          <td className="cell-muted">{item.format.toUpperCase()}</td>
                          <td className="cell-muted">{formatMediaBytes(item.bytes)}</td>
                          <td className="cell-muted">{dimensionsOf(item)}</td>
                          <td className="cell-muted admin-media-mono">
                            {item.physicalPath}
                          </td>
                          <td className="cell-muted">{formatDate(item.modifiedAt)}</td>
                          <td>
                            <span
                              className={`admin-media-status admin-media-status-${item.status}`}
                            >
                              {MEDIA_USAGE_LABELS[item.status]}
                            </span>
                          </td>
                          <td className="cell-muted">{item.referenceCount}</td>
                          <td>
                            <div className="cell-actions">
                              <button
                                type="button"
                                className="admin-button admin-button-ghost admin-button-small"
                                onClick={() => {
                                  setSelectedKey(item.key);
                                  setConfirmDelete(false);
                                  setFeedback(null);
                                }}
                              >
                                Ver detalles
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {tab === "papelera" && (
        <MediaTrashPanel rows={trashedRows} onChanged={() => void refresh()} />
      )}

      {tab === "actividad" && <MediaActivityPanel />}

      {/* ------------------------------------------------------- detalle */}
      {selected && (
        <div className="admin-drawer" role="dialog" aria-modal="true" aria-label={`Detalle de ${selected.name}`}>
          <div className="admin-drawer-panel">
            <div className="admin-drawer-head">
              <div>
                <h2>{selected.name}</h2>
                <p className="admin-card-sub">{selected.logicalPath}</p>
              </div>
              <button
                type="button"
                className="admin-close"
                aria-label="Cerrar el detalle de la imagen"
                onClick={() => {
                  setSelectedKey(null);
                  setConfirmDelete(false);
                }}
              >
                ×
              </button>
            </div>

            {feedback && (
              <div className={feedback.kind === "ok" ? "admin-ok" : "admin-error"}>
                {feedback.text}
              </div>
            )}

            <div className="admin-stack">
              <div className="admin-media-detail-grid">
                <div className="admin-media-detail-block">
                  <h3>Ubicación y rutas</h3>

                  <div className="admin-media-path-box">
                    <code>
                      {selected.origin === "bundled"
                        ? selected.physicalPath
                        : `${selected.provider}: ${selected.physicalPath}`}
                    </code>
                    <button
                      type="button"
                      className="admin-media-copy-button"
                      aria-label="Copiar la ruta física"
                      onClick={() => void copy(selected.physicalPath, "physical")}
                    >
                      {copied === "physical" ? "Copiado" : "Copiar"}
                    </button>
                  </div>

                  <div className="admin-media-path-box">
                    <code>{selected.publicPath}</code>
                    <button
                      type="button"
                      className="admin-media-copy-button"
                      aria-label="Copiar la ruta pública"
                      onClick={() => void copy(selected.publicPath, "public")}
                    >
                      {copied === "public" ? "Copiado" : "Copiar"}
                    </button>
                  </div>

                  <div className="admin-media-path-box">
                    <code>{selected.name}</code>
                    <button
                      type="button"
                      className="admin-media-copy-button"
                      aria-label="Copiar el nombre original"
                      onClick={() => void copy(selected.name, "original")}
                    >
                      {copied === "original" ? "Copiado" : "Copiar"}
                    </button>
                  </div>

                  <div className="admin-media-path-box">
                    <code>{selected.storedName ?? selected.name}</code>
                    <button
                      type="button"
                      className="admin-media-copy-button"
                      aria-label="Copiar el nombre almacenado"
                      onClick={() => void copy(
                        selected.storedName ?? selected.name,
                        "stored",
                      )}
                    >
                      {copied === "stored" ? "Copiado" : "Copiar"}
                    </button>
                  </div>

                  <div className="admin-media-path-box">
                    <code>{selected.folder || "—"}</code>
                    <button
                      type="button"
                      className="admin-media-copy-button"
                      aria-label="Copiar el directorio contenedor"
                      onClick={() => void copy(selected.folder, "folder")}
                    >
                      {copied === "folder" ? "Copiado" : "Copiar"}
                    </button>
                  </div>

                  <div className="admin-media-path-box">
                    <code>{selected.publicUrl || "—"}</code>
                    <button
                      type="button"
                      className="admin-media-copy-button"
                      aria-label="Copiar la URL pública"
                      onClick={() => void copy(selected.publicUrl, "url")}
                    >
                      {copied === "url" ? "Copiado" : "Copiar"}
                    </button>
                  </div>

                  <div className="admin-media-path-box">
                    <code>{selected.provider}</code>
                    <button
                      type="button"
                      className="admin-media-copy-button"
                      aria-label="Copiar el proveedor"
                      onClick={() => void copy(selected.provider, "provider")}
                    >
                      {copied === "provider" ? "Copiado" : "Copiar"}
                    </button>
                  </div>
                </div>

                <div className="admin-media-detail-block">
                  <h3>Datos del archivo</h3>
                  <dl className="detail-list">
                    <dt>Formato</dt>
                    <dd>{selected.format.toUpperCase()}</dd>
                    <dt>Peso</dt>
                    <dd>{formatMediaBytes(selected.bytes)}</dd>
                    <dt>Medidas</dt>
                    <dd>{dimensionsOf(selected)}</dd>
                    <dt>Modificada</dt>
                    <dd>{formatDate(selected.modifiedAt)}</dd>
                    <dt>Estado</dt>
                    <dd>
                      <span
                        className={`admin-media-status admin-media-status-${selected.status}`}
                      >
                        {MEDIA_USAGE_LABELS[selected.status]}
                      </span>
                    </dd>
                    <dt>Referencias</dt>
                    <dd>{selected.referenceCount}</dd>
                    <dt>Origen</dt>
                    <dd>
                      {selected.origin === "bundled"
                        ? "Asset compilado del sitio"
                        : "Banco de imágenes (Storage)"}
                    </dd>
                  </dl>
                </div>
              </div>

              <div className="admin-media-detail-block">
                <h3>Dónde se usa</h3>
                {selected.referenceCount ? (
                  <div className="admin-media-refs">
                    {selected.references.map((reference, index) => (
                      <div className="admin-media-ref" key={`${reference.file}-${reference.line}-${index}`}>
                        <b>{reference.label}</b>
                        <code>
                          {reference.file}:{reference.line}
                        </code>
                        <button
                          type="button"
                          className="admin-media-copy-button"
                          style={{ marginTop: ".4rem" }}
                          aria-label={`Copiar la referencia de ${reference.label}`}
                          onClick={() =>
                            void copy(`${reference.file}:${reference.line}`, `ref-${index}`)
                          }
                        >
                          {copied === `ref-${index}` ? "Copiado" : "Copiar"}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="admin-media-hint">
                    No se detectaron referencias a esta imagen en el código del
                    sitio.
                  </p>
                )}
              </div>

              <div className="admin-row">
                <button
                  type="button"
                  className="admin-button admin-button-copper"
                  onClick={() => {
                    setEditorKey(selected.key);
                    setSelectedKey(null);
                  }}
                >
                  Editar imagen
                </button>
                <button
                  type="button"
                  className="admin-button admin-button-ghost"
                  onClick={() => {
                    setMetadataKey(selected.key);
                    setSelectedKey(null);
                  }}
                >
                  Editar información
                </button>
                <button
                  type="button"
                  className="admin-button admin-button-danger"
                  disabled={blockers.length > 0}
                  onClick={() => setConfirmDelete(true)}
                >
                  Eliminar imagen
                </button>
                {blockers.length > 0 && (
                  <span className="cell-muted">{blockers[0]}</span>
                )}
              </div>

              {confirmDelete && (
                <div className="admin-media-warning">
                  {usageWarning ? (
                    <>
                      <strong>{usageWarning}</strong>
                      <ul>
                        {selected.references.map((reference, index) => (
                          <li key={`${reference.file}-${index}`}>
                            {reference.label} — {reference.file}:{reference.line}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <strong>
                      ¿Eliminar «{selected.name}»? La imagen va a la papelera y
                      se puede restaurar.
                    </strong>
                  )}

                  {blockers.length > 0 && (
                    <ul>
                      {blockers.map(blocker => (
                        <li key={blocker}>{blocker}</li>
                      ))}
                    </ul>
                  )}

                  <div className="admin-row" style={{ marginTop: ".8rem" }}>
                    <button
                      type="button"
                      className="admin-button admin-button-danger"
                      disabled={busy || blockers.length > 0}
                      onClick={() => void moveToTrash(selected)}
                    >
                      {busy ? "Moviendo…" : "Mover a la papelera"}
                    </button>
                    <button
                      type="button"
                      className="admin-button admin-button-ghost"
                      onClick={() => setConfirmDelete(false)}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------- modales */}
      {uploadOpen && (
        <MediaUploadPanel
          folders={folders}
          items={items}
          onFoldersChanged={() => void refresh()}
          onUploaded={() => void refresh()}
          onClose={() => setUploadOpen(false)}
        />
      )}

      {editorItem && (
        <ImageEditorModal
          item={editorItem}
          folders={folders}
          onClose={() => setEditorKey(null)}
          onSaved={message => {
            setFeedback({ kind: "ok", text: message });
            void refresh();
          }}
        />
      )}

      {metadataItem && (
        <MediaMetadataDialog
          item={metadataItem}
          onClose={() => setMetadataKey(null)}
          onSaved={message => {
            setFeedback({ kind: "ok", text: message });
            void refresh();
          }}
        />
      )}
    </div>
  );
}
