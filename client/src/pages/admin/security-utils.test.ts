import { describe, expect, it } from "vitest";
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_REQUIREMENTS,
  STRENGTH_LABELS,
  evaluatePasswordStrength,
  passwordRequirementsMet,
  validatePasswordChange,
} from "./security-utils";

/**
 * Guardas de la lógica del módulo «Seguridad · Cambiar contraseña».
 *
 * Lo que no se puede probar acá es lo que hace el servidor: reautenticar la
 * contraseña actual, escribir la nueva y revocar las sesiones anteriores. Lo
 * que se prueba es la parte que decide si el formulario se envía: los
 * requisitos mínimos, la coincidencia de la confirmación, el rechazo de la
 * reutilización y la escala de fortaleza.
 */

/** Contraseña que cumple los cinco requisitos. */
const VALID = "Casoratti2026!";

describe("evaluatePasswordStrength", () => {
  it("detecta cada requisito por separado", () => {
    const { checks } = evaluatePasswordStrength("C4s0r@tti");

    expect(checks.long).toBe(false);
    expect(checks.lower).toBe(true);
    expect(checks.upper).toBe(true);
    expect(checks.digit).toBe(true);
    expect(checks.symbol).toBe(true);
  });

  it("exige el mínimo de caracteres", () => {
    expect(evaluatePasswordStrength("aA1!aaaa").checks.long).toBe(false);
    expect(evaluatePasswordStrength("aA1!aaaaaa").checks.long).toBe(true);
    expect(MIN_PASSWORD_LENGTH).toBe(10);
  });

  it("cuenta letras acentuadas como letras y no como símbolos", () => {
    const { checks } = evaluatePasswordStrength("áÉ9ñ");

    expect(checks.lower).toBe(true);
    expect(checks.upper).toBe(true);
    expect(checks.digit).toBe(true);
    expect(checks.symbol).toBe(false);
  });

  it("no cuenta el espacio como símbolo", () => {
    expect(evaluatePasswordStrength("C4s0r atti").checks.symbol).toBe(false);
  });

  it("devuelve el nivel más bajo para una contraseña vacía", () => {
    const strength = evaluatePasswordStrength("");

    expect(strength.score).toBe(0);
    expect(strength.label).toBe(STRENGTH_LABELS[0]);
    expect(Object.values(strength.checks).some(Boolean)).toBe(false);
  });

  it("sube el nivel a medida que se cumplen los requisitos", () => {
    const weak = evaluatePasswordStrength("abc");
    const medium = evaluatePasswordStrength("abcdefghij");
    const good = evaluatePasswordStrength("Abcdefghij");
    const strong = evaluatePasswordStrength("Abcdefghij1");
    const veryStrong = evaluatePasswordStrength("Abcdefghij1!");

    expect(weak.score).toBe(0);
    expect(medium.score).toBe(1);
    expect(good.score).toBe(2);
    expect(strong.score).toBe(3);
    expect(veryStrong.score).toBe(4);

    expect(weak.score).toBeLessThan(medium.score);
    expect(medium.score).toBeLessThan(good.score);
    expect(good.score).toBeLessThan(strong.score);
    expect(strong.score).toBeLessThan(veryStrong.score);
  });

  it("etiqueta los cuatro niveles con texto", () => {
    expect(STRENGTH_LABELS[0]).toBe("Débil");
    expect(STRENGTH_LABELS[1]).toBe("Débil");
    expect(STRENGTH_LABELS[2]).toBe("Media");
    expect(STRENGTH_LABELS[3]).toBe("Fuerte");
    expect(STRENGTH_LABELS[4]).toBe("Muy fuerte");
  });

  it("acompaña siempre el nivel con un texto legible", () => {
    for (const password of ["", "a", "abcdefghij", "Abcdefghij", VALID]) {
      const strength = evaluatePasswordStrength(password);
      expect(strength.label.length).toBeGreaterThan(0);
      expect(strength.score).toBeGreaterThanOrEqual(0);
      expect(strength.score).toBeLessThanOrEqual(4);
    }
  });
});

