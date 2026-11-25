/**
 * Matemática del editor de imágenes.
 *
 * Todo lo que decide *dónde* cae un píxel está en funciones puras y
 * testeables: relación de aspecto, rectángulo de recorte, límites del estado
 * y estilo del marco. La parte que toca el DOM (el `<canvas>`) está al final
 * del archivo, aislada en `renderEditorCanvas`.
 *
 * No hay dependencias: se usa Canvas + DOM, nada más.
 */

/** Recortes predefinidos que ofrece el editor. */
export type CropPreset = "free" | "1:1" | "16:9" | "4:3" | "3:4" | "9:16";

/** Modo de encuadre de la imagen dentro del marco. */
export type FitMode = "cover" | "contain" | "fill";

/** Forma del marco. */
export type FrameShape = "rect" | "square" | "circle" | "rounded";

/** Rectángulo de recorte, en píxeles de la imagen natural. */
export type EditorCrop = { x: number; y: number; width: number; height: number };

/** Marco: forma, radio, borde y encuadre. */
export type EditorFrame = {
  shape: FrameShape;
  radius: number;
  borderWidth: number;
  borderColor: string;
  fit: FitMode;
  /** Posición horizontal dentro del marco, de 0 (izquierda) a 1 (derecha). */
  positionX: number;
  /** Posición vertical dentro del marco, de 0 (arriba) a 1 (abajo). */
  positionY: number;
};

/** Formato del archivo de salida. */
export type EditorOutput = { width: number; height: number; mime: string; quality: number };

/** Estado completo del editor. */
export type EditorState = {
  /** 1 = sin zoom. */
  zoom: number;
  /** Desplazamiento horizontal, en píxeles de la imagen natural. */
  offsetX: number;
  /** Desplazamiento vertical, en píxeles de la imagen natural. */
  offsetY: number;
  /** Rotación en grados (múltiplos de 90). */
  rotation: number;
  crop: EditorCrop;
  frame: EditorFrame;
  output: EditorOutput;
};

/** Estilo calculado del marco, listo para aplicar a un `<img>` o a un `<div>`. */
export type FrameStyle = {
  borderRadius: string;
  borderWidth: string;
  borderColor: string;
  objectFit: FitMode;
  objectPosition: string;
};

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
export const MAX_ROTATION = 360;

const PRESET_ASPECTS: Record<CropPreset, number | null> = {
  free: null,
  "1:1": 1,
  "16:9": 16 / 9,
  "4:3": 4 / 3,
  "3:4": 3 / 4,
  "9:16": 9 / 16,
};

const FIT_MODES: FitMode[] = ["cover", "contain", "fill"];
const FRAME_SHAPES: FrameShape[] = ["rect", "square", "circle", "rounded"];

/* ------------------------------------------------------------------ */
/* Utilidades numéricas                                                */
/* ------------------------------------------------------------------ */

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  const result = Math.min(Math.max(value, min), max);
  // Evita el -0 (que no es igual a 0 en comparaciones estrictas).
  return result === 0 ? 0 : result;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Normaliza la rotación a un múltiplo de 90 dentro del rango razonable. */
export function normalizeRotation(rotation: number): number {
  const value = numberOr(rotation, 0);
  const snapped = Math.round(value / 90) * 90;
  return clamp(snapped, -MAX_ROTATION, MAX_ROTATION);
}

/* ------------------------------------------------------------------ */
/* Relación de aspecto                                                 */
/* ------------------------------------------------------------------ */

/** Relación de aspecto de un recorte predefinido (`null` = libre). */
export function presetAspect(preset: CropPreset): number | null {
  return PRESET_ASPECTS[preset] ?? null;
}

/**
 * Rectángulo de recorte máximo **centrado** que respeta la relación de
 * aspecto dentro de la imagen. Con `aspect === null` devuelve la imagen
 * completa.
 */
