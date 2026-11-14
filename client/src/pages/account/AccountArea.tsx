import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useAuthContext } from "@/contexts/AuthContext";
import { getSupabase, isSupabaseConfigured, CLIENT_DOCUMENTS_BUCKET, CASE_DOCUMENTS_BUCKET } from "@/lib/supabase";
import {
  CASE_STATUS_LABELS,
  CONSULTATION_STATUS_LABELS,
  type Consultation,
  type ConsultationStatus,
  type LegalCase,
} from "@/lib/rbac";

/**
 * Área de cliente.
 *
 * Todo lo que se muestra acá está acotado por las políticas RLS: el cliente
 * sólo alcanza sus propias consultas, expedientes y documentos, y nunca las
 * notas internas del estudio.
 */

const dateFormat = new Intl.DateTimeFormat("es-AR", { dateStyle: "medium" });
const dateTimeFormat = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" });

type Tab = "consultas" | "expedientes" | "documentos" | "perfil";

export function AccountArea() {
  const { user, profile, role, loading, configured, signOut, refreshProfile } = useAuthContext();
  const [tab, setTab] = useState<Tab>("consultas");
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [cases, setCases] = useState<LegalCase[]>([]);
  const [documents, setDocuments] = useState<
    Array<{ id: string; file_name: string; storage_path: string; bucket: string; created_at: string }>
  >([]);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!configured || !user) return;
    let cancelled = false;

    async function load() {
      setLoadingData(true);
      setError(null);
      try {
        const supabase = getSupabase();
        const [consultationsResult, casesResult, clientDocs, caseDocs] = await Promise.all([
          supabase
            .from("legal_consultations")
            .select("*")
            .order("received_at", { ascending: false }),
          supabase.from("legal_cases").select("*").order("started_at", { ascending: false }),
          supabase.from("client_documents").select("*"),
          supabase.from("case_documents").select("*"),
        ]);

        if (cancelled) return;
        if (consultationsResult.error) throw consultationsResult.error;

        setConsultations((consultationsResult.data ?? []) as Consultation[]);
        setCases((casesResult.data ?? []) as LegalCase[]);
        setDocuments([
          ...((clientDocs.data ?? []) as any[]).map((doc) => ({
            id: doc.id,
            file_name: doc.file_name,
            storage_path: doc.storage_path,
            bucket: CLIENT_DOCUMENTS_BUCKET,
            created_at: doc.created_at,
          })),
          ...((caseDocs.data ?? []) as any[]).map((doc) => ({
            id: doc.id,
            file_name: doc.file_name,
            storage_path: doc.storage_path,
            bucket: CASE_DOCUMENTS_BUCKET,
            created_at: doc.created_at,
          })),
        ]);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "No pudimos cargar tu información.");
        }
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [user, configured]);

  const counts = useMemo(
    () => ({
      consultas: consultations.length,
      expedientes: cases.length,
      documentos: documents.length,
    }),
    [consultations, cases, documents],
  );

  if (!configured) {
    return (
      <div className="account-shell">
        <div className="account-empty">
          El área privada está deshabilitada porque Supabase no está configurado en este
          entorno.
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="account-shell">
        <div className="account-empty">Cargando tu información…</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="account-shell">
        <div className="account-head">
          <div>
            <span className="eyebrow">
              <i />
              Área de clientes
            </span>
            <h1>Iniciá sesión</h1>
            <p>Para ver el estado de tus consultas necesitás entrar con tu cuenta.</p>
          </div>
          <Link className="button button-copper" href="/ingresar">
            Iniciar sesión
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="account-shell">
      <div className="account-head">
        <div>
          <span className="eyebrow">
            <i />
            Área de clientes
          </span>
          <h1>
            Hola, {profile?.full_name?.split(" ")[0] ?? "bienvenido"}
          </h1>
          <p>Acá seguís el estado de tus consultas y la documentación habilitada.</p>
        </div>
        <div className="admin-row">
          <Link className="button button-dark" href="/">
            Volver al sitio
          </Link>
          <button type="button" className="reset-link" onClick={() => void signOut()}>
            Cerrar sesión
          </button>
        </div>
      </div>

      <div className="account-tabs">
        <button
          type="button"
          className={tab === "consultas" ? "account-tab active" : "account-tab"}
          onClick={() => setTab("consultas")}
        >
          Consultas ({counts.consultas})
        </button>
        <button
          type="button"
          className={tab === "expedientes" ? "account-tab active" : "account-tab"}
          onClick={() => setTab("expedientes")}
        >
          Expedientes ({counts.expedientes})
        </button>
        <button
          type="button"
          className={tab === "documentos" ? "account-tab active" : "account-tab"}
          onClick={() => setTab("documentos")}
        >
          Documentos ({counts.documentos})
        </button>
        <button
          type="button"
          className={tab === "perfil" ? "account-tab active" : "account-tab"}
          onClick={() => setTab("perfil")}
        >
          Mis datos
        </button>
      </div>

      {error && <div className="admin-error">{error}</div>}
      {loadingData && <div className="account-empty">Cargando…</div>}

      {!loadingData && tab === "consultas" && (
        <>
          {consultations.length === 0 ? (
            <div className="account-empty">
              Todavía no tenés consultas registradas. Podés enviar una desde el{" "}
              <Link href="/contacto" style={{ color: "var(--copper)" }}>
                formulario de contacto
              </Link>
              .
            </div>
          ) : (
            consultations.map((consultation) => (
              <article className="account-card" key={consultation.id}>
                <div className="admin-spread">
                  <h3>{consultation.subject}</h3>
                  <span className={`badge badge-${consultation.status}`}>
                    {CONSULTATION_STATUS_LABELS[consultation.status as ConsultationStatus]}
                  </span>
                </div>
                <div className="account-meta" style={{ marginTop: ".5rem" }}>
                  <span>{consultation.reference_code}</span>
                  <span>Recibida el {dateFormat.format(new Date(consultation.received_at))}</span>
                </div>
                <p style={{ color: "var(--muted)", fontSize: ".85rem", marginTop: ".9rem" }}>
                  {consultation.description}
                </p>
              </article>
            ))
          )}
        </>
      )}

      {!loadingData && tab === "expedientes" && (
        <>
          {cases.length === 0 ? (
            <div className="account-empty">Todavía no tenés expedientes abiertos.</div>
          ) : (
            cases.map((legalCase) => (
              <article className="account-card" key={legalCase.id}>
                <div className="admin-spread">
                  <h3>{legalCase.title}</h3>
                  <span className={`badge badge-${legalCase.status}`}>
                    {CASE_STATUS_LABELS[legalCase.status]}
                  </span>
                </div>
                <div className="account-meta" style={{ marginTop: ".5rem" }}>
                  <span>{legalCase.case_number}</span>
                  {legalCase.fuero && <span>{legalCase.fuero}</span>}
                  {legalCase.court && <span>{legalCase.court}</span>}
                  <span>Iniciado el {dateFormat.format(new Date(legalCase.started_at))}</span>
                </div>
              </article>
            ))
          )}
        </>
      )}

      {!loadingData && tab === "documentos" && (
        <>
          {documents.length === 0 ? (
            <div className="account-empty">
              No hay documentos habilitados para vos en este momento.
            </div>
          ) : (
            <div className="account-card">
              {documents.map((document) => (
                <div className="admin-doc-row" key={document.id}>
                  <div>
                    <strong>{document.file_name}</strong>
                    <div className="account-meta">
                      <span>{dateTimeFormat.format(new Date(document.created_at))}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="admin-button admin-button-ghost admin-button-small"
                    onClick={async () => {
                      const { data, error: signError } = await getSupabase()
                        .storage.from(document.bucket)
                        .createSignedUrl(document.storage_path, 60);
                      if (signError || !data?.signedUrl) {
                        setError("No pudimos generar el enlace de descarga.");
                        return;
                      }
                      window.open(data.signedUrl, "_blank", "noopener");
                    }}
                  >
                    Descargar
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {!loadingData && tab === "perfil" && (
        <ProfilePanel
          userId={user.id}
          fullName={profile?.full_name ?? ""}
          phone={profile?.phone ?? ""}
          documentId={profile?.document_id ?? ""}
          role={role}
          onSaved={refreshProfile}
        />
      )}
    </div>
  );
}

function ProfilePanel({
  userId,
  fullName,
  phone,
  documentId,
  role,
  onSaved,
}: {
  userId: string;
  fullName: string;
  phone: string;
  documentId: string;
  role: string | null;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(fullName);
  const [phoneValue, setPhoneValue] = useState(phone);
  const [documentValue, setDocumentValue] = useState(documentId);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const { error: updateError } = await getSupabase()
        .from("profiles")
        .update({ full_name: name, phone: phoneValue, document_id: documentValue })
        .eq("id", userId);
      if (updateError) throw updateError;
      await onSaved();
      setMessage("Tus datos quedaron actualizados.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos guardar tus datos.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="account-card">
      <h3>Mis datos</h3>
      <p style={{ color: "var(--muted)", fontSize: ".82rem" }}>
        Podés actualizar tu nombre, teléfono y documento. Tu rol en la plataforma no se
        modifica desde acá.
      </p>
      {message && <div className="admin-ok">{message}</div>}
      {error && <div className="admin-error">{error}</div>}
      <form onSubmit={save} style={{ marginTop: "1.2rem" }}>
        <div className="admin-grid-2">
          <div className="filter-field">
            <label htmlFor="profile-name">Nombre y apellido</label>
            <input
              id="profile-name"
              className="admin-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="filter-field">
            <label htmlFor="profile-phone">Teléfono</label>
            <input
              id="profile-phone"
              className="admin-input"
              value={phoneValue}
              onChange={(e) => setPhoneValue(e.target.value)}
            />
          </div>
        </div>
        <div className="filter-field" style={{ marginTop: ".9rem" }}>
          <label htmlFor="profile-doc">Documento</label>
          <input
            id="profile-doc"
            className="admin-input"
            value={documentValue}
            onChange={(e) => setDocumentValue(e.target.value)}
          />
        </div>
        <div className="admin-row" style={{ marginTop: "1.2rem" }}>
          <button type="submit" className="admin-button" disabled={busy}>
            {busy ? "Guardando…" : "Guardar cambios"}
          </button>
          <span style={{ color: "var(--muted)", fontSize: ".74rem" }}>
            Rol actual: {role ?? "usuario"}
          </span>
        </div>
      </form>
    </div>
  );
}
