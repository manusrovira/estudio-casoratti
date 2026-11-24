import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CONSULTATION_STATUSES,
  CONSULTATION_STATUS_LABELS,
  type ConsultationStatus,
} from "@/lib/rbac";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { useAuthContext } from "@/contexts/AuthContext";
import {
  IP_RATE_LIMIT,
  IP_RATE_WINDOW_HOURS,
  PAGE_SIZE,
  SERIES_DAYS,
  aggregateByDay,
  asRow,
  asRows,
  buildSearchFilter,
  calculateTotalPages,
  civilDateToIso,
  clampPage,
  dayStartIso,
  formatDateTimeEs,
  formatDurationEs,
  formatNumberEs,
  formatPercentEs,
  isMissingColumnError,
  pageRange,
  percentage,
  summarizeIpUsage,
  truncateText,
  windowStartIso,
  type DayPoint,
  type IpUsage,
} from "./consultations-utils";

/**
 * Administración de consultas.
 *
 * Pantalla de trabajo del estudio: todas las consultas recibidas desde el
 * formulario público, con indicadores reales, listado paginado en el servidor,
 * detalle con notas internas y control del uso por IP.
 *
 * Decisiones importantes:
 *
 *  - La paginación es REAL: se pide una sola página de 10 filas con
 *    `.range(desde, hasta)` y `count: "exact"`. El navegador nunca descarga la
 *    tabla completa.
 *  - Las cifras del encabezado salen de consultas de conteo a Postgres, no de
 *    cálculos sobre los datos ya cargados.
 *  - La migración que agrega `ip_address` puede no estar aplicada todavía. Si
 *    Postgres responde 42703 (columna inexistente) el módulo se degrada solo:
 *    deja de pedir la columna, oculta los filtros de IP y sigue funcionando.
 *  - La seguridad no vive acá: Postgres filtra por RLS y `can_read_consultation`.
 *    Nunca se usa la service role ni el cliente anónimo.
 */

/** Columnas base de la tabla de consultas. */
const LIST_COLUMNS =
  "id, reference_code, full_name, email, phone, category_id, subject, description, status, assigned_lawyer_id, client_id, legal_case_id, is_new, received_at, updated_at, privacy_accepted_at";

/** Columnas cuando la migración de `ip_address` ya está aplicada. */
const LIST_COLUMNS_WITH_IP = `${LIST_COLUMNS}, ip_address, user_agent`;

/** Tope de filas que se traen para las series agregadas en el navegador. */
const AGGREGATE_LIMIT = 5000;

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
  ip_address?: string | null;
  user_agent?: string | null;
};

type CategoryRow = { id: string; name: string };
type LawyerRow = { id: string; full_name: string };
type ClientOption = { id: string; full_name: string; email: string | null };
type CaseOption = { id: string; case_number: string; title: string };

type ThreadRow = {
  id: string;
  body: string;
  created_at: string;
  author_id: string | null;
  authorName: string | null;
};

type HistoryRow = {
  id: string;
  action: string;
  actor_id: string | null;
  created_at: string;
  actorName: string | null;
};

type Feedback = { kind: "ok" | "error"; text: string };

type Stats = {
  total: number;
  nuevas: number;
  hoy: number;
  dias7: number;
  dias30: number;
  enAnalisis: number;
  tasaRespuesta: number;
};

const EMPTY_STATS: Stats = {
  total: 0,
  nuevas: 0,
  hoy: 0,
  dias7: 0,
  dias30: 0,
  enAnalisis: 0,
  tasaRespuesta: 0,
};

/** Traduce las acciones de auditoría a un texto legible. */
const HISTORY_ACTION_LABELS: Record<string, string> = {
  insert_legal_consultations: "Consulta recibida",
  update_legal_consultations: "Consulta actualizada",
  delete_legal_consultations: "Consulta eliminada",
};

function StatusBadge({ status }: { status: ConsultationStatus }) {
  return (
    <span className={`badge badge-${status}`}>
      {CONSULTATION_STATUS_LABELS[status]}
    </span>
  );
}

/** Nombres de los autores (notas, mensajes y auditoría). */
async function loadAuthorNames(
  ids: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (!ids.length) return names;
  const { data } = await getSupabase()
    .from("profiles")
    .select("id, full_name")
    .in("id", ids);
  for (const raw of data ?? []) {
    const row = raw as { id: string; full_name: string | null };
    if (row.full_name) names.set(row.id, row.full_name);
  }
  return names;
}