export function cropRectForAspect(
  imgW: number,
  imgH: number,
  aspect: number | null,
): { x: number; y: number; width: number; height: number } {
  const width = numberOr(imgW, 0);
  const height = numberOr(imgH, 0);
  if (width <= 0 || height <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  if (aspect === null || !Number.isFinite(aspect) || aspect <= 0) {
    return { x: 0, y: 0, width, height };
  }

  const imageAspect = width / height;
  let cropWidth = width;
  let cropHeight = height;
  if (imageAspect > aspect) {
    cropWidth = height * aspect;
  } else {
    cropHeight = width / aspect;
  }
  cropWidth = Math.max(1, Math.floor(cropWidth));
  cropHeight = Math.max(1, Math.floor(cropHeight));

  return {
    x: Math.floor((width - cropWidth) / 2),
    y: Math.floor((height - cropHeight) / 2),
    width: cropWidth,
    height: cropHeight,
  };
}

/* ------------------------------------------------------------------ */
/* Estado acotado                                                      */
/* ------------------------------------------------------------------ */

function clampCrop(crop: EditorCrop | undefined, imgW: number, imgH: number): EditorCrop {
  if (imgW <= 0 || imgH <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const width = clamp(numberOr(crop?.width, imgW), 1, imgW);
  const height = clamp(numberOr(crop?.height, imgH), 1, imgH);
  const x = clamp(numberOr(crop?.x, 0), 0, Math.max(0, imgW - width));
  const y = clamp(numberOr(crop?.y, 0), 0, Math.max(0, imgH - height));
  return { x, y, width, height };
}

/**
 * Rango del desplazamiento para que la ventana de recorte siempre esté
 * dentro de la imagen.
 */
function offsetRange(cropStart: number, cropSize: number, imageSize: number): [number, number] {
  const min = cropStart + cropSize - imageSize;
  const max = cropStart;
  return min <= max ? [min, max] : [0, 0];
}

/**
 * Acota el estado del editor: zoom, desplazamientos, rotación (a múltiplos de
 * 90), rectángulo de recorte dentro de la imagen y valores del marco.
 */
export function clampEditorState(state: EditorState, imgW: number, imgH: number): EditorState {
  const width = numberOr(imgW, 0);
  const height = numberOr(imgH, 0);

  const crop = clampCrop(state?.crop, width, height);
  const [minX, maxX] = offsetRange(crop.x, crop.width, width);
  const [minY, maxY] = offsetRange(crop.y, crop.height, height);

  const zoom = clamp(numberOr(state?.zoom, 1), MIN_ZOOM, MAX_ZOOM);
  const offsetX = clamp(numberOr(state?.offsetX, 0), minX, maxX);
  const offsetY = clamp(numberOr(state?.offsetY, 0), minY, maxY);
  const rotation = normalizeRotation(state?.rotation ?? 0);

  const shape = FRAME_SHAPES.includes(state?.frame?.shape) ? state.frame.shape : "rect";
  const fit = FIT_MODES.includes(state?.frame?.fit) ? state.frame.fit : "cover";

  const frame: EditorFrame = {
    shape,
    radius: Math.max(0, numberOr(state?.frame?.radius, 0)),
    borderWidth: Math.max(0, numberOr(state?.frame?.borderWidth, 0)),
    borderColor: state?.frame?.borderColor || "#000000",
    fit,
    positionX: clamp(numberOr(state?.frame?.positionX, 0.5), 0, 1),
    positionY: clamp(numberOr(state?.frame?.positionY, 0.5), 0, 1),
  };

  const output: EditorOutput = {
    width: Math.max(1, Math.round(numberOr(state?.output?.width, 1))),
    height: Math.max(1, Math.round(numberOr(state?.output?.height, 1))),
    mime: state?.output?.mime || "image/png",
    quality: clamp(numberOr(state?.output?.quality, 0.92), 0.1, 1),
  };

  return { zoom, offsetX, offsetY, rotation, crop, frame, output };
}

/** Estado inicial razonable para una imagen de las medidas dadas. */
export function defaultEditorState(imgW: number, imgH: number): EditorState {
  const width = numberOr(imgW, 1);
  const height = numberOr(imgH, 1);
  return {
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
    crop: { x: 0, y: 0, width, height },
    frame: {
      shape: "rect",
      radius: 24,
      borderWidth: 0,
      borderColor: "#000000",
      fit: "cover",
      positionX: 0.5,
      positionY: 0.5,
    },
    output: { width, height, mime: "image/png", quality: 0.92 },
  };
}

/* ------------------------------------------------------------------ */
/* Estilo del marco                                                    */
/* ------------------------------------------------------------------ */

/**
 * Estilo del marco según su forma y su modo de encuadre. `objectPosition`
 * usa porcentajes derivados de `positionX` / `positionY`.
 */
export function computeFrameStyle(state: EditorState): FrameStyle {
  const frame = state?.frame;
  const shape = FRAME_SHAPES.includes(frame?.shape) ? frame.shape : "rect";
  const fit = FIT_MODES.includes(frame?.fit) ? frame.fit : "cover";
  const radius = Math.max(0, numberOr(frame?.radius, 0));

  let borderRadius = "0px";
  if (shape === "circle") {
    borderRadius = "50%";
  } else if (shape === "rounded") {
    borderRadius = `${round2(radius)}px`;
  }

  const positionX = clamp(numberOr(frame?.positionX, 0.5), 0, 1);
  const positionY = clamp(numberOr(frame?.positionY, 0.5), 0, 1);

  return {
    borderRadius,
    borderWidth: `${round2(Math.max(0, numberOr(frame?.borderWidth, 0)))}px`,
    borderColor: frame?.borderColor || "#000000",
    objectFit: fit,
    objectPosition: `${round2(positionX * 100)}% ${round2(positionY * 100)}%`,
  };
}

/* ------------------------------------------------------------------ */
/* Render en canvas                                                    */
/* ------------------------------------------------------------------ */

function framePath(
  ctx: CanvasRenderingContext2D,
  shape: FrameShape,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  if (shape === "circle") {
    ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
    return;
  }
  const corner = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
  if (corner <= 0) {
    ctx.rect(0, 0, width, height);
    return;
  }
  ctx.moveTo(corner, 0);
  ctx.lineTo(width - corner, 0);
  ctx.quadraticCurveTo(width, 0, width, corner);
  ctx.lineTo(width, height - corner);
  ctx.quadraticCurveTo(width, height, width - corner, height);
  ctx.lineTo(corner, height);
  ctx.quadraticCurveTo(0, height, 0, height - corner);
  ctx.lineTo(0, corner);
  ctx.quadraticCurveTo(0, 0, corner, 0);
  ctx.closePath();
}

function fitScale(
  fit: FitMode,
  cropWidth: number,
  cropHeight: number,
  outWidth: number,
  outHeight: number,
): number {
  if (cropWidth <= 0 || cropHeight <= 0) return 1;
  const scaleX = outWidth / cropWidth;
  const scaleY = outHeight / cropHeight;
  if (fit === "cover") return Math.max(scaleX, scaleY);
  if (fit === "fill") return 1;
  return Math.min(scaleX, scaleY);
}

/**
 * Dibuja en el canvas el resultado del recorte, el zoom, los desplazamientos,
 * la rotación y el marco. El canvas queda con el tamaño de la salida pedida.
 */
export function renderEditorCanvas(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  state: EditorState,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const outWidth = Math.max(1, Math.round(numberOr(state?.output?.width, canvas.width || 1)));
  const outHeight = Math.max(1, Math.round(numberOr(state?.output?.height, canvas.height || 1)));
  canvas.width = outWidth;
  canvas.height = outHeight;
  ctx.clearRect(0, 0, outWidth, outHeight);

  const imageWidth = image?.naturalWidth || image?.width || 0;
  const imageHeight = image?.naturalHeight || image?.height || 0;
  if (imageWidth <= 0 || imageHeight <= 0) return;

  const crop = clampCrop(state?.crop, imageWidth, imageHeight);
  const frame = state?.frame;
  const shape = FRAME_SHAPES.includes(frame?.shape) ? frame.shape : "rect";
  const fit = FIT_MODES.includes(frame?.fit) ? frame.fit : "cover";
  const zoom = clamp(numberOr(state?.zoom, 1), MIN_ZOOM, MAX_ZOOM);
  const rotation = normalizeRotation(state?.rotation ?? 0);

  const scale = fitScale(fit, crop.width, crop.height, outWidth, outHeight);
  let destWidth = crop.width * scale * zoom;
  let destHeight = crop.height * scale * zoom;
  if (fit === "fill") {
    destWidth = outWidth * zoom;
    destHeight = outHeight * zoom;
  }

  const positionX = clamp(numberOr(frame?.positionX, 0.5), 0, 1);
  const positionY = clamp(numberOr(frame?.positionY, 0.5), 0, 1);
  const destX = positionX * (destWidth - outWidth);
  const destY = positionY * (destHeight - outHeight);

  const sourceX = crop.x - numberOr(state?.offsetX, 0);
  const sourceY = crop.y - numberOr(state?.offsetY, 0);

  ctx.save();
  framePath(ctx, shape, outWidth, outHeight, numberOr(frame?.radius, 0));
  ctx.clip();

  ctx.translate(outWidth / 2, outHeight / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.translate(-outWidth / 2, -outHeight / 2);

  ctx.drawImage(image, sourceX, sourceY, crop.width, crop.height, destX, destY, destWidth, destHeight);
  ctx.restore();

  const borderWidth = Math.max(0, numberOr(frame?.borderWidth, 0));
  if (borderWidth > 0) {
    ctx.save();
    ctx.strokeStyle = frame?.borderColor || "#000000";
    ctx.lineWidth = borderWidth;
    framePath(ctx, shape, outWidth, outHeight, numberOr(frame?.radius, 0));
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * Renderiza y devuelve el resultado como `Blob`, listo para subirlo a
 * Storage. Resuelve `null` si el navegador no puede exportar el canvas.
 */
export function renderEditorCanvasToBlob(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  state: EditorState,
): Promise<Blob | null> {
  renderEditorCanvas(canvas, image, state);
  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== "function") {
      resolve(null);
      return;
    }
    canvas.toBlob(
      (blob) => resolve(blob),
      state?.output?.mime || "image/png",
      numberOr(state?.output?.quality, 0.92),
    );
  });
}
