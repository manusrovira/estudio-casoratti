import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente de Supabase para el navegador.
 *
 * Sólo se usa la clave pública (anon). La service role nunca llega al
 * frontend: el prompt lo prohíbe explícitamente y además implicaría que
 * cualquier visitante podría saltarse todas las políticas RLS.
 *
 * Sin credenciales el sitio público sigue funcionando (es contenido
 * estático); lo que deja de estar disponible son las funciones que necesitan
 * base de datos, y la interfaz lo informa con claridad en lugar de fallar en
 * silencio.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey);

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error(
      "Supabase no está configurado. Definí VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.",
    );
  }
  if (!client) {
    client = createClient(url as string, anonKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}

/** Bucket de Storage para documentos de clientes. */
export const CLIENT_DOCUMENTS_BUCKET = "client-documents";
/** Bucket de Storage para documentos de expedientes. */
export const CASE_DOCUMENTS_BUCKET = "case-documents";

/** Edge Function que recibe las consultas del formulario público. */
export const SUBMIT_CONSULTATION_FUNCTION = "submit-consultation";
