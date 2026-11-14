import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useAuthContext } from "@/contexts/AuthContext";
import { getSupabase } from "@/lib/supabase";
import { APP_ROLES, ROLE_LABELS, type AppRole } from "@/lib/rbac";

/**
 * Gestión de usuarios y roles.
 *
 * `auth.users` no es legible desde el navegador: los datos salen de
 * `profiles` y `user_roles`, que se cruzan en memoria por `user_id`.
 *
 * Regla dura: un administrador nunca cambia su propio rol. Ni el frontend ni
 * Postgres lo permiten, pero acá se rechaza explícitamente para que quede
 * claro en la interfaz.
 */

const dateFormat = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short",
  timeStyle: "short",
});

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  created_at: string;
};

type RoleRow = {
  user_id: string;
  role: AppRole;
};

type ClientLink = {
  id: string;
  user_id: string | null;
  full_name: string;
};

type UserRow = {
  id: string;
  fullName: string | null;
  email: string | null;
  createdAt: string;
  role: AppRole | null;
  clientId: string | null;
  clientName: string | null;
};

type Notice = {
  kind: "ok" | "error";
  text: string;
};

function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "No pudimos completar la operación.";
}

export function UsersModule() {
  const { user, configured } = useAuthContext();
  const currentUserId = user?.id ?? null;

  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const supabase = getSupabase();
        const [profiles, roles, clients] = await Promise.all([
          supabase
            .from("profiles")
            .select("id, full_name, email, created_at")
            .order("created_at", { ascending: false }),
          supabase.from("user_roles").select("user_id, role"),
          supabase.from("clients").select("id, user_id, full_name"),
        ]);
        if (profiles.error) throw profiles.error;
        if (roles.error) throw roles.error;
        if (clients.error) throw clients.error;

        const roleByUser = new Map<string, AppRole>();
        for (const row of (roles.data ?? []) as RoleRow[]) {
          roleByUser.set(row.user_id, row.role);
        }

        const clientByUser = new Map<string, ClientLink>();
        for (const client of (clients.data ?? []) as ClientLink[]) {
          if (client.user_id) clientByUser.set(client.user_id, client);
        }

        const merged = ((profiles.data ?? []) as ProfileRow[]).map(
          (profile): UserRow => {
            const linkedClient = clientByUser.get(profile.id);
            return {
              id: profile.id,
              fullName: profile.full_name,
              email: profile.email,
              createdAt: profile.created_at,
              role: roleByUser.get(profile.id) ?? null,
              clientId: linkedClient?.id ?? null,
              clientName: linkedClient?.full_name ?? null,
            };
          },
        );

        if (cancelled) return;
        setRows(
          merged.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        );
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
  }, [configured]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) =>
      (row.fullName ?? "").toLowerCase().includes(query) ||
      (row.email ?? "").toLowerCase().includes(query),
    );
  }, [rows, search]);

  async function changeRole(targetId: string, nextRole: AppRole) {
    if (!currentUserId) return;
    if (targetId === currentUserId) {
      setNotice({
        kind: "error",
        text: "No podés cambiar tu propio rol. Otro administrador tiene que hacerlo por vos.",
      });
      return;
    }

    setSavingId(targetId);
    setNotice(null);
    try {
      const supabase = getSupabase();
      const hasRole = rows.some(
        (row) => row.id === targetId && row.role !== null,
      );

      if (hasRole) {
        const { error: updateError } = await supabase
          .from("user_roles")
          .update({ role: nextRole, granted_by: currentUserId })
          .eq("user_id", targetId);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from("user_roles")
          .insert({
            user_id: targetId,
            role: nextRole,
            granted_by: currentUserId,
          });
        if (insertError) throw insertError;
      }

      setRows((previous) =>
        previous.map((row) =>
          row.id === targetId ? { ...row, role: nextRole } : row,
        ),
      );
      setNotice({
        kind: "ok",
        text: `Rol actualizado: ${ROLE_LABELS[nextRole]}.`,
      });
    } catch (updateError) {
      setNotice({ kind: "error", text: messageOf(updateError) });
    } finally {
      setSavingId(null);
    }
  }

  if (!configured) {
    return (
      <div className="admin-info">
        Supabase no configurado. Definí <code>VITE_SUPABASE_URL</code> y{" "}
        <code>VITE_SUPABASE_ANON_KEY</code> para habilitar la gestión de
        usuarios.
      </div>
    );
  }

  return (
    <>
      {error && <div className="admin-error">{error}</div>}
      {notice?.kind === "ok" && <div className="admin-ok">{notice.text}</div>}
      {notice?.kind === "error" && (
        <div className="admin-error">{notice.text}</div>
      )}

      <div className="admin-card">
        <div className="admin-card-head">
          <div>
            <h2 className="admin-card-title">Usuarios de la plataforma</h2>
            <p className="admin-card-sub">
              {rows.length} cuentas registradas. El rol se concede desde acá y
              queda asentado en la auditoría.
            </p>
          </div>
        </div>

        <div className="admin-filters">
          <div className="filter-field">
            <label htmlFor="users-search">Buscar por nombre</label>
            <input
              id="users-search"
              className="admin-input"
              placeholder="Nombre y apellido"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>

        <div className="admin-card-body flush">
          {loading ? (
            <div className="admin-empty">Cargando usuarios…</div>
          ) : filtered.length === 0 ? (
            <div className="admin-empty">
              <strong>
                {rows.length === 0
                  ? "No hay usuarios registrados"
                  : "Ningún usuario coincide con la búsqueda"}
              </strong>
              {rows.length === 0
                ? "Las cuentas se crean desde el sitio público o desde el acceso de clientes."
                : "Probá con otro nombre o quitá el filtro."}
            </div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Usuario</th>
                    <th>Correo</th>
                    <th>Identificador</th>
                    <th>Rol</th>
                    <th>Ficha de cliente</th>
                    <th>Alta</th>
                    <th>Gestión</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => {
                    const isSelf = row.id === currentUserId;
                    return (
                      <tr key={row.id}>
                        <td className="cell-strong">
                          {row.fullName ?? "Sin nombre"}
                        </td>
                        <td className="cell-muted">{row.email ?? "—"}</td>
                        <td className="cell-muted">
                          {row.id.slice(0, 8)}
                        </td>
                        <td>
                          {row.role ? (
                            <span className={`badge badge-${row.role}`}>
                              {ROLE_LABELS[row.role]}
                            </span>
                          ) : (
                            <span className="cell-muted">Sin rol asignado</span>
                          )}
                        </td>
                        <td>
                          {row.clientId ? (
                            <Link
                              href="/panel/clientes"
                              style={{ color: "var(--copper)" }}
                            >
                              Ver ficha de cliente
                            </Link>
                          ) : (
                            <span className="cell-muted">Sin ficha</span>
                          )}
                        </td>
                        <td className="cell-muted">
                          {dateFormat.format(new Date(row.createdAt))}
                        </td>
                        <td>
                          <div className="cell-actions">
                            <select
                              className="admin-select narrow"
                              aria-label={`Rol de ${row.fullName ?? row.id.slice(0, 8)}`}
                              value={row.role ?? "usuario"}
                              disabled={savingId === row.id}
                              onChange={(event) =>
                                void changeRole(
                                  row.id,
                                  event.target.value as AppRole,
                                )
                              }
                            >
                              {APP_ROLES.map((role) => (
                                <option key={role} value={role}>
                                  {ROLE_LABELS[role]}
                                </option>
                              ))}
                            </select>
                          </div>
                          {isSelf && (
                            <span className="cell-muted">
                              Tu cuenta: no podés cambiar tu propio rol.
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
