import { describe, expect, it } from "vitest";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampEditorState,
  computeFrameStyle,
  cropRectForAspect,
  defaultEditorState,
  presetAspect,
  type EditorState,
} from "./media-editor";

function stateWith(patch: Partial<EditorState>): EditorState {
  return { ...defaultEditorState(1000, 800), ...patch };
}

/* ------------------------------------------------------------------ */
/* Relación de aspecto                                                 */
/* ------------------------------------------------------------------ */

describe("presetAspect", () => {
  it("devuelve null para el recorte libre", () => {
    expect(presetAspect("free")).toBeNull();
  });

  it("devuelve la razón de cada predefinido", () => {
    expect(presetAspect("1:1")).toBe(1);
    expect(presetAspect("16:9")).toBeCloseTo(16 / 9, 10);
    expect(presetAspect("4:3")).toBeCloseTo(4 / 3, 10);
    expect(presetAspect("3:4")).toBeCloseTo(3 / 4, 10);
    expect(presetAspect("9:16")).toBeCloseTo(9 / 16, 10);
  });
});

/* ------------------------------------------------------------------ */
/* Rectángulo de recorte                                               */
/* ------------------------------------------------------------------ */

describe("cropRectForAspect", () => {
  it("con relación nula devuelve la imagen completa", () => {
    expect(cropRectForAspect(1000, 800, null)).toEqual({
      x: 0,
      y: 0,
      width: 1000,
      height: 800,
    });
  });

  it("centra el recorte y respeta los límites de la imagen", () => {
    const square = cropRectForAspect(1000, 500, 1);
    expect(square).toEqual({ x: 250, y: 0, width: 500, height: 500 });
    expect(square.x).toBeGreaterThanOrEqual(0);
    expect(square.x + square.width).toBeLessThanOrEqual(1000);
    expect(square.y + square.height).toBeLessThanOrEqual(500);
  });

  it("recorta en vertical cuando la imagen es más alta que el predefinido", () => {
    const wide = cropRectForAspect(1000, 1000, 16 / 9);
    expect(wide.width).toBe(1000);
    expect(wide.height).toBeLessThanOrEqual(1000);
    expect(wide.x).toBe(0);
    // Centrado vertical: los márgenes de arriba y abajo son iguales.
    expect(wide.y).toBe(Math.floor((1000 - wide.height) / 2));
  });

  it("recorta a lo ancho cuando la imagen es más ancha que el predefinido", () => {
    const wide = cropRectForAspect(2000, 1000, 16 / 9);
    expect(wide.height).toBe(1000);
    expect(wide.width).toBeLessThanOrEqual(2000);
    expect(wide.y).toBe(0);
    expect(wide.x).toBe(Math.floor((2000 - wide.width) / 2));
  });

  it("recorta a lo alto cuando la imagen es más alta que el predefinido", () => {
    const tall = cropRectForAspect(1000, 2000, 16 / 9);
    expect(tall.width).toBe(1000);
    expect(tall.height).toBeLessThanOrEqual(2000);
    expect(tall.x).toBe(0);
    expect(tall.y).toBe(Math.floor((2000 - tall.height) / 2));
  });

  it("devuelve un rectángulo vacío si la imagen no tiene medidas", () => {
    expect(cropRectForAspect(0, 0, 1)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

/* ------------------------------------------------------------------ */
/* Estado acotado                                                      */
/* ------------------------------------------------------------------ */

describe("clampEditorState", () => {
  it("acota el zoom", () => {
    expect(clampEditorState(stateWith({ zoom: 99 }), 1000, 800).zoom).toBe(MAX_ZOOM);
    expect(clampEditorState(stateWith({ zoom: 0 }), 1000, 800).zoom).toBe(MIN_ZOOM);
    expect(clampEditorState(stateWith({ zoom: 2 }), 1000, 800).zoom).toBe(2);
  });

  it("ajusta la rotación a múltiplos de 90", () => {
    expect(clampEditorState(stateWith({ rotation: 45 }), 1000, 800).rotation).toBe(90);
    expect(clampEditorState(stateWith({ rotation: 100 }), 1000, 800).rotation).toBe(90);
    expect(clampEditorState(stateWith({ rotation: -100 }), 1000, 800).rotation).toBe(-90);
    expect(clampEditorState(stateWith({ rotation: 360 }), 1000, 800).rotation).toBe(360);
    expect(clampEditorState(stateWith({ rotation: 720 }), 1000, 800).rotation).toBe(360);
  });

  it("mantiene el recorte dentro de la imagen", () => {
    const result = clampEditorState(
      stateWith({ crop: { x: -50, y: -50, width: 5000, height: 5000 } }),
      1000,
      800,
    );
    expect(result.crop).toEqual({ x: 0, y: 0, width: 1000, height: 800 });
  });

  it("mantiene los desplazamientos dentro del rango de la imagen", () => {
    const crop = { x: 0, y: 0, width: 100, height: 100 };
    const result = clampEditorState(
      stateWith({ crop, offsetX: 99999, offsetY: -99999 }),
      1000,
      800,
    );
    expect(result.offsetX).toBe(0);
    expect(result.offsetY).toBe(-700);
  });

  it("acota el marco y la salida", () => {
    const result = clampEditorState(
      stateWith({
        frame: {
          shape: "circle",
          radius: -10,
          borderWidth: -5,
          borderColor: "",
          fit: "contain",
          positionX: 4,
          positionY: -2,
        },
        output: { width: 0, height: -3, mime: "", quality: 9 },
      }),
      1000,
      800,
    );
    expect(result.frame.radius).toBe(0);
    expect(result.frame.borderWidth).toBe(0);
    expect(result.frame.borderColor).toBe("#000000");
    expect(result.frame.positionX).toBe(1);
    expect(result.frame.positionY).toBe(0);
    expect(result.output.width).toBe(1);
    expect(result.output.height).toBe(1);
    expect(result.output.quality).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* Estilo del marco                                                    */
/* ------------------------------------------------------------------ */

describe("computeFrameStyle", () => {
  it("usa un radio del 50% para el marco circular", () => {
    const style = computeFrameStyle(
      stateWith({
        frame: {
          shape: "circle",
          radius: 20,
          borderWidth: 3,
          borderColor: "#ff0000",
          fit: "cover",
          positionX: 0.5,
          positionY: 0.5,
        },
      }),
    );
    expect(style.borderRadius).toBe("50%");
    expect(style.borderWidth).toBe("3px");
    expect(style.borderColor).toBe("#ff0000");
  });

  it("usa el radio configurado para el marco redondeado", () => {
    const style = computeFrameStyle(
      stateWith({
        frame: {
          shape: "rounded",
          radius: 24,
          borderWidth: 0,
          borderColor: "#000000",
          fit: "cover",
          positionX: 0.5,
          positionY: 0.5,
        },
      }),
    );
    expect(style.borderRadius).toBe("24px");
  });

  it("deja el radio en cero para el marco rectangular o cuadrado", () => {
    const rect = computeFrameStyle(
      stateWith({
        frame: {
          shape: "rect",
          radius: 30,
          borderWidth: 1,
          borderColor: "#000000",
          fit: "cover",
          positionX: 0.5,
          positionY: 0.5,
        },
      }),
    );
    expect(rect.borderRadius).toBe("0px");

    const square = computeFrameStyle(
      stateWith({
        frame: {
          shape: "square",
          radius: 30,
          borderWidth: 1,
          borderColor: "#000000",
          fit: "cover",
          positionX: 0.5,
          positionY: 0.5,
        },
      }),
    );
    expect(square.borderRadius).toBe("0px");
  });

  it("mapea los tres modos de encuadre", () => {
    const build = (fit: "cover" | "contain" | "fill") =>
      computeFrameStyle(
        stateWith({
          frame: {
            shape: "rect",
            radius: 0,
            borderWidth: 0,
            borderColor: "#000000",
            fit,
            positionX: 0.5,
            positionY: 0.5,
          },
        }),
      );
    expect(build("cover").objectFit).toBe("cover");
    expect(build("contain").objectFit).toBe("contain");
    expect(build("fill").objectFit).toBe("fill");
  });

  it("traduce la posición a porcentajes", () => {
    const style = computeFrameStyle(
      stateWith({
        frame: {
          shape: "rect",
          radius: 0,
          borderWidth: 0,
          borderColor: "#000000",
          fit: "cover",
          positionX: 0.25,
          positionY: 0.75,
        },
      }),
    );
    expect(style.objectPosition).toBe("25% 75%");
  });
});
