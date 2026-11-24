/**
 * Lógica de la Edge Function `submit-consultation`, sin dependencias de runtime.
 *
 * Se separa del `index.ts` (que es específico de Deno) para que el mismo código
 * se pueda ejecutar en el entorno local de desarrollo (Node) sin duplicar reglas.
 * Nada de `npm:` imports aquí: este módulo tiene que correr en Deno y en Node.
 */

export type ConsultationPayload = {
  fullName: string;
  email: string;
  phone?: string;
  categoryId?: string;
  subject: string;
  description: string;
  privacyAccepted: true;
  /** Honeypot: si viene completo, es un bot. */
  website?: string;
};

export type ValidationResult =
  | { ok: true; data: ConsultationPayload }
  | { ok: false; error: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Validación del payload del formulario. Devuelve el primer error legible. */
export function validateConsultationPayload(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Datos inválidos" };
  }
  const body = raw as Record<string, unknown>;

  const fullName = clean(body.fullName);
  const email = clean(body.email);
  const phone = clean(body.phone);
  const categoryId = clean(body.categoryId);
  const subject = clean(body.subject);
  const description = clean(body.description);
  const website = clean(body.website);

  if (fullName.length < 3) return { ok: false, error: "Falta el nombre" };
  if (!EMAIL_PATTERN.test(email)) return { ok: false, error: "Correo inválido" };
  if (phone.length > 40) return { ok: false, error: "Teléfono inválido" };
  if (categoryId && !UUID_PATTERN.test(categoryId)) {
    return { ok: false, error: "Área de consulta inválida" };
  }
  if (subject.length < 3) return { ok: false, error: "Falta el asunto" };
  if (subject.length > 160) return { ok: false, error: "El asunto es demasiado largo" };
  if (description.length < 10) return { ok: false, error: "Contanos un poco más" };
  if (description.length > 5000) return { ok: false, error: "El mensaje es demasiado largo" };
  if (body.privacyAccepted !== true) {
    return { ok: false, error: "Debés aceptar la política de privacidad" };
  }

  return {
    ok: true,
    data: {
      fullName,
      email,
      phone: phone || undefined,
      categoryId: categoryId || undefined,
      subject,
      description,
      privacyAccepted: true,
      website: website || undefined,
    },
  };
}

export type ConsultationContext = {
  /** IP de origen, identificada en el servidor (nunca por el navegador). */
  ip?: string;
  /** User agent del navegador, sólo como contexto para el estudio. */
  userAgent?: string;
};

/** Resultado del camino atómico: alta aceptada o límite alcanzado. */
export type SubmitResult =
  | { allowed: true; referenceCode: string }
  | { allowed: false; retryAfterSeconds: number };

export type ConsultationDeps = {
  /** Devuelve true si el envío está permitido según el rate limit. */
  consumeRateLimit: () => Promise<boolean>;
  /** Inserta la consulta y devuelve el código de referencia generado. */
  insertConsultation: (data: ConsultationPayload, context?: ConsultationContext) => Promise<string>;
  /**
   * Camino atómico: aplica el límite por IP y la inserción en una sola
   * transacción de Postgres. Si está presente, reemplaza a
   * `consumeRateLimit` + `insertConsultation` (que quedan sin uso).
   */
  submitConsultation?: (
    data: ConsultationPayload,
    context: ConsultationContext,
  ) => Promise<SubmitResult>;
};

export type ConsultationOutcome =
  | { ok: true; referenceCode: string }
  | { ok: false; status: number; error: string; retryAfterSeconds?: number };

/** Mensaje que ve la persona cuando su IP agotó el límite de consultas. */
export const RATE_LIMIT_MESSAGE =
  "Alcanzaste el máximo de consultas por IP. Podés volver a escribirnos en 24 horas.";

/**
 * Flujo completo: validar → rate limit → insertar.
 * El honeypot se responde como un envío exitoso, pero no se guarda nada.
 */
export async function handleConsultation(
  raw: unknown,
  deps: ConsultationDeps,
  context: ConsultationContext = {},
): Promise<ConsultationOutcome> {
  const validation = validateConsultationPayload(raw);
  if (!validation.ok) {
    return { ok: false, status: 400, error: validation.error };
  }
  const data = validation.data;

  // Honeypot: se responde OK pero no se guarda nada.
  if (data.website) {
    return { ok: true, referenceCode: "CAS-26-00000" };
  }

  // Camino atómico: el límite por IP y el alta ocurren en la misma transacción.
  if (deps.submitConsultation) {
    const result = await deps.submitConsultation(data, context);
    if (!result.allowed) {
      return {
        ok: false,
        status: 429,
        error: RATE_LIMIT_MESSAGE,
        retryAfterSeconds: result.retryAfterSeconds,
      };
    }
    return { ok: true, referenceCode: result.referenceCode };
  }

  const allowed = await deps.consumeRateLimit();
  if (!allowed) {
    return {
      ok: false,
      status: 429,
      error: RATE_LIMIT_MESSAGE,
    };
  }

  const referenceCode = await deps.insertConsultation(data, context);
  return { ok: true, referenceCode };
}
