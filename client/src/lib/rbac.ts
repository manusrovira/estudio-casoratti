/**
 * Roles y permisos de la plataforma.
 *
 * El rol NUNCA se decide en el frontend: se lee desde `public.user_roles` y
 * Postgres lo aplica en cada request. Estas funciones sólo sirven para
 * adaptar la interfaz a lo que el usuario puede hacer.
 */

export const APP_ROLES = ["admin", "abogado", "cliente", "usuario"] as const;

export type AppRole = (typeof APP_ROLES)[number];

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Administrador",
  abogado: "Abogado",
  cliente: "Cliente",
  usuario: "Usuario registrado",
};

export const CONSULTATION_STATUSES = [
  "nueva",
  "pendiente",
  "en_analisis",
  "en_seguimiento",
  "respondida",
  "cerrada",
  "rechazada",
] as const;

export type ConsultationStatus = (typeof CONSULTATION_STATUSES)[number];

export const CONSULTATION_STATUS_LABELS: Record<ConsultationStatus, string> = {
  nueva: "Nueva",
  pendiente: "Pendiente de revisión",
  en_analisis: "En análisis",
  en_seguimiento: "En seguimiento",
  respondida: "Respondida",
  cerrada: "Cerrada",
  rechazada: "Rechazada",
};

export const CLIENT_STATUSES = ["activo", "potencial", "inactivo"] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  activo: "Activo",
  potencial: "Potencial",
  inactivo: "Inactivo",
};

export const CASE_STATUSES = ["inicial", "en_tramitacion", "suspendido", "archivado", "cerrado"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  inicial: "Inicial",
  en_tramitacion: "En tramitación",
  suspendido: "Suspendido",
  archivado: "Archivado",
  cerrado: "Cerrado",
};

/** Únicamente el administrador entra al panel de administración. */
export function canAccessAdminPanel(role: AppRole | null): boolean {
  return role === "admin";
}

/** El área de cliente la usan los clientes y el personal del estudio. */
export function canAccessClientArea(role: AppRole | null): boolean {
  return role === "cliente" || role === "admin" || role === "abogado";
}

/** Perfil de usuario dentro de la plataforma. */
export type Profile = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  document_id: string | null;
  avatar_url: string | null;
  accepted_terms_at: string | null;
  created_at: string;
};

export type Consultation = {
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
};

export type Client = {
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
};

export type LegalCase = {
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
};

export type Lawyer = {
  id: string;
  profile_id: string | null;
  full_name: string;
  license_number: string | null;
  email: string | null;
  specialties: string[];
  bio: string | null;
  is_active: boolean;
};

export type ConsultationCategory = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_active: boolean;
  sort_order: number;
};
