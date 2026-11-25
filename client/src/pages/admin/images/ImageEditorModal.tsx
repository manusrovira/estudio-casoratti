import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clampEditorState,
  computeFrameStyle,
  cropRectForAspect,
  defaultEditorState,
  presetAspect,
  renderEditorCanvas,
  renderEditorCanvasToBlob,
  type CropPreset,
  type EditorCrop,
  type EditorState,
  type FitMode,
  type FrameShape,
} from "./media-editor";
import {
  logMediaActivity,
  publicMediaUrl,
  replaceImage,
  uploadImage,
} from "./media-service";
import { withCacheVersion, type InventoryItem } from "./media-inventory";

/**
 * Editor visual de una imagen.
 *
 * Recorte, ajuste y encuadre se calculan con las funciones puras de
 * `media-editor.ts` y se rasterizan en un `<canvas>`: el resultado es un
 * archivo real (un `File`) que después se sube a Storage. No hay
 * dependencias: nada de Cropper.js.
 */

type ImageEditorModalProps = {
  item: InventoryItem;
  folders: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
};

type Feedback = { kind: "ok" | "error" | "info"; text: string };

type PreviewContext = "card" | "portada" | "perfil" | "fondo" | "institucional";

const CROP_PRESETS: { value: CropPreset; label: string }[] = [
  { value: "free", label: "Libre" },
  { value: "1:1", label: "1:1 (cuadrado)" },
  { value: "16:9", label: "16:9 (panorámico)" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4 (vertical)" },
  { value: "9:16", label: "9:16 (historia)" },
];

const FRAME_SHAPES: { value: FrameShape; label: string }[] = [
  { value: "rect", label: "Rectangular" },
  { value: "square", label: "Cuadrado" },
  { value: "circle", label: "Circular" },
  { value: "rounded", label: "Bordes redondeados" },
];

const FIT_MODES: { value: FitMode; label: string }[] = [
  { value: "cover", label: "cover (recorta)" },
  { value: "contain", label: "contain (entera)" },
  { value: "fill", label: "fill (deforma)" },
];

const PREVIEW_CONTEXTS: { value: PreviewContext; label: string }[] = [
  { value: "card", label: "Tarjeta" },
  { value: "portada", label: "Portada" },
  { value: "perfil", label: "Perfil" },
  { value: "fondo", label: "Fondo" },
  { value: "institucional", label: "Institucional" },
];

const OUTPUT_MIMES: { value: string; label: string }[] = [
  { value: "image/png", label: "PNG" },
  { value: "image/jpeg", label: "JPEG" },
  { value: "image/webp", label: "WEBP" },
];

const MAX_OUTPUT_PX = 4000;

function extensionFor(mime: string): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "png";
}

function baseNameOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