describe("passwordRequirementsMet", () => {
  it("acepta una contraseña que cumple los cinco requisitos", () => {
    expect(passwordRequirementsMet(VALID)).toBe(true);
  });

  it("rechaza una contraseña a la que le falta un requisito", () => {
    expect(passwordRequirementsMet("casoratti2026")).toBe(false); // sin mayúscula
    expect(passwordRequirementsMet("Casoratti2026")).toBe(false); // sin símbolo
    expect(passwordRequirementsMet("C4s0r@tti")).toBe(false); // muy corta
    expect(passwordRequirementsMet("")).toBe(false);
  });
});

describe("validatePasswordChange", () => {
  it("no devuelve errores cuando todo está correcto", () => {
    expect(
      validatePasswordChange({
        current: "Actual2025!",
        next: VALID,
        confirm: VALID,
      }),
    ).toEqual([]);
  });

  it("exige la contraseña actual", () => {
    const errors = validatePasswordChange({
      current: "   ",
      next: VALID,
      confirm: VALID,
    });

    expect(errors).toContain("Ingresá tu contraseña actual.");
  });

  it("exige longitud mínima", () => {
    const errors = validatePasswordChange({
      current: "Actual2025!",
      next: "Aa1!aaaa",
      confirm: "Aa1!aaaa",
    });

    expect(errors).toContain(
      `La nueva contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
    );
  });

  it("exige minúscula, mayúscula, número y símbolo", () => {
    const sinMinuscula = validatePasswordChange({
      current: "Actual2025!",
      next: "ABCDEFGHIJ",
      confirm: "ABCDEFGHIJ",
    });
    expect(sinMinuscula).toContain(
      "La nueva contraseña debe incluir al menos una minúscula.",
    );

    const sinMayuscula = validatePasswordChange({
      current: "Actual2025!",
      next: "abcdefghij",
      confirm: "abcdefghij",
    });
    expect(sinMayuscula).toContain(
      "La nueva contraseña debe incluir al menos una mayúscula.",
    );

    const sinNumero = validatePasswordChange({
      current: "Actual2025!",
      next: "Abcdefghij!",
      confirm: "Abcdefghij!",
    });
    expect(sinNumero).toContain(
      "La nueva contraseña debe incluir al menos un número.",
    );

    const sinSimbolo = validatePasswordChange({
      current: "Actual2025!",
      next: "Abcdefghij1",
      confirm: "Abcdefghij1",
    });
    expect(sinSimbolo).toContain(
      "La nueva contraseña debe incluir al menos un símbolo.",
    );
  });

  it("rechaza que la confirmación no coincida", () => {
    const errors = validatePasswordChange({
      current: "Actual2025!",
      next: VALID,
      confirm: `${VALID}x`,
    });

    expect(errors).toContain(
      "La confirmación no coincide con la nueva contraseña.",
    );
  });

  it("rechaza reutilizar la contraseña actual", () => {
    const errors = validatePasswordChange({
      current: VALID,
      next: VALID,
      confirm: VALID,
    });

    expect(errors).toContain("La nueva contraseña debe ser distinta de la actual.");
  });

  it("acumula todos los errores en lugar de devolver el primero", () => {
    const errors = validatePasswordChange({
      current: "",
      next: "corta",
      confirm: "otra",
    });

    expect(errors.length).toBeGreaterThan(1);
    expect(errors).toContain("Ingresá tu contraseña actual.");
    expect(errors).toContain(
      "La confirmación no coincide con la nueva contraseña.",
    );
  });

  it("no marca error de confirmación cuando ambas están vacías", () => {
    const errors = validatePasswordChange({
      current: "Actual2025!",
      next: "",
      confirm: "",
    });

    expect(errors).not.toContain(
      "La confirmación no coincide con la nueva contraseña.",
    );
  });
});

describe("PASSWORD_REQUIREMENTS", () => {
  it("expone los cinco requisitos en el orden de la interfaz", () => {
    expect(PASSWORD_REQUIREMENTS.map((requirement) => requirement.key)).toEqual([
      "long",
      "lower",
      "upper",
      "digit",
      "symbol",
    ]);
  });

  it("cada requisito tiene un texto visible", () => {
    for (const requirement of PASSWORD_REQUIREMENTS) {
      expect(requirement.label.length).toBeGreaterThan(0);
    }
  });
});
