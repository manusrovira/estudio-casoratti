import { useCallback, useEffect, useMemo, useState } from "react";
import { CASE_STATUSES, CASE_STATUS_LABELS, type CaseStatus } from "@/lib/rbac";
import {
  CASE_DOCUMENTS_BUCKET,
  getSupabase,
  isSupabaseConfigured,
} from "@/lib/supabase";

/**
 * Expedientes (asuntos jurídicos).
 *
 * Cada expediente pertenece a un cliente (obligatorio en Postgres) y puede
 * tener documentación asociada en el bucket privado `case-documents`.
 */

type CaseRow = {
  id: string;
  case_number: string;
  title: string;
  client_id: string;
  assigned_lawyer_id: string | null;
  fuero: string | null;
  jurisdiction: string | null;
  court: string | null;
  court_case_number: string | null;
  status: CaseStatus;
  description: string | null;
  internal_notes: string | null;
  started_at: string;
  created_at: string;
  updated_at: string;
};

type LawyerRow = { id: string; full_name: string };
type ClientOption = { id: string; full_name: string; email: string | null };
type ConsultationOption = {
  id: string;
  reference_code: string;
  full_name: string;
  legal_case_id: string | null;
};
type CaseDocument = {
  id: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
};
type Feedback = { kind: "ok" | "error"; text: string };

type CaseForm = {
  case_number: string;
  title: string;
  client_id: string;
  assigned_lawyer_id: string;
  fuero: string;
  jurisdiction: string;
  court: string;
  court_case_number: string;
  status: CaseStatus;
  started_at: string;
  description: string;
  internal_notes: string;
};

const EMPTY_FORM: CaseForm = {
  case_number: "",
  title: "",
  client_id: "",
  assigned_lawyer_id: "",
  fuero: "",
  jurisdiction: "",
  court: "",
  court_case_number: "",
  status: "inicial",
  started_at: new Date().toISOString().slice(0, 10),
  description: "",
  internal_notes: "",
};

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

function sanitizeTerm(term: string): string {
  return term.trim().replace(/[,()%]/g, "");
}