export function ImageEditorModal({
  item,
  folders,
  onClose,
  onSaved,
}: ImageEditorModalProps) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [state, setState] = useState<EditorState>(() => defaultEditorState(1, 1));
  const [preset, setPreset] = useState<CropPreset>("free");
  const [scalePercent, setScalePercent] = useState(100);
  const [keepAspect, setKeepAspect] = useState(true);
  const [context, setContext] = useState<PreviewContext>("card");
  const [mode, setMode] = useState<"none" | "new" | "replace">("none");
  const [newFolder, setNewFolder] = useState(folders[0] ?? "images/general");
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const compareRef = useRef<HTMLCanvasElement | null>(null);
  const contextRef = useRef<HTMLCanvasElement | null>(null);

  /* --------------------------------------------------------------- carga */

  useEffect(() => {
    let cancelled = false;
    if (!item.publicUrl) {
      setLoadError(
        "Este asset no tiene una URL pública: el build no lo emite porque ningún componente del sitio lo usa. Para editarlo hay que importarlo primero en el sitio.",
      );
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      setImage(img);
      setState(defaultEditorState(img.naturalWidth, img.naturalHeight));
      setScalePercent(100);
      setPreset("free");
    };
    img.onerror = () => {
      if (cancelled) return;
      // El servidor puede no mandar cabeceras CORS: se reintenta sin pedir
      // acceso cruzado para poder mostrar la imagen al menos.
      const retry = new Image();
      retry.onload = () => {
        if (cancelled) return;
        setImage(retry);
        setState(defaultEditorState(retry.naturalWidth, retry.naturalHeight));
        setScalePercent(100);
        setPreset("free");
        setLoadError(
          "El servidor de la imagen no manda cabeceras CORS: se puede ver y recortar, pero el navegador no va a dejar exportar el archivo editado.",
        );
      };
      retry.onerror = () => {
        if (cancelled) return;
        setLoadError(
          "No se pudo cargar la imagen para editarla. Revisá la URL pública de la imagen.",
        );
      };
      retry.src = item.publicUrl;
    };
    img.src = item.publicUrl;
    return () => {
      cancelled = true;
    };
  }, [item.publicUrl]);

  /* -------------------------------------------------------------- estado */

  const patch = useCallback(
    (
      partial:
        | Partial<EditorState>
        | ((current: EditorState) => Partial<EditorState>),
    ) => {
      setState(current => {
        const delta = typeof partial === "function" ? partial(current) : partial;
        const merged: EditorState = {
          ...current,
          ...delta,
          crop: delta.crop ?? current.crop,
          frame: { ...current.frame, ...(delta.frame ?? {}) },
          output: { ...current.output, ...(delta.output ?? {}) },
        };
        if (!image) return merged;
        return clampEditorState(merged, image.naturalWidth, image.naturalHeight);
      });
    },
    [image],
  );

  const imageWidth = image?.naturalWidth ?? 0;
  const imageHeight = image?.naturalHeight ?? 0;

  const applyCrop = useCallback(
    (crop: EditorCrop) => {
      const factor = scalePercent / 100;
      patch(current => ({
        crop,
        output: {
          ...current.output,
          width: Math.max(1, Math.min(MAX_OUTPUT_PX, Math.round(crop.width * factor))),
          height: Math.max(1, Math.min(MAX_OUTPUT_PX, Math.round(crop.height * factor))),
        },
      }));
    },
    [patch, scalePercent],
  );

  const applyPreset = useCallback(
    (value: CropPreset) => {
      setPreset(value);
      if (!image) return;
      const crop = cropRectForAspect(
        image.naturalWidth,
        image.naturalHeight,
        presetAspect(value),
      );
      applyCrop(crop);
    },
    [applyCrop, image],
  );

  const reset = useCallback(() => {
    if (!image) return;
    setPreset("free");
    setScalePercent(100);
    setState(defaultEditorState(image.naturalWidth, image.naturalHeight));
  }, [image]);

  const applyScale = useCallback(
    (percent: number) => {
      const value = Math.max(10, Math.min(200, percent));
      setScalePercent(value);
      patch(current => ({
        output: {
          ...current.output,
          width: Math.max(
            1,
            Math.min(MAX_OUTPUT_PX, Math.round(current.crop.width * (value / 100))),
          ),
          height: Math.max(
            1,
            Math.min(MAX_OUTPUT_PX, Math.round(current.crop.height * (value / 100))),
          ),
        },
      }));
    },
    [patch],
  );

  const setOutputWidth = useCallback(
    (value: number) => {
      patch(current => ({
        output: {
          ...current.output,
          width: Math.max(1, Math.min(MAX_OUTPUT_PX, Math.round(value))),
          height: keepAspect
            ? Math.max(
                1,
                Math.min(
                  MAX_OUTPUT_PX,
                  Math.round(
                    (value * current.crop.height) / Math.max(1, current.crop.width),
                  ),
                ),
              )
            : current.output.height,
        },
      }));
    },
    [keepAspect, patch],
  );

  const setOutputHeight = useCallback(
    (value: number) => {
      patch(current => ({
        output: {
          ...current.output,
          height: Math.max(1, Math.min(MAX_OUTPUT_PX, Math.round(value))),
          width: keepAspect
            ? Math.max(
                1,
                Math.min(
                  MAX_OUTPUT_PX,
                  Math.round(
                    (value * current.crop.width) / Math.max(1, current.crop.height),
                  ),
                ),
              )
            : current.output.width,
        },
      }));
    },
    [keepAspect, patch],
  );

  /* --------------------------------------------------------------- render */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    renderEditorCanvas(canvas, image, state);
  }, [image, state]);

  useEffect(() => {
    const source = canvasRef.current;
    if (!source) return;
    const width = 480;
    const height = Math.max(
      1,
      Math.round((width * source.height) / Math.max(1, source.width)),
    );
    for (const target of [compareRef.current, contextRef.current]) {
      if (!target) continue;
      target.width = width;
      target.height = height;
      const ctx = target.getContext("2d");
      if (!ctx) continue;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(source, 0, 0, width, height);
    }
  }, [state, image]);

  const frameStyle = useMemo(() => computeFrameStyle(state), [state]);

  /* -------------------------------------------------------------- guardar */

  const buildFile = useCallback(
    async (nameBase: string): Promise<File | null> => {
      const canvas = canvasRef.current;
      if (!canvas || !image) return null;
      const blob = await renderEditorCanvasToBlob(canvas, image, state);
      if (!blob) return null;
      const extension = extensionFor(state.output.mime);
      const safeBase = nameBase.trim() || baseNameOf(item.name);
      const file = new File([blob], `${safeBase}.${extension}`, {
        type: state.output.mime,
      });
      return file;
    },
    [image, item.name, state],
  );

  const verifyServed = useCallback(async (url: string) => {
    if (!url) return { ok: false, status: 0 };
    try {
      const response = await fetch(withCacheVersion(url, Date.now()), {
        cache: "no-store",
      });
      return { ok: response.ok, status: response.status };
    } catch {
      return { ok: false, status: 0 };
    }
  }, []);

  const saveAsNew = useCallback(async () => {
    const typed = newName.trim();
    const withoutExtension = typed ? typed.replace(/\.[^.]+$/, "") : "";
    const nameBase = withoutExtension || `${baseNameOf(item.name)}-editada`;
    const file = await buildFile(nameBase);
    if (!file) {
      setFeedback({
        kind: "error",
        text: "No se pudo generar el archivo de la imagen editada.",
      });
      return;
    }

    setSaving(true);
    setFeedback(null);
    const result = await uploadImage(file, newFolder);
    if (!result.ok) {
      setSaving(false);
      setFeedback({ kind: "error", text: result.error });
      return;
    }

    const served = await verifyServed(publicMediaUrl(result.storagePath));
    await logMediaActivity("edit", result.logicalPath, "success", {
      modo: "nueva-imagen",
      origen: item.logicalPath,
    });
    setSaving(false);
    if (!served.ok) {
      setFeedback({
        kind: "error",
        text: `La imagen se guardó como ${result.logicalPath}, pero no se pudo verificar que se esté sirviendo (estado ${served.status}).`,
      });
      onSaved(`Se guardó una copia nueva en ${result.logicalPath}.`);
      return;
    }
    setFeedback({
      kind: "ok",
      text: `Se guardó la imagen editada en ${result.logicalPath} y se verificó que se sirve (estado ${served.status}).`,
    });
    onSaved(`Se guardó una copia nueva en ${result.logicalPath}.`);
  }, [buildFile, item.name, newName, newFolder, onSaved, verifyServed]);

  const replaceOriginal = useCallback(async () => {
    const file = await buildFile(baseNameOf(item.name));
    if (!file) {
      setFeedback({
        kind: "error",
        text: "No se pudo generar el archivo de la imagen editada.",
      });
      return;
    }

    setSaving(true);
    setFeedback(null);

    if (item.rowId) {
      const result = await replaceImage(item.logicalPath, file, { backup: true });
      if (!result.ok) {
        setSaving(false);
        setFeedback({ kind: "error", text: result.error });
        return;
      }
      const served = await verifyServed(publicMediaUrl(result.storagePath));
      await logMediaActivity("edit", item.logicalPath, "success", {
        modo: "reemplazo",
        origen: item.logicalPath,
      });
      setSaving(false);
      if (!served.ok) {
        setFeedback({
          kind: "error",
          text: `La imagen se reemplazó, pero no se pudo verificar que se esté sirviendo (estado ${served.status}).`,
        });
        onSaved(`Se reemplazó ${item.name}.`);
        return;
      }
      setFeedback({
        kind: "ok",
        text: `Se reemplazó la imagen y se verificó que se sirve (estado ${served.status}). La versión original quedó en la carpeta de respaldos.`,
      });
      onSaved(`Se reemplazó ${item.name}.`);
      return;
    }

    // Asset compilado del sitio: no hay fila en la base, así que la versión
    // nueva se registra como override de la misma ruta lógica. El archivo del
    // repositorio no se toca nunca.
    const result = await uploadImage(file, "images/general", {
      logicalPath: item.logicalPath,
      overwrite: true,
    });
    if (!result.ok) {
      setSaving(false);
      setFeedback({ kind: "error", text: result.error });
      return;
    }
    const served = await verifyServed(publicMediaUrl(result.storagePath));
    await logMediaActivity("edit", item.logicalPath, "success", {
      modo: "override",
      origen: item.logicalPath,
    });
    setSaving(false);
    if (!served.ok) {
      setFeedback({
        kind: "error",
        text: `Se registró la nueva versión, pero no se pudo verificar que se esté sirviendo (estado ${served.status}).`,
      });
      onSaved(`Se actualizó ${item.name}.`);
      return;
    }
    setFeedback({
      kind: "ok",
      text: `Se registró la nueva versión y se verificó que se sirve (estado ${served.status}). El asset del sitio se conserva como respaldo.`,
    });
    onSaved(`Se actualizó ${item.name}.`);
  }, [buildFile, item.logicalPath, item.name, item.rowId, onSaved, verifyServed]);

  /* --------------------------------------------------------------- render */

  const crop = state.crop;
  const offsetMinX = Math.min(crop.x + crop.width - imageWidth, crop.x);
  const offsetMaxX = crop.x;
  const offsetMinY = Math.min(crop.y + crop.height - imageHeight, crop.y);
  const offsetMaxY = crop.y;

  return (
    <div
      className="admin-media-modal"
      role="dialog"
      aria-modal="true"
      aria-label={`Editar ${item.name}`}
    >
      <div className="admin-media-modal-panel">
        <div className="admin-media-modal-head">
          <div>
            <h2>Editar imagen</h2>
            <p>
              {item.name} · {item.logicalPath}
            </p>
          </div>
          <button
            type="button"
            className="admin-close"
            aria-label="Cerrar el editor"
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

          {loadError && <div className="admin-error">{loadError}</div>}

          <div className="admin-media-editor">
            {/* ------------------------------------------------ lienzo */}
            <div className="admin-media-editor-stage">
              <div className="admin-media-canvas-wrap">
                <canvas
                  ref={canvasRef}
                  aria-label="Vista previa de la imagen editada"
                  role="img"
                />
              </div>

              <div className="admin-media-compare">
                <figure>
                  <figcaption>Original</figcaption>
                  <img src={item.publicUrl} alt={item.metadata.altText ?? item.name} />
                </figure>
                <figure>
                  <figcaption>Resultado</figcaption>
                  <canvas
                    ref={compareRef}
                    aria-label="Resultado de la edición"
                    role="img"
                  />
                </figure>
              </div>

              <div>
                <div className="admin-media-preview-contexts">
                  {PREVIEW_CONTEXTS.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      className={
                        context === option.value
                          ? "admin-button admin-button-small admin-button-copper"
                          : "admin-button admin-button-small admin-button-ghost"
                      }
                      onClick={() => setContext(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <div className="admin-media-preview-stage">
                  <div
                    className={`admin-media-preview-box admin-media-ctx-${context}`}
                    style={{
                      borderRadius: frameStyle.borderRadius,
                      borderWidth: frameStyle.borderWidth,
                      borderColor: frameStyle.borderColor,
                      borderStyle: "solid",
                    }}
                  >
                    <canvas
                      ref={contextRef}
                      aria-label={`Vista previa contextual: ${context}`}
                      role="img"
                    />
                  </div>
                </div>
                <p className="admin-media-hint">
                  Encuadre {frameStyle.objectFit} · posición {frameStyle.objectPosition} ·
                  salida {state.output.width}×{state.output.height} px.
                </p>
              </div>
            </div>

            {/* ------------------------------------------------ controles */}
            <div className="admin-media-controls">
              <fieldset className="admin-media-fieldset">
                <legend>Recortar</legend>
                <div className="admin-media-field-grid">
                  <div className="filter-field">
                    <label htmlFor="media-crop-preset">Relación de aspecto</label>
                    <select
                      id="media-crop-preset"
                      className="admin-select"
                      value={preset}
                      onChange={event =>
                        applyPreset(event.target.value as CropPreset)
                      }
                    >
                      {CROP_PRESETS.map(option => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="filter-field">
                    <label htmlFor="media-crop-x">Área X</label>
                    <input
                      id="media-crop-x"
                      className="admin-input"
                      type="number"
                      value={Math.round(crop.x)}
                      onChange={event =>
                        applyCrop({ ...crop, x: Number(event.target.value) })
                      }
                    />
                  </div>
                  <div className="filter-field">
                    <label htmlFor="media-crop-y">Área Y</label>
                    <input
                      id="media-crop-y"
                      className="admin-input"
                      type="number"
                      value={Math.round(crop.y)}
                      onChange={event =>
                        applyCrop({ ...crop, y: Number(event.target.value) })
                      }
                    />
                  </div>
                  <div className="filter-field">
                    <label htmlFor="media-crop-w">Área ancho</label>
                    <input
                      id="media-crop-w"
                      className="admin-input"
                      type="number"
                      value={Math.round(crop.width)}
                      onChange={event =>
                        applyCrop({ ...crop, width: Number(event.target.value) })
                      }
                    />
                  </div>
                  <div className="filter-field">
                    <label htmlFor="media-crop-h">Área alto</label>
                    <input
                      id="media-crop-h"
                      className="admin-input"
                      type="number"
                      value={Math.round(crop.height)}
                      onChange={event =>
                        applyCrop({ ...crop, height: Number(event.target.value) })
                      }
                    />
                  </div>
                </div>

                <div className="filter-field" style={{ marginTop: ".8rem" }}>
                  <label htmlFor="media-crop-offset-x">
                    Mover el área (horizontal)
                  </label>
                  <input
                    id="media-crop-offset-x"
                    className="admin-media-slider"
                    type="range"
                    min={offsetMinX}
                    max={offsetMaxX}
                    step={1}
                    value={state.offsetX}
                    onChange={event => patch({ offsetX: Number(event.target.value) })}
                  />
                </div>
                <div className="filter-field" style={{ marginTop: ".6rem" }}>
                  <label htmlFor="media-crop-offset-y">Mover el área (vertical)</label>
                  <input
                    id="media-crop-offset-y"
                    className="admin-media-slider"
                    type="range"
                    min={offsetMinY}
                    max={offsetMaxY}
                    step={1}
                    value={state.offsetY}
                    onChange={event => patch({ offsetY: Number(event.target.value) })}
                  />
                </div>

                <div className="admin-row" style={{ marginTop: ".8rem" }}>
                  <button
                    type="button"
                    className="admin-button admin-button-ghost admin-button-small"
                    onClick={() => patch({ zoom: Math.max(0.1, state.zoom - 0.1) })}
                  >
                    Reducir
                  </button>
                  <button
                    type="button"
                    className="admin-button admin-button-ghost admin-button-small"
                    onClick={() => patch({ zoom: Math.min(8, state.zoom + 0.1) })}
                  >
                    Ampliar
                  </button>
                  <button
                    type="button"
                    className="admin-button admin-button-ghost admin-button-small"
                    onClick={() =>
                      patch({ rotation: (state.rotation + 90) % 360 })
                    }
                  >
                    Girar 90°
                  </button>
                  <button
                    type="button"
                    className="admin-button admin-button-ghost admin-button-small"
                    onClick={reset}
                  >
                    Restablecer
                  </button>
                </div>
              </fieldset>

              <fieldset className="admin-media-fieldset">
                <legend>Ajustar</legend>
                <div className="admin-media-field-grid">
                  <div className="filter-field">
                    <label htmlFor="media-output-width">Ancho (px)</label>
                    <input
                      id="media-output-width"
                      className="admin-input"
                      type="number"
                      min={1}
                      max={MAX_OUTPUT_PX}
                      value={state.output.width}
                      onChange={event => setOutputWidth(Number(event.target.value))}
                    />
                  </div>
                  <div className="filter-field">
                    <label htmlFor="media-output-height">Alto (px)</label>
                    <input
                      id="media-output-height"
                      className="admin-input"
                      type="number"
                      min={1}
                      max={MAX_OUTPUT_PX}
                      value={state.output.height}
                      onChange={event => setOutputHeight(Number(event.target.value))}
                    />
                  </div>
                  <div className="filter-field">
                    <label htmlFor="media-scale">Escala (%)</label>
                    <input
                      id="media-scale"
                      className="admin-input"
                      type="number"
                      min={10}
                      max={200}
                      value={scalePercent}
                      onChange={event => applyScale(Number(event.target.value))}
                    />
                  </div>
                  <div className="filter-field">
                    <label htmlFor="media-rotation">Orientación</label>
                    <select
                      id="media-rotation"
                      className="admin-select"
                      value={state.rotation}
                      onChange={event => patch({ rotation: Number(event.target.value) })}
                    >
                      <option value={0}>Sin rotar</option>
                      <option value={90}>90°</option>
                      <option value={180}>180°</option>
                      <option value={270}>270°</option>
                    </select>
                  </div>
                  <div className="filter-field">
                    <label htmlFor="media-zoom">Zoom</label>
                    <input
                      id="media-zoom"
                      className="admin-input"
                      type="number"
                      min={0.1}
                      max={8}
                      step={0.1}
                      value={state.zoom}
                      onChange={event => patch({ zoom: Number(event.target.value) })}
                    />
                  </div>
                  <div className="filter-field">
                    <label htmlFor="media-position-x">Posición X</label>
                    <input
                      id="media-position-x"
                      className="admin-media-slider"
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={state.frame.positionX}
                      onChange={event =>
                        patch({ frame: { ...state.frame, positionX: Number(event.target.value) } })
                      }
                    />
                  </div>
                  <div className="filter-field">
                    <label htmlFor="media-position-y">Posición Y</label>
                    <input
                      id="media-position-y"
                      className="admin-media-slider"
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={state.frame.positionY}
                      onChange={event =>
                        patch({ frame: { ...state.frame, positionY: Number(event.target.value) } })
                      }
                    />
                  </div>
                </div>

                <label className="admin-media-check">
                  <input
                    type="checkbox"
                    checked={keepAspect}
                    onChange={event => setKeepAspect(event.target.checked)}
                  />
                  Mantener proporciones al cambiar el ancho o el alto.
                </label>
              </fieldset>

              <fieldset className="admin-media-fieldset">
                <legend>Enmarcar</legend>
                <div className="admin-media-field-grid">
                  <div className="filter-field">
                    <label htmlFor="media-frame-shape">Marco</label>
                    <select
                      id="media-frame-shape"
                      className="admin-select"
                      value={state.frame.shape}
                      onChange={event =>
                        patch({ frame: { ...state.frame, shape: event.target.value as FrameShape } })
                      }
                    >
                      {FRAME_SHAPES.map(option => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="filter-field">
                    <label htmlFor="media-frame-fit">Encuadre</label>
                    <select
                      id="media-frame-fit"
                      className="admin-select"
                      value={state.frame.fit}
                      onChange={event =>
                        patch({ frame: { ...state.frame, fit: event.target.value as FitMode } })
                      }
                    >
                      {FIT_MODES.map(option => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="filter-field">
                    <label htmlFor="media-frame-radius">Radio del borde (px)</label>
                    <input
                      id="media-frame-radius"
                      className="admin-input"
                      type="number"
                      min={0}
                      max={400}
                      value={state.frame.radius}
                      onChange={event =>
                        patch({ frame: { ...state.frame, radius: Number(event.target.value) } })
                      }
                    />
                  </div>
                  <div className="filter-field">
                    <label htmlFor="media-frame-border">Grosor del borde (px)</label>
                    <input
                      id="media-frame-border"
                      className="admin-input"
                      type="number"
                      min={0}
                      max={60}
                      value={state.frame.borderWidth}
                      onChange={event =>
                        patch({ frame: { ...state.frame, borderWidth: Number(event.target.value) } })
                      }
                    />
                  </div>
                  <div className="filter-field">
                    <label htmlFor="media-frame-color">Color del borde</label>
                    <input
                      id="media-frame-color"
                      className="admin-input"
                      type="color"
                      value={state.frame.borderColor}
                      onChange={event =>
                        patch({ frame: { ...state.frame, borderColor: event.target.value } })
                      }
                    />
                  </div>
                </div>
              </fieldset>

              <fieldset className="admin-media-fieldset">
                <legend>Archivo de salida</legend>
                <div className="admin-media-field-grid">
                  <div className="filter-field">
                    <label htmlFor="media-output-mime">Formato</label>
                    <select
                      id="media-output-mime"
                      className="admin-select"
                      value={state.output.mime}
                      onChange={event =>
                        patch({ output: { ...state.output, mime: event.target.value } })
                      }
                    >
                      {OUTPUT_MIMES.map(option => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="filter-field">
                    <label htmlFor="media-output-quality">Calidad</label>
                    <input
                      id="media-output-quality"
                      className="admin-input"
                      type="number"
                      min={0.1}
                      max={1}
                      step={0.02}
                      value={state.output.quality}
                      onChange={event =>
                        patch({ output: { ...state.output, quality: Number(event.target.value) } })
                      }
                    />
                  </div>
                </div>
                <p className="admin-media-hint" style={{ marginTop: ".6rem" }}>
                  El recorte y el encuadre se calculan con funciones puras y se
                  rasterizan en un lienzo: la imagen editada es un archivo real
                  que se sube a Storage.
                </p>
              </fieldset>
            </div>
          </div>

          {mode === "new" && (
            <div className="admin-media-detail-block">
              <h3>Guardar como nueva imagen</h3>
              <div className="admin-media-field-grid">
                <div className="filter-field">
                  <label htmlFor="media-new-folder">Carpeta de destino</label>
                  <select
                    id="media-new-folder"
                    className="admin-select"
                    value={newFolder}
                    onChange={event => setNewFolder(event.target.value)}
                  >
                    {(folders.length ? folders : ["images/general"]).map(folder => (
                      <option key={folder} value={folder}>
                        {folder}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="filter-field">
                  <label htmlFor="media-new-name">Nombre del archivo</label>
                  <input
                    id="media-new-name"
                    className="admin-input"
                    type="text"
                    placeholder={`${baseNameOf(item.name)}-editada`}
                    value={newName}
                    onChange={event => setNewName(event.target.value)}
                  />
                </div>
              </div>
              <p className="admin-media-hint" style={{ marginTop: ".6rem" }}>
                La imagen original no se toca: se sube una copia nueva con su
                propia ruta lógica.
              </p>
            </div>
          )}

          {mode === "replace" && (
            <div className="admin-media-warning">
              <strong>Atención: vas a reemplazar la imagen original.</strong>
              <p style={{ margin: ".4rem 0 0" }}>
                {item.rowId
                  ? "La versión que se está sirviendo va a cambiar y las referencias del sitio siguen apuntando al mismo lugar. La versión original queda guardada como respaldo."
                  : "Este asset forma parte del build del sitio. Se va a registrar una versión nueva para la misma ruta lógica; el archivo del repositorio no se modifica y las referencias siguen funcionando."}
              </p>
            </div>
          )}
        </div>

        <div className="admin-media-modal-foot">
          <button
            type="button"
            className="admin-button admin-button-ghost"
            onClick={onClose}
            disabled={saving}
          >
            Cerrar
          </button>
          <button
            type="button"
            className="admin-button admin-button-ghost"
            onClick={() => setMode(mode === "new" ? "none" : "new")}
            disabled={saving || !image}
          >
            Guardar como nueva imagen
          </button>
          {mode === "new" && (
            <button
              type="button"
              className="admin-button admin-button-copper"
              onClick={() => void saveAsNew()}
              disabled={saving || !image}
            >
              {saving ? "Guardando…" : "Confirmar y guardar"}
            </button>
          )}
          <button
            type="button"
            className="admin-button admin-button-danger"
            onClick={() => setMode(mode === "replace" ? "none" : "replace")}
            disabled={saving || !image}
          >
            Reemplazar la original
          </button>
          {mode === "replace" && (
            <button
              type="button"
              className="admin-button admin-button-danger"
              onClick={() => void replaceOriginal()}
              disabled={saving || !image}
            >
              {saving ? "Reemplazando…" : "Sí, reemplazar"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
