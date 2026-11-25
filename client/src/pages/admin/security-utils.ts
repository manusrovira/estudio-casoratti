/**
 * Lógica pura del módulo «Seguridad · Cambiar contraseña».
 *
 * Sin React y sin acceso a la red: son funciones deterministas que se prueban
 * con vitest. El módulo (`SecurityModule.tsx`) las usa para validar el
 * formulario y para dibujar el indicador de fortaleza.
 *
 * Ninguna función recibe ni devuelve información sensible: acá sólo se
 * cuentan y comparan caracteres en memoria. La contraseña nunca se registra,
 * no se serializa y no sale de la pantalla del administrador.
 */

/** Longitud mínima exigida por el contrato del módulo (spec §3.2.3). */
export const MIN_PASSWORD_LENGTH = 10;

export type PasswordChecks = {
  /** Al menos `MIN_PASSWORD_LENGTH` caracteres. */
  long: boolean;
  /** Al menos una letra minúscula. */
  lower: boolean;
  /** Al menos una letra mayúscula. */
  upper: boolean;
  /** Al menos un dígito. */
  digit: boolean;
  /** Al menos un símbolo: un carácter que no es letra, ni número, ni espacio. */
  symbol: boolean;
};

export type PasswordStrength = {
  /** 0 = débil · 1 = débil · 2 = media · 3 = fuerte · 4 = muy fuerte. */
  score: 0 | 1 | 2 | 3 | 4;
  /** Etiqueta lista para mostrar, con color siempre acompañado de texto. */
  label: string;
  /** Cumplimiento de cada requisito, para la lista visual de la interfaz. */
  checks: PasswordChecks;
};

/** Etiqueta de cada nivel de fortaleza. */
export const STRENGTH_LABELS: Record<PasswordStrength["score"], string> = {
  0: "Débil",
  1: "Débil",
  2: "Media",
  3: "Fuerte",
  4: "Muy fuerte",
};

/** Requisitos, en el orden en que se muestran en la interfaz. */
export const PASSWORD_REQUIREMENTS: ReadonlyArray<{
  key: keyof PasswordChecks;
  label: string;
}> = [
  { key: "long", label: "Al menos 10 caracteres" },
  { key: "lower", label: "Al menos una minúscula" },
  { key: "upper", label: "Al menos una mayúscula" },
  { key: "digit", label: "Al menos un número" },
  { key: "symbol", label: "Al menos un símbolo (por ejemplo, ! o ?)" },
];

/* Expresiones regulares con Unicode: «á» es una minúscula, no un símbolo. */
const HAS_LOWER = /\p{Ll}/u;
const HAS_UPPER = /\p{Lu}/u;
const HAS_DIGIT = /\p{Nd}/u;
const HAS_SYMBOL = /[^\p{L}\p{N}\s]/u;

/**
 * Evalúa la fortaleza de una contraseña.
 *
 * El nivel depende de cuántos requisitos se cumplen, no de una heurística
 * secreta: es una guía visual, no una garantía criptográfica. El servidor
 * vuelve a validar los requisitos antes de escribir.
 */
export function evaluatePasswordStrength(password: string): PasswordStrength {
  const value = typeof password === "string" ? password : "";

  const checks: PasswordChecks = {
    long: value.length >= MIN_PASSWORD_LENGTH,
    lower: HAS_LOWER.test(value),
    upper: HAS_UPPER.test(value),
    digit: HAS_DIGIT.test(value),
    symbol: HAS_SYMBOL.test(value),
  };

  const met = Object.values(checks).filter(Boolean).length;
  const score: PasswordStrength["score"] =
    met <= 1 ? 0 : met === 2 ? 1 : met === 3 ? 2 : met === 4 ? 3 : 4;

  return { score, label: STRENGTH_LABELS[score], checks };
}

/** `true` si la contraseña cumple los cinco requisitos mínimos. */
export function passwordRequirementsMet(password: string): boolean {
  const { checks } = evaluatePasswordStrength(password);
  return checks.long && checks.lower && checks.upper && checks.digit && checks.symbol;
}

export type PasswordChangeInput = {
  /** Contraseña actual, que se verifica contra el servidor. */
  current: string;
  /** Contraseña nueva. */
  next: string;
  /** Repetición de la contraseña nueva. */
  confirm: string;
};

/**
 * Valida el cambio de contraseña en el cliente.
 *
 * Devuelve la lista de errores (en español, en el orden en que se muestran) o
 * una lista vacía si todo está bien. No devuelve `false`/`true` a secas: el
 * administrador necesita saber qué corregir.
 */
export function validatePasswordChange({
  current,
  next,
  confirm,
}: PasswordChangeInput): string[] {
  const errors: string[] = [];

  if (!current.trim()) {
    errors.push("Ingresá tu contraseña actual.");
  }

  const { checks } = evaluatePasswordStrength(next);
  if (!checks.long) {
    errors.push(
      `La nueva contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
    );
  }
  if (!checks.lower) {
    errors.push("La nueva contraseña debe incluir al menos una minúscula.");
  }
  if (!checks.upper) {
    errors.push("La nueva contraseña debe incluir al menos una mayúscula.");
  }
  if (!checks.digit) {
    errors.push("La nueva contraseña debe incluir al menos un número.");
  }
  if (!checks.symbol) {
    errors.push("La nueva contraseña debe incluir al menos un símbolo.");
  }

  if (next !== confirm) {
    errors.push("La confirmación no coincide con la nueva contraseña.");
  }

  // Reutilización: la nueva no puede ser la misma que la vigente.
  if (current && next && next === current) {
    errors.push("La nueva contraseña debe ser distinta de la actual.");
  }

  return errors;
}
