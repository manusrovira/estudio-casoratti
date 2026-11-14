import { useEffect, useState } from "react";
import { useAuthContext } from "@/contexts/AuthContext";
import { getSupabase } from "@/lib/supabase";
import { CONSULTATION_STATUS_LABELS, type ConsultationStatus } from "@/lib/rbac";

/**
 * Dashboard del panel de administración.
 *
 * Sólo lectura: cuenta y muestra el estado del estudio. Los filtros y la
 * seguridad viven en Postgres (RLS); el frontend sólo adapta la interfaz.
 */

const dateTimeFormat = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short",
  timeStyle: "short",
});
const numberFormat = new Intl.NumberFormat("es-AR");

/** Consultas que todavía no están cerradas ni rechazadas. */
const OPEN_CONSULTATION_STATUSES = [
  "nueva",
  "pendiente",
  "en_analisis",
  "en_seguimiento",
  "respondida",
] as const;

/** Expedientes que no están archivados ni cerrados. */
const OPEN_CASE_STATUSES = [
  "inicial",
  "en_tramitacion",
  "suspendido",
] as const;

type Stats = {
  consultations: number;
  newConsultations: number;
  openConsultations: number;
  clients: number;
  activeClients: number;
  openCases: number;
  users: number;
  unread: number;
};

const EMPTY_STATS: Stats = {
  consultations: 0,
  newConsultations: 0,
  openConsultations: 0,
  clients: 0,
  activeClients: 0,
  openCases: 0,
  users: 0,
  unread: 0,
};

type RecentConsultation = {
  id: string;
  reference_code: string;
  full_name: string;
  subject: string;
  status: ConsultationStatus;
  received_at: string;
};

type ActivityEntry = {
  id: string;
  actorName: string;
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
    : "No pudimos cargar los datos del panel.";
}

