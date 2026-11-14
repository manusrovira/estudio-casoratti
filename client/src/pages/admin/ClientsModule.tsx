import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CLIENT_STATUSES,
  CLIENT_STATUS_LABELS,
  type ClientStatus,
} from "@/lib/rbac";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";

/**
 * Fichas de clientes del estudio.
 *
 * Un cliente puede existir sin cuenta en la plataforma: `user_id` es el
 * vínculo opcional con un `profiles` registrado. Los conteos de consultas y
 * expedientes se calculan en el navegador sobre los ids devueltos por
 * Postgres (no son datos sensibles: la fila sigue filtrada por RLS).
 */

type ClientRow = {
  id: string;
  full_name: string;
  document_id: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  status: ClientStatus;
  assigned_lawyer_id: string | null;
  user_id: string | null;
  internal_notes: string | null;
  created_at: string;
  updated_at: string;
};

type LawyerRow = { id: string; full_name: string };
type ProfileOption = { id: string; full_name: string | null; email: string | null };
type Feedback = { kind: "ok" | "error"; text: string };

type ClientForm = {
  full_name: string;
  document_id: string;
  email: string;
  phone: string;
  address: string;
  status: ClientStatus;
  assigned_lawyer_id: string;
  user_id: string;
  internal_notes: string;
};

const EMPTY_FORM: ClientForm = {
  full_name: "",
  document_id: "",
  email: "",
  phone: "",
  address: "",
  status: "activo",
  assigned_lawyer_id: "",
  user_id: "",
  internal_notes: "",
};

const dateFormatter = new Intl.DateTimeFormat("es-AR", { dateStyle: "short" });

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return dateFormatter.format(parsed);
}

function sanitizeTerm(term: string): string {
  return term.trim().replace(/[,()%]/g, "");
}

function countBy(values: string[]): Map<string, number> {
  const map = new Map<string, number>();
  values.forEach(value => map.set(value, (map.get(value) ?? 0) + 1));
  return map;
}

function StatusBadge({ status }: { status: ClientStatus }) {
  return (
    <span className={`badge badge-${status}`}>
      {CLIENT_STATUS_LABELS[status]}
    </span>
  );
}

