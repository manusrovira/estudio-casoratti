/**
 * Edge Function: submit-consultation (Supabase Edge Runtime / Deno).
 *
 * Recibe las consultas del formulario público y las guarda en PostgreSQL.
 *
 * ¿Por qué una Edge Function y no un insert directo desde el navegador?
 *  - la service role nunca sale del servidor (el prompt lo prohíbe en el
 *    frontend);
 *  - acá vive el rate limiting, que no se puede hacer con RLS;
 *  - la validación es una sola, server-side, sin duplicar reglas.
 *
 * La lógica vive en `handler.ts` (sin imports de runtime) para poder
 * reutilizarla en el entorno local de desarrollo.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { handleConsultation, type ConsultationPayload } from "./handler.ts";

const RATE_LIMIT_MAX = 5; // consultas por IP
const RATE_LIMIT_WINDOW_HOURS = 24; // ventana móvil de 24 horas

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": Deno.env.get("SITE_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

/** Hash del IP: nunca guardamos la dirección en claro. */
async function hashIp(ip: string): Promise<string> {
  const pepper =
    Deno.env.get("RATE_LIMIT_SALT") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "casoratti";
  const data = new TextEncoder().encode(`${pepper}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return json({ error: "Método no permitido" }, 405);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    const raw = await request.json().catch(() => null);

    // La IP se identifica en el servidor, a partir de los encabezados que
    // agrega la red de Supabase. Nunca se acepta una IP enviada por el cliente.
    const ip =
      request.headers.get("cf-connecting-ip") ??
      request.headers.get("x-real-ip") ??
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      "desconocida";
    const userAgent = request.headers.get("user-agent") ?? null;

    const outcome = await handleConsultation(
      raw,
      {
        async consumeRateLimit() {
          const key = `consulta:${await hashIp(ip)}`;

          const { data: allowed, error: rateError } = await admin.rpc("consume_rate_limit", {
            p_key: key,
            p_max: RATE_LIMIT_MAX,
            p_window_seconds: RATE_LIMIT_WINDOW_HOURS * 3600,
          });

          if (rateError) {
            // Si el helper no estuviera disponible no se bloquea el envío: el
            // error queda registrado y el alta sigue protegida por RLS.
            console.error("rate_limit_error", rateError.message);
            return true;
          }
          return allowed !== false;
        },

        async insertConsultation(data) {
          const { data: inserted, error: insertError } = await admin
            .from("legal_consultations")
            .insert({
              full_name: data.fullName,
              email: data.email,
              phone: data.phone ?? null,
              category_id: data.categoryId ?? null,
              subject: data.subject,
              description: data.description,
              status: "nueva",
              is_new: true,
              privacy_accepted_at: new Date().toISOString(),
              ip_address: ip,
              user_agent: userAgent,
            })
            .select("reference_code")
            .single();

          if (insertError) throw insertError;
          return inserted.reference_code;
        },

        /**
         * Camino atómico: `submit_consultation` cuenta las consultas de la
         * IP en las últimas 24 horas y, si queda lugar, inserta la consulta
         * en la misma transacción. Así dos envíos simultáneos desde la misma
         * dirección no pueden passarse el límite.
         */
        async submitConsultation(data) {
          const { data: result, error: submitError } = await admin.rpc("submit_consultation", {
            p_full_name: data.fullName,
            p_email: data.email,
            p_phone: data.phone ?? null,
            p_category_id: data.categoryId ?? null,
            p_subject: data.subject,
            p_description: data.description,
            p_ip: ip,
            p_user_agent: userAgent,
            p_max: RATE_LIMIT_MAX,
            p_window: `${RATE_LIMIT_WINDOW_HOURS} hours`,
          });

          if (submitError) throw submitError;
          const row = (result ?? [])[0] as
            | { allowed: boolean; reference_code: string | null; retry_after_seconds: number }
            | undefined;

          if (!row) throw new Error("submit_consultation no devolvió resultado");

          if (!row.allowed) {
            return {
              allowed: false,
              retryAfterSeconds: row.retry_after_seconds ?? RATE_LIMIT_WINDOW_HOURS * 3600,
            };
          }

          return { allowed: true, referenceCode: row.reference_code ?? "" };
        },
      },
      { ip, userAgent: userAgent ?? undefined },
    );

    if (!outcome.ok) {
      return json(
        {
          error: outcome.error,
          ...(outcome.retryAfterSeconds ? { retryAfterSeconds: outcome.retryAfterSeconds } : {}),
        },
        outcome.status,
      );
    }
    return json({ ok: true, referenceCode: outcome.referenceCode });
  } catch (error) {
    console.error("submit_consultation_error", error);
    return json({ error: "No pudimos registrar la consulta. Probá de nuevo." }, 500);
  }
});
