import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CASE_DOCUMENTS_BUCKET,
  CLIENT_DOCUMENTS_BUCKET,
  getSupabase,
  isSupabaseConfigured,
} from "@/lib/supabase";
import { useAuthContext } from "@/contexts/AuthContext";

/**
 * Documentación privada: archivos de clientes y de expedientes.
 *
 * Los buckets son privados: el binario nunca se sirve en claro. Para
 * descargarlo se genera una URL firmada de 60 segundos, y el path sigue la
 * convención `{ownerId}/{fileName}` dentro del bucket correspondiente, que es
 * lo que validan las policies de `storage.objects`.
 */

type DocumentRow = {
  id: string;
  client_id?: string | null;
  legal_case_id?: string | null;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
  uploaded_by: string | null;
};

type Owner = { id: string; label: string };
type Feedback = { kind: "ok" | "error"; text: string };

/** Mismos tipos y límite que fijan los buckets en Postgres. */
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
];
const ALLOWED_EXTENSIONS = [
  ".pdf",
  ".doc",
  ".docx",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
];
const MAX_SIZE_BYTES = 25 * 1024 * 1024;

const dateFormatter = new Intl.DateTimeFormat("es-AR", { dateStyle: "short" });
const numberFormatter = new Intl.NumberFormat("es-AR", {
  maximumFractionDigits: 1,
});

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return dateFormatter.format(parsed);
}

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${numberFormatter.format(kb)} KB`;
  return `${numberFormatter.format(kb / 1024)} MB`;
}

/** Deja el nombre del archivo utilizable como clave dentro del bucket. */
function safeFileName(name: string): string {
  return name.trim().replace(/[\\/:*?"<>|]/g, "-");
}

function validateFile(file: File): string | null {
  const lower = file.name.toLowerCase();
  const byExtension = ALLOWED_EXTENSIONS.some(ext => lower.endsWith(ext));
  const byMime = ALLOWED_MIME_TYPES.includes(file.type);
  if (!byExtension && !byMime) {
    return "El archivo no es un PDF, DOC/DOCX o imagen admitida.";
  }
  if (file.size > MAX_SIZE_BYTES) {
    return "El archivo supera el máximo de 25 MB.";
  }
  return null;
}

function DocumentSection({
  title,
  subtitle,
  bucket,
  docTable,
  ownerColumn,
  owners,
  ownerLabel,
}: {
  title: string;
  subtitle: string;
  bucket: string;
  docTable: string;
  ownerColumn: string;
  owners: Owner[];
  ownerLabel: string;
}) {
  const { user } = useAuthContext();
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [ownerId, setOwnerId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const ownerLabels = useMemo(() => {
    const map = new Map<string, string>();
    owners.forEach(o => map.set(o.id, o.label));
    return map;
  }, [owners]);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from(docTable)
      .select("*")
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      setFeedback({ kind: "error", text: error.message });
      setDocs([]);
      return;
    }
    setDocs((data ?? []) as DocumentRow[]);
  }, [docTable]);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = useCallback(async () => {
    setFeedback(null);
    if (!ownerId) {
      setFeedback({
        kind: "error",
        text: `Elegí ${ownerLabel.toLowerCase()}.`,
      });
      return;
    }
    if (!file) {
      setFeedback({ kind: "error", text: "Elegí el archivo a subir." });
      return;
    }
    const invalid = validateFile(file);
    if (invalid) {
      setFeedback({ kind: "error", text: invalid });
      return;
    }

    setUploading(true);
    const supabase = getSupabase();
    const path = `${ownerId}/${safeFileName(file.name)}`;

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(path, file, { upsert: false });
    if (uploadError) {
      setUploading(false);
      setFeedback({ kind: "error", text: uploadError.message });
      return;
    }

    const row: Record<string, unknown> = {
      [ownerColumn]: ownerId,
      storage_path: path,
      file_name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
      uploaded_by: user?.id ?? null,
    };
    const { error: insertError } = await supabase.from(docTable).insert(row);
    setUploading(false);
    if (insertError) {
      setFeedback({
        kind: "error",
        text: `El archivo se subió pero no se pudo registrar: ${insertError.message}`,
      });
      return;
    }

    setFile(null);
    setFeedback({ kind: "ok", text: "Archivo subido correctamente." });
    void load();
  }, [
    ownerId,
    file,
    bucket,
    docTable,
    ownerColumn,
    ownerLabel,
    user?.id,
    load,
  ]);

  const download = useCallback(
    async (doc: DocumentRow) => {
      setFeedback(null);
      const supabase = getSupabase();
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(doc.storage_path, 60);
      if (error || !data?.signedUrl) {
        setFeedback({
          kind: "error",
          text: error?.message ?? "No se pudo generar el enlace de descarga.",
        });
        return;
      }
      window.open(data.signedUrl, "_blank", "noopener");
    },
    [bucket]
  );

  const remove = useCallback(
    async (doc: DocumentRow) => {
      setFeedback(null);
      const confirmed = window.confirm(
        `¿Eliminar “${doc.file_name}”? La acción no se puede deshacer.`
      );
      if (!confirmed) return;

      const supabase = getSupabase();
      const { error: storageError } = await supabase.storage
        .from(bucket)
        .remove([doc.storage_path]);
      if (storageError) {
        setFeedback({ kind: "error", text: storageError.message });
        return;
      }
      const { error: deleteError } = await supabase
        .from(docTable)
        .delete()
        .eq("id", doc.id);
      if (deleteError) {
        setFeedback({ kind: "error", text: deleteError.message });
        return;
      }
      setFeedback({ kind: "ok", text: "Archivo eliminado." });
      void load();
    },
    [bucket, docTable, load]
  );

  return (
    <div className="admin-card">
      <div className="admin-card-head">
        <div>
          <h2 className="admin-card-title">{title}</h2>
          <p className="admin-card-sub">{subtitle}</p>
        </div>
      </div>

      <div className="admin-card-body admin-stack">
        {feedback && (
          <div className={feedback.kind === "ok" ? "admin-ok" : "admin-error"}>
            {feedback.text}
          </div>
        )}

        <div className="admin-grid-2">
          <div className="filter-field">
            <label htmlFor={`doc-owner-${docTable}`}>{ownerLabel}</label>
            <select
              id={`doc-owner-${docTable}`}
              className="admin-select"
              value={ownerId}
              onChange={e => setOwnerId(e.target.value)}
            >
              <option value="">Elegí…</option>
              {owners.map(owner => (
                <option key={owner.id} value={owner.id}>
                  {owner.label}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-field">
            <label htmlFor={`doc-file-${docTable}`}>Archivo</label>
            <input
              id={`doc-file-${docTable}`}
              type="file"
              className="admin-input"
              accept={ALLOWED_MIME_TYPES.join(",")}
              onChange={e => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </div>

        <div className="admin-row">
          <button
            type="button"
            className="admin-button admin-button-copper"
            disabled={uploading || !file || !ownerId}
            onClick={() => void upload()}
          >
            {uploading ? "Subiendo…" : "Subir archivo"}
          </button>
          <span className="cell-muted">
            PDF, DOC, DOCX o imágenes (JPG, PNG, WEBP, HEIC). Máximo 25 MB.
          </span>
        </div>
      </div>

      <div className="admin-card-body flush">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Archivo</th>
                <th>{ownerLabel}</th>
                <th>Tamaño</th>
                <th>Subido</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {docs.map(doc => (
                <tr key={doc.id}>
                  <td className="cell-strong">{doc.file_name}</td>
                  <td className="cell-muted">
                    {ownerLabels.get(
                      (ownerColumn === "client_id"
                        ? doc.client_id
                        : doc.legal_case_id) ?? ""
                    ) ?? "—"}
                  </td>
                  <td className="cell-muted">{formatBytes(doc.size_bytes)}</td>
                  <td className="cell-muted">{formatDate(doc.created_at)}</td>
                  <td>
                    <div className="cell-actions">
                      <button
                        type="button"
                        className="admin-button admin-button-ghost admin-button-small"
                        onClick={() => void download(doc)}
                      >
                        Descargar
                      </button>
                      <button
                        type="button"
                        className="admin-button admin-button-danger admin-button-small"
                        onClick={() => void remove(doc)}
                      >
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!loading && !docs.length && (
          <div className="admin-empty">
            <strong>Todavía no hay archivos</strong>
            Subí el primer documento de esta sección.
          </div>
        )}
        {loading && <div className="admin-empty">Cargando archivos…</div>}
      </div>
    </div>
  );
}

export function DocumentsModule() {
  const [clients, setClients] = useState<Owner[]>([]);
  const [cases, setCases] = useState<Owner[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const supabase = getSupabase();
    void (async () => {
      const [cli, cas] = await Promise.all([
        supabase
          .from("clients")
          .select("id, full_name")
          .order("full_name", { ascending: true }),
        supabase
          .from("legal_cases")
          .select("id, case_number, title")
          .order("created_at", { ascending: false })
          .limit(500),
      ]);
      if (cli.error) setError(cli.error.message);
      if (cas.error) setError(cas.error.message);

      setClients(
        (cli.data ?? []).map(raw => {
          const row = raw as { id: string; full_name: string };
          return { id: row.id, label: row.full_name };
        })
      );
      setCases(
        (cas.data ?? []).map(raw => {
          const row = raw as { id: string; case_number: string; title: string };
          return { id: row.id, label: `${row.case_number} · ${row.title}` };
        })
      );
    })();
  }, []);

  if (!isSupabaseConfigured) {
    return (
      <div className="admin-info">
        Supabase no está configurado. Definí <code>VITE_SUPABASE_URL</code> y{" "}
        <code>VITE_SUPABASE_ANON_KEY</code> en el archivo <code>.env</code> para
        habilitar el módulo de documentación.
      </div>
    );
  }

  return (
    <>
      {error && <div className="admin-error">{error}</div>}

      <DocumentSection
        title="Documentos de clientes"
        subtitle="Archivos privados asociados a una ficha de cliente."
        bucket={CLIENT_DOCUMENTS_BUCKET}
        docTable="client_documents"
        ownerColumn="client_id"
        owners={clients}
        ownerLabel="Cliente"
      />

      <DocumentSection
        title="Documentos de expedientes"
        subtitle="Archivos privados asociados a un expediente."
        bucket={CASE_DOCUMENTS_BUCKET}
        docTable="case_documents"
        ownerColumn="legal_case_id"
        owners={cases}
        ownerLabel="Expediente"
      />
    </>
  );
}