export function ClientsModule() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ClientRow[]>([]);
  const [lawyers, setLawyers] = useState<LawyerRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [linkedUserIds, setLinkedUserIds] = useState<Set<string>>(new Set());
  const [consultationsCount, setConsultationsCount] = useState<
    Map<string, number>
  >(new Map());
  const [casesCount, setCasesCount] = useState<Map<string, number>>(new Map());

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ClientForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const lawyerName = useMemo(() => {
    const map = new Map<string, string>();
    lawyers.forEach(l => map.set(l.id, l.full_name));
    return map;
  }, [lawyers]);

  const profileName = useMemo(() => {
    const map = new Map<string, string>();
    profiles.forEach(p => {
      if (p.full_name) map.set(p.id, p.full_name);
    });
    return map;
  }, [profiles]);

  /* ----------------------------------------------------------------- datos */

  const loadList = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const supabase = getSupabase();

    let query = supabase.from("clients").select("*");
    const term = sanitizeTerm(search);
    if (term) {
      query = query.or(
        `full_name.ilike.%${term}%,email.ilike.%${term}%,document_id.ilike.%${term}%`
      );
    }
    if (statusFilter) query = query.eq("status", statusFilter);
    query = query.order("full_name", { ascending: true });

    const { data, error: queryError } = await query;
    if (queryError) {
      setError(queryError.message);
      setRows([]);
    } else {
      setError(null);
      setRows((data ?? []) as ClientRow[]);
    }
    setLoading(false);
  }, [search, statusFilter]);

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

  // Listas de apoyo + conteos + perfiles sin cliente asignado.
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const supabase = getSupabase();
    void (async () => {
      const [laws, profs, linked, consultations, cases] = await Promise.all([
        supabase
          .from("lawyers")
          .select("id, full_name")
          .eq("is_active", true)
          .order("full_name", { ascending: true }),
        supabase.from("profiles").select("id, full_name, email").order("full_name"),
        supabase.from("clients").select("user_id").not("user_id", "is", null),
        supabase.from("legal_consultations").select("client_id"),
        supabase.from("legal_cases").select("client_id"),
      ]);

      const problems = [
        laws.error?.message,
        profs.error?.message,
        linked.error?.message,
        consultations.error?.message,
        cases.error?.message,
      ].filter(Boolean);
      if (problems.length) setError(problems.join(" · "));

      setLawyers((laws.data ?? []) as LawyerRow[]);
      setProfiles((profs.data ?? []) as ProfileOption[]);
      setLinkedUserIds(
        new Set(
          (linked.data ?? [])
            .map(r => (r as { user_id: string | null }).user_id)
            .filter((v): v is string => Boolean(v))
        )
      );

      setConsultationsCount(
        countBy(
          (consultations.data ?? [])
            .map(r => (r as { client_id: string | null }).client_id)
            .filter((v): v is string => Boolean(v))
        )
      );
      setCasesCount(
        countBy(
          (cases.data ?? [])
            .map(r => (r as { client_id: string | null }).client_id)
            .filter((v): v is string => Boolean(v))
        )
      );
    })();
  }, []);

  /* ---------------------------------------------------------------- acciones */

  const openCreate = useCallback(() => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFeedback(null);
    setDrawerOpen(true);
  }, []);

  const openEdit = useCallback((client: ClientRow) => {
    setEditingId(client.id);
    setForm({
      full_name: client.full_name ?? "",
      document_id: client.document_id ?? "",
      email: client.email ?? "",
      phone: client.phone ?? "",
      address: client.address ?? "",
      status: client.status,
      assigned_lawyer_id: client.assigned_lawyer_id ?? "",
      user_id: client.user_id ?? "",
      internal_notes: client.internal_notes ?? "",
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
    if (!form.full_name.trim()) {
      setFeedback({
        kind: "error",
        text: "El nombre del cliente es obligatorio.",
      });
      return;
    }
    setSaving(true);
    const supabase = getSupabase();

    const payload: Record<string, unknown> = {
      full_name: form.full_name.trim(),
      document_id: form.document_id.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      address: form.address.trim() || null,
      status: form.status,
      assigned_lawyer_id: form.assigned_lawyer_id || null,
      user_id: form.user_id || null,
      internal_notes: form.internal_notes.trim() || null,
    };

    if (editingId) {
      const { error: updateError } = await supabase
        .from("clients")
        .update(payload)
        .eq("id", editingId);
      setSaving(false);
      if (updateError) {
        setFeedback({ kind: "error", text: updateError.message });
        return;
      }
      setFeedback({ kind: "ok", text: "Cliente actualizado." });
    } else {
      const { error: insertError } = await supabase
        .from("clients")
        .insert(payload);
      setSaving(false);
      if (insertError) {
        setFeedback({ kind: "error", text: insertError.message });
        return;
      }
      setFeedback({ kind: "ok", text: "Cliente creado." });
    }
    void loadList();
    setDrawerOpen(false);
  }, [form, editingId, loadList]);

  const linkUser = useCallback(
    async (client: ClientRow, userId: string) => {
      const supabase = getSupabase();
      const { error: updateError } = await supabase
        .from("clients")
        .update({ user_id: userId || null })
        .eq("id", client.id);
      if (updateError) {
        setFeedback({ kind: "error", text: updateError.message });
        return;
      }
      setLinkedUserIds(current => {
        const next = new Set(current);
        next.delete(client.user_id ?? "");
        if (userId) next.add(userId);
        return next;
      });
      setFeedback({
        kind: "ok",
        text: userId
          ? "Cuenta vinculada al cliente."
          : "Se quitó el vínculo con la cuenta.",
      });
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
        habilitar el módulo de clientes.
      </div>
    );
  }

  const unlinkedProfiles = profiles.filter(p => !linkedUserIds.has(p.id));

  return (
    <>
      {error && <div className="admin-error">{error}</div>}

      <div className="admin-card">
        <div className="admin-filters">
          <div className="filter-field">
            <label htmlFor="f-cliente-buscar">Buscar</label>
            <input
              id="f-cliente-buscar"
              className="admin-input"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Nombre, email o documento"
            />
          </div>
          <div className="filter-field">
            <label htmlFor="f-cliente-estado">Estado</label>
            <select
              id="f-cliente-estado"
              className="admin-select narrow"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
            >
              <option value="">Todos</option>
              {CLIENT_STATUSES.map(s => (
                <option key={s} value={s}>
                  {CLIENT_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="admin-button admin-button-copper"
            onClick={openCreate}
          >
            Nuevo cliente
          </button>
        </div>

        <div className="admin-card-body flush">
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Documento</th>
                  <th>Email</th>
                  <th>Teléfono</th>
                  <th>Estado</th>
                  <th>Abogado</th>
                  <th>Cuenta</th>
                  <th>Consultas</th>
                  <th>Expedientes</th>
                  <th>Alta</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id}>
                    <td className="cell-strong">{row.full_name}</td>
                    <td className="cell-muted">{row.document_id ?? "—"}</td>
                    <td className="cell-muted">{row.email ?? "—"}</td>
                    <td className="cell-muted">{row.phone ?? "—"}</td>
                    <td>
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="cell-muted">
                      {row.assigned_lawyer_id
                        ? (lawyerName.get(row.assigned_lawyer_id) ?? "—")
                        : "Sin asignar"}
                    </td>
                    <td>
                      {row.user_id ? (
                        <span className="badge badge-cliente">Vinculada</span>
                      ) : (
                        <span className="cell-muted">Sin cuenta</span>
                      )}
                    </td>
                    <td className="cell-muted">
                      {consultationsCount.get(row.id) ?? 0}
                    </td>
                    <td className="cell-muted">
                      {casesCount.get(row.id) ?? 0}
                    </td>
                    <td className="cell-muted">{formatDate(row.created_at)}</td>
                    <td>
                      <div className="cell-actions">
                        <button
                          type="button"
                          className="admin-button admin-button-ghost admin-button-small"
                          onClick={() => openEdit(row)}
                        >
                          Editar
                        </button>
                        <select
                          className="admin-select narrow"
                          aria-label={`Vincular cuenta a ${row.full_name}`}
                          value={row.user_id ?? ""}
                          onChange={e => void linkUser(row, e.target.value)}
                        >
                          <option value="">Vincular cuenta…</option>
                          {row.user_id && (
                            <option value={row.user_id}>
                              {profileName.get(row.user_id) ?? "Cuenta actual"}
                            </option>
                          )}
                          {unlinkedProfiles.map(p => (
                            <option key={p.id} value={p.id}>
                              {p.full_name ?? p.id}
                              {p.email ? ` · ${p.email}` : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!loading && !rows.length && (
            <div className="admin-empty">
              <strong>No hay clientes para mostrar</strong>
              Revisá los filtros o creá la primera ficha de cliente.
            </div>
          )}
          {loading && <div className="admin-empty">Cargando clientes…</div>}
        </div>
      </div>

      {drawerOpen && (
        <div
          className="admin-drawer"
          role="dialog"
          aria-modal="true"
          aria-label={editingId ? "Editar cliente" : "Nuevo cliente"}
          onClick={closeDrawer}
        >
          <div
            className="admin-drawer-panel"
            onClick={event => event.stopPropagation()}
          >
            <div className="admin-drawer-head">
              <h2>{editingId ? "Editar cliente" : "Nuevo cliente"}</h2>
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
                <label htmlFor="c-nombre">Nombre y apellido *</label>
                <input
                  id="c-nombre"
                  className="admin-input"
                  value={form.full_name}
                  onChange={e =>
                    setForm({ ...form, full_name: e.target.value })
                  }
                />
              </div>

              <div className="filter-field">
                <label htmlFor="c-documento">Documento</label>
                <input
                  id="c-documento"
                  className="admin-input"
                  value={form.document_id}
                  onChange={e =>
                    setForm({ ...form, document_id: e.target.value })
                  }
                />
              </div>

              <div className="filter-field">
                <label htmlFor="c-email">Email</label>
                <input
                  id="c-email"
                  type="email"
                  className="admin-input"
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                />
              </div>

              <div className="filter-field">
                <label htmlFor="c-telefono">Teléfono</label>
                <input
                  id="c-telefono"
                  className="admin-input"
                  value={form.phone}
                  onChange={e => setForm({ ...form, phone: e.target.value })}
                />
              </div>

              <div className="filter-field">
                <label htmlFor="c-direccion">Dirección</label>
                <input
                  id="c-direccion"
                  className="admin-input"
                  value={form.address}
                  onChange={e => setForm({ ...form, address: e.target.value })}
                />
              </div>

              <div className="filter-field">
                <label htmlFor="c-estado">Estado</label>
                <select
                  id="c-estado"
                  className="admin-select"
                  value={form.status}
                  onChange={e =>
                    setForm({ ...form, status: e.target.value as ClientStatus })
                  }
                >
                  {CLIENT_STATUSES.map(s => (
                    <option key={s} value={s}>
                      {CLIENT_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="filter-field">
                <label htmlFor="c-abogado">Abogado a cargo</label>
                <select
                  id="c-abogado"
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
                <label htmlFor="c-cuenta">Cuenta de la plataforma</label>
                <select
                  id="c-cuenta"
                  className="admin-select"
                  value={form.user_id}
                  onChange={e => setForm({ ...form, user_id: e.target.value })}
                >
                  <option value="">Sin cuenta vinculada</option>
                  {form.user_id &&
                    !profiles.some(p => p.id === form.user_id) && (
                      <option value={form.user_id}>
                        {profileName.get(form.user_id) ?? "Cuenta actual"}
                      </option>
                    )}
                  {unlinkedProfiles.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.full_name ?? p.id}
                      {p.email ? ` · ${p.email}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="filter-field">
                <label htmlFor="c-notas">Notas internas</label>
                <textarea
                  id="c-notas"
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
                  {editingId ? "Guardar cambios" : "Crear cliente"}
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
    </>
  );
}