export function ConsultationsAdminModule() {
  const { user } = useAuthContext();

  /* ------------------------------------------------------------- listado */

  const [rows, setRows] = useState<ConsultationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  /* ------------------------------------------------------------- filtros */

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [ipFilter, setIpFilter] = useState("");
  const [onlyNew, setOnlyNew] = useState(false);
  const [jumpPage, setJumpPage] = useState("1");

  /* ------------------------------------------------------------- apoyo */

  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [lawyers, setLawyers] = useState<LawyerRow[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [cases, setCases] = useState<CaseOption[]>([]);

  /**
   * ¿Existe la columna `ip_address` en la base? Se prueba con la primera
   * consulta: si Postgres responde 42703 se apaga y el módulo sigue igual.
   */
  const [ipAvailable, setIpAvailable] = useState(true);

  /* --------------------------------------------------------- indicadores */

  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [series, setSeries] = useState<DayPoint[]>([]);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});

  /* ------------------------------------------------------- control de IPs */

  const [ipUsage, setIpUsage] = useState<IpUsage[]>([]);
  const [ipLoading, setIpLoading] = useState(true);
  const [ipError, setIpError] = useState<string | null>(null);

  /* ------------------------------------------------------------- detalle */

  const [detail, setDetail] = useState<ConsultationRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [notes, setNotes] = useState<ThreadRow[]>([]);
  const [messages, setMessages] = useState<ThreadRow[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [noteBody, setNoteBody] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const totalPages = calculateTotalPages(total);
  const currentRange = pageRange(page);

  const categoryName = useMemo(() => {
    const map = new Map<string, string>();
    categories.forEach((category) => map.set(category.id, category.name));
    return map;
  }, [categories]);

  const lawyerName = useMemo(() => {
    const map = new Map<string, string>();
    lawyers.forEach((lawyer) => map.set(lawyer.id, lawyer.full_name));
    return map;
  }, [lawyers]);

  const clientName = useMemo(() => {
    const map = new Map<string, string>();
    clients.forEach((client) => map.set(client.id, client.full_name));
    return map;
  }, [clients]);

  const caseLabel = useMemo(() => {
    const map = new Map<string, string>();
    cases.forEach((row) => map.set(row.id, `${row.case_number} · ${row.title}`));
    return map;
  }, [cases]);

  /* ------------------------------------------------------- carga del listado */

  const loadList = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const supabase = getSupabase();
    setListLoading(true);

    const columns = ipAvailable ? LIST_COLUMNS_WITH_IP : LIST_COLUMNS;
    let query = supabase
      .from("legal_consultations")
      .select(columns, { count: "exact" });

    const term = buildSearchFilter(search);
    if (term) query = query.or(term);
    if (categoryId) query = query.eq("category_id", categoryId);
    if (statusFilter) query = query.eq("status", statusFilter);
    if (onlyNew) query = query.eq("is_new", true);
    if (ipAvailable && ipFilter.trim()) {
      query = query.eq("ip_address", ipFilter.trim());
    }

    // Los filtros de fecha se interpretan en hora local de Argentina.
    const fromIso = fromDate ? civilDateToIso(fromDate, false) : null;
    const toIso = toDate ? civilDateToIso(toDate, true) : null;
    if (fromIso) query = query.gte("received_at", fromIso);
    if (toIso) query = query.lte("received_at", toIso);

    const { from, to } = currentRange;
    const { data, error, count } = await query
      .order("received_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);

    if (error) {
      // La columna todavía no existe: se apaga la parte de IP y se reintenta.
      if (isMissingColumnError(error)) {
        setIpAvailable(false);
        setListLoading(false);
        return;
      }
      setListError(error.message);
      setRows([]);
      setTotal(0);
      setListLoading(false);
      return;
    }

    setListError(null);
    setRows(asRows<ConsultationRow>(data));
    const newTotal = count ?? 0;
    setTotal(newTotal);

    // Si un filtro achicó el universo y la página actual quedó vacía, se
    // corrige sola para no dejar al administrador en un hueco.
    const pages = calculateTotalPages(newTotal);
    if (pages > 0 && page > pages) setPage(pages);

    setListLoading(false);
  }, [
    ipAvailable,
    ipFilter,
    search,
    categoryId,
    statusFilter,
    fromDate,
    toDate,
    onlyNew,
    page,
    currentRange.from,
    currentRange.to,
  ]);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setListLoading(false);
      return;
    }
    void loadList();
  }, [loadList]);

  /* -------------------------------------------------------- carga indicadores */

  const loadOverview = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const supabase = getSupabase();
    setStatsLoading(true);

    const now = new Date();
    const todayStart = dayStartIso(now);
    // Argentina no cambia de horario: sumar 24 h siempre cae en el día siguiente.
    const tomorrowStart = dayStartIso(
      new Date(now.getTime() + 24 * 3600000),
    );

    const statusCountsQuery = Promise.all(
      CONSULTATION_STATUSES.map(async (status) => {
        const result = await supabase
          .from("legal_consultations")
          .select("id", { count: "exact", head: true })
          .eq("status", status);
        return { status, count: result.count ?? 0, error: result.error };
      }),
    );

    const [
      totalRes,
      nuevasRes,
      hoyRes,
      dias7Res,
      dias30Res,
      enAnalisisRes,
      respondidasRes,
      seriesRes,
      statusResults,
    ] = await Promise.all([
      supabase
        .from("legal_consultations")
        .select("id", { count: "exact", head: true }),
      supabase
        .from("legal_consultations")
        .select("id", { count: "exact", head: true })
        .eq("is_new", true),
      supabase
        .from("legal_consultations")
        .select("id", { count: "exact", head: true })
        .gte("received_at", todayStart)
        .lt("received_at", tomorrowStart),
      supabase
        .from("legal_consultations")
        .select("id", { count: "exact", head: true })
        .gte("received_at", windowStartIso(7, now)),
      supabase
        .from("legal_consultations")
        .select("id", { count: "exact", head: true })
        .gte("received_at", windowStartIso(30, now)),
      supabase
        .from("legal_consultations")
        .select("id", { count: "exact", head: true })
        .eq("status", "en_analisis"),
      supabase
        .from("legal_consultations")
        .select("id", { count: "exact", head: true })
        .in("status", ["respondida", "cerrada"]),
      supabase
        .from("legal_consultations")
        .select("received_at")
        .gte("received_at", windowStartIso(SERIES_DAYS, now))
        .limit(AGGREGATE_LIMIT),
      statusCountsQuery,
    ]);

    const failure =
      totalRes.error?.message ??
      nuevasRes.error?.message ??
      hoyRes.error?.message ??
      dias7Res.error?.message ??
      dias30Res.error?.message ??
      enAnalisisRes.error?.message ??
      respondidasRes.error?.message ??
      seriesRes.error?.message ??
      statusResults.find((item) => item.error)?.error?.message;

    if (failure) {
      setStatsError(failure);
      setStatsLoading(false);
      return;
    }

    const totalCount = totalRes.count ?? 0;
    const respondidas = respondidasRes.count ?? 0;

    setStatsError(null);
    setStats({
      total: totalCount,
      nuevas: nuevasRes.count ?? 0,
      hoy: hoyRes.count ?? 0,
      dias7: dias7Res.count ?? 0,
      dias30: dias30Res.count ?? 0,
      enAnalisis: enAnalisisRes.count ?? 0,
      tasaRespuesta: percentage(respondidas, totalCount),
    });

    setSeries(
      aggregateByDay(
        (seriesRes.data ?? []) as Array<{ received_at: string | null }>,
        SERIES_DAYS,
        now,
      ),
    );

    const counts: Record<string, number> = {};
    for (const item of statusResults) counts[item.status] = item.count;
    setStatusCounts(counts);

    setStatsLoading(false);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setStatsLoading(false);
      return;
    }
    void loadOverview();
  }, [loadOverview]);

  /* ------------------------------------------------------ carga uso por IP */

  const loadIpUsage = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    if (!ipAvailable) {
      setIpUsage([]);
      setIpLoading(false);
      return;
    }

    const supabase = getSupabase();
    setIpLoading(true);
    const since = new Date(Date.now() - IP_RATE_WINDOW_HOURS * 3600000);

    const { data, error } = await supabase
      .from("legal_consultations")
      .select("ip_address, received_at")
      .gte("received_at", since.toISOString())
      .limit(AGGREGATE_LIMIT);

    if (error) {
      if (isMissingColumnError(error)) {
        // Todavía no está la columna: se apaga la sección de IPs.
        setIpAvailable(false);
        setIpLoading(false);
        return;
      }
      setIpError(error.message);
      setIpLoading(false);
      return;
    }

    const usage = summarizeIpUsage(
      (data ?? []) as Array<{
        ip_address: string | null;
        received_at: string | null;
      }>,
      { now: new Date() },
    );

    setIpUsage(usage);
    setIpError(null);
    setIpLoading(false);
  }, [ipAvailable]);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setIpLoading(false);
      return;
    }
    void loadIpUsage();
  }, [loadIpUsage]);

  /* -------------------------------------------------------- listas de apoyo */

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const supabase = getSupabase();
    void (async () => {
      const [cats, laws, clis, cses] = await Promise.all([
        supabase
          .from("consultation_categories")
          .select("id, name")
          .eq("is_active", true)
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
      setCategories((cats.data ?? []) as CategoryRow[]);
      setLawyers((laws.data ?? []) as LawyerRow[]);
      setClients((clis.data ?? []) as ClientOption[]);
      setCases((cses.data ?? []) as CaseOption[]);
    })();
  }, []);

  /* ------------------------------------------------------- búsqueda diferida */

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch((current) => (current === searchInput ? current : searchInput));
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setJumpPage(String(page));
  }, [page]);

  // Si la columna de IP no está disponible, el filtro por IP deja de aplicar.
  useEffect(() => {
    if (!ipAvailable) setIpFilter("");
  }, [ipAvailable]);

  /* ---------------------------------------------------------------- detalle */

  const loadThread = useCallback(async (consultationId: string) => {
    const supabase = getSupabase();
    const [notesRes, messagesRes, historyRes] = await Promise.all([
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
      supabase
        .from("audit_logs")
        .select("id, action, actor_id, created_at")
        .eq("entity_type", "legal_consultations")
        .eq("entity_id", consultationId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    const problems = [
      notesRes.error?.message,
      messagesRes.error?.message,
      historyRes.error?.message,
    ].filter(Boolean);
    if (problems.length) {
      setFeedback({ kind: "error", text: problems.join(" · ") });
    }

    const notesRows = (notesRes.data ?? []) as Array<{
      id: string;
      body: string;
      created_at: string;
      author_id: string | null;
    }>;
    const messageRows = (messagesRes.data ?? []) as Array<{
      id: string;
      body: string;
      created_at: string;
      author_id: string | null;
    }>;
    const historyRows = (historyRes.data ?? []) as Array<{
      id: string;
      action: string;
      actor_id: string | null;
      created_at: string;
    }>;

    const ids = Array.from(
      new Set(
        [
          ...notesRows.map((row) => row.author_id),
          ...messageRows.map((row) => row.author_id),
          ...historyRows.map((row) => row.actor_id),
        ].filter((value): value is string => Boolean(value)),
      ),
    );
    const names = await loadAuthorNames(ids);

    setNotes(
      notesRows.map((row) => ({
        ...row,
        authorName: row.author_id ? (names.get(row.author_id) ?? null) : null,
      })),
    );
    setMessages(
      messageRows.map((row) => ({
        ...row,
        authorName: row.author_id ? (names.get(row.author_id) ?? null) : null,
      })),
    );
    setHistory(
      historyRows.map((row) => ({
        ...row,
        actorName: row.actor_id ? (names.get(row.actor_id) ?? null) : null,
      })),
    );
  }, []);

  const openDetail = useCallback(
    async (id: string) => {
      if (!isSupabaseConfigured) return;
      setFeedback(null);
      setNoteBody("");
      setMessageBody("");
      setDetailLoading(true);

      const supabase = getSupabase();
      let result = await supabase
        .from("legal_consultations")
        .select(ipAvailable ? LIST_COLUMNS_WITH_IP : LIST_COLUMNS)
        .eq("id", id)
        .maybeSingle();

      // La columna `ip_address` puede no existir todavía.
      if (result.error && isMissingColumnError(result.error) && ipAvailable) {
        setIpAvailable(false);
        result = await supabase
          .from("legal_consultations")
          .select(LIST_COLUMNS)
          .eq("id", id)
          .maybeSingle();
      }

      if (result.error) {
        setFeedback({ kind: "error", text: result.error.message });
        setDetailLoading(false);
        return;
      }

      setDetail(asRow<ConsultationRow>(result.data));
      await loadThread(id);
      setDetailLoading(false);
    },
    [ipAvailable, loadThread],
  );

  const closeDetail = useCallback(() => {
    setDetail(null);
    setNotes([]);
    setMessages([]);
    setHistory([]);
    setFeedback(null);
  }, []);

  const patchDetail = useCallback(
    async (patch: Record<string, unknown>, successText: string) => {
      if (!detail) return;
      setSaving(true);
      const { data, error } = await getSupabase()
        .from("legal_consultations")
        .update(patch)
        .eq("id", detail.id)
        .select("*")
        .maybeSingle();
      setSaving(false);
      if (error) {
        setFeedback({ kind: "error", text: error.message });
        return;
      }
      if (data) setDetail(data as ConsultationRow);
      setFeedback({ kind: "ok", text: successText });
      void loadList();
      void loadOverview();
    },
    [detail, loadList, loadOverview],
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
      current ? { ...current, client_id: newClient.id } : current,
    );
    setClients(current =>
      current.some((client) => client.id === newClient.id)
        ? current
        : [
            ...current,
            {
              id: newClient.id,
              full_name: newClient.full_name,
              email: detail.email,
            },
          ],
    );
    setFeedback({
      kind: "ok",
      text: `Cliente creado y vinculado: ${newClient.full_name}.`,
    });
  }, [detail]);

  const addNote = useCallback(async () => {
    if (!detail || !noteBody.trim()) return;
    setSaving(true);
    const { error } = await getSupabase()
      .from("consultation_notes")
      .insert({
        consultation_id: detail.id,
        body: noteBody.trim(),
        author_id: user?.id ?? null,
      });
    setSaving(false);
    if (error) {
      setFeedback({ kind: "error", text: error.message });
      return;
    }
    setNoteBody("");
    setFeedback({ kind: "ok", text: "Nota interna guardada." });
    await loadThread(detail.id);
  }, [detail, noteBody, user?.id, loadThread]);

  const sendMessage = useCallback(async () => {
    if (!detail || !messageBody.trim()) return;
    setSaving(true);
    const { error } = await getSupabase()
      .from("consultation_messages")
      .insert({
        consultation_id: detail.id,
        body: messageBody.trim(),
        author_id: user?.id ?? null,
      });
    setSaving(false);
    if (error) {
      setFeedback({ kind: "error", text: error.message });
      return;
    }
    setMessageBody("");
    setFeedback({ kind: "ok", text: "Respuesta enviada al cliente." });
    await loadThread(detail.id);
  }, [detail, messageBody, user?.id, loadThread]);

  /* ------------------------------------------------------------- derivados */

  const statusRows = useMemo(() => {
    const sum = CONSULTATION_STATUSES.reduce(
      (total, status) => total + (statusCounts[status] ?? 0),
      0,
    );
    return CONSULTATION_STATUSES.map((status) => {
      const count = statusCounts[status] ?? 0;
      return {
        status,
        label: CONSULTATION_STATUS_LABELS[status],
        count,
        percent: percentage(count, sum),
      };
    });
  }, [statusCounts]);

  const maxDayCount = useMemo(
    () => Math.max(1, ...series.map((point) => point.count)),
    [series],
  );

  const ipOptions = useMemo(
    () => ipUsage.map((entry) => entry.ip),
    [ipUsage],
  );

  const firstRow = total === 0 ? 0 : currentRange.from + 1;
  const lastRow = total === 0 ? 0 : Math.min(currentRange.to + 1, total);

  /* ------------------------------------------------------------------ vista */

  if (!isSupabaseConfigured) {
    return (
      <div className="admin-info">
        Supabase no está configurado. Definí <code>VITE_SUPABASE_URL</code> y{" "}
        <code>VITE_SUPABASE_ANON_KEY</code> en el archivo <code>.env</code> para
        habilitar la administración de consultas.
      </div>
    );
  }

  const kpis: Array<{
    label: string;
    hint: string;
    value: number | null;
    format?: "number" | "percent";
    variant?: string;
  }> = [
    {
      label: "Consultas totales",
      hint: "Histórico completo del formulario",
      value: statsLoading ? null : stats.total,
    },
    {
      label: "Consultas nuevas",
      hint: "Todavía sin revisar por el estudio",
      value: statsLoading ? null : stats.nuevas,
      variant: "admin-cons-kpi-accent",
    },
    {
      label: "Recibidas hoy",
      hint: "Desde la medianoche (Argentina)",
      value: statsLoading ? null : stats.hoy,
    },
    {
      label: "Últimos 7 días",
      hint: "Consultas de la semana",
      value: statsLoading ? null : stats.dias7,
    },
    {
      label: "Últimos 30 días",
      hint: "Consultas del último mes",
      value: statsLoading ? null : stats.dias30,
    },
    {
      label: "En análisis",
      hint: "Consultas en estudio",
      value: statsLoading ? null : stats.enAnalisis,
    },
    {
      label: "Tasa de respuesta",
      hint: "Respondidas o cerradas sobre el total",
      value: statsLoading ? null : stats.tasaRespuesta,
      format: "percent",
      variant: "admin-cons-kpi-strong",
    },
    {
      label: "IPs distintas (24 h)",
      hint: ipAvailable
        ? "Direcciones que consultaron hoy"
        : "Requiere la columna ip_address",
      value: ipAvailable ? (ipLoading ? null : ipUsage.length) : null,
    },
  ];

  return (
    <>
      {/* ------------------------------------------------------- indicadores */}
      <div className="admin-cons-kpis">
        {kpis.map((kpi) => (
          <div
            className={`admin-cons-kpi${kpi.variant ? ` ${kpi.variant}` : ""}`}
            key={kpi.label}
          >
            <span className="admin-cons-kpi-label">{kpi.label}</span>
            <span className="admin-cons-kpi-value">
              {kpi.value === null
                ? "—"
                : kpi.format === "percent"
                  ? formatPercentEs(kpi.value)
                  : formatNumberEs(kpi.value)}
            </span>
            <span className="admin-cons-kpi-hint">{kpi.hint}</span>
          </div>
        ))}
      </div>

      {statsError && <div className="admin-error">{statsError}</div>}

      {/* ------------------------------------------------- serie y estados */}
      <div className="admin-grid-2">
        <div className="admin-card">
          <div className="admin-card-head">
            <div>
              <h2 className="admin-card-title">Consultas por día</h2>
              <p className="admin-card-sub">
                Últimos {SERIES_DAYS} días, en hora de Argentina.
              </p>
            </div>
          </div>
          <div className="admin-card-body flush">
            {statsLoading ? (
              <div className="admin-empty">Cargando la serie…</div>
            ) : (
              <div className="admin-cons-chart">
                <div
                  className="admin-cons-chart-bars"
                  role="img"
                  aria-label={`Consultas recibidas por día durante los últimos ${SERIES_DAYS} días. Máximo ${maxDayCount} en un día.`}
                >
                  {series.map((point) => {
                    const height =
                      point.count === 0
                        ? "3px"
                        : `${Math.max(
                            4,
                            Math.round((point.count / maxDayCount) * 100),
                          )}%`;
                    return (
                      <div
                        className="admin-cons-chart-col"
                        key={point.key}
                        title={`${point.label}: ${point.count}`}
                      >
                        <span className="admin-cons-chart-count">
                          {point.count > 0 ? point.count : ""}
                        </span>
                        <div
                          className={`admin-cons-bar${
                            point.count === 0 ? " admin-cons-bar-empty" : ""
                          }${point.isToday ? " admin-cons-bar-today" : ""}`}
                          style={{ height }}
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="admin-cons-chart-axis" aria-hidden="true">
                  <span>{series[0]?.label ?? ""}</span>
                  <span>{series[series.length - 1]?.label ?? ""}</span>
                </div>
                <ul className="admin-cons-sr-only">
                  {series.map((point) => (
                    <li key={point.key}>
                      {point.label}: {point.count} consultas
                    </li>
                  ))}
                </ul>
                <p className="admin-cons-chart-caption">
                  {stats.dias30 === 0
                    ? "En los últimos 30 días no se recibieron consultas."
                    : `${formatNumberEs(stats.dias30)} consultas en los últimos 30 días, con un máximo de ${formatNumberEs(maxDayCount)} en un mismo día.`}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="admin-card">
          <div className="admin-card-head">
            <div>
              <h2 className="admin-card-title">Distribución por estado</h2>
              <p className="admin-card-sub">
                Cantidad y porcentaje sobre el total de consultas.
              </p>
            </div>
          </div>
          <div className="admin-card-body">
            {statsLoading ? (
              <div className="admin-empty">Cargando los estados…</div>
            ) : (
              <div className="admin-cons-status">
                {statusRows.map((row) => (
                  <div className="admin-cons-status-row" key={row.status}>
                    <div className="admin-cons-status-head">
                      <b>{row.label}</b>
                      <span>
                        {formatNumberEs(row.count)} ·{" "}
                        {formatPercentEs(row.percent)}
                      </span>
                    </div>
                    <div className="admin-cons-status-track">
                      <div
                        className="admin-cons-status-fill"
                        style={{ width: `${row.percent}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------- listado */}
      <div className="admin-card">
        <div className="admin-card-head">
          <div>
            <h2 className="admin-card-title">Consultas recibidas</h2>
            <p className="admin-card-sub">
              {PAGE_SIZE} consultas por página, paginadas en el servidor.
            </p>
          </div>
          <div className="admin-topbar-actions">
            <button
              type="button"
              className="admin-button admin-button-ghost admin-button-small"
              onClick={() => {
                void loadList();
                void loadOverview();
                void loadIpUsage();
              }}
              disabled={listLoading}
            >
              {listLoading ? "Actualizando…" : "Actualizar"}
            </button>
          </div>
        </div>

        <div className="admin-filters">
          <div className="filter-field">
            <label htmlFor="cons-buscar">Buscar</label>
            <input
              id="cons-buscar"
              className="admin-input narrow"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Nombre, email, asunto o código"
            />
          </div>
          <div className="filter-field">
            <label htmlFor="cons-area">Área jurídica</label>
            <select
              id="cons-area"
              className="admin-select narrow"
              value={categoryId}
              onChange={(event) => {
                setCategoryId(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Todas</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="cons-estado">Estado</label>
            <select
              id="cons-estado"
              className="admin-select narrow"
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos</option>
              {CONSULTATION_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {CONSULTATION_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="cons-desde">Desde</label>
            <input
              id="cons-desde"
              type="date"
              className="admin-input narrow"
              value={fromDate}
              onChange={(event) => {
                setFromDate(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="filter-field">
            <label htmlFor="cons-hasta">Hasta</label>
            <input
              id="cons-hasta"
              type="date"
              className="admin-input narrow"
              value={toDate}
              onChange={(event) => {
                setToDate(event.target.value);
                setPage(1);
              }}
            />
          </div>
          {ipAvailable && (
            <div className="filter-field">
              <label htmlFor="cons-ip">IP</label>
              <input
                id="cons-ip"
                className="admin-input narrow"
                list="cons-ip-lista"
                value={ipFilter}
                onChange={(event) => {
                  setIpFilter(event.target.value);
                  setPage(1);
                }}
                placeholder="Todas"
              />
              <datalist id="cons-ip-lista">
                {ipOptions.map((ip) => (
                  <option key={ip} value={ip} />
                ))}
              </datalist>
            </div>
          )}
          <div className="filter-field">
            <label htmlFor="cons-nuevas">Sólo nuevas</label>
            <input
              id="cons-nuevas"
              type="checkbox"
              checked={onlyNew}
              onChange={(event) => {
                setOnlyNew(event.target.checked);
                setPage(1);
              }}
            />
          </div>
          <button
            type="button"
            className="admin-button admin-button-ghost"
            onClick={() => {
              setSearchInput("");
              setSearch("");
              setCategoryId("");
              setStatusFilter("");
              setFromDate("");
              setToDate("");
              setIpFilter("");
              setOnlyNew(false);
              setPage(1);
            }}
          >
            Limpiar
          </button>
        </div>

        <div className="admin-card-body flush">
          {listError ? (
            <div className="admin-error" style={{ margin: "1.4rem" }}>
              {listError}
            </div>
          ) : listLoading ? (
            <div className="admin-empty">Cargando consultas…</div>
          ) : rows.length === 0 ? (
            <div className="admin-empty">
              <strong>No hay consultas para mostrar</strong>
              {total === 0
                ? "Todavía no se recibieron consultas, o ningún resultado coincide con los filtros aplicados."
                : "Probá cambiando los filtros o volvé a la primera página."}
            </div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <caption className="admin-cons-sr-only">
                  Consultas recibidas, página {page} de {totalPages || 1}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Referencia</th>
                    <th scope="col">Recibida</th>
                    <th scope="col">Nombre</th>
                    <th scope="col">Email</th>
                    <th scope="col">Teléfono</th>
                    <th scope="col">IP</th>
                    <th scope="col">Área</th>
                    <th scope="col">Asunto</th>
                    <th scope="col">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      className="admin-cons-row-link"
                      onClick={() => void openDetail(row.id)}
                    >
                      <td className="cell-strong">
                        <button
                          type="button"
                          className="admin-cons-ref-button"
                          onClick={event => {
                            event.stopPropagation();
                            void openDetail(row.id);
                          }}
                        >
                          {row.reference_code}
                        </button>
                        {row.is_new && (
                          <span
                            className="badge badge-nueva"
                            style={{ marginLeft: ".5rem" }}
                          >
                            Nueva
                          </span>
                        )}
                      </td>
                      <td className="cell-muted">
                        {formatDateTimeEs(row.received_at)}
                      </td>
                      <td>{row.full_name}</td>
                      <td className="cell-muted">{row.email}</td>
                      <td className="cell-muted">{row.phone ?? "—"}</td>
                      <td className="cell-muted">
                        {ipAvailable ? (row.ip_address ?? "—") : "—"}
                      </td>
                      <td className="cell-muted">
                        {row.category_id
                          ? (categoryName.get(row.category_id) ?? "—")
                          : "—"}
                      </td>
                      <td>
                        <span
                          className="admin-cons-subject"
                          title={row.subject}
                        >
                          {truncateText(row.subject, 40)}
                        </span>
                      </td>
                      <td>
                        <StatusBadge status={row.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!listError && (
            <div className="admin-cons-pagination">
              <p className="admin-cons-pagination-info">
                Mostrando <b>{formatNumberEs(firstRow)}</b>–
                <b>{formatNumberEs(lastRow)}</b> de{" "}
                <b>{formatNumberEs(total)}</b> consultas · Página{" "}
                <b>{page}</b> de <b>{Math.max(totalPages, 1)}</b>
              </p>
              <div className="admin-cons-pagination-controls">
                <button
                  type="button"
                  className="admin-button admin-button-ghost admin-button-small"
                  disabled={listLoading || page <= 1}
                  onClick={() => setPage((current) => clampPage(current - 1, totalPages))}
                >
                  Anterior
                </button>
                <button
                  type="button"
                  className="admin-button admin-button-ghost admin-button-small"
                  disabled={listLoading || page >= totalPages}
                  onClick={() => setPage((current) => clampPage(current + 1, totalPages))}
                >
                  Siguiente
                </button>
                <form
                  className="admin-cons-jump"
                  onSubmit={event => {
                    event.preventDefault();
                    const wanted = Number.parseInt(jumpPage, 10);
                    if (!Number.isFinite(wanted)) {
                      setPage(1);
                      return;
                    }
                    setPage(clampPage(wanted, totalPages));
                  }}
                >
                  <div className="filter-field">
                    <label htmlFor="cons-pagina">Ir a la página</label>
                    <input
                      id="cons-pagina"
                      type="number"
                      min={1}
                      max={Math.max(totalPages, 1)}
                      className="admin-input"
                      value={jumpPage}
                      onChange={event => setJumpPage(event.target.value)}
                    />
                  </div>
                  <button
                    type="submit"
                    className="admin-button admin-button-small"
                    disabled={listLoading}
                  >
                    Ir
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ----------------------------------------------- control de solicitudes */}
      <div className="admin-card">
        <div className="admin-card-head">
          <div>
            <h2 className="admin-card-title">Control de solicitudes</h2>
            <p className="admin-card-sub">
              Uso de cada dirección IP en las últimas{" "}
              {IP_RATE_WINDOW_HOURS} horas.
            </p>
          </div>
        </div>
        <div className="admin-card-body">
          <p className="admin-cons-limit-note">
            Límite configurado: {IP_RATE_LIMIT} consultas por IP cada{" "}
            {IP_RATE_WINDOW_HOURS} horas. La capacidad se libera de a una
            consulta cada vez que la más antigua sale de la ventana.
          </p>

          {ipLoading ? (
            <div className="admin-empty">Cargando el uso de las IPs…</div>
          ) : ipError ? (
            <div className="admin-error">{ipError}</div>
          ) : !ipAvailable ? (
            <div className="admin-info">
              La base todavía no tiene la columna <code>ip_address</code>. En
              cuanto se aplique la migración, esta sección se completa sola con
              los datos reales.
            </div>
          ) : ipUsage.length === 0 ? (
            <div className="admin-empty">
              <strong>Ninguna IP consultó en las últimas 24 horas</strong>
              Cuando se registren consultas desde el sitio, acá va el detalle
              del uso por dirección.
            </div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th scope="col">IP</th>
                    <th scope="col">Consultas</th>
                    <th scope="col">Capacidad restante</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Se libera en</th>
                    <th scope="col">Última consulta</th>
                  </tr>
                </thead>
                <tbody>
                  {ipUsage.map((entry) => (
                    <tr key={entry.ip}>
                      <td className="admin-cons-ip">{entry.ip}</td>
                      <td>
                        <div className="cell-strong">
                          {entry.count} de {IP_RATE_LIMIT}
                        </div>
                        <div
                          className="admin-cons-meter"
                          role="img"
                          aria-label={`${entry.count} de ${IP_RATE_LIMIT} consultas usadas`}
                        >
                          <div
                            className={`admin-cons-meter-fill${
                              entry.atLimit
                                ? " admin-cons-meter-fill-warn"
                                : " admin-cons-meter-fill-ok"
                            }`}
                            style={{
                              width: `${Math.min(
                                100,
                                (entry.count / IP_RATE_LIMIT) * 100,
                              )}%`,
                            }}
                          />
                        </div>
                      </td>
                      <td className="cell-muted">
                        {entry.remaining} consulta{entry.remaining === 1 ? "" : "s"}
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            entry.atLimit
                              ? "badge-rechazada"
                              : "badge-respondida"
                          }`}
                        >
                          {entry.atLimit
                            ? "Límite alcanzado"
                            : "Habilitada"}
                        </span>
                      </td>
                      <td className="cell-muted">
                        {entry.atLimit
                          ? formatDurationEs(entry.releasesInMinutes)
                          : "Disponible"}
                      </td>
                      <td className="cell-muted">
                        {formatDateTimeEs(entry.lastSeenIso)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------ detalle */}
      {detailLoading && (
        <div
          className="admin-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Cargando la consulta"
          onClick={closeDetail}
        >
          <div
            className="admin-drawer-panel"
            onClick={event => event.stopPropagation()}
          >
            <div className="admin-drawer-head">
              <div>
                <h2>Consulta</h2>
                <p className="admin-card-sub">Cargando los datos…</p>
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
            <div className="admin-empty">Cargando la consulta…</div>
          </div>
        </div>
      )}

      {detail && !detailLoading && (
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
                <dt>IP</dt>
                <dd className="admin-cons-ip">
                  {ipAvailable ? (detail.ip_address ?? "—") : "—"}
                </dd>
                <dt>Navegador</dt>
                <dd className="admin-cons-ua">
                  {ipAvailable ? (detail.user_agent ?? "—") : "—"}
                </dd>
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
                <dd>
                  {detail.client_id
                    ? (clientName.get(detail.client_id) ?? "Sin vincular")
                    : "Sin vincular"}
                </dd>
                <dt>Expediente</dt>
                <dd>
                  {detail.legal_case_id
                    ? (caseLabel.get(detail.legal_case_id) ?? "Sin vincular")
                    : "Sin vincular"}
                </dd>
                <dt>Recibida</dt>
                <dd>{formatDateTimeEs(detail.received_at)}</dd>
                <dt>Actualizada</dt>
                <dd>{formatDateTimeEs(detail.updated_at)}</dd>
                <dt>Privacidad aceptada</dt>
                <dd>{formatDateTimeEs(detail.privacy_accepted_at)}</dd>
              </dl>

              <div className="admin-card">
                <div className="admin-card-head">
                  <h3 className="admin-card-title">Gestión</h3>
                </div>
                <div className="admin-card-body admin-stack">
                  <div className="filter-field">
                    <label htmlFor="cons-d-estado">Estado</label>
                    <select
                      id="cons-d-estado"
                      className="admin-select"
                      value={detail.status}
                      disabled={saving}
                      onChange={event =>
                        void patchDetail(
                          { status: event.target.value, is_new: false },
                          "Estado actualizado.",
                        )
                      }
                    >
                      {CONSULTATION_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {CONSULTATION_STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="filter-field">
                    <label htmlFor="cons-d-abogado">Abogado a cargo</label>
                    <select
                      id="cons-d-abogado"
                      className="admin-select"
                      value={detail.assigned_lawyer_id ?? ""}
                      disabled={saving}
                      onChange={event =>
                        void patchDetail(
                          { assigned_lawyer_id: event.target.value || null },
                          "Asignación actualizada.",
                        )
                      }
                    >
                      <option value="">Sin asignar</option>
                      {lawyers.map((lawyer) => (
                        <option key={lawyer.id} value={lawyer.id}>
                          {lawyer.full_name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="filter-field">
                    <label htmlFor="cons-d-cliente">Cliente vinculado</label>
                    <select
                      id="cons-d-cliente"
                      className="admin-select"
                      value={detail.client_id ?? ""}
                      disabled={saving}
                      onChange={event =>
                        void patchDetail(
                          { client_id: event.target.value || null },
                          "Cliente vinculado actualizado.",
                        )
                      }
                    >
                      <option value="">Sin vincular</option>
                      {clients.map((client) => (
                        <option key={client.id} value={client.id}>
                          {client.full_name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="filter-field">
                    <label htmlFor="cons-d-expediente">Expediente vinculado</label>
                    <select
                      id="cons-d-expediente"
                      className="admin-select"
                      value={detail.legal_case_id ?? ""}
                      disabled={saving}
                      onChange={event =>
                        void patchDetail(
                          { legal_case_id: event.target.value || null },
                          "Expediente vinculado actualizado.",
                        )
                      }
                    >
                      <option value="">Sin vincular</option>
                      {cases.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.case_number} · {row.title}
                        </option>
                      ))}
                    </select>
                  </div>

                  {!detail.client_id && (
                    <div className="filter-field">
                      <button
                        type="button"
                        className="admin-button admin-button-ghost"
                        onClick={() => void convertToClient()}
                        disabled={saving}
                      >
                        Convertir la consulta en cliente
                      </button>
                    </div>
                  )}
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
                          {formatDateTimeEs(note.created_at)}
                        </footer>
                      </div>
                    ))
                  ) : (
                    <p className="cell-muted">Todavía no hay notas internas.</p>
                  )}

                  <div className="admin-stack">
                    <label className="admin-cons-sr-only" htmlFor="cons-nota">
                      Escribir una nota interna
                    </label>
                    <textarea
                      id="cons-nota"
                      className="admin-textarea"
                      value={noteBody}
                      onChange={event => setNoteBody(event.target.value)}
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
                          {formatDateTimeEs(message.created_at)}
                        </span>
                        {message.body}
                      </div>
                    ))
                  ) : (
                    <p className="cell-muted">Todavía no hay mensajes.</p>
                  )}

                  <div className="admin-stack">
                    <label className="admin-cons-sr-only" htmlFor="cons-mensaje">
                      Escribir la respuesta al cliente
                    </label>
                    <textarea
                      id="cons-mensaje"
                      className="admin-textarea"
                      value={messageBody}
                      onChange={event => setMessageBody(event.target.value)}
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

              <div className="admin-card">
                <div className="admin-card-head">
                  <div>
                    <h3 className="admin-card-title">Historial</h3>
                    <p className="admin-card-sub">
                      Movimientos registrados de esta consulta.
                    </p>
                  </div>
                </div>
                <div className="admin-card-body">
                  {history.length ? (
                    <div className="admin-cons-history">
                      {history.map(entry => (
                        <div
                          className="admin-cons-history-row"
                          key={entry.id}
                        >
                          <span>{formatDateTimeEs(entry.created_at)}</span>
                          <b>
                            {HISTORY_ACTION_LABELS[entry.action] ??
                              entry.action}
                          </b>
                          <span>
                            {entry.actorName ?? "Sistema"}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="cell-muted">
                      Todavía no hay movimientos registrados.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
