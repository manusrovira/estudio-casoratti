import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CONSULTATION_STATUSES,
  CONSULTATION_STATUS_LABELS,
  type ConsultationStatus,
} from "@/lib/rbac";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { useAuthContext } from "@/contexts/AuthContext";

/**
 * Consultas recibidas desde el sitio.
 *
 * La tabla `legal_consultations` sólo es legible por el staff autorizado
 * (Postgres aplica la fila, no el navegador). Acá sólo se arman los filtros
 * y se muestran los resultados.
 *
 * Dos tipos de texto separados a propósito:
 *  - `consultation_notes`   -> notas internas, el cliente NUNCA las ve.
 *  - `consultation_messages` -> mensajes estudio <-> cliente, sí visibles.
 */

type ConsultationRow = {
  id: string;
  reference_code: string;
  full_name: string;
  email: string;
  phone: string | null;
  category_id: string | null;
  subject: string;
  description: string;
  status: ConsultationStatus;
  assigned_lawyer_id: string | null;
  client_id: string | null;
  legal_case_id: string | null;
  is_new: boolean;
  received_at: string;
  updated_at: string;
  privacy_accepted_at: string | null;
};

type CategoryRow = { id: string; name: string; is_active: boolean };
type LawyerRow = { id: string; full_name: string };
type ClientOption = { id: string; full_name: string; email: string | null };
type CaseOption = { id: string; case_number: string; title: string };
type NoteRow = {
  id: string;
  body: string;
  created_at: string;
  author_id: string | null;
  authorName: string | null;
};
type MessageRow = {
  id: string;
  body: string;
  created_at: string;
  author_id: string | null;
  authorName: string | null;
};
type Feedback = { kind: "ok" | "error"; text: string };

const dateTimeFormatter = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short",
  timeStyle: "short",
});

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return dateTimeFormatter.format(parsed);
}

/** Limpia el texto antes de mandarlo a un filtro `or` de PostgREST. */
function sanitizeTerm(term: string): string {
  return term.trim().replace(/[,()%]/g, "");
}

async function loadAuthorNames(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!ids.length) return map;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", ids);
  if (error) return map;
  for (const raw of data ?? []) {
    const row = raw as { id: string; full_name: string | null };
    if (row.full_name) map.set(row.id, row.full_name);
  }
  return map;
}

function StatusBadge({ status }: { status: ConsultationStatus }) {
  return (
    <span className={`badge badge-${status}`}>
      {CONSULTATION_STATUS_LABELS[status]}
    </span>
  );
}