export function DashboardModule() {
  const { user, configured } = useAuthContext();

  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);

  const [consultations, setConsultations] = useState<RecentConsultation[]>(
    [],
  );
  const [consultationsLoading, setConsultationsLoading] = useState(true);
  const [consultationsError, setConsultationsError] = useState<string | null>(
    null,
  );

  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState<string | null>(null);

  // --- Cifras del estudio (todas en paralelo) ------------------------------
  useEffect(() => {
    if (!configured) return;
    let cancelled = false;

    async function load() {
      setStatsLoading(true);
      setStatsError(null);
      try {
        const supabase = getSupabase();
        const unreadQuery = user
          ? supabase
              .from("notifications")
              .select("*", { count: "exact", head: true })
              .eq("user_id", user.id)
              .is("read_at", null)
              .then((result) => ({
                count: result.count ?? 0,
                error: result.error?.message ?? null,
              }))
          : Promise.resolve({ count: 0, error: null as string | null });

        const [
          total,
          fresh,
          open,
          clients,
          activeClients,
          openCases,
          users,
          unread,
        ] = await Promise.all([
          supabase
            .from("legal_consultations")
            .select("*", { count: "exact", head: true }),
          supabase
            .from("legal_consultations")
            .select("*", { count: "exact", head: true })
            .eq("is_new", true),
          supabase
            .from("legal_consultations")
            .select("*", { count: "exact", head: true })
            .in("status", [...OPEN_CONSULTATION_STATUSES]),
          supabase.from("clients").select("*", { count: "exact", head: true }),
          supabase
            .from("clients")
            .select("*", { count: "exact", head: true })
            .eq("status", "activo"),
          supabase
            .from("legal_cases")
            .select("*", { count: "exact", head: true })
            .in("status", [...OPEN_CASE_STATUSES]),
          supabase.from("profiles").select("*", { count: "exact", head: true }),
          unreadQuery,
        ]);

        const failureMessage =
          total.error?.message ??
          fresh.error?.message ??
          open.error?.message ??
          clients.error?.message ??
          activeClients.error?.message ??
          openCases.error?.message ??
          users.error?.message ??
          unread.error;
        if (failureMessage) throw new Error(failureMessage);

        if (cancelled) return;
        setStats({
          consultations: total.count ?? 0,
          newConsultations: fresh.count ?? 0,
          openConsultations: open.count ?? 0,
          clients: clients.count ?? 0,
          activeClients: activeClients.count ?? 0,
          openCases: openCases.count ?? 0,
          users: users.count ?? 0,
          unread: unread.count ?? 0,
        });
      } catch (error) {
        if (!cancelled) setStatsError(messageOf(error));
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [configured, user?.id]);

  // --- Consultas recientes ---------------------------------------------------
  useEffect(() => {
    if (!configured) return;
    let cancelled = false;

    async function load() {
      setConsultationsLoading(true);
      setConsultationsError(null);
      try {
        const { data, error } = await getSupabase()
          .from("legal_consultations")
          .select("id, reference_code, full_name, subject, status, received_at")
          .order("received_at", { ascending: false })
          .limit(8);
        if (error) throw error;
        if (!cancelled) {
          setConsultations((data ?? []) as RecentConsultation[]);
        }
      } catch (error) {
        if (!cancelled) setConsultationsError(messageOf(error));
      } finally {
        if (!cancelled) setConsultationsLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [configured]);

  // --- Actividad reciente (auditoría + nombre del actor) ---------------------
  useEffect(() => {
    if (!configured) return;
    let cancelled = false;

    async function load() {
      setActivityLoading(true);
      setActivityError(null);
      try {
        const supabase = getSupabase();
        const [logs, profiles] = await Promise.all([
          supabase
            .from("audit_logs")
            .select("id, actor_id, action, entity_type, entity_id, created_at")
            .order("created_at", { ascending: false })
            .limit(8),
          supabase.from("profiles").select("id, full_name"),
        ]);
        if (logs.error) throw logs.error;
        if (profiles.error) throw profiles.error;

        const names = new Map<string, string>();
        for (const profile of (profiles.data ?? []) as ProfileName[]) {
          names.set(profile.id, profile.full_name ?? "Sin nombre");
        }

        if (cancelled) return;
        setActivity(
          ((logs.data ?? []) as Array<{
            id: string;
            actor_id: string | null;
            action: string;
            entity_type: string;
            entity_id: string | null;
            created_at: string;
          }>).map((entry) => ({
            id: entry.id,
            actorName: entry.actor_id
              ? (names.get(entry.actor_id) ?? "Usuario eliminado")
              : "Sistema",
            action: entry.action,
            entity_type: entry.entity_type,
            entity_id: entry.entity_id,
            created_at: entry.created_at,
          })),
        );
      } catch (error) {
        if (!cancelled) setActivityError(messageOf(error));
      } finally {
        if (!cancelled) setActivityLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [configured]);

  if (!configured) {
    return (
      <div className="admin-info">
        Supabase no configurado. Definí <code>VITE_SUPABASE_URL</code> y{" "}
        <code>VITE_SUPABASE_ANON_KEY</code> para habilitar los datos del panel.
      </div>
    );
  }

  const kpis: Array<{
    key: keyof Stats;
    label: string;
    hint: string;
    accent?: boolean;
  }> = [
    {
      key: "consultations",
      label: "Consultaciones",
      hint: "Recibidas desde el sitio público",
    },
    {
      key: "newConsultations",
      label: "Consultas nuevas",
      hint: "Sin revisar por el estudio",
      accent: true,
    },
    {
      key: "openConsultations",
      label: "Consultas abiertas",
      hint: "Todavía en curso",
    },
    {
      key: "clients",
      label: "Clientes",
      hint: "Fichas del estudio",
    },
    {
      key: "activeClients",
      label: "Clientes activos",
      hint: "Con relación vigente",
    },
    {
      key: "openCases",
      label: "Expedientes abiertos",
      hint: "Sin archivar ni cerrar",
    },
    {
      key: "users",
      label: "Usuarios",
      hint: "Cuentas registradas en la plataforma",
    },
    {
      key: "unread",
      label: "Notificaciones",
      hint: "Sin leer en tu sesión",
    },
  ];

  return (
    <>
      {statsError && <div className="admin-error">{statsError}</div>}

      <div className="stat-grid">
        {kpis.map((kpi) => (
          <div className="stat-card" key={kpi.key}>
            <span className="stat-label">{kpi.label}</span>
            <span
              className={kpi.accent ? "stat-value stat-accent" : "stat-value"}
            >
              {statsLoading ? "—" : numberFormat.format(stats[kpi.key])}
            </span>
            <span className="stat-hint">{kpi.hint}</span>
          </div>
        ))}
      </div>

      <div className="admin-grid-2">
        <div className="admin-card">
          <div className="admin-card-head">
            <div>
              <h2 className="admin-card-title">Consultas recientes</h2>
              <p className="admin-card-sub">Las últimas recibidas.</p>
            </div>
          </div>
          <div className="admin-card-body flush">
            {consultationsLoading ? (
              <div className="admin-empty">Cargando consultas…</div>
            ) : consultationsError ? (
              <div className="admin-error">{consultationsError}</div>
            ) : consultations.length === 0 ? (
              <div className="admin-empty">
                <strong>Todavía no hay consultas</strong>
                Cuando alguien escriba desde el formulario del sitio, aparecerá
                acá.
              </div>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Consulta</th>
                      <th>Estado</th>
                      <th>Recibida</th>
                    </tr>
                  </thead>
                  <tbody>
                    {consultations.map((consultation) => (
                      <tr key={consultation.id}>
                        <td className="cell-strong">
                          {consultation.reference_code}
                        </td>
                        <td>
                          <div className="cell-strong">
                            {consultation.full_name}
                          </div>
                          <div className="cell-muted">
                            {consultation.subject}
                          </div>
                        </td>
                        <td>
                          <span
                            className={`badge badge-${consultation.status}`}
                          >
                            {CONSULTATION_STATUS_LABELS[consultation.status]}
                          </span>
                        </td>
                        <td className="cell-muted">
                          {dateTimeFormat.format(
                            new Date(consultation.received_at),
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="admin-card">
          <div className="admin-card-head">
            <div>
              <h2 className="admin-card-title">Actividad reciente</h2>
              <p className="admin-card-sub">
                Últimas operaciones registradas por el estudio.
              </p>
            </div>
          </div>
          <div className="admin-card-body flush">
            {activityLoading ? (
              <div className="admin-empty">Cargando actividad…</div>
            ) : activityError ? (
              <div className="admin-error">{activityError}</div>
            ) : activity.length === 0 ? (
              <div className="admin-empty">
                <strong>Sin movimientos registrados</strong>
                La auditoría se completa sola a medida que se trabaja en el
                panel.
              </div>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Acción</th>
                      <th>Entidad</th>
                      <th>Autor</th>
                      <th>Fecha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activity.map((entry) => (
                      <tr key={entry.id}>
                        <td className="cell-strong">{entry.action}</td>
                        <td className="cell-muted">{entry.entity_type}</td>
                        <td>{entry.actorName}</td>
                        <td className="cell-muted">
                          {dateTimeFormat.format(new Date(entry.created_at))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
