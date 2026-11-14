import { useEffect, useState } from "react";
import { useAuthContext } from "@/contexts/AuthContext";
import { getSupabase } from "@/lib/supabase";

/**
 * Auditoría del panel.
 *
 * `audit_logs` es de sólo lectura y de append-only: en Postgres no hay policy
 * de UPDATE ni de DELETE, así que ni un administrador puede reescribir el
 * historial. Acá sólo se lee, se filtra y se pagina.
 */

const dateTimeFormat = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short",
  timeStyle: "short",
});

const PAGE_SIZE = 50;

type AuditRow = {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  created_at: string;
};

type ProfileName = {
  id: string;
  full_name: string | null;
};

function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "No pudimos cargar el registro de auditoría.";
}

/** Convierte un `<input type="date">` (yyyy-mm-dd) a un ISO con hora local. */
function toIsoBoundary(value: string, endOfDay: boolean): string {
  const time = endOfDay ? "23:59:59.999" : "00:00:00.000";
  return new Date(`${value}T${time}`).toISOString();
}

export function AuditModule() {
  const { configured } = useAuthContext();

  const [rows, setRows] = useState<AuditRow[]>([]);
  const [actorNames, setActorNames] = useState<Record<string, string>>({});
  const [entityTypes, setEntityTypes] = useState<string[]>([]);
  const [entityType, setEntityType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Consulta base con los filtros actuales. */
  function buildQuery() {
    let query = getSupabase()
      .from("audit_logs")
      .select("id, actor_id, action, entity_type, entity_id, created_at")
      .order("created_at", { ascending: false });
    if (entityType) query = query.eq("entity_type", entityType);
    if (from) query = query.gte("created_at", toIsoBoundary(from, false));
    if (to) query = query.lte("created_at", toIsoBoundary(to, true));
    return query;
  }

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const supabase = getSupabase();
        const [logs, profiles, types] = await Promise.all([
          buildQuery().range(0, PAGE_SIZE - 1),
          supabase.from("profiles").select("id, full_name"),
          supabase.from("audit_logs").select("entity_type").limit(1000),
        ]);
        if (logs.error) throw logs.error;
        if (profiles.error) throw profiles.error;
        if (types.error) throw types.error;

        const names: Record<string, string> = {};
        for (const profile of (profiles.data ?? []) as ProfileName[]) {
          names[profile.id] = profile.full_name ?? "Sin nombre";
        }

        const distinct = Array.from(
          new Set(
            (types.data ?? []).map(
              (row) => (row as { entity_type: string }).entity_type,
            ),
          ),
        ).sort((a, b) => a.localeCompare(b));

        if (cancelled) return;
        setRows((logs.data ?? []) as AuditRow[]);
        setActorNames(names);
        setEntityTypes(distinct);
        setPage(0);
        setHasMore((logs.data ?? []).length === PAGE_SIZE);
      } catch (loadError) {
        if (!cancelled) setError(messageOf(loadError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
    // buildQuery se reconstruye en cada render con los filtros vigentes.
  }, [configured, entityType, from, to]);

  async function loadMore() {
    const nextPage = page + 1;
    setLoadingMore(true);
    setError(null);
    try {
      const start = nextPage * PAGE_SIZE;
      const { data, error: moreError } = await buildQuery().range(
        start,
        start + PAGE_SIZE - 1,
      );
      if (moreError) throw moreError;

      const newRows = (data ?? []) as AuditRow[];
      setRows((previous) => [...previous, ...newRows]);
      setPage(nextPage);
      setHasMore(newRows.length === PAGE_SIZE);
    } catch (moreError) {
      setError(messageOf(moreError));
    } finally {
      setLoadingMore(false);
    }
  }

  if (!configured) {
    return (
      <div className="admin-info">
        Supabase no configurado. Definí <code>VITE_SUPABASE_URL</code> y{" "}
        <code>VITE_SUPABASE_ANON_KEY</code> para habilitar la auditoría.
      </div>
    );
  }

  return (
    <>
      {error && <div className="admin-error">{error}</div>}

      <div className="admin-card">
        <div className="admin-card-head">
          <div>
            <h2 className="admin-card-title">Registro de auditoría</h2>
            <p className="admin-card-sub">
              Sólo lectura: el registro se escribe de forma automática y no se
              puede editar ni borrar, ni siquiera desde el panel.
            </p>
          </div>
        </div>

        <div className="admin-filters">
          <div className="filter-field">
            <label htmlFor="audit-entity">Tipo de entidad</label>
            <select
              id="audit-entity"
              className="admin-select narrow"
              value={entityType}
              onChange={(event) => setEntityType(event.target.value)}
            >
              <option value="">Todas</option>
              {entityTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="audit-from">Desde</label>
            <input
              id="audit-from"
              type="date"
              className="admin-input narrow"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>
          <div className="filter-field">
            <label htmlFor="audit-to">Hasta</label>
            <input
              id="audit-to"
              type="date"
              className="admin-input narrow"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
        </div>

        <div className="admin-card-body flush">
          {loading ? (
            <div className="admin-empty">Cargando el registro…</div>
          ) : rows.length === 0 ? (
            <div className="admin-empty">
              <strong>No hay movimientos para mostrar</strong>
              Ajustá los filtros o esperá a que se registren operaciones del
              estudio.
            </div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Acción</th>
                    <th>Entidad</th>
                    <th>Identificador</th>
                    <th>Autor</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className="cell-muted">
                        {dateTimeFormat.format(new Date(row.created_at))}
                      </td>
                      <td className="cell-strong">{row.action}</td>
                      <td>{row.entity_type}</td>
                      <td className="cell-muted">
                        {row.entity_id ? row.entity_id.slice(0, 8) : "—"}
                      </td>
                      <td>
                        {row.actor_id
                          ? (actorNames[row.actor_id] ?? "Usuario eliminado")
                          : "Sistema"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {!loading && rows.length > 0 && (
          <div className="admin-card-body">
            <div className="admin-row">
              <button
                type="button"
                className="admin-button admin-button-ghost"
                onClick={() => void loadMore()}
                disabled={loadingMore || loading || !hasMore}
              >
                {loadingMore
                  ? "Cargando…"
                  : hasMore
                    ? "Cargar más registros"
                    : "No hay más registros"}
              </button>
              <span className="cell-muted">
                Mostrando {rows.length} movimientos.
              </span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