export function ConsultationsModule() {
  const { user } = useAuthContext();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ConsultationRow[]>([]);
  const [newCount, setNewCount] = useState(0);

  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [lawyers, setLawyers] = useState<LawyerRow[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [cases, setCases] = useState<CaseOption[]>([]);

  const [nameQ, setNameQ] = useState("");
  const [emailQ, setEmailQ] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [onlyNew, setOnlyNew] = useState(false);

  const [detail, setDetail] = useState<ConsultationRow | null>(null);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [noteBody, setNoteBody] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const categoryName = useMemo(() => {
    const map = new Map<string, string>();
    categories.forEach(c => map.set(c.id, c.name));
    return map;
  }, [categories]);

  const lawyerName = useMemo(() => {
    const map = new Map<string, string>();
    lawyers.forEach(l => map.set(l.id, l.full_name));
    return map;
  }, [lawyers]);

  /* ----------------------------------------------------------------- datos */

  const loadList = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const supabase = getSupabase();

    let query = supabase.from("legal_consultations").select("*");

    const nameTerm = sanitizeTerm(nameQ);
    if (nameTerm) query = query.or(`full_name.ilike.%${nameTerm}%`);

    const emailTerm = sanitizeTerm(emailQ);
    if (emailTerm) query = query.or(`email.ilike.%${emailTerm}%`);

    if (categoryId) query = query.eq("category_id", categoryId);
    if (statusFilter) query = query.eq("status", statusFilter);
    if (fromDate) query = query.gte("received_at", fromDate);
    if (toDate) query = query.lte("received_at", `${toDate}T23:59:59`);
    if (onlyNew) query = query.eq("is_new", true);

    query = query.order("received_at", { ascending: false });

    const { data, error: queryError } = await query;
    if (queryError) {
      setError(queryError.message);
      setRows([]);
    } else {
      setError(null);
      setRows((data ?? []) as ConsultationRow[]);
    }
    setLoading(false);
  }, [nameQ, emailQ, categoryId, statusFilter, fromDate, toDate, onlyNew]);

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

  // Contador de consultas sin leer (badge de notificaciones del estudio).
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const supabase = getSupabase();
    void (async () => {
      const { count, error: countError } = await supabase
        .from("legal_consultations")
        .select("id", { count: "exact", head: true })
        .eq("is_new", true);
      if (countError) return;
      setNewCount(count ?? 0);
    })();
  }, [rows]);

  // Listas de apoyo: se cargan una sola vez.
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const supabase = getSupabase();
    void (async () => {
      const [cats, laws, clis, cses] = await Promise.all([
        supabase
          .from("consultation_categories")
          .select("id, name, is_active")
          .order("sort_order", { ascending: true }),
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
          .from("legal_cases")
          .select("id, case_number, title")
          .order("created_at", { ascending: false })
          .limit(500),
      ]);

      const problems = [
        cats.error?.message,
        laws.error?.message,
        clis.error?.message,
        cses.error?.message,
      ].filter(Boolean);
      if (problems.length) {
        setError(problems.join(" · "));
      }

      setCategories((cats.data ?? []) as CategoryRow[]);
      setLawyers((laws.data ?? []) as LawyerRow[]);
      setClients((clis.data ?? []) as ClientOption[]);
      setCases((cses.data ?? []) as CaseOption[]);
    })();
  }, []);

  /* ---------------------------------------------------------------- drawer */

  const loadThread = useCallback(async (consultationId: string) => {
    const supabase = getSupabase();
    const [notesRes, messagesRes] = await Promise.all([
      supabase
        .from("consultation_notes")
        .select("id, body, created_at, author_id")
        .eq("consultation_id", consultationId)
        .order("created_at", { ascending: false }),
      supabase
        .from("consultation_messages")
        .select("id, body, created_at, author_id")
        .eq("consultation_id", consultationId)
        .order("created_at", { ascending: true }),
    ]);

    if (notesRes.error)
      setFeedback({ kind: "error", text: notesRes.error.message });
    if (messagesRes.error) {
      setFeedback({ kind: "error", text: messagesRes.error.message });
    }

    const noteAuthors = (notesRes.data ?? []) as {
      id: string;
      body: string;
      created_at: string;
      author_id: string | null;
    }[];
    const messageAuthors = (messagesRes.data ?? []) as {
      id: string;
      body: string;
      created_at: string;
      author_id: string | null;
    }[];

    const ids = Array.from(
      new Set(
        [...noteAuthors, ...messageAuthors]
          .map(r => r.author_id)
          .filter((v): v is string => Boolean(v))
      )
    );
    const names = await loadAuthorNames(ids);

    setNotes(
      noteAuthors.map(n => ({
        ...n,
        authorName: n.author_id ? (names.get(n.author_id) ?? null) : null,
      }))
    );
    setMessages(
      messageAuthors.map(m => ({
        ...m,
        authorName: m.author_id ? (names.get(m.author_id) ?? null) : null,
      }))
    );
  }, []);

  const openDetail = useCallback(
    async (id: string) => {
      setFeedback(null);
      setNoteBody("");
      setMessageBody("");
      const supabase = getSupabase();
      const { data, error: detailError } = await supabase
        .from("legal_consultations")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (detailError) {
        setFeedback({ kind: "error", text: detailError.message });
        return;
      }
      setDetail((data ?? null) as ConsultationRow | null);
      await loadThread(id);
    },
    [loadThread]
  );

  const closeDetail = useCallback(() => {
    setDetail(null);
    setNotes([]);
    setMessages([]);
    setFeedback(null);
  }, []);

  const patchDetail = useCallback(
    async (patch: Record<string, unknown>, successText: string) => {
      if (!detail) return;
      setSaving(true);
      const supabase = getSupabase();
      const { data, error: updateError } = await supabase
        .from("legal_consultations")
        .update(patch)
        .eq("id", detail.id)
        .select("*")
        .maybeSingle();
      setSaving(false);
      if (updateError) {
        setFeedback({ kind: "error", text: updateError.message });
        return;
      }
      if (data) setDetail(data as ConsultationRow);
      setFeedback({ kind: "ok", text: successText });
      void loadList();
    },
    [detail, loadList]
  );

  const convertToClient = useCallback(async () => {
    if (!detail) return;
    setSaving(true);
    const supabase = getSupabase();
    const { data, error: insertError } = await supabase
      .from("clients")
      .insert({
        full_name: detail.full_name,
        email: detail.email,
        phone: detail.phone,
        status: "activo",
      })
      .select("id, full_name")
      .single();
    if (insertError || !data) {
      setSaving(false);
      setFeedback({
        kind: "error",
        text: insertError?.message ?? "No se pudo crear el cliente.",
      });
      return;
    }
    const newClient = data as { id: string; full_name: string };
    const { error: linkError } = await supabase
      .from("legal_consultations")
      .update({ client_id: newClient.id })
      .eq("id", detail.id);
    setSaving(false);
    if (linkError) {
      setFeedback({ kind: "error", text: linkError.message });
      return;
    }
    setDetail(current =>
      current ? { ...current, client_id: newClient.id } : current
    );
    setClients(current =>
      current.some(c => c.id === newClient.id)
        ? current
        : [
            ...current,
            {
              id: newClient.id,
              full_name: newClient.full_name,
              email: detail.email,
            },
          ]
    );
    setFeedback({
      kind: "ok",
      text: `Cliente creado y vinculado (${newClient.id}).`,
    });
    void loadList();
  }, [detail, loadList]);

  const addNote = useCallback(async () => {
    if (!detail || !noteBody.trim()) return;
    setSaving(true);
    const supabase = getSupabase();
    const { error: insertError } = await supabase
      .from("consultation_notes")
      .insert({
        consultation_id: detail.id,
        body: noteBody.trim(),
        author_id: user?.id ?? null,
      });
    setSaving(false);
    if (insertError) {
      setFeedback({ kind: "error", text: insertError.message });
      return;
    }
    setNoteBody("");
    setFeedback({ kind: "ok", text: "Nota interna guardada." });
    await loadThread(detail.id);
  }, [detail, noteBody, user?.id, loadThread]);

  const sendMessage = useCallback(async () => {
    if (!detail || !messageBody.trim()) return;
    setSaving(true);
    const supabase = getSupabase();
    const { error: insertError } = await supabase
      .from("consultation_messages")
      .insert({
        consultation_id: detail.id,
        body: messageBody.trim(),
        author_id: user?.id ?? null,
      });
    setSaving(false);
    if (insertError) {
      setFeedback({ kind: "error", text: insertError.message });
      return;
    }
    setMessageBody("");
    setFeedback({ kind: "ok", text: "Respuesta enviada al cliente." });
    await loadThread(detail.id);
  }, [detail, messageBody, user?.id, loadThread]);

  /* ----------------------------------------------------------------- vista */

  if (!isSupabaseConfigured) {
    return (
      <div className="admin-info">
        Supabase no está configurado. Definí <code>VITE_SUPABASE_URL</code> y{" "}
        <code>VITE_SUPABASE_ANON_KEY</code> en el archivo <code>.env</code> para
        habilitar el módulo de consultas.
      </div>
    );
  }

  return (
    <>
      <div className="admin-spread" style={{ marginBottom: "1.2rem" }}>
        <div>
          <span className="badge badge-nueva">
            {newCount} {newCount === 1 ? "consulta nueva" : "consultas nuevas"}
          </span>
          <p className="admin-card-sub" style={{ marginTop: ".6rem" }}>
            Las consultas nuevas se marcan automáticamente hasta que les cambiás
            el estado.
          </p>
        </div>
      </div>

      {error && <div className="admin-error">{error}</div>}

      <div className="admin-card">
        <div className="admin-filters">
          <div className="filter-field">
            <label htmlFor="f-consulta-nombre">Nombre</label>
            <input
              id="f-consulta-nombre"
              className="admin-input narrow"
              value={nameQ}
              onChange={e => setNameQ(e.target.value)}
              placeholder="Buscar por nombre"
            />
          </div>
          <div className="filter-field">
            <label htmlFor="f-consulta-email">Email</label>
            <input
              id="f-consulta-email"
              className="admin-input narrow"
              value={emailQ}
              onChange={e => setEmailQ(e.target.value)}
              placeholder="Buscar por email"
            />
          </div>
          <div className="filter-field">
            <label htmlFor="f-consulta-area">Área jurídica</label>
            <select
              id="f-consulta-area"
              className="admin-select narrow"
              value={categoryId}
              onChange={e => setCategoryId(e.target.value)}
            >
              <option value="">Todas</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="f-consulta-estado">Estado</label>
            <select
              id="f-consulta-estado"
              className="admin-select narrow"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
            >
              <option value="">Todos</option>
              {CONSULTATION_STATUSES.map(s => (
                <option key={s} value={s}>
                  {CONSULTATION_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="f-consulta-desde">Desde</label>
            <input
              id="f-consulta-desde"
              type="date"
              className="admin-input narrow"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
            />
          </div>
          <div className="filter-field">
            <label htmlFor="f-consulta-hasta">Hasta</label>
            <input
              id="f-consulta-hasta"
              type="date"
              className="admin-input narrow"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
            />
          </div>
          <div className="filter-field">
            <label htmlFor="f-consulta-nuevas">Sólo nuevas</label>
            <input
              id="f-consulta-nuevas"
              type="checkbox"
              checked={onlyNew}
              onChange={e => setOnlyNew(e.target.checked)}
            />
          </div>
          <button
            type="button"
            className="admin-button admin-button-ghost"
            onClick={() => {
              setNameQ("");
              setEmailQ("");
              setCategoryId("");
              setStatusFilter("");
              setFromDate("");
              setToDate("");
              setOnlyNew(false);
            }}
          >
            Limpiar
          </button>
        </div>

        <div className="admin-card-body flush">
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Referencia</th>
                  <th>Nombre</th>
                  <th>Email</th>
                  <th>Teléfono</th>
                  <th>Área</th>
                  <th>Asunto</th>
                  <th>Estado</th>
                  <th>Recibida</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr
                    key={row.id}
                    onClick={() => void openDetail(row.id)}
                    style={{ cursor: "pointer" }}
                  >
                    <td className="cell-strong">
                      {row.reference_code}
                      {row.is_new && (
                        <span
                          className="badge badge-nueva"
                          style={{ marginLeft: ".5rem" }}
                        >
                          Nueva
                        </span>
                      )}
                    </td>
                    <td>{row.full_name}</td>
                    <td className="cell-muted">{row.email}</td>
                    <td className="cell-muted">{row.phone ?? "—"}</td>
                    <td className="cell-muted">
                      {row.category_id
                        ? (categoryName.get(row.category_id) ?? "—")
                        : "—"}
                    </td>
                    <td>{row.subject}</td>
                    <td>
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="cell-muted">
                      {formatDateTime(row.received_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!loading && !rows.length && (
            <div className="admin-empty">
              <strong>No hay consultas para mostrar</strong>
              Probá cambiando los filtros o revisá si el sitio está recibiendo
              consultas.
            </div>
          )}
          {loading && <div className="admin-empty">Cargando consultas…</div>}
        </div>
      </div>

      {detail && (
        <div
          className="admin-drawer"
          role="dialog"
          aria-modal="true"
          aria-label={`Consulta ${detail.reference_code}`}
          onClick={closeDetail}
        >
          <div
            className="admin-drawer-panel"
            onClick={event => event.stopPropagation()}
          >
            <div className="admin-drawer-head">
              <div>
                <h2>{detail.reference_code}</h2>
                <p className="admin-card-sub">
                  {detail.full_name} · {detail.email}
                </p>
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

            {feedback && (
              <div
                className={feedback.kind === "ok" ? "admin-ok" : "admin-error"}
              >
                {feedback.text}
              </div>
            )}

            <div className="admin-stack">
              <dl className="detail-list">
                <dt>Referencia</dt>
                <dd>{detail.reference_code}</dd>
                <dt>Nombre</dt>
                <dd>{detail.full_name}</dd>
                <dt>Email</dt>
                <dd>{detail.email}</dd>
                <dt>Teléfono</dt>
                <dd>{detail.phone ?? "—"}</dd>
                <dt>Área jurídica</dt>
                <dd>
                  {detail.category_id
                    ? (categoryName.get(detail.category_id) ?? "—")
                    : "—"}
                </dd>
                <dt>Asunto</dt>
                <dd>{detail.subject}</dd>
                <dt>Descripción</dt>
                <dd>{detail.description}</dd>
                <dt>Estado</dt>
                <dd>
                  <StatusBadge status={detail.status} />
                </dd>
                <dt>Abogado asignado</dt>
                <dd>
                  {detail.assigned_lawyer_id
                    ? (lawyerName.get(detail.assigned_lawyer_id) ?? "—")
                    : "Sin asignar"}
                </dd>
                <dt>Cliente vinculado</dt>
                <dd>{detail.client_id ?? "Sin vincular"}</dd>
                <dt>Expediente</dt>
                <dd>{detail.legal_case_id ?? "Sin vincular"}</dd>
                <dt>Recibida</dt>
                <dd>{formatDateTime(detail.received_at)}</dd>
                <dt>Actualizada</dt>
                <dd>{formatDateTime(detail.updated_at)}</dd>
                <dt>Privacidad aceptada</dt>
                <dd>{formatDateTime(detail.privacy_accepted_at)}</dd>
              </dl>

              <div className="admin-card">
                <div className="admin-card-head">
                  <h3 className="admin-card-title">Gestión</h3>
                </div>
                <div className="admin-card-body admin-stack">
                  <div className="filter-field">
                    <label htmlFor="d-estado">Estado</label>
                    <select
                      id="d-estado"
                      className="admin-select"
                      value={detail.status}
                      disabled={saving}
                      onChange={e =>
                        void patchDetail(
                          { status: e.target.value, is_new: false },
                          "Estado actualizado."
                        )
                      }
                    >
                      {CONSULTATION_STATUSES.map(s => (
                        <option key={s} value={s}>
                          {CONSULTATION_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="filter-field">
                    <label htmlFor="d-abogado">Abogado a cargo</label>
                    <select
                      id="d-abogado"
                      className="admin-select"
                      value={detail.assigned_lawyer_id ?? ""}
                      disabled={saving}
                      onChange={e =>
                        void patchDetail(
                          { assigned_lawyer_id: e.target.value || null },
                          "Asignación actualizada."
                        )
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
                    <label htmlFor="d-cliente">Cliente vinculado</label>
                    <select
                      id="d-cliente"
                      className="admin-select"
                      value={detail.client_id ?? ""}
                      disabled={saving}
                      onChange={e =>
                        void patchDetail(
                          { client_id: e.target.value || null },
                          "Cliente vinculado."
                        )
                      }
                    >
                      <option value="">Sin vincular</option>
                      {clients.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.full_name}
                          {c.email ? ` · ${c.email}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="admin-row">
                    <button
                      type="button"
                      className="admin-button admin-button-copper admin-button-small"
                      disabled={saving || Boolean(detail.client_id)}
                      onClick={() => void convertToClient()}
                    >
                      Convertir en cliente
                    </button>
                    <span className="cell-muted">
                      Crea la ficha de cliente y vincula la consulta.
                    </span>
                  </div>

                  <div className="filter-field">
                    <label htmlFor="d-expediente">Expediente vinculado</label>
                    <select
                      id="d-expediente"
                      className="admin-select"
                      value={detail.legal_case_id ?? ""}
                      disabled={saving}
                      onChange={e =>
                        void patchDetail(
                          { legal_case_id: e.target.value || null },
                          "Expediente vinculado."
                        )
                      }
                    >
                      <option value="">Sin vincular</option>
                      {cases.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.case_number} · {c.title}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="admin-card">
                <div className="admin-card-head">
                  <div>
                    <h3 className="admin-card-title">Notas internas</h3>
                    <p className="admin-card-sub">
                      Sólo las ve el estudio. El cliente nunca las lee.
                    </p>
                  </div>
                </div>
                <div className="admin-card-body">
                  {notes.length ? (
                    notes.map(note => (
                      <div className="note-block" key={note.id}>
                        {note.body}
                        <footer>
                          {note.authorName ?? "Estudio"} ·{" "}
                          {formatDateTime(note.created_at)}
                        </footer>
                      </div>
                    ))
                  ) : (
                    <p className="cell-muted">Todavía no hay notas internas.</p>
                  )}

                  <div className="admin-stack">
                    <textarea
                      className="admin-textarea"
                      value={noteBody}
                      onChange={e => setNoteBody(e.target.value)}
                      placeholder="Escribí una nota interna…"
                    />
                    <button
                      type="button"
                      className="admin-button admin-button-small"
                      disabled={saving || !noteBody.trim()}
                      onClick={() => void addNote()}
                    >
                      Guardar nota interna
                    </button>
                  </div>
                </div>
              </div>

              <div className="admin-card">
                <div className="admin-card-head">
                  <div>
                    <h3 className="admin-card-title">
                      Mensajes con el cliente
                    </h3>
                    <p className="admin-card-sub">
                      Esta conversación sí es visible para la persona que
                      consultó.
                    </p>
                  </div>
                </div>
                <div className="admin-card-body">
                  {messages.length ? (
                    messages.map(message => (
                      <div className="message-block" key={message.id}>
                        <span className="who">
                          {message.authorName ?? "Estudio"} ·{" "}
                          {formatDateTime(message.created_at)}
                        </span>
                        {message.body}
                      </div>
                    ))
                  ) : (
                    <p className="cell-muted">Todavía no hay mensajes.</p>
                  )}

                  <div className="admin-stack">
                    <textarea
                      className="admin-textarea"
                      value={messageBody}
                      onChange={e => setMessageBody(e.target.value)}
                      placeholder="Escribí la respuesta al cliente…"
                    />
                    <button
                      type="button"
                      className="admin-button admin-button-copper admin-button-small"
                      disabled={saving || !messageBody.trim()}
                      onClick={() => void sendMessage()}
                    >
                      Enviar respuesta
                    </button>
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
