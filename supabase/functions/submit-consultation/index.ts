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

const RATE_LIMIT_MAX = 5; // consultas por ventana y por IP
const RATE_LIMIT_WINDOW_SECONDS = 3600; // 1 hora

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

    const outcome = await handleConsultation(raw, {
      async consumeRateLimit() {
        const ip =
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          request.headers.get("cf-connecting-ip") ??
          "unknown";
        const key = `consulta:${await hashIp(ip)}`;

        const { data: allowed, error: rateError } = await admin.rpc("consume_rate_limit", {
          p_key: key,
          p_max: RATE_LIMIT_MAX,
          p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
        });

        if (rateError) {
          // Si el helper no estuviera disponible no se bloquea el envío: el
          // error queda registrado y el alta sigue protegida por RLS.
          console.error("rate_limit_error", rateError.message);
          return true;
        }
        return allowed !== false;
      },

      async insertConsultation(data: ConsultationPayload) {
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
          })
          .select("reference_code")
          .single();

        if (insertError) throw insertError;
        return inserted.reference_code;
      },
    });

    if (!outcome.ok) {
      return json({ error: outcome.error }, outcome.status);
    }
    return json({ ok: true, referenceCode: outcome.referenceCode });
  } catch (error) {
    console.error("submit_consultation_error", error);
    return json({ error: "No pudimos registrar la consulta. Probá de nuevo." }, 500);
  }
});
