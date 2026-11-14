import { describe, expect, it } from "vitest";
import {
  APP_ROLES,
  CASE_STATUSES,
  CASE_STATUS_LABELS,
  CLIENT_STATUSES,
  CLIENT_STATUS_LABELS,
  CONSULTATION_STATUSES,
  CONSULTATION_STATUS_LABELS,
  ROLE_LABELS,
  canAccessAdminPanel,
  canAccessClientArea,
} from "./rbac";

/**
 * Guardas de coherencia entre la base de datos y la interfaz.
 *
 * Los enums de Postgres (app_role, consultation_status, client_status,
 * case_status) y las etiquetas de la UI están en archivos distintos: si uno
 * cambia y el otro no, la interfaz muestra estados vacíos o permite
 * seleccionar un valor que la base rechaza. Estos tests fallan en ese caso.
 */

describe("Roles", () => {
  it("cubre todos los roles de la base de datos", () => {
    expect([...APP_ROLES].sort()).toEqual(["abogado", "admin", "cliente", "usuario"]);
    for (const role of APP_ROLES) {
      expect(ROLE_LABELS[role]).toBeTruthy();
    }
  });

  it("sólo el administrador entra al panel", () => {
    expect(canAccessAdminPanel("admin")).toBe(true);
    expect(canAccessAdminPanel("abogado")).toBe(false);
    expect(canAccessAdminPanel("cliente")).toBe(false);
    expect(canAccessAdminPanel("usuario")).toBe(false);
    expect(canAccessAdminPanel(null)).toBe(false);
  });

  it("el área de cliente la pueden usar clientes y personal del estudio", () => {
    expect(canAccessClientArea("cliente")).toBe(true);
    expect(canAccessClientArea("admin")).toBe(true);
    expect(canAccessClientArea("abogado")).toBe(true);
    expect(canAccessClientArea("usuario")).toBe(false);
    expect(canAccessClientArea(null)).toBe(false);
  });
});

describe("Estados", () => {
  it("cada estado de consulta tiene etiqueta", () => {
    expect(CONSULTATION_STATUSES).toHaveLength(7);
    for (const status of CONSULTATION_STATUSES) {
      expect(CONSULTATION_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it("cada estado de cliente tiene etiqueta", () => {
    for (const status of CLIENT_STATUSES) {
      expect(CLIENT_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it("cada estado de expediente tiene etiqueta", () => {
    for (const status of CASE_STATUSES) {
      expect(CASE_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it("no hay etiquetas huérfanas (un estado que la base no tiene)", () => {
    expect(Object.keys(CONSULTATION_STATUS_LABELS).sort()).toEqual([...CONSULTATION_STATUSES].sort());
    expect(Object.keys(CLIENT_STATUS_LABELS).sort()).toEqual([...CLIENT_STATUSES].sort());
    expect(Object.keys(CASE_STATUS_LABELS).sort()).toEqual([...CASE_STATUSES].sort());
  });
});
