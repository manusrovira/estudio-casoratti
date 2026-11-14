import { useEffect, useState } from "react";
import { useAuthContext } from "@/contexts/AuthContext";
import { getSupabase } from "@/lib/supabase";
import type { ConsultationCategory, Lawyer } from "@/lib/rbac";

/**
 * Configuración del panel: áreas jurídicas y equipo profesional.
 *
 * Todo lo que se borra pasa por una confirmación explícita. Un abogado del
 * equipo que tenga clientes o consultas asignadas no se elimina: se desactiva,
 * para no dejar expedientes históricos sin responsable.
 */

type Notice = {
  kind: "ok" | "error";
  text: string;
};

type CategoryForm = {
  name: string;
  slug: string;
  description: string;
  sortOrder: string;
};

type LawyerForm = {
  fullName: string;
  licenseNumber: string;
  email: string;
  specialties: string;
  bio: string;
  isActive: boolean;
};

type LawyerRow = Lawyer & {
  clientCount: number;
  consultationCount: number;
};

const EMPTY_CATEGORY_FORM: CategoryForm = {
  name: "",
  slug: "",
  description: "",
  sortOrder: "0",
};

const EMPTY_LAWYER_FORM: LawyerForm = {
  fullName: "",
  licenseNumber: "",
  email: "",
  specialties: "",
  bio: "",
  isActive: true,
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "No pudimos guardar los datos.";
}