/** Sugiere el próximo número de expediente: EXP-{año}-{secuencia}. */
function suggestCaseNumber(existing: string[]): string {
  const year = new Date().getFullYear();
  const prefix = `EXP-${year}-`;
  let max = 0;
  existing.forEach(value => {
    if (!value.startsWith(prefix)) return;
    const seq = Number.parseInt(value.slice(prefix.length), 10);
    if (Number.isFinite(seq) && seq > max) max = seq;
  });
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

function StatusBadge({ status }: { status: CaseStatus }) {
  return (
    <span className={`badge badge-${status}`}>
      {CASE_STATUS_LABELS[status]}
    </span>
  );
}

export function CasesModule() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<CaseRow[]>([]);
  const [lawyers, setLawyers] = useState<LawyerRow[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [consultations, setConsultations] = useState<ConsultationOption[]>([]);
  const [allCaseNumbers, setAllCaseNumbers] = useState<string[]>([]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [lawyerFilter, setLawyerFilter] = useState("");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CaseForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const [detail, setDetail] = useState<CaseRow | null>(null);
  const [detailDocs, setDetailDocs] = useState<CaseDocument[]>([]);
  const [detailFeedback, setDetailFeedback] = useState<Feedback | null>(null);

  const lawyerName = useMemo(() => {
    const map = new Map<string, string>();
    lawyers.forEach(l => map.set(l.id, l.full_name));
    return map;
  }, [lawyers]);

  const clientName = useMemo(() => {
    const map = new Map<string, string>();
    clients.forEach(c => map.set(c.id, c.full_name));
    return map;
  }, [clients]);

  /* ----------------------------------------------------------------- datos */

  const loadList = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const supabase = getSupabase();

    let query = supabase.from("legal_cases").select("*");
    const term = sanitizeTerm(search);
    if (term)
      query = query.or(`case_number.ilike.%${term}%,title.ilike.%${term}%`);
    if (statusFilter) query = query.eq("status", statusFilter);
    if (lawyerFilter) query = query.eq("assigned_lawyer_id", lawyerFilter);
    query = query.order("started_at", { ascending: false });

    const { data, error: queryError } = await query;
    if (queryError) {
      setError(queryError.message);
      setRows([]);
    } else {
      setError(null);
      setRows((data ?? []) as CaseRow[]);
    }
    setLoading(false);
  }, [search, statusFilter, lawyerFilter]);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    const timer = setTimeout(() => {
      void loadList();
    }, 250);
    return () => clearTimeout(timer);
  }, [loadList]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const supabase = getSupabase();
    void (async () => {
      const [laws, clis, cons, numbers] = await Promise.all([
        supabase
          .from("lawyers")
          .select("id, full_name")
          .eq("is_active", true)
          .order("full_name", { ascending: true }),
        supabase
          .from("clients")
          .select("id, full_name, email")
          .order("full_name", { ascending: true }),
        supabase
          .from("legal_consultations")
          .select("id, reference_code, full_name, legal_case_id")
          .order("received_at", { ascending: false })
          .limit(500),
        supabase.from("legal_cases").select("case_number"),
      ]);

      const problems = [
        laws.error?.message,
        clis.error?.message,
        cons.error?.message,
        numbers.error?.message,
      ].filter(Boolean);
      if (problems.length) setError(problems.join(" · "));

      setLawyers((laws.data ?? []) as LawyerRow[]);
      setClients((clis.data ?? []) as ClientOption[]);
      setConsultations((cons.data ?? []) as ConsultationOption[]);
      setAllCaseNumbers(
        (numbers.data ?? []).map(
          r => (r as { case_number: string }).case_number
        )
      );
    })();
  }, []);

  /* ---------------------------------------------------------------- acciones */

  const openCreate = useCallback(() => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, case_number: suggestCaseNumber(allCaseNumbers) });
    setFeedback(null);
    setDrawerOpen(true);
  }, [allCaseNumbers]);

  const openEdit = useCallback((item: CaseRow) => {
    setEditingId(item.id);
    setForm({
      case_number: item.case_number,
      title: item.title,
      client_id: item.client_id,
      assigned_lawyer_id: item.assigned_lawyer_id ?? "",
      fuero: item.fuero ?? "",
      jurisdiction: item.jurisdiction ?? "",
      court: item.court ?? "",
      court_case_number: item.court_case_number ?? "",
      status: item.status,
      started_at: item.started_at ?? "",
      description: item.description ?? "",
      internal_notes: item.internal_notes ?? "",
    });
    setFeedback(null);
    setDrawerOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    setEditingId(null);
    setFeedback(null);
  }, []);

  const save = useCallback(async () => {
    if (!form.title.trim()) {
      setFeedback({
        kind: "error",
        text: "El título del expediente es obligatorio.",
      });
      return;
    }
    if (!form.client_id) {
      setFeedback({ kind: "error", text: "Elegí el cliente del expediente." });
      return;
    }
    const caseNumber =
      form.case_number.trim() || suggestCaseNumber(allCaseNumbers);

    setSaving(true);
    const supabase = getSupabase();
    const payload: Record<string, unknown> = {
      case_number: caseNumber,
      title: form.title.trim(),
      client_id: form.client_id,
      assigned_lawyer_id: form.assigned_lawyer_id || null,
      fuero: form.fuero.trim() || null,
      jurisdiction: form.jurisdiction.trim() || null,
      court: form.court.trim() || null,
      court_case_number: form.court_case_number.trim() || null,
      status: form.status,
      started_at: form.started_at || undefined,
      description: form.description.trim() || null,
      internal_notes: form.internal_notes.trim() || null,
    };

    if (editingId) {
      const { error: updateError } = await supabase
        .from("legal_cases")
        .update(payload)
        .eq("id", editingId);
      setSaving(false);
      if (updateError) {
        setFeedback({ kind: "error", text: updateError.message });
        return;
      }
      setFeedback({ kind: "ok", text: "Expediente actualizado." });
    } else {
      const { error: insertError } = await supabase
        .from("legal_cases")
        .insert(payload);
      setSaving(false);
      if (insertError) {
        setFeedback({ kind: "error", text: insertError.message });
        return;
      }
      setFeedback({ kind: "ok", text: "Expediente creado." });
    }
    void loadList();
    setDrawerOpen(false);
  }, [form, editingId, allCaseNumbers, loadList]);

  const openDetail = useCallback(async (item: CaseRow) => {
    setDetail(item);
    setDetailFeedback(null);
    const supabase = getSupabase();
    const { data, error: docsError } = await supabase
      .from("case_documents")
      .select("id, storage_path, file_name, mime_type, size_bytes, created_at")
      .eq("legal_case_id", item.id)
      .order("created_at", { ascending: false });
    if (docsError) {
      setDetailFeedback({ kind: "error", text: docsError.message });
      setDetailDocs([]);
      return;
    }
    setDetailDocs((data ?? []) as CaseDocument[]);
  }, []);

  const closeDetail = useCallback(() => {
    setDetail(null);
    setDetailDocs([]);
    setDetailFeedback(null);
  }, []);

  const downloadDocument = useCallback(async (doc: CaseDocument) => {
    const supabase = getSupabase();
    const { data, error: signError } = await supabase.storage
      .from(CASE_DOCUMENTS_BUCKET)
      .createSignedUrl(doc.storage_path, 60);
    if (signError || !data?.signedUrl) {
      setDetailFeedback({
        kind: "error",
        text: signError?.message ?? "No se pudo generar el enlace de descarga.",
      });
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  }, []);

  const linkConsultation = useCallback(
    async (caseId: string, consultationId: string) => {
      if (!consultationId) return;
      const supabase = getSupabase();
      const { error: updateError } = await supabase
        .from("legal_consultations")
        .update({ legal_case_id: caseId })
        .eq("id", consultationId);
      if (updateError) {
        setDetailFeedback({ kind: "error", text: updateError.message });
        return;
      }
      setDetailFeedback({ kind: "ok", text: "Consulta vinculada." });
      void loadList();
    },
    [loadList]
  );

  /* ----------------------------------------------------------------- vista */

  if (!isSupabaseConfigured) {
    return (
      <div className="admin-info">
        Supabase no está configurado. Definí <code>VITE_SUPABASE_URL</code> y{" "}
        <code>VITE_SUPABASE_ANON_KEY</code> en el archivo <code>.env</code> para
        habilitar el módulo de expedientes.
      </div>
    );
  }

  const caseConsultations = detail
    ? consultations.filter(c => c.legal_case_id === detail.id)
    : [];

  return (
    <>
      {error && <div className="admin-error">{error}</div>}

      <div className="admin-card">
        <div className="admin-filters">
          <div className="filter-field">
            <label htmlFor="f-caso-buscar">Buscar</label>
            <input
              id="f-caso-buscar"
              className="admin-input"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Número o título"
            />
          </div>
          <div className="filter-field">
            <label htmlFor="f-caso-estado">Estado</label>
            <select
              id="f-caso-estado"
              className="admin-select narrow"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
            >
              <option value="">Todos</option>
              {CASE_STATUSES.map(s => (
                <option key={s} value={s}>
                  {CASE_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="f-caso-abogado">Abogado</label>
            <select
              id="f-caso-abogado"
              className="admin-select narrow"
              value={lawyerFilter}
              onChange={e => setLawyerFilter(e.target.value)}
            >
              <option value="">Todos</option>
              {lawyers.map(l => (
                <option key={l.id} value={l.id}>
                  {l.full_name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="admin-button admin-button-copper"
            onClick={openCreate}
          >
            Nuevo expediente
          </button>
        </div>

        <div className="admin-card-body flush">
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Título</th>
                  <th>Cliente</th>
                  <th>Abogado</th>
                  <th>Fuero</th>
                  <th>Jurisdicción</th>
                  <th>Juzgado</th>
                  <th>Estado</th>
                  <th>Inicio</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id}>
                    <td className="cell-strong">{row.case_number}</td>
                    <td>{row.title}</td>
                    <td className="cell-muted">
                      {clientName.get(row.client_id) ?? "—"}
                    </td>
                    <td className="cell-muted">
                      {row.assigned_lawyer_id
                        ? (lawyerName.get(row.assigned_lawyer_id) ?? "—")
                        : "Sin asignar"}
                    </td>
                    <td className="cell-muted">{row.fuero ?? "—"}</td>
                    <td className="cell-muted">{row.jurisdiction ?? "—"}</td>
                    <td className="cell-muted">{row.court ?? "—"}</td>
                    <td>
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="cell-muted">{formatDate(row.started_at)}</td>
                    <td>
                      <div className="cell-actions">
                        <button
                          type="button"
                          className="admin-button admin-button-ghost admin-button-small"
                          onClick={() => void openDetail(row)}
                        >
                          Ver
                        </button>
                        <button
                          type="button"
                          className="admin-button admin-button-small"
                          onClick={() => openEdit(row)}
                        >
                          Editar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!loading && !rows.length && (
            <div className="admin-empty">
              <strong>No hay expedientes para mostrar</strong>
              Revisá los filtros o creá el primer expediente.
            </div>
          )}
          {loading && <div className="admin-empty">Cargando expedientes…</div>}
        </div>
      </div>

      {/* ------------------------------------------------------------- drawer */}
      {drawerOpen && (
        <div
          className="admin-drawer"
          role="dialog"
          aria-modal="true"
          aria-label={editingId ? "Editar expediente" : "Nuevo expediente"}
          onClick={closeDrawer}
        >
          <div
            className="admin-drawer-panel"
            onClick={event => event.stopPropagation()}
          >
            <div className="admin-drawer-head">
              <h2>{editingId ? "Editar expediente" : "Nuevo expediente"}</h2>
              <button
                type="button"
                className="admin-close"
                onClick={closeDrawer}
                aria-label="Cerrar"
              >
                ×
              </button>
            </div>

            {feedback && (
              <div
                className={feedback.kind === "ok" ? "admin-ok" : "admin-error"}
              >
                {feedback.text}
              </div>
            )}

            <div className="admin-stack">
              <div className="filter-field">
                <label htmlFor="e-numero">Número de expediente</label>
                <input
                  id="e-numero"
                  className="admin-input"
                  value={form.case_number}
                  onChange={e =>
                    setForm({ ...form, case_number: e.target.value })
                  }
                />
              </div>

              <div className="filter-field">
                <label htmlFor="e-titulo">Título *</label>
                <input
                  id="e-titulo"
                  className="admin-input"
                  value={form.title}
                  onChange={e => setForm({ ...form, title: e.target.value })}
                />
              </div>

              <div className="filter-field">
                <label htmlFor="e-cliente">Cliente *</label>
                <select
                  id="e-cliente"
                  className="admin-select"
                  value={form.client_id}
                  onChange={e =>
                    setForm({ ...form, client_id: e.target.value })
                  }
                >
                  <option value="">Elegí un cliente</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.full_name}
                      {c.email ? ` · ${c.email}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="filter-field">
                <label htmlFor="e-abogado">Abogado a cargo</label>
                <select
                  id="e-abogado"
                  className="admin-select"
                  value={form.assigned_lawyer_id}
                  onChange={e =>
                    setForm({ ...form, assigned_lawyer_id: e.target.value })
                  }
                >
                  <option value="">Sin asignar</option>
                  {lawyers.map(l => (
                    <option key={l.id} value={l.id}>
                      {l.full_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="filter-field">
                <label htmlFor="e-fuero">Fuero</label>
                <input
                  id="e-fuero"
                  className="admin-input"
                  value={form.fuero}
                  onChange={e => setForm({ ...form, fuero: e.target.value })}
                />
              </div>

              <div className="filter-field">
                <label htmlFor="e-jurisdiccion">Jurisdicción</label>
                <input
                  id="e-jurisdiccion"
                  className="admin-input"
                  value={form.jurisdiction}
                  onChange={e =>
                    setForm({ ...form, jurisdiction: e.target.value })
                  }
                />
              </div>

              <div className="filter-field">
                <label htmlFor="e-juzgado">Juzgado / tribunal</label>
                <input
                  id="e-juzgado"
                  className="admin-input"
                  value={form.court}
                  onChange={e => setForm({ ...form, court: e.target.value })}
                />
              </div>

              <div className="filter-field">
                <label htmlFor="e-numero-causa">Número de causa</label>
                <input
                  id="e-numero-causa"
                  className="admin-input"
                  value={form.court_case_number}
                  onChange={e =>
                    setForm({ ...form, court_case_number: e.target.value })
                  }
                />
              </div>

              <div className="filter-field">
                <label htmlFor="e-estado">Estado</label>
                <select
                  id="e-estado"
                  className="admin-select"
                  value={form.status}
                  onChange={e =>
                    setForm({ ...form, status: e.target.value as CaseStatus })
                  }
                >
                  {CASE_STATUSES.map(s => (
                    <option key={s} value={s}>
                      {CASE_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="filter-field">
                <label htmlFor="e-inicio">Fecha de inicio</label>
                <input
                  id="e-inicio"
                  type="date"
                  className="admin-input"
                  value={form.started_at}
                  onChange={e =>
                    setForm({ ...form, started_at: e.target.value })
                  }
                />
              </div>

              <div className="filter-field">
                <label htmlFor="e-descripcion">Descripción</label>
                <textarea
                  id="e-descripcion"
                  className="admin-textarea"
                  value={form.description}
                  onChange={e =>
                    setForm({ ...form, description: e.target.value })
                  }
                />
              </div>

              <div className="filter-field">
                <label htmlFor="e-notas">Notas internas</label>
                <textarea
                  id="e-notas"
                  className="admin-textarea"
                  value={form.internal_notes}
                  onChange={e =>
                    setForm({ ...form, internal_notes: e.target.value })
                  }
                />
              </div>

              <div className="admin-row">
                <button
                  type="button"
                  className="admin-button admin-button-copper"
                  disabled={saving}
                  onClick={() => void save()}
                >
                  {editingId ? "Guardar cambios" : "Crear expediente"}
                </button>
                <button
                  type="button"
                  className="admin-button admin-button-ghost"
                  onClick={closeDrawer}
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------- detalle */}
      {detail && (
        <div
          className="admin-drawer"
          role="dialog"
          aria-modal="true"
          aria-label={`Expediente ${detail.case_number}`}
          onClick={closeDetail}
        >
          <div
            className="admin-drawer-panel"
            onClick={event => event.stopPropagation()}
          >
            <div className="admin-drawer-head">
              <div>
                <h2>{detail.case_number}</h2>
                <p className="admin-card-sub">{detail.title}</p>
              </div>
              <button
                type="button"
                className="admin-close"
                onClick={closeDetail}
                aria-label="Cerrar"
              >
                ×
              </button>
            </div>

            {detailFeedback && (
              <div
                className={
                  detailFeedback.kind === "ok" ? "admin-ok" : "admin-error"
                }
              >
                {detailFeedback.text}
              </div>
            )}

            <div className="admin-stack">
              <dl className="detail-list">
                <dt>Número</dt>
                <dd>{detail.case_number}</dd>
                <dt>Título</dt>
                <dd>{detail.title}</dd>
                <dt>Cliente</dt>
                <dd>{clientName.get(detail.client_id) ?? detail.client_id}</dd>
                <dt>Abogado</dt>
                <dd>
                  {detail.assigned_lawyer_id
                    ? (lawyerName.get(detail.assigned_lawyer_id) ?? "—")
                    : "Sin asignar"}
                </dd>
                <dt>Fuero</dt>
                <dd>{detail.fuero ?? "—"}</dd>
                <dt>Jurisdicción</dt>
                <dd>{detail.jurisdiction ?? "—"}</dd>
                <dt>Juzgado</dt>
                <dd>{detail.court ?? "—"}</dd>
                <dt>Número de causa</dt>
                <dd>{detail.court_case_number ?? "—"}</dd>
                <dt>Estado</dt>
                <dd>
                  <StatusBadge status={detail.status} />
                </dd>
                <dt>Inicio</dt>
                <dd>{formatDate(detail.started_at)}</dd>
                <dt>Descripción</dt>
                <dd>{detail.description ?? "—"}</dd>
                <dt>Notas internas</dt>
                <dd>{detail.internal_notes ?? "—"}</dd>
              </dl>

              <div className="admin-card">
                <div className="admin-card-head">
                  <h3 className="admin-card-title">Documentación</h3>
                </div>
                <div className="admin-card-body">
                  {detailDocs.length ? (
                    detailDocs.map(doc => (
                      <div className="admin-doc-row" key={doc.id}>
                        <div>
                          <span className="cell-strong">{doc.file_name}</span>
                          <span className="cell-muted">
                            {" "}
                            · {formatBytes(doc.size_bytes)} ·{" "}
                            {formatDate(doc.created_at)}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="admin-button admin-button-ghost admin-button-small"
                          onClick={() => void downloadDocument(doc)}
                        >
                          Descargar
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="cell-muted">
                      Este expediente todavía no tiene documentación.
                    </p>
                  )}
                </div>
              </div>

              <div className="admin-card">
                <div className="admin-card-head">
                  <h3 className="admin-card-title">Consulta de origen</h3>
                </div>
                <div className="admin-card-body admin-stack">
                  {caseConsultations.length ? (
                    caseConsultations.map(consultation => (
                      <div className="admin-doc-row" key={consultation.id}>
                        <div>
                          <span className="cell-strong">
                            {consultation.reference_code}
                          </span>
                          <span className="cell-muted">
                            {" "}
                            · {consultation.full_name}
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="cell-muted">
                      No hay consultas vinculadas a este expediente.
                    </p>
                  )}

                  <div className="filter-field">
                    <label htmlFor="d-consulta">Vincular consulta</label>
                    <select
                      id="d-consulta"
                      className="admin-select"
                      value=""
                      onChange={e =>
                        void linkConsultation(detail.id, e.target.value)
                      }
                    >
                      <option value="">Elegí una consulta…</option>
                      {consultations
                        .filter(
                          c => !c.legal_case_id || c.legal_case_id === detail.id
                        )
                        .map(c => (
                          <option key={c.id} value={c.id}>
                            {c.reference_code} · {c.full_name}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