/** Convierte un nombre en un slug estilo URL: sin tildes, en minúsculas. */
function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Convierte "Civil, Societario" en el array text[] que espera Postgres. */
function parseSpecialties(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function SettingsModule() {
  const { configured } = useAuthContext();

  const [categories, setCategories] = useState<ConsultationCategory[]>([]);
  const [categoryForm, setCategoryForm] =
    useState<CategoryForm>(EMPTY_CATEGORY_FORM);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(
    null,
  );
  const [categoryBusy, setCategoryBusy] = useState(false);

  const [lawyers, setLawyers] = useState<LawyerRow[]>([]);
  const [lawyerForm, setLawyerForm] = useState<LawyerForm>(EMPTY_LAWYER_FORM);
  const [editingLawyerId, setEditingLawyerId] = useState<string | null>(null);
  const [lawyerBusy, setLawyerBusy] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const supabase = getSupabase();
        const [categoriesResult, lawyersResult, clientsResult, consultationsResult] =
          await Promise.all([
            supabase
              .from("consultation_categories")
              .select("*")
              .order("sort_order", { ascending: true }),
            supabase.from("lawyers").select("*").order("full_name"),
            supabase.from("clients").select("id, assigned_lawyer_id"),
            supabase
              .from("legal_consultations")
              .select("id, assigned_lawyer_id"),
          ]);
        if (categoriesResult.error) throw categoriesResult.error;
        if (lawyersResult.error) throw lawyersResult.error;
        if (clientsResult.error) throw clientsResult.error;
        if (consultationsResult.error) throw consultationsResult.error;

        const clientCounts = new Map<string, number>();
        for (const client of (clientsResult.data ?? []) as Array<{
          id: string;
          assigned_lawyer_id: string | null;
        }>) {
          if (!client.assigned_lawyer_id) continue;
          clientCounts.set(
            client.assigned_lawyer_id,
            (clientCounts.get(client.assigned_lawyer_id) ?? 0) + 1,
          );
        }

        const consultationCounts = new Map<string, number>();
        for (const consultation of (consultationsResult.data ??
          []) as Array<{ id: string; assigned_lawyer_id: string | null }>) {
          if (!consultation.assigned_lawyer_id) continue;
          consultationCounts.set(
            consultation.assigned_lawyer_id,
            (consultationCounts.get(consultation.assigned_lawyer_id) ?? 0) + 1,
          );
        }

        if (cancelled) return;
        setCategories(
          (categoriesResult.data ?? []) as ConsultationCategory[],
        );
        setLawyers(
          ((lawyersResult.data ?? []) as Lawyer[]).map((lawyer) => ({
            ...lawyer,
            clientCount: clientCounts.get(lawyer.id) ?? 0,
            consultationCount: consultationCounts.get(lawyer.id) ?? 0,
          })),
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

  // --- Áreas jurídicas ------------------------------------------------------

  async function saveCategory(event: React.FormEvent) {
    event.preventDefault();
    const name = categoryForm.name.trim();
    if (!name) {
      setNotice({ kind: "error", text: "Escribí el nombre del área jurídica." });
      return;
    }
    const slug = categoryForm.slug.trim() || slugify(name);
    const sortOrder = Number.parseInt(categoryForm.sortOrder, 10) || 0;
    const description = categoryForm.description.trim() || null;

    setCategoryBusy(true);
    setNotice(null);
    try {
      const supabase = getSupabase();
      if (editingCategoryId) {
        const { error: updateError } = await supabase
          .from("consultation_categories")
          .update({ name, slug, description, sort_order: sortOrder })
          .eq("id", editingCategoryId);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from("consultation_categories")
          .insert({
            name,
            slug,
            description,
            sort_order: sortOrder,
            is_active: true,
          });
        if (insertError) throw insertError;
      }

      const { data, error: reloadError } = await supabase
        .from("consultation_categories")
        .select("*")
        .order("sort_order", { ascending: true });
      if (reloadError) throw reloadError;
      setCategories((data ?? []) as ConsultationCategory[]);
      setCategoryForm(EMPTY_CATEGORY_FORM);
      setEditingCategoryId(null);
      setNotice({
        kind: "ok",
        text: editingCategoryId
          ? "Área jurídica actualizada."
          : "Área jurídica creada.",
      });
    } catch (saveError) {
      setNotice({ kind: "error", text: messageOf(saveError) });
    } finally {
      setCategoryBusy(false);
    }
  }

  async function toggleCategory(category: ConsultationCategory) {
    setNotice(null);
    try {
      const { error: toggleError } = await getSupabase()
        .from("consultation_categories")
        .update({ is_active: !category.is_active })
        .eq("id", category.id);
      if (toggleError) throw toggleError;
      setCategories((previous) =>
        previous.map((item) =>
          item.id === category.id
            ? { ...item, is_active: !item.is_active }
            : item,
        ),
      );
      setNotice({
        kind: "ok",
        text: category.is_active
          ? `El área "${category.name}" quedó desactivada.`
          : `El área "${category.name}" quedó activa.`,
      });
    } catch (toggleError) {
      setNotice({ kind: "error", text: messageOf(toggleError) });
    }
  }

  async function deleteCategory(category: ConsultationCategory) {
    const confirmed = window.confirm(
      `¿Eliminar el área "${category.name}"? Las consultas ya cargadas con esta área quedan sin clasificar.`,
    );
    if (!confirmed) return;

    setNotice(null);
    try {
      const { error: deleteError } = await getSupabase()
        .from("consultation_categories")
        .delete()
        .eq("id", category.id);
      if (deleteError) throw deleteError;
      setCategories((previous) =>
        previous.filter((item) => item.id !== category.id),
      );
      setNotice({
        kind: "ok",
        text: `El área "${category.name}" se eliminó.`,
      });
    } catch (deleteError) {
      setNotice({ kind: "error", text: messageOf(deleteError) });
    }
  }

  function startEditingCategory(category: ConsultationCategory) {
    setEditingCategoryId(category.id);
    setCategoryForm({
      name: category.name,
      slug: category.slug,
      description: category.description ?? "",
      sortOrder: String(category.sort_order),
    });
    setNotice(null);
  }

  // --- Equipo profesional ----------------------------------------------------

  async function saveLawyer(event: React.FormEvent) {
    event.preventDefault();
    const fullName = lawyerForm.fullName.trim();
    if (!fullName) {
      setNotice({
        kind: "error",
        text: "Escribí el nombre del profesional.",
      });
      return;
    }

    const payload = {
      full_name: fullName,
      license_number: lawyerForm.licenseNumber.trim() || null,
      email: lawyerForm.email.trim() || null,
      specialties: parseSpecialties(lawyerForm.specialties),
      bio: lawyerForm.bio.trim() || null,
      is_active: lawyerForm.isActive,
    };

    setLawyerBusy(true);
    setNotice(null);
    try {
      const supabase = getSupabase();
      if (editingLawyerId) {
        const { error: updateError } = await supabase
          .from("lawyers")
          .update(payload)
          .eq("id", editingLawyerId);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from("lawyers")
          .insert(payload);
        if (insertError) throw insertError;
      }

      const { data, error: reloadError } = await supabase
        .from("lawyers")
        .select("*")
        .order("full_name");
      if (reloadError) throw reloadError;
      // Los contadores de carga se conservan: no cambian con esta operación.
      const previous = new Map(lawyers.map((lawyer) => [lawyer.id, lawyer]));
      setLawyers(
        ((data ?? []) as Lawyer[]).map((lawyer) => ({
          ...lawyer,
          clientCount: previous.get(lawyer.id)?.clientCount ?? 0,
          consultationCount: previous.get(lawyer.id)?.consultationCount ?? 0,
        })),
      );
      setLawyerForm(EMPTY_LAWYER_FORM);
      setEditingLawyerId(null);
      setNotice({
        kind: "ok",
        text: editingLawyerId
          ? "Los datos del profesional quedaron actualizados."
          : "El profesional se agregó al equipo.",
      });
    } catch (saveError) {
      setNotice({ kind: "error", text: messageOf(saveError) });
    } finally {
      setLawyerBusy(false);
    }
  }

  async function toggleLawyer(lawyer: LawyerRow) {
    setNotice(null);
    try {
      const { error: toggleError } = await getSupabase()
        .from("lawyers")
        .update({ is_active: !lawyer.is_active })
        .eq("id", lawyer.id);
      if (toggleError) throw toggleError;
      setLawyers((previous) =>
        previous.map((item) =>
          item.id === lawyer.id
            ? { ...item, is_active: !item.is_active }
            : item,
        ),
      );
      setNotice({
        kind: "ok",
        text: lawyer.is_active
          ? `${lawyer.full_name} quedó desactivado.`
          : `${lawyer.full_name} vuelve a estar activo.`,
      });
    } catch (toggleError) {
      setNotice({ kind: "error", text: messageOf(toggleError) });
    }
  }

  async function deleteLawyer(lawyer: LawyerRow) {
    if (lawyer.clientCount > 0 || lawyer.consultationCount > 0) {
      setNotice({
        kind: "error",
        text: `${lawyer.full_name} tiene ${lawyer.clientCount} cliente(s) y ${lawyer.consultationCount} consulta(s) asignadas. No se puede eliminar: desactivá el profesional para que no reciba trabajo nuevo sin perder el historial.`,
      });
      return;
    }

    const confirmed = window.confirm(
      `¿Eliminar a ${lawyer.full_name} del equipo? Esta acción no se puede deshacer.`,
    );
    if (!confirmed) return;

    setNotice(null);
    try {
      const { error: deleteError } = await getSupabase()
        .from("lawyers")
        .delete()
        .eq("id", lawyer.id);
      if (deleteError) throw deleteError;
      setLawyers((previous) =>
        previous.filter((item) => item.id !== lawyer.id),
      );
      setNotice({
        kind: "ok",
        text: `${lawyer.full_name} se eliminó del equipo.`,
      });
    } catch (deleteError) {
      setNotice({ kind: "error", text: messageOf(deleteError) });
    }
  }

  function startEditingLawyer(lawyer: LawyerRow) {
    setEditingLawyerId(lawyer.id);
    setLawyerForm({
      fullName: lawyer.full_name,
      licenseNumber: lawyer.license_number ?? "",
      email: lawyer.email ?? "",
      specialties: lawyer.specialties.join(", "),
      bio: lawyer.bio ?? "",
      isActive: lawyer.is_active,
    });
    setNotice(null);
  }

  if (!configured) {
    return (
      <div className="admin-info">
        Supabase no configurado. Definí <code>VITE_SUPABASE_URL</code> y{" "}
        <code>VITE_SUPABASE_ANON_KEY</code> para habilitar la configuración.
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
            <h2 className="admin-card-title">Áreas jurídicas</h2>
            <p className="admin-card-sub">
              Las áreas que ofrece el estudio. Sólo las activas se muestran en
              el formulario público.
            </p>
          </div>
        </div>

        <div className="admin-card-body">
          <form onSubmit={saveCategory}>
            <div className="admin-grid-2">
              <div className="filter-field">
                <label htmlFor="category-name">Nombre</label>
                <input
                  id="category-name"
                  className="admin-input"
                  placeholder="Derecho civil"
                  value={categoryForm.name}
                  onChange={(event) =>
                    setCategoryForm((previous) => ({
                      ...previous,
                      name: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="filter-field">
                <label htmlFor="category-slug">Slug</label>
                <input
                  id="category-slug"
                  className="admin-input"
                  placeholder="derecho-civil"
                  value={categoryForm.slug}
                  onChange={(event) =>
                    setCategoryForm((previous) => ({
                      ...previous,
                      slug: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <div className="admin-grid-2" style={{ marginTop: ".9rem" }}>
              <div className="filter-field">
                <label htmlFor="category-description">Descripción</label>
                <textarea
                  id="category-description"
                  className="admin-textarea"
                  placeholder="Una línea de contexto para el equipo."
                  value={categoryForm.description}
                  onChange={(event) =>
                    setCategoryForm((previous) => ({
                      ...previous,
                      description: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="filter-field">
                <label htmlFor="category-order">Orden</label>
                <input
                  id="category-order"
                  className="admin-input narrow"
                  type="number"
                  min={0}
                  value={categoryForm.sortOrder}
                  onChange={(event) =>
                    setCategoryForm((previous) => ({
                      ...previous,
                      sortOrder: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <div className="admin-row" style={{ marginTop: "1.1rem" }}>
              <button
                type="submit"
                className="admin-button admin-button-copper"
                disabled={categoryBusy}
              >
                {categoryBusy
                  ? "Guardando…"
                  : editingCategoryId
                    ? "Guardar cambios"
                    : "Agregar área"}
              </button>
              {editingCategoryId && (
                <button
                  type="button"
                  className="admin-button admin-button-ghost"
                  onClick={() => {
                    setEditingCategoryId(null);
                    setCategoryForm(EMPTY_CATEGORY_FORM);
                  }}
                >
                  Cancelar
                </button>
              )}
              <span className="cell-muted">
                Si el slug queda vacío, se arma a partir del nombre.
              </span>
            </div>
          </form>
        </div>

        <div className="admin-card-body flush">
          {loading ? (
            <div className="admin-empty">Cargando áreas…</div>
          ) : categories.length === 0 ? (
            <div className="admin-empty">
              <strong>No hay áreas cargadas</strong>
              Agregá la primera para que aparezca en el formulario público.
            </div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Área</th>
                    <th>Slug</th>
                    <th>Orden</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((category) => (
                    <tr key={category.id}>
                      <td className="cell-strong">{category.name}</td>
                      <td className="cell-muted">{category.slug}</td>
                      <td className="cell-muted">{category.sort_order}</td>
                      <td>
                        <span
                          className={
                            category.is_active
                              ? "badge badge-activo"
                              : "badge badge-inactivo"
                          }
                        >
                          {category.is_active ? "Activa" : "Inactiva"}
                        </span>
                      </td>
                      <td>
                        <div className="cell-actions">
                          <button
                            type="button"
                            className="admin-button admin-button-small admin-button-ghost"
                            onClick={() => void toggleCategory(category)}
                          >
                            {category.is_active ? "Desactivar" : "Activar"}
                          </button>
                          <button
                            type="button"
                            className="admin-button admin-button-small"
                            onClick={() => startEditingCategory(category)}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            className="admin-button admin-button-small admin-button-danger"
                            onClick={() => void deleteCategory(category)}
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
          )}
        </div>
      </div>

      <div className="admin-card">
        <div className="admin-card-head">
          <div>
            <h2 className="admin-card-title">Equipo profesional</h2>
            <p className="admin-card-sub">
              Los abogados del estudio. Un profesional con clientes o consultas
              asignadas se desactiva, no se elimina.
            </p>
          </div>
        </div>

        <div className="admin-card-body">
          <form onSubmit={saveLawyer}>
            <div className="admin-grid-2">
              <div className="filter-field">
                <label htmlFor="lawyer-name">Nombre y apellido</label>
                <input
                  id="lawyer-name"
                  className="admin-input"
                  placeholder="Dra. María Casoratti"
                  value={lawyerForm.fullName}
                  onChange={(event) =>
                    setLawyerForm((previous) => ({
                      ...previous,
                      fullName: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="filter-field">
                <label htmlFor="lawyer-license">Matrícula</label>
                <input
                  id="lawyer-license"
                  className="admin-input"
                  placeholder="F#/A-1234"
                  value={lawyerForm.licenseNumber}
                  onChange={(event) =>
                    setLawyerForm((previous) => ({
                      ...previous,
                      licenseNumber: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <div className="admin-grid-2" style={{ marginTop: ".9rem" }}>
              <div className="filter-field">
                <label htmlFor="lawyer-email">Correo</label>
                <input
                  id="lawyer-email"
                  type="email"
                  className="admin-input"
                  placeholder="estudio@casoratti.com.ar"
                  value={lawyerForm.email}
                  onChange={(event) =>
                    setLawyerForm((previous) => ({
                      ...previous,
                      email: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="filter-field">
                <label htmlFor="lawyer-specialties">
                  Especialidades (separadas por coma)
                </label>
                <input
                  id="lawyer-specialties"
                  className="admin-input"
                  placeholder="Derecho civil, Societario"
                  value={lawyerForm.specialties}
                  onChange={(event) =>
                    setLawyerForm((previous) => ({
                      ...previous,
                      specialties: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <div className="filter-field" style={{ marginTop: ".9rem" }}>
              <label htmlFor="lawyer-bio">Presentación</label>
              <textarea
                id="lawyer-bio"
                className="admin-textarea"
                placeholder="Algunas líneas sobre la trayectoria profesional."
                value={lawyerForm.bio}
                onChange={(event) =>
                  setLawyerForm((previous) => ({
                    ...previous,
                    bio: event.target.value,
                  }))
                }
              />
            </div>
            <div className="admin-row" style={{ marginTop: "1.1rem" }}>
              <button
                type="submit"
                className="admin-button admin-button-copper"
                disabled={lawyerBusy}
              >
                {lawyerBusy
                  ? "Guardando…"
                  : editingLawyerId
                    ? "Guardar cambios"
                    : "Agregar profesional"}
              </button>
              {editingLawyerId && (
                <button
                  type="button"
                  className="admin-button admin-button-ghost"
                  onClick={() => {
                    setEditingLawyerId(null);
                    setLawyerForm(EMPTY_LAWYER_FORM);
                  }}
                >
                  Cancelar
                </button>
              )}
            </div>
          </form>
        </div>

        <div className="admin-card-body flush">
          {loading ? (
            <div className="admin-empty">Cargando equipo…</div>
          ) : lawyers.length === 0 ? (
            <div className="admin-empty">
              <strong>No hay profesionales cargados</strong>
              Agregá al primer abogado del estudio para poder asignarle
              consultas y expedientes.
            </div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Profesional</th>
                    <th>Matrícula</th>
                    <th>Correo</th>
                    <th>Especialidades</th>
                    <th>Carga actual</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {lawyers.map((lawyer) => (
                    <tr key={lawyer.id}>
                      <td className="cell-strong">{lawyer.full_name}</td>
                      <td className="cell-muted">
                        {lawyer.license_number ?? "—"}
                      </td>
                      <td className="cell-muted">{lawyer.email ?? "—"}</td>
                      <td className="cell-muted">
                        {lawyer.specialties.length > 0
                          ? lawyer.specialties.join(", ")
                          : "—"}
                      </td>
                      <td className="cell-muted">
                        {lawyer.clientCount} cliente(s) ·{" "}
                        {lawyer.consultationCount} consulta(s)
                      </td>
                      <td>
                        <span
                          className={
                            lawyer.is_active
                              ? "badge badge-activo"
                              : "badge badge-inactivo"
                          }
                        >
                          {lawyer.is_active ? "Activo" : "Inactivo"}
                        </span>
                      </td>
                      <td>
                        <div className="cell-actions">
                          <button
                            type="button"
                            className="admin-button admin-button-small admin-button-ghost"
                            onClick={() => void toggleLawyer(lawyer)}
                          >
                            {lawyer.is_active ? "Desactivar" : "Reactivar"}
                          </button>
                          <button
                            type="button"
                            className="admin-button admin-button-small"
                            onClick={() => startEditingLawyer(lawyer)}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            className="admin-button admin-button-small admin-button-danger"
                            onClick={() => void deleteLawyer(lawyer)}
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
          )}
        </div>
      </div>
    </>
  );
}
