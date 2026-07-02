'use client';

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3333';
const OPERATIONAL_TIME_ZONE = 'America/Argentina/Buenos_Aires';
const currencies = ['ARS', 'CHL', 'USD'] as const;
const investmentStatuses = ['EN_PROCESO', 'PRESUPUESTO_OK'] as const;
const datePresetOptions = [
  { value: 'thisMonth', label: 'Este mes' },
  { value: 'today', label: 'Hoy' },
  { value: 'yesterday', label: 'Ayer' },
  { value: 'previousMonth', label: 'Mes anterior' },
  { value: 'custom', label: 'Personalizado' }
] as const;
const baseObjectives = [
  'Ventas',
  'Alcance',
  'Leads',
  'Trafico',
  'Leads-mensajes',
  'Youtube',
  'Local campaing',
  'Visitas al perfil',
  'Interaccion'
];
const googleObjectiveSuffixes = ['PMAX', 'Search'];
const platformOptions = ['META', 'Google', 'MELI', 'TikTok'];
const allObjectiveOptions = uniqueValues([
  ...baseObjectives,
  ...['Trafico', 'Leads', 'Ventas'].flatMap((objective) => (
    googleObjectiveSuffixes.map((suffix) => `${objective}-${suffix}`)
  ))
]);
const GENERAL_VIEW = 'general';
const viewAsClients: Record<string, string[]> = {
  'florencia@redhookdata.com': ['FRESH UP', 'LONDON', 'ZONA FRANCA', 'PAMPA BAY', 'IMQ'],
  'francisco@redhookdata.com': ['WORLD SPORT', 'BINDER RULEMANES', 'LP', 'ORMIFLEX', 'RP', 'RHD'],
  'franco@redhookdata.com': ['PAMPA BAY', 'IMQ', 'LP', 'ORMIFLEX', 'BINDER RULEMANES', 'RP'],
  'sabrina@redhookdata.com': ['FRESH UP', 'LONDON', 'ZONA FRANCA', 'WORLD SPORT']
};
const viewAsOptions: SelectOption[] = [
  { label: 'Ver como general', value: GENERAL_VIEW },
  ...Object.keys(viewAsClients).map((email) => ({ label: `Ver como: ${email}`, value: email }))
];

type InvestmentCurrency = typeof currencies[number];
type InvestmentStatus = typeof investmentStatuses[number];
type DatePreset = typeof datePresetOptions[number]['value'];
type DateRange = { startDate: string; endDate: string };
type CustomDateRange = DateRange;
type ControlFilterKey = 'anunciante' | 'marca' | 'moneda' | 'plataforma' | 'objetivo';
type ControlFilters = Record<ControlFilterKey, string>;
type SortDirection = 'asc' | 'desc';
type SortKey =
  | 'presupuesto'
  | 'consumo'
  | 'porcentajeConsumo'
  | 'consumoRestante'
  | 'nuevoPresupuestoDiario'
  | 'desvio'
  | 'consumoDia'
  | 'resultadosProyectados'
  | 'fcProyectada';

type ControlSort = {
  key: SortKey;
  direction: SortDirection;
} | null;

type SelectOption = {
  label: string;
  value: string;
};

type UserRole = 'ADMIN' | 'MEDIA' | 'CLIENT';

type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
};

type LoginResponse = {
  token: string;
  user: AuthUser;
};

type MetricsSyncStatus = {
  key: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: 'running' | 'success' | 'failed' | null;
  totalSynced: number | null;
  error: string | null;
};

type MetricsSyncResponse = {
  syncStatus?: MetricsSyncStatus;
};

type InvestmentLine = {
  id: string;
  anunciante: string;
  marca?: string;
  moneda: InvestmentCurrency;
  status: InvestmentStatus;
  plataforma: string;
  objetivo: string;
  campana?: string;
  presupuesto: number;
  costoPorResultado: number;
  tktPromedio: number;
  mes: string;
  consumo: number;
  consumoDia: number;
  consumoAyer: number;
  presupuestoDaily: number;
  nuevoPresupuestoDiario: number;
  share: number;
  resultadosProyectados: number;
  fcProyectada: number;
  consumoRestante: number;
  porcentajeConsumo: number;
  desvio: number;
};

type InvestmentResponse = {
  summary: {
    mes: string;
    date: string;
    startDate: string;
    endDate: string;
    dias: number;
    diasRestantes: number;
    ritmo: number;
    presupuestoPlanificado: number;
    consumoTotal: number;
    restante: number;
    completion: number;
  };
  lines: InvestmentLine[];
};

type ManualForm = {
  anunciante: string;
  marca: string;
  moneda: InvestmentCurrency | '';
  status: InvestmentStatus;
  plataforma: string;
  objetivo: string;
  campana: string;
  presupuesto: string;
  costoPorResultado: string;
  tktPromedio: string;
  mes: string;
};

type ManualHistoryLine = Omit<ManualForm, 'moneda' | 'presupuesto' | 'costoPorResultado' | 'tktPromedio'> & {
  id: string;
  moneda: InvestmentCurrency;
  presupuesto: number;
  costoPorResultado: number;
  tktPromedio: number;
  createdAt?: string;
  updatedAt?: string | null;
};

type ManualInvestmentLogAction = 'CREATED' | 'UPDATED' | 'DELETED';

type ManualInvestmentLog = {
  id: string;
  action: ManualInvestmentLogAction;
  userId: string | null;
  userName: string;
  manualInvestmentLineId: string;
  manualInvestmentLineAnunciante: string;
  manualInvestmentLineSnapshot: ManualHistoryLine;
  createdAt: string;
  updatedAt: string | null;
  deletedAt: string | null;
};

function yesterdayDate() {
  return addDays(todayDate(), -1);
}

function todayDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: OPERATIONAL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const getPart = (type: string) => parts.find((part) => part.type === type)?.value || '00';

  return `${getPart('year')}-${getPart('month')}-${getPart('day')}`;
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function monthStart(date: string) {
  return `${date.slice(0, 7)}-01`;
}

function monthEnd(date: string) {
  const [year, month] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

const currentDate = todayDate();

function monthRange(month: string) {
  const safeMonth = /^\d{4}-\d{2}$/.test(month) ? month : currentDate.slice(0, 7);
  return { startDate: `${safeMonth}-01`, endDate: monthEnd(`${safeMonth}-01`) };
}

function isFinishedMonth(month: string) {
  return monthEnd(`${month}-01`) < currentDate;
}

function formatMonthLabel(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) return month;
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1, 1));
  return new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

const defaultForm: ManualForm = {
  anunciante: '',
  marca: '',
  moneda: '',
  status: 'EN_PROCESO',
  plataforma: '',
  objetivo: '',
  campana: '',
  presupuesto: '',
  costoPorResultado: '',
  tktPromedio: '',
  mes: currentDate.slice(0, 7)
};

const emptyControlFilters: ControlFilters = {
  anunciante: '',
  marca: '',
  moneda: '',
  plataforma: '',
  objetivo: ''
};

const sortLabels: Record<SortKey, string> = {
  presupuesto: 'Presupuesto',
  consumo: 'Consumo',
  porcentajeConsumo: '% Consumo',
  consumoRestante: 'Consumo restante',
  nuevoPresupuestoDiario: 'Nuevo presupuesto diario',
  desvio: 'Desvio',
  consumoDia: 'Consumo ayer',
  resultadosProyectados: 'Resultados proyectados',
  fcProyectada: 'FC proyectada'
};

function getDateRange(preset: DatePreset, customRange: CustomDateRange) {
  const today = todayDate();

  if (preset === 'today') {
    return { startDate: today, endDate: today };
  }

  if (preset === 'yesterday') {
    const yesterday = yesterdayDate();
    return { startDate: yesterday, endDate: yesterday };
  }

  if (preset === 'previousMonth') {
    const previousMonthDate = addDays(monthStart(today), -1);
    return { startDate: monthStart(previousMonthDate), endDate: monthEnd(previousMonthDate) };
  }

  if (preset === 'custom') {
    return customRange;
  }

  return { startDate: monthStart(today), endDate: today };
}

function getQueryMonth(preset: DatePreset, range: DateRange) {
  if (preset === 'previousMonth' || preset === 'custom') return range.startDate.slice(0, 7);
  return currentDate.slice(0, 7);
}

function getConsumptionSyncDate(preset: DatePreset, range: DateRange) {
  if (preset === 'thisMonth') return todayDate();
  return range.endDate;
}

function getConsumoDiaLabel(preset: DatePreset) {
  if (preset === 'today' || preset === 'thisMonth') return 'Consumo hoy';
  if (preset === 'yesterday') return 'Consumo ayer';
  return 'Consumo dia';
}

const integer = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });

function formatMoney(value: number, moneda: InvestmentCurrency = 'CHL') {
  if (moneda === 'CHL') {
    return `CHL ${integer.format(value)}`;
  }

  const currencyByMoneda: Record<InvestmentCurrency, string> = {
    ARS: 'ARS',
    CHL: 'CLP',
    USD: 'USD'
  };

  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: currencyByMoneda[moneda],
    maximumFractionDigits: moneda === 'USD' ? 2 : 0
  }).format(value);
}

function formatLastUpdate(value: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
}

function getManualLogActionLabel(action: ManualInvestmentLogAction) {
  const labels: Record<ManualInvestmentLogAction, string> = {
    CREATED: 'Creacion',
    UPDATED: 'Actualizacion',
    DELETED: 'Eliminacion'
  };

  return labels[action] ?? action;
}

function getObjectiveOptions(platform: string) {
  if (normalizePlatformName(platform) !== 'google') return baseObjectives;

  const googleObjectiveBases = ['Trafico', 'Leads', 'Ventas'];
  const googleObjectives = googleObjectiveBases.flatMap((objective) => (
    googleObjectiveSuffixes.map((suffix) => `${objective}-${suffix}`)
  ));

  return [...baseObjectives, ...googleObjectives];
}

function normalizePlatformName(platform: string) {
  return platform
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeClientName(value: string) {
  return value.trim().toUpperCase();
}

function getViewAllowedClients(viewAs: string): Set<string> | null {
  const clients = viewAsClients[viewAs];
  if (!clients) return null;
  return new Set(clients.map(normalizeClientName));
}

function lineMatchesView(line: InvestmentLine, allowedClients: Set<string> | null) {
  return !allowedClients || allowedClients.has(normalizeClientName(line.anunciante));
}

function formatPlatformLabel(platform: string) {
  const normalized = normalizePlatformName(platform);
  if (normalized === 'merc-libre' || normalized === 'mercado-libre' || normalized === 'm-libre' || normalized === 'meli') return 'MELI';
  if (normalized === 'linkedin') return 'LinkedIn';
  if (normalized === 'tiktok' || normalized === 'tik-tok') return 'TikTok';
  return platform;
}

function platformClassName(platform: string) {
  const normalized = normalizePlatformName(platform);
  if (normalized === 'merc-libre' || normalized === 'mercado-libre' || normalized === 'm-libre' || normalized === 'meli') return 'platform-merc-libre';
  if (normalized === 'tik-tok') return 'platform-tiktok';
  return `platform-${normalized}`;
}

type CurrencyTotal = {
  moneda: InvestmentCurrency;
  presupuesto: number;
  fcProyectada: number;
};

type ControlCurrencyTotal = {
  moneda: InvestmentCurrency;
  presupuesto: number;
  consumo: number;
  consumoRestante: number;
  nuevoPresupuestoDiario: number;
  consumoDia: number;
};

function sortCurrencyTotals(totals: CurrencyTotal[]) {
  return totals.sort((a, b) => a.moneda.localeCompare(b.moneda));
}

function formatCurrencyTotals(totals: CurrencyTotal[], field: 'presupuesto' | 'fcProyectada') {
  return sortCurrencyTotals([...totals])
    .map((total) => formatMoney(total[field], total.moneda))
    .join(' | ');
}

function getBrandTotals(lines: InvestmentLine[]) {
  const totals = new Map<string, { marca: string; currencies: Map<InvestmentCurrency, CurrencyTotal> }>();

  lines.forEach((line) => {
    const marca = line.marca ?? 'Sin marca';
    const existing = totals.get(marca) ?? { marca, currencies: new Map<InvestmentCurrency, CurrencyTotal>() };
    const currencyTotal = existing.currencies.get(line.moneda) ?? { moneda: line.moneda, presupuesto: 0, fcProyectada: 0 };
    existing.currencies.set(line.moneda, {
      moneda: line.moneda,
      presupuesto: currencyTotal.presupuesto + line.presupuesto,
      fcProyectada: currencyTotal.fcProyectada + line.fcProyectada
    });
    totals.set(marca, existing);
  });

  return Array.from(totals.values())
    .map((item) => ({ marca: item.marca, totals: sortCurrencyTotals(Array.from(item.currencies.values())) }))
    .sort((a, b) => a.marca.localeCompare(b.marca));
}

function getClientTotals(lines: InvestmentLine[]) {
  const totals = new Map<string, { cliente: string; currencies: Map<InvestmentCurrency, CurrencyTotal> }>();

  lines.forEach((line) => {
    const existing = totals.get(line.anunciante) ?? { cliente: line.anunciante, currencies: new Map<InvestmentCurrency, CurrencyTotal>() };
    const currencyTotal = existing.currencies.get(line.moneda) ?? { moneda: line.moneda, presupuesto: 0, fcProyectada: 0 };
    existing.currencies.set(line.moneda, {
      moneda: line.moneda,
      presupuesto: currencyTotal.presupuesto + line.presupuesto,
      fcProyectada: currencyTotal.fcProyectada + line.fcProyectada
    });
    totals.set(line.anunciante, existing);
  });

  return Array.from(totals.values())
    .map((item) => ({ cliente: item.cliente, totals: sortCurrencyTotals(Array.from(item.currencies.values())) }))
    .sort((a, b) => a.cliente.localeCompare(b.cliente));
}

function getRoundedGroupShares(groupLines: InvestmentLine[]) {
  const shares = new Map<string, number>();
  const byCurrency = new Map<InvestmentCurrency, InvestmentLine[]>();

  groupLines.forEach((line) => {
    byCurrency.set(line.moneda, [...(byCurrency.get(line.moneda) ?? []), line]);
  });

  byCurrency.forEach((lines) => {
    const total = lines.reduce((sum, line) => sum + line.presupuesto, 0);
    if (total <= 0) {
      lines.forEach((line) => shares.set(line.id, 0));
      return;
    }

    const parts = lines.map((line) => {
      const exact = (line.presupuesto / total) * 100;
      return {
        id: line.id,
        roundedDown: Math.floor(exact),
        remainder: exact - Math.floor(exact)
      };
    });
    const missing = 100 - parts.reduce((sum, part) => sum + part.roundedDown, 0);
    const bonusIds = new Set(
      [...parts]
        .sort((a, b) => b.remainder - a.remainder)
        .slice(0, missing)
        .map((part) => part.id)
    );

    parts.forEach((part) => {
      shares.set(part.id, part.roundedDown + (bonusIds.has(part.id) ? 1 : 0));
    });
  });

  return shares;
}

function getControlCurrencyTotals(lines: InvestmentLine[]): ControlCurrencyTotal[] {
  const totals = new Map<InvestmentCurrency, ControlCurrencyTotal>();

  lines.forEach((line) => {
    const current = totals.get(line.moneda) ?? {
      moneda: line.moneda,
      presupuesto: 0,
      consumo: 0,
      consumoRestante: 0,
      nuevoPresupuestoDiario: 0,
      consumoDia: 0
    };

    totals.set(line.moneda, {
      moneda: line.moneda,
      presupuesto: current.presupuesto + line.presupuesto,
      consumo: current.consumo + line.consumo,
      consumoRestante: current.consumoRestante + line.consumoRestante,
      nuevoPresupuestoDiario: current.nuevoPresupuestoDiario + line.nuevoPresupuestoDiario,
      consumoDia: current.consumoDia + line.consumoDia
    });
  });

  return Array.from(totals.values()).sort((a, b) => a.moneda.localeCompare(b.moneda));
}

function getManualFormSuggestions(lines: ManualHistoryLine[], form: ManualForm): ManualHistoryLine[] {
  if (!form.anunciante || !form.marca || !form.plataforma) return [];

  const client = normalizeClientName(form.anunciante);
  const brand = normalizeTypeaheadText(form.marca);
  const platform = normalizePlatformName(form.plataforma);
  const matches = lines.filter((line) => (
    normalizeClientName(line.anunciante) === client
    && normalizeTypeaheadText(line.marca ?? '') === brand
    && normalizePlatformName(line.plataforma) === platform
  ));

  return matches.sort((a, b) => getManualLineRecency(b) - getManualLineRecency(a));
}

function getCampaignSuggestionLabel(line: ManualHistoryLine) {
  return line.campana?.trim() || 'Sin nombre campaña';
}

function getManualLineRecency(line: ManualHistoryLine) {
  const date = line.updatedAt || line.createdAt || `${line.mes}-01T00:00:00.000Z`;
  const timestamp = new Date(date).getTime();
  if (Number.isFinite(timestamp)) return timestamp;
  return new Date(`${line.mes}-01T00:00:00.000Z`).getTime();
}

function getControlFilterOptions(lines: InvestmentLine[]): Record<ControlFilterKey, string[]> {
  return {
    anunciante: uniqueValues(lines.map((line) => line.anunciante)),
    marca: uniqueValues(lines.map((line) => line.marca ?? '')),
    moneda: uniqueValues(lines.map((line) => line.moneda)),
    plataforma: uniqueValues(lines.map((line) => line.plataforma)),
    objetivo: uniqueValues(lines.map((line) => line.objetivo))
  };
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function normalizeTypeaheadText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function getDeviationClass(value: number) {
  const percent = Math.round(value * 100);
  if (percent >= 5 || percent <= -5) return 'deviation-cell danger';
  if ((percent >= 3 && percent <= 4) || (percent <= -3 && percent >= -4)) return 'deviation-cell warning';
  if (percent >= -2 && percent <= 2) return 'deviation-cell good';
  return 'deviation-cell';
}

export function InvestmentsApp({ initialTab }: { initialTab: 'control' | 'manual' }) {
  const router = useRouter();
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authToken, setAuthToken] = useState('');
  const [authLoading, setAuthLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'control' | 'manual'>(initialTab);
  const [data, setData] = useState<InvestmentResponse | null>(null);
  const [manualData, setManualData] = useState<InvestmentResponse | null>(null);
  const [manualHistory, setManualHistory] = useState<ManualHistoryLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);
  const [datePreset, setDatePreset] = useState<DatePreset>('thisMonth');
  const [customRange, setCustomRange] = useState<CustomDateRange>(() => monthRange(currentDate.slice(0, 7)));
  const [previewMonth, setPreviewMonth] = useState(currentDate.slice(0, 7));
  const [syncing, setSyncing] = useState(false);
  const [consumptionSyncStatus, setConsumptionSyncStatus] = useState<MetricsSyncStatus | null>(null);
  const [lastConsumptionSyncAt, setLastConsumptionSyncAt] = useState('');
  const [previousValuesOpen, setPreviousValuesOpen] = useState(false);
  const [historyModalLine, setHistoryModalLine] = useState<InvestmentLine | null>(null);
  const [lineHistory, setLineHistory] = useState<ManualInvestmentLog[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [brandClients, setBrandClients] = useState<string[]>([]);
  const [brandCatalog, setBrandCatalog] = useState<Record<string, string[]>>({});
  const [viewAs, setViewAs] = useState(GENERAL_VIEW);
  const [summaryCurrency, setSummaryCurrency] = useState<InvestmentCurrency>('ARS');
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [lineDraft, setLineDraft] = useState<ManualForm | null>(null);
  const [editClientBrands, setEditClientBrands] = useState<string[]>([]);
  const [deleteMode, setDeleteMode] = useState(false);
  const [selectedDeleteIds, setSelectedDeleteIds] = useState<string[]>([]);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [controlFilters, setControlFilters] = useState<ControlFilters>(emptyControlFilters);
  const [openControlFilter, setOpenControlFilter] = useState<ControlFilterKey | null>(null);
  const [controlSort, setControlSort] = useState<ControlSort>(null);
  const [openSelectId, setOpenSelectId] = useState<string | null>(null);
  const [previewClientFilter, setPreviewClientFilter] = useState('');
  const [previewBrandFilter, setPreviewBrandFilter] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const canManageManualLines = authUser?.role === 'ADMIN' || authUser?.role === 'MEDIA';

  const selectedRange = useMemo(
    () => getDateRange(datePreset, customRange),
    [datePreset, customRange]
  );
  const viewAllowedClients = useMemo(() => getViewAllowedClients(viewAs), [viewAs]);
  const clients = useMemo(
    () => (brandClients.length > 0 ? brandClients : Object.keys(brandCatalog).sort())
      .filter((cliente) => !viewAllowedClients || viewAllowedClients.has(normalizeClientName(cliente))),
    [brandCatalog, brandClients, viewAllowedClients]
  );
  const scopedBrandCatalog = useMemo(() => (
    Object.entries(brandCatalog).reduce<Record<string, string[]>>((acc, [cliente, marcas]) => {
      if (!viewAllowedClients || viewAllowedClients.has(normalizeClientName(cliente))) {
        acc[cliente] = marcas;
      }
      return acc;
    }, {})
  ), [brandCatalog, viewAllowedClients]);
  const scopedControlData = useMemo<InvestmentResponse | null>(() => {
    if (!data) return null;
    return {
      ...data,
      lines: data.lines.filter((line) => lineMatchesView(line, viewAllowedClients))
    };
  }, [data, viewAllowedClients]);
  const scopedManualData = useMemo<InvestmentResponse | null>(() => {
    if (!manualData) return null;
    return {
      ...manualData,
      lines: manualData.lines.filter((line) => lineMatchesView(line, viewAllowedClients))
    };
  }, [manualData, viewAllowedClients]);
  const selectedBrands = useMemo(() => scopedBrandCatalog[form.anunciante] ?? [], [scopedBrandCatalog, form.anunciante]);
  const manualFormSuggestions = useMemo(() => getManualFormSuggestions(manualHistory, form), [manualHistory, form]);
  const controlFilterOptions = useMemo(() => getControlFilterOptions(scopedControlData?.lines ?? []), [scopedControlData]);
  const filteredControlLines = useMemo(() => {
    const lines = (scopedControlData?.lines ?? []).filter((line) => (
      (!controlFilters.anunciante || line.anunciante === controlFilters.anunciante)
      && (!controlFilters.marca || (line.marca ?? '') === controlFilters.marca)
      && (!controlFilters.moneda || line.moneda === controlFilters.moneda)
      && (!controlFilters.plataforma || line.plataforma === controlFilters.plataforma)
      && (!controlFilters.objetivo || line.objetivo === controlFilters.objetivo)
    ));

    if (!controlSort) return lines;

    return [...lines].sort((a, b) => {
      const result = Number(a[controlSort.key] ?? 0) - Number(b[controlSort.key] ?? 0);
      return controlSort.direction === 'asc' ? result : -result;
    });
  }, [scopedControlData, controlFilters, controlSort]);
  const controlCurrencyTotals = useMemo(() => getControlCurrencyTotals(filteredControlLines), [filteredControlLines]);
  const previewBrands = useMemo(() => {
    const lines = scopedManualData?.lines ?? [];
    return Array.from(new Set(
      lines
        .filter((line) => !previewClientFilter || line.anunciante === previewClientFilter)
        .map((line) => line.marca ?? '')
        .filter(Boolean)
    )).sort();
  }, [scopedManualData, previewClientFilter]);
  const filteredManualPreviewLines = useMemo(() => (
    (scopedManualData?.lines ?? [])
      .filter((line) => !previewClientFilter || line.anunciante === previewClientFilter)
      .filter((line) => !previewBrandFilter || line.marca === previewBrandFilter)
  ), [scopedManualData, previewClientFilter, previewBrandFilter]);
  const objectiveOptions = useMemo(() => getObjectiveOptions(form.plataforma), [form.plataforma]);
  const editBrandOptions = useMemo(() => {
    if (!lineDraft?.anunciante) return [];

    return uniqueValues([
      ...editClientBrands,
      ...(scopedBrandCatalog[lineDraft.anunciante] ?? []),
      ...((scopedManualData?.lines ?? [])
        .filter((line) => line.anunciante === lineDraft.anunciante)
        .map((line) => line.marca ?? ''))
    ]);
  }, [scopedBrandCatalog, editClientBrands, lineDraft?.anunciante, scopedManualData]);

  const groupedLines = useMemo(() => {
    const groups = new Map<string, InvestmentLine[]>();
    filteredManualPreviewLines.forEach((line) => {
      const key = `${line.anunciante}-${line.marca ?? 'Sin marca'}`;
      groups.set(key, [...(groups.get(key) ?? []), line]);
    });
    return Array.from(groups.entries()).map(([key, lines]) => ({ key, lines }));
  }, [filteredManualPreviewLines]);
  const formMonthFinished = isFinishedMonth(form.mes);
  const manualPreviewMonthLabel = formatMonthLabel(previewMonth);
  const manualPreviewMonthFinished = isFinishedMonth(previewMonth);
  const canEditManualPreview = canManageManualLines && !manualPreviewMonthFinished;
  const syncRunning = syncing || consumptionSyncStatus?.status === 'running';

  async function requestJson<T>(url: string, options?: RequestInit & { timeoutMs?: number }): Promise<T> {
    const headers = new Headers(options?.headers);
    if (authToken) headers.set('Authorization', `Bearer ${authToken}`);

    const timeoutMs = options?.timeoutMs;
    const controller = timeoutMs ? new AbortController() : null;
    const timeout = controller
      ? window.setTimeout(() => controller.abort(), timeoutMs)
      : undefined;

    let response: Response;
    try {
      response = await fetch(url, {
        ...options,
        headers,
        signal: controller?.signal || options?.signal
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('La sincronizacion tardo demasiado. Probemos con menos cuentas o una fuente puntual.');
      }

      throw error;
    } finally {
      if (timeout) window.clearTimeout(timeout);
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401) {
        localStorage.removeItem('mediapulse-auth');
        setAuthToken('');
        setAuthUser(null);
      }

      const message = payload?.message;
      throw new Error(Array.isArray(message) ? message.join(', ') : message || 'No se pudo completar la operacion');
    }
    return payload as T;
  }

  function handleLogout() {
    localStorage.removeItem('mediapulse-auth');
    setAuthToken('');
    setAuthUser(null);
    setData(null);
    setManualData(null);
    router.push('/login');
  }

  async function loadInvestments(range = selectedRange, preset = datePreset) {
    setLoading(true);
    setErrorMessage('');
    try {
      const mes = getQueryMonth(preset, range);
      const payload = await requestJson<InvestmentResponse>(`${API_BASE}/investments?mes=${mes}&startDate=${range.startDate}&endDate=${range.endDate}&mode=${preset}`, { cache: 'no-store' });
      setData(payload);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo cargar inversiones');
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  async function loadConsumptionSyncStatus() {
    const status = await requestJson<MetricsSyncStatus>(`${API_BASE}/metrics/sync/status?key=consumption`, { cache: 'no-store' });
    setConsumptionSyncStatus(status);
    setLastConsumptionSyncAt(status.finishedAt || status.startedAt || '');
    return status;
  }

  async function loadManualPreview(month = previewMonth) {
    try {
      const range = monthRange(month);
      const payload = await requestJson<InvestmentResponse>(`${API_BASE}/investments?mes=${month}&startDate=${range.startDate}&endDate=${range.endDate}&includeDrafts=true&mode=custom`, { cache: 'no-store' });
      setManualData(payload);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo cargar la carga manual');
      setManualData(null);
    }
  }

  async function loadManualHistory() {
    try {
      const payload = await requestJson<ManualHistoryLine[]>(`${API_BASE}/investments/manual`, { cache: 'no-store' });
      setManualHistory(payload);
    } catch {
      setManualHistory([]);
    }
  }

  async function openLineHistory(line: InvestmentLine) {
    setHistoryModalLine(line);
    setLineHistory([]);
    setHistoryLoading(true);
    setErrorMessage('');

    try {
      const payload = await requestJson<ManualInvestmentLog[]>(`${API_BASE}/investments/manual/${line.id}/history`, { cache: 'no-store' });
      setLineHistory(payload);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo cargar el historial de la linea');
      setLineHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    async function restoreSession() {
      try {
        const raw = localStorage.getItem('mediapulse-auth');
        if (!raw) {
          router.replace(`/login?from=${initialTab === 'manual' ? '/carga-manual' : '/control'}`);
          return;
        }

        const session = JSON.parse(raw) as LoginResponse;
        const response = await fetch(`${API_BASE}/auth/me`, {
          headers: { Authorization: `Bearer ${session.token}` },
          cache: 'no-store'
        });

        if (!response.ok) {
          localStorage.removeItem('mediapulse-auth');
          router.replace(`/login?from=${initialTab === 'manual' ? '/carga-manual' : '/control'}`);
          return;
        }

        const user = await response.json() as AuthUser;
        setAuthToken(session.token);
        setAuthUser(user);
        const email = user.email.toLowerCase();
        setViewAs(viewAsClients[email] ? email : GENERAL_VIEW);
      } catch {
        localStorage.removeItem('mediapulse-auth');
        router.replace(`/login?from=${initialTab === 'manual' ? '/carga-manual' : '/control'}`);
      } finally {
        setAuthLoading(false);
      }
    }

    restoreSession();
  }, [initialTab, router]);

  useEffect(() => {
    if (!authToken) return;
    loadConsumptionSyncStatus().catch(() => undefined);
  }, [authToken]);

  useEffect(() => {
    if (!authToken || consumptionSyncStatus?.status !== 'running') return;

    let cancelled = false;
    const interval = window.setInterval(async () => {
      try {
        const status = await loadConsumptionSyncStatus();
        if (cancelled || status.status === 'running') return;
        await loadInvestments(getDateRange(datePreset, customRange), datePreset);
      } catch {
        return undefined;
      }
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [authToken, consumptionSyncStatus?.status, datePreset, customRange, selectedRange.startDate, selectedRange.endDate]);

  useEffect(() => {
    if (!authToken) return;
    loadInvestments().catch(() => setLoading(false));
  }, [authToken, datePreset, selectedRange.startDate, selectedRange.endDate]);

  useEffect(() => {
    if (!authToken) return;
    loadManualPreview().catch(() => undefined);
  }, [authToken, previewMonth]);

  useEffect(() => {
    if (!authToken) return;
    loadManualHistory().catch(() => undefined);
  }, [authToken]);

  useEffect(() => {
    setPreviewClientFilter('');
    setPreviewBrandFilter('');
    setEditingLineId(null);
    setLineDraft(null);
    setDeleteMode(false);
    setSelectedDeleteIds([]);
  }, [previewMonth]);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    setPreviousValuesOpen(false);
  }, [form.anunciante, form.marca, form.plataforma]);

  useEffect(() => {
    setControlFilters(emptyControlFilters);
    setControlSort(null);
    setPreviewClientFilter('');
    setPreviewBrandFilter('');
    setEditingLineId(null);
    setLineDraft(null);
    setOpenControlFilter(null);
    setOpenSelectId(null);
  }, [viewAs]);

  useEffect(() => {
    if (!authToken) return;

    async function loadBrandCatalog() {
      const [clientOptions, mappings] = await Promise.all([
        requestJson<string[]>(`${API_BASE}/brand-mapping/clients`, { cache: 'no-store' }),
        requestJson<Array<{ cliente: string; marca: string }>>(`${API_BASE}/brand-mapping`, { cache: 'no-store' })
      ]);
      const grouped = mappings.reduce<Record<string, string[]>>((acc, item) => {
        acc[item.cliente] = [...(acc[item.cliente] ?? []), item.marca];
        return acc;
      }, {});

      Object.keys(grouped).forEach((cliente) => {
        grouped[cliente] = Array.from(new Set(grouped[cliente])).sort();
      });

      setBrandClients(clientOptions);
      setBrandCatalog(grouped);
    }

    loadBrandCatalog().catch(() => {
      setBrandClients([]);
      setBrandCatalog({});
    });
  }, [authToken]);

  useEffect(() => {
    if (!authToken || !lineDraft?.anunciante) {
      setEditClientBrands([]);
      return;
    }

    requestJson<string[]>(
      `${API_BASE}/brand-mapping/clients/${encodeURIComponent(lineDraft.anunciante)}/brands`,
      { cache: 'no-store' }
    )
      .then(setEditClientBrands)
      .catch(() => setEditClientBrands([]));
  }, [authToken, lineDraft?.anunciante]);

  useEffect(() => {
    function closeDropdowns(event: MouseEvent | TouchEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-dropdown-root="true"]')) return;
      setOpenSelectId(null);
      setOpenControlFilter(null);
    }

    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setOpenSelectId(null);
      setOpenControlFilter(null);
      setPreviousValuesOpen(false);
    }

    document.addEventListener('mousedown', closeDropdowns);
    document.addEventListener('touchstart', closeDropdowns);
    document.addEventListener('keydown', closeOnEscape);

    return () => {
      document.removeEventListener('mousedown', closeDropdowns);
      document.removeEventListener('touchstart', closeDropdowns);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  async function syncSupermetrics() {
    if (syncRunning) return;
    setSyncing(true);
    try {
      setErrorMessage('');
      const syncDate = getConsumptionSyncDate(datePreset, selectedRange);
      const syncUrl = datePreset === 'custom' || datePreset === 'previousMonth'
        ? `${API_BASE}/metrics/sync/date-range?source=all&startDate=${selectedRange.startDate}&endDate=${selectedRange.endDate}`
        : `${API_BASE}/metrics/sync/monthly-and-daily?source=all&date=${syncDate}`;
      const response = await requestJson<MetricsSyncResponse>(syncUrl, {
        method: 'POST',
        timeoutMs: 180000
      });
      if (response.syncStatus) setConsumptionSyncStatus(response.syncStatus);
      const syncedAt = response.syncStatus?.finishedAt || response.syncStatus?.startedAt || '';
      if (syncedAt) setLastConsumptionSyncAt(syncedAt);
      await loadInvestments(getDateRange(datePreset, customRange), datePreset);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo actualizar consumo');
    } finally {
      setSyncing(false);
    }
  }

  function clearManualForm() {
    setForm((current) => ({
      ...defaultForm,
      mes: current.mes
    }));
    setPreviousValuesOpen(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManageManualLines) return;
    if (formMonthFinished) {
      setErrorMessage('No se puede cargar presupuesto en un mes finalizado');
      return;
    }
    setSaving(true);

    setErrorMessage('');
    try {
      await requestJson(`${API_BASE}/investments/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          presupuesto: Number(form.presupuesto),
          costoPorResultado: Number(form.costoPorResultado),
          tktPromedio: Number(form.tktPromedio)
        })
      });

      setForm((current) => ({
        ...defaultForm,
        mes: current.mes
      }));
      await loadInvestments(getDateRange(datePreset, customRange), datePreset);
      await loadManualPreview();
      await loadManualHistory();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo guardar la linea');
    } finally {
      setSaving(false);
    }
  }

  async function saveLine(line: InvestmentLine) {
    if (!lineDraft || !canManageManualLines) return;
    if (manualPreviewMonthFinished) return;

    setErrorMessage('');
    try {
      await requestJson(`${API_BASE}/investments/manual/${line.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...lineDraft,
          presupuesto: Number(lineDraft.presupuesto),
          costoPorResultado: Number(lineDraft.costoPorResultado),
          tktPromedio: Number(lineDraft.tktPromedio)
        })
      });

      setEditingLineId(null);
      setLineDraft(null);
      await loadInvestments();
      await loadManualPreview();
      await loadManualHistory();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo editar la linea');
    }
  }

  async function updateLineStatus(line: InvestmentLine, status: InvestmentStatus) {
    if (!canManageManualLines) return;
    if (manualPreviewMonthFinished) return;
    if (line.status === status) return;

    setErrorMessage('');
    try {
      await requestJson(`${API_BASE}/investments/manual/${line.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          anunciante: line.anunciante,
          marca: line.marca ?? '',
          moneda: line.moneda,
          plataforma: line.plataforma,
          objetivo: line.objetivo,
          campana: line.campana ?? '',
          presupuesto: line.presupuesto,
          costoPorResultado: line.costoPorResultado,
          tktPromedio: line.tktPromedio,
          status
        })
      });
      await loadInvestments();
      await loadManualPreview();
      await loadManualHistory();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo actualizar el status');
    }
  }

  async function updateGroupStatus(lines: InvestmentLine[], status: InvestmentStatus) {
    if (!canManageManualLines) return;
    if (manualPreviewMonthFinished) return;
    const changedLines = lines.filter((line) => line.status !== status);
    if (changedLines.length === 0) return;

    setErrorMessage('');
    try {
      await Promise.all(changedLines.map((line) => requestJson(`${API_BASE}/investments/manual/${line.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          anunciante: line.anunciante,
          marca: line.marca ?? '',
          moneda: line.moneda,
          plataforma: line.plataforma,
          objetivo: line.objetivo,
          campana: line.campana ?? '',
          presupuesto: line.presupuesto,
          costoPorResultado: line.costoPorResultado,
          tktPromedio: line.tktPromedio,
          status
        })
      })));
      await loadInvestments();
      await loadManualPreview();
      await loadManualHistory();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo actualizar el status');
    }
  }

  function applyManualSuggestion(suggestion: ManualHistoryLine) {
    setForm((current) => ({
      ...current,
      moneda: suggestion.moneda,
      objetivo: suggestion.objetivo,
      campana: suggestion.campana ?? '',
      presupuesto: String(suggestion.presupuesto),
      costoPorResultado: String(suggestion.costoPorResultado),
      tktPromedio: String(suggestion.tktPromedio)
    }));
    setPreviousValuesOpen(false);
  }

  function startLineEdit(line: InvestmentLine) {
    if (!canManageManualLines) return;
    if (manualPreviewMonthFinished) return;
    setDeleteMode(false);
    setSelectedDeleteIds([]);
    setOpenSelectId(null);
    setOpenControlFilter(null);
    setEditClientBrands(uniqueValues([
      ...(scopedBrandCatalog[line.anunciante] ?? []),
      ...((scopedManualData?.lines ?? [])
        .filter((currentLine) => currentLine.anunciante === line.anunciante)
        .map((currentLine) => currentLine.marca ?? ''))
    ]));
    setEditingLineId(line.id);
    setLineDraft({
      anunciante: line.anunciante,
      marca: line.marca ?? '',
      moneda: line.moneda,
      plataforma: line.plataforma,
      objetivo: line.objetivo,
      campana: line.campana ?? '',
      presupuesto: String(line.presupuesto),
      costoPorResultado: String(line.costoPorResultado),
      tktPromedio: String(line.tktPromedio),
      status: line.status,
      mes: line.mes
    });

    requestJson<string[]>(
      `${API_BASE}/brand-mapping/clients/${encodeURIComponent(line.anunciante)}/brands`,
      { cache: 'no-store' }
    )
      .then(setEditClientBrands)
      .catch(() => undefined);
  }

  function toggleDeleteMode() {
    if (!canManageManualLines) return;
    if (manualPreviewMonthFinished) return;
    setEditingLineId(null);
    setLineDraft(null);
    setDeleteMode((current) => {
      if (current) setSelectedDeleteIds([]);
      return !current;
    });
  }

  function toggleDeleteSelection(id: string) {
    if (!canManageManualLines) return;
    if (manualPreviewMonthFinished) return;
    setSelectedDeleteIds((current) => (
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    ));
  }

  function toggleDeleteBrandSelection(lines: InvestmentLine[], marca: string) {
    if (!canManageManualLines) return;
    if (manualPreviewMonthFinished) return;
    const brandIds = lines
      .filter((line) => (line.marca ?? line.anunciante) === marca)
      .map((line) => line.id);

    setSelectedDeleteIds((current) => {
      const selected = new Set(current);
      const allSelected = brandIds.length > 0 && brandIds.every((id) => selected.has(id));

      if (allSelected) {
        brandIds.forEach((id) => selected.delete(id));
      } else {
        brandIds.forEach((id) => selected.add(id));
      }

      return Array.from(selected);
    });
  }

  async function confirmDeleteLines() {
    if (!canManageManualLines) return;
    if (manualPreviewMonthFinished) return;
    if (selectedDeleteIds.length === 0) return;

    setDeleting(true);
    setErrorMessage('');
    try {
      await requestJson(`${API_BASE}/investments/manual`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedDeleteIds })
      });
      setDeleteModalOpen(false);
      setDeleteMode(false);
      setSelectedDeleteIds([]);
      await loadInvestments();
      await loadManualPreview();
      await loadManualHistory();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudieron eliminar las lineas');
    } finally {
      setDeleting(false);
    }
  }

  if (authLoading) {
    return (
      <main className="auth-shell">
        <div className="auth-loading">Validando sesion...</div>
      </main>
    );
  }

  if (!authUser) return null;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">MediaPulse RHD</p>
          <h1>Inversiones</h1>
        </div>
        <div className="date-actions-stack">
          <div className="date-actions">
            <label className="month-control view-as-control">
              Ver como
              <CustomSelect
                id="view-as"
                className="view-as-select"
                value={viewAs}
                options={viewAsOptions}
                openSelectId={openSelectId}
                onOpenSelect={setOpenSelectId}
                onChange={setViewAs}
                ariaLabel="Ver como"
              />
            </label>
            <DateRangeControl
              preset={datePreset}
              range={selectedRange}
              customRange={customRange}
              openSelectId={openSelectId}
              onOpenSelect={setOpenSelectId}
              onPresetChange={setDatePreset}
              onCustomRangeChange={setCustomRange}
            />
            <button className="sync-button" type="button" onClick={syncSupermetrics} disabled={syncRunning}>
              {syncRunning ? 'Sincronizando...' : 'Actualizar consumo'}
            </button>
            <div className="user-pill">
              <button type="button" onClick={handleLogout}>Salir</button>
            </div>
          </div>
          <p className="last-sync">Ultima actualizacion: {formatLastUpdate(lastConsumptionSyncAt)}</p>
        </div>
      </header>

      <nav className="tabs" aria-label="Vistas de inversiones">
        <button className={activeTab === 'control' ? 'active' : ''} onClick={() => router.push('/control')}>
          Control
        </button>
        <button className={activeTab === 'manual' ? 'active' : ''} onClick={() => router.push('/carga-manual')}>
         Forecast
        </button>
      </nav>

      {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}

      {activeTab === 'control' ? (
        <section className="workspace">
          <SummaryStrip
            data={scopedControlData}
            loading={loading}
            currency={summaryCurrency}
            onCurrencyChange={setSummaryCurrency}
            openSelectId={openSelectId}
            onOpenSelect={setOpenSelectId}
          />
          <div className="control-toolbar">
            <button className="secondary-button" type="button" onClick={() => {
              setControlFilters(emptyControlFilters);
              setControlSort(null);
            }}>
              Limpiar filtros
            </button>
          </div>
          <div className="table-wrap">
            <table className="control-table">
              <thead>
                <tr>
                  <FilterHeader
                    filterKey="anunciante"
                    label="Anunciante"
                    value={controlFilters.anunciante}
                    options={clients}
                    openFilter={openControlFilter}
                    onToggle={setOpenControlFilter}
                    onChange={(value) => setControlFilters((current) => ({ ...current, anunciante: value }))}
                  />
                  <FilterHeader
                    filterKey="marca"
                    label="Marca"
                    value={controlFilters.marca}
                    options={controlFilterOptions.marca}
                    openFilter={openControlFilter}
                    onToggle={setOpenControlFilter}
                    onChange={(value) => setControlFilters((current) => ({ ...current, marca: value }))}
                  />
                  <FilterHeader
                    filterKey="moneda"
                    label="Moneda"
                    value={controlFilters.moneda}
                    options={controlFilterOptions.moneda}
                    openFilter={openControlFilter}
                    onToggle={setOpenControlFilter}
                    onChange={(value) => setControlFilters((current) => ({ ...current, moneda: value }))}
                  />
                  <FilterHeader
                    filterKey="plataforma"
                    label="Plataforma"
                    value={controlFilters.plataforma}
                    options={controlFilterOptions.plataforma}
                    formatOptionLabel={formatPlatformLabel}
                    openFilter={openControlFilter}
                    onToggle={setOpenControlFilter}
                    onChange={(value) => setControlFilters((current) => ({ ...current, plataforma: value }))}
                  />
                  <FilterHeader
                    filterKey="objetivo"
                    label="Objetivo"
                    value={controlFilters.objetivo}
                    options={controlFilterOptions.objetivo}
                    openFilter={openControlFilter}
                    onToggle={setOpenControlFilter}
                    onChange={(value) => setControlFilters((current) => ({ ...current, objetivo: value }))}
                  />
                  <th>Campaña</th>
                  {Object.entries(sortLabels).map(([key, label]) => (
                    <SortHeader
                      key={key}
                      label={key === 'consumoDia' ? getConsumoDiaLabel(datePreset) : label}
                      sortKey={key as SortKey}
                      currentSort={controlSort}
                      onChange={setControlSort}
                    />
                  ))}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredControlLines.map((line) => (
                  <tr key={line.id}>
                    <td>{line.anunciante}</td>
                    <td>{line.marca ?? '-'}</td>
                    <td>{line.moneda}</td>
                    <td><span className={`platform ${platformClassName(line.plataforma)}`}>{formatPlatformLabel(line.plataforma)}</span></td>
                    <td>{line.objetivo}</td>
                    <td>{line.campana || '-'}</td>
                    <td>{formatMoney(line.presupuesto, line.moneda)}</td>
                    <td>{formatMoney(line.consumo, line.moneda)}</td>
                    <td>{Math.round(line.porcentajeConsumo * 100)}%</td>
                    <td className={line.consumoRestante < 0 ? 'negative' : ''}>{formatMoney(line.consumoRestante, line.moneda)}</td>
                    <td>{formatMoney(line.nuevoPresupuestoDiario, line.moneda)}</td>
                    <td className={getDeviationClass(line.desvio)}>{Math.round(line.desvio * 100)}%</td>
                    <td>{formatMoney(line.consumoDia, line.moneda)}</td>
                    <td>{integer.format(line.resultadosProyectados)}</td>
                    <td>{formatMoney(line.fcProyectada, line.moneda)}</td>
                    <td className="actions-cell">
                      <button className="icon-button" type="button" onClick={() => openLineHistory(line)} aria-label="Ver historial de linea">
                        <EyeIcon />
                      </button>
                    </td>
                  </tr>
                ))}
                {!loading && filteredControlLines.length === 0 ? (
                  <tr>
                    <td colSpan={16} className="empty">No hay inversiones cargadas para este mes.</td>
                  </tr>
                ) : null}
              </tbody>
              {controlCurrencyTotals.length > 0 ? (
                <tfoot className="control-totals">
                  {controlCurrencyTotals.map((total) => (
                    <tr key={total.moneda}>
                      <td colSpan={6}>Gran total {total.moneda}</td>
                      <td>{formatMoney(total.presupuesto, total.moneda)}</td>
                      <td>{formatMoney(total.consumo, total.moneda)}</td>
                      <td>{total.presupuesto > 0 ? `${Math.round((total.consumo / total.presupuesto) * 100)}%` : '0%'}</td>
                      <td className={total.consumoRestante < 0 ? 'negative' : ''}>{formatMoney(total.consumoRestante, total.moneda)}</td>
                      <td>{formatMoney(total.nuevoPresupuestoDiario, total.moneda)}</td>
                      <td></td>
                      <td>{formatMoney(total.consumoDia, total.moneda)}</td>
                      <td colSpan={3}></td>
                    </tr>
                  ))}
                </tfoot>
              ) : null}
            </table>
          </div>
        </section>
      ) : (
        <section className={`manual-grid ${canManageManualLines ? '' : 'viewer'}`}>
          {canManageManualLines ? (
            <form className="manual-form" onSubmit={handleSubmit}>
              <div className="manual-form-header">
                <h2>Nuevo Presupuesto</h2>
                <button className="secondary-button" type="button" onClick={clearManualForm}>
                  Limpiar
                </button>
              </div>
              <div className="form-grid">
                <MonthField
                  label="Mes"
                  value={form.mes}
                  id="manual-mes"
                  openSelectId={openSelectId}
                  onOpenSelect={setOpenSelectId}
                  onChange={(value) => setForm({ ...form, mes: value })}
                />
                <SelectField
                  label="Anunciante"
                  value={form.anunciante}
                  options={clients}
                  placeholder="Selecciona un cliente"
                  id="manual-anunciante"
                  openSelectId={openSelectId}
                  onOpenSelect={setOpenSelectId}
                  onChange={(value) => {
                    const firstBrand = brandCatalog[value]?.[0] ?? '';
                    setForm({ ...form, anunciante: value, marca: firstBrand });
                  }}
                />
                <SelectField
                  label="Marca"
                  value={form.marca}
                  options={selectedBrands}
                  placeholder="Selecciona una marca"
                  disabled={!form.anunciante}
                  id="manual-marca"
                  openSelectId={openSelectId}
                  onOpenSelect={setOpenSelectId}
                  onChange={(value) => setForm({ ...form, marca: value })}
                />
                <SelectField
                  label="Plataforma"
                  value={form.plataforma}
                  options={['META', 'Google', 'MELI', 'TikTok']}
                  placeholder="Selecciona plataforma"
                  id="manual-plataforma"
                  openSelectId={openSelectId}
                  onOpenSelect={setOpenSelectId}
                  onChange={(value) => {
                    if (!value) {
                      setForm({ ...form, plataforma: '', objetivo: '' });
                      return;
                    }
                    const options = getObjectiveOptions(value);
                    setForm({ ...form, plataforma: value, objetivo: options.includes(form.objetivo) ? form.objetivo : options[0] });
                  }}
                />
                <SelectField label="Moneda" value={form.moneda} options={[...currencies]} placeholder="Selecciona moneda" id="manual-moneda" openSelectId={openSelectId} onOpenSelect={setOpenSelectId} onChange={(value) => setForm({ ...form, moneda: value as InvestmentCurrency | '' })} />
                <SelectField label="Objetivo" value={form.objetivo} options={objectiveOptions} placeholder="Selecciona objetivo" id="manual-objetivo" openSelectId={openSelectId} onOpenSelect={setOpenSelectId} onChange={(value) => setForm({ ...form, objetivo: value })} />
                <Field label="Campaña" value={form.campana} required={false} onChange={(value) => setForm({ ...form, campana: value })} />
                <Field label="Presupuesto" type="number" value={form.presupuesto} onChange={(value) => setForm({ ...form, presupuesto: value })} />
                <Field label="Costo x resultado" type="number" value={form.costoPorResultado} onChange={(value) => setForm({ ...form, costoPorResultado: value })} />
                <Field label="TKT prom" type="number" value={form.tktPromedio} onChange={(value) => setForm({ ...form, tktPromedio: value })} />
              </div>
              {manualFormSuggestions.length > 0 ? (
                <div className="form-suggestion">
                  <div className="form-suggestion-heading">
                    <span>Valores previos</span>
                    <strong>{manualFormSuggestions.length} campaña{manualFormSuggestions.length === 1 ? '' : 's'}</strong>
                  </div>
                  <button className="suggestion-button" type="button" onClick={() => setPreviousValuesOpen(true)}>
                    Ver valores previos
                  </button>
                </div>
              ) : null}
              <button className="primary-button" type="submit" disabled={saving || formMonthFinished || !form.anunciante || !form.marca || !form.moneda || !form.plataforma || !form.objetivo}>
                {saving ? 'Guardando...' : 'Agregar'}
              </button>
            </form>
          ) : null}

          <div className="manual-preview">
            <div className="preview-header">
              <div className="preview-heading">
                <h2>Carga actual</h2>
                <span>{manualPreviewMonthLabel}</span>
              </div>
              <div className="preview-filters">
                <MonthField
                  label="Mes"
                  value={previewMonth}
                  id="preview-mes"
                  openSelectId={openSelectId}
                  onOpenSelect={setOpenSelectId}
                  onChange={setPreviewMonth}
                />
                <SelectField
                  label="Cliente"
                  value={previewClientFilter}
                  options={clients}
                  placeholder="Todos"
                  id="preview-cliente"
                  openSelectId={openSelectId}
                  onOpenSelect={setOpenSelectId}
                  onChange={(value) => {
                    setPreviewClientFilter(value);
                    setPreviewBrandFilter('');
                  }}
                />
                <SelectField
                  label="Marca"
                  value={previewBrandFilter}
                  options={previewBrands}
                  placeholder="Todas"
                  disabled={!previewClientFilter && previewBrands.length === 0}
                  id="preview-marca"
                  openSelectId={openSelectId}
                  onOpenSelect={setOpenSelectId}
                  onChange={setPreviewBrandFilter}
                />
              </div>
            </div>
            {groupedLines.length === 0 ? (
              <div className="manual-empty">
                No hay cargas manuales para {manualPreviewMonthLabel}.
              </div>
            ) : null}
            {groupedLines.map((group) => {
              const clientTotals = getClientTotals(
                filteredManualPreviewLines.filter((line) => line.anunciante === group.lines[0].anunciante)
              );
              const brandTotals = getBrandTotals(group.lines);
              const groupStatus = group.lines.every((line) => line.status === 'PRESUPUESTO_OK')
                ? 'PRESUPUESTO_OK'
                : 'EN_PROCESO';
              const groupCurrencies = uniqueValues(group.lines.map((line) => line.moneda));
              const groupShares = getRoundedGroupShares(group.lines);
              return (
                <section className="preview-block" key={group.key}>
                  <div className="preview-title">
                    <div className="preview-title-main">
                      <strong>{group.lines[0].anunciante}</strong>
                      {groupCurrencies.map((currency) => (
                        <span className="currency-badge" key={currency}>{currency}</span>
                      ))}
                      {manualPreviewMonthFinished ? (
                        <span className="status-finished">Finalizado</span>
                      ) : canManageManualLines ? (
                        <StatusToggle
                          value={groupStatus}
                          onChange={(status) => updateGroupStatus(group.lines, status)}
                          compact
                          id={`group-status-${group.key}`}
                          openSelectId={openSelectId}
                          onOpenSelect={setOpenSelectId}
                        />
                      ) : (
                        <StatusBadge value={groupStatus} />
                      )}
                    </div>
                    {canEditManualPreview ? (
                      <div className="preview-title-actions">
                        {deleteMode ? (
                          <button className="secondary-button" type="button" onClick={() => {
                            setDeleteMode(false);
                            setSelectedDeleteIds([]);
                          }}>
                            Cancelar
                          </button>
                        ) : null}
                        <button
                          className={`icon-button delete ${deleteMode ? 'active' : ''}`}
                          type="button"
                          onClick={() => {
                            if (!deleteMode) {
                              toggleDeleteMode();
                              return;
                            }
                            if (selectedDeleteIds.length > 0) setDeleteModalOpen(true);
                          }}
                          aria-label={deleteMode ? 'Eliminar seleccionados' : 'Seleccionar lineas para eliminar'}
                          disabled={deleteMode && selectedDeleteIds.length === 0}
                        >
                          <img src="/assets/delete.svg" alt="" aria-hidden="true" />
                        </button>
                      </div>
                    ) : null}
                  </div>
                  {deleteMode && canEditManualPreview ? (
                    <div className="bulk-delete-bar">
                      {brandTotals.map((item) => {
                        const brandIds = group.lines
                          .filter((line) => (line.marca ?? line.anunciante) === item.marca)
                          .map((line) => line.id);
                        const allBrandLinesSelected = brandIds.length > 0 && brandIds.every((id) => selectedDeleteIds.includes(id));

                        return (
                          <label className="select-all-brand" key={item.marca}>
                            <input
                              type="checkbox"
                              checked={allBrandLinesSelected}
                              onChange={() => toggleDeleteBrandSelection(group.lines, item.marca)}
                              aria-label={`Seleccionar todas las lineas de ${item.marca}`}
                            />
                            Selecciona todas
                          </label>
                        );
                      })}
                    </div>
                  ) : null}
                  <div className="forecast-table-wrap">
                    <table>
                    <thead>
                      <tr>
                        <th>Marca</th>
                        <th>Plataforma</th>
                        <th>Objetivo</th>
                        <th>Campaña</th>
                        <th>Moneda</th>
                        <th>Presupuesto</th>
                        <th>Share</th>
                        <th>Costo x resultado</th>
                        <th>Resultado proyectado</th>
                        <th>TKT prom</th>
                        <th>FC proyectada</th>
                        <th className="forecast-actions-header"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.lines.map((line) => (
                        <tr key={line.id}>
                          <td>
                            {editingLineId === line.id && lineDraft ? (
                              <CellSelect
                                value={lineDraft.marca}
                                options={editBrandOptions}
                                id={`edit-marca-${line.id}`}
                                openSelectId={openSelectId}
                                onOpenSelect={setOpenSelectId}
                                onChange={(value) => setLineDraft({ ...lineDraft, marca: value})}
                              />
                            ) : (
                              <div className="brand-cell">
                                {deleteMode && canEditManualPreview ? (
                                  <input
                                    type="checkbox"
                                    checked={selectedDeleteIds.includes(line.id)}
                                    onChange={() => toggleDeleteSelection(line.id)}
                                    aria-label={`Seleccionar ${line.marca ?? line.anunciante}`}
                                  />
                                ) : null}
                                <span>{line.marca ?? '-'}</span>
                              </div>
                            )}
                          </td>
                          <td>
                            {editingLineId === line.id && lineDraft ? (
                              <CellSelect
                                value={lineDraft.plataforma}
                                options={platformOptions}
                                id={`edit-plataforma-${line.id}`}
                                openSelectId={openSelectId}
                                onOpenSelect={setOpenSelectId}
                                onChange={(value) => {
                                  setLineDraft({
                                    ...lineDraft,
                                    plataforma: value,
                                    objetivo: allObjectiveOptions.includes(lineDraft.objetivo)
                                      ? lineDraft.objetivo
                                      : allObjectiveOptions[0] ?? ''
                                  });
                                }}
                              />
                            ) : line.plataforma}
                          </td>
                          <td>
                            {editingLineId === line.id && lineDraft ? (
                              <CellSelect
                                value={lineDraft.objetivo}
                                options={allObjectiveOptions}
                                id={`edit-objetivo-${line.id}`}
                                openSelectId={openSelectId}
                                onOpenSelect={setOpenSelectId}
                                onChange={(value) => setLineDraft({ ...lineDraft, objetivo: value })}
                              />
                            ) : line.objetivo}
                          </td>
                          <td>
                            {editingLineId === line.id && lineDraft ? (
                              <input
                                className="budget-input campaign-input"
                                value={lineDraft.campana}
                                onChange={(event) => setLineDraft({ ...lineDraft, campana: event.target.value })}
                                placeholder="Ej: CAMPAÑA_COMPLETA"
                              />
                            ) : line.campana || '-'}
                          </td>
                          <td> 
                            {editingLineId === line.id && lineDraft ? (
                              <CellSelect
                                value={lineDraft.moneda}
                                options={[...currencies]}
                                id={`edit-moneda-${line.id}`}
                                openSelectId={openSelectId}
                                onOpenSelect={setOpenSelectId}
                                onChange={(value) => setLineDraft({ ...lineDraft, moneda: value as InvestmentCurrency })}
                              />
                            ): line.moneda}
                          </td>
                          <td>
                            {editingLineId === line.id && lineDraft ? (
                              <input
                                className="budget-input"
                                type="number"
                                value={lineDraft.presupuesto}
                                onChange={(event) => setLineDraft({ ...lineDraft, presupuesto: event.target.value })}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') saveLine(line);
                                  if (event.key === 'Escape') setEditingLineId(null);
                                }}
                                autoFocus
                              />
                            ) : formatMoney(line.presupuesto, line.moneda)}
                          </td>
                          <td>{groupShares.get(line.id) ?? 0}%</td>
                          <td>
                            {editingLineId === line.id && lineDraft ? (
                              <input
                                className="budget-input"
                                type="number"
                                value={lineDraft.costoPorResultado}
                                onChange={(event) => setLineDraft({ ...lineDraft, costoPorResultado: event.target.value })}
                              />
                            ) : formatMoney(line.costoPorResultado, line.moneda)}
                          </td>
                          <td>{integer.format(line.resultadosProyectados)}</td>
                          <td>
                            {editingLineId === line.id && lineDraft ? (
                              <input
                                className="budget-input"
                                type="number"
                                value={lineDraft.tktPromedio}
                                onChange={(event) => setLineDraft({ ...lineDraft, tktPromedio: event.target.value })}
                              />
                            ) : formatMoney(line.tktPromedio, line.moneda)}
                          </td>
                          <td>{formatMoney(line.fcProyectada, line.moneda)}</td>
                          <td className="actions-cell">
                            {canEditManualPreview && editingLineId === line.id ? (
                              <div className="inline-actions">
                                <button className="icon-button confirm" type="button" onClick={() => saveLine(line)} aria-label="Guardar linea">OK</button>
                                <button className="icon-button" type="button" onClick={() => setEditingLineId(null)} aria-label="Cancelar edicion">X</button>
                              </div>
                            ) : (
                              <div className="inline-actions">
                                <button className="icon-button" type="button" onClick={() => openLineHistory(line)} aria-label="Ver historial de linea">
                                  <EyeIcon />
                                </button>
                                {canEditManualPreview ? (
                                  <button className="icon-button" type="button" onClick={() => startLineEdit(line)} aria-label="Editar linea" disabled={deleteMode}>
                                    <img src="/assets/edit.svg" alt="" aria-hidden="true" />
                                  </button>
                                ) : null}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      {brandTotals.map((item) => (
                        <tr key={item.marca}>
                          <td>Total marca: {item.marca}</td>
                          <td></td>
                          <td></td>
                          <td></td>
                          <td></td>
                          <td>{formatCurrencyTotals(item.totals, 'presupuesto')}</td>
                          <td></td>
                          <td></td>
                          <td></td>
                          <td></td>
                          <td>{formatCurrencyTotals(item.totals, 'fcProyectada')}</td>
                          <td className="forecast-actions-footer"></td>
                        </tr>
                      ))}
                      {clientTotals.map((item) => (
                        <tr key={item.cliente}>
                          <td>Total cliente: {item.cliente}</td>
                          <td></td>
                          <td></td>
                          <td></td>
                          <td></td>
                          <td>{formatCurrencyTotals(item.totals, 'presupuesto')}</td>
                          <td></td>
                          <td></td>
                          <td></td>
                          <td></td>
                          <td>{formatCurrencyTotals(item.totals, 'fcProyectada')}</td>
                          <td className="forecast-actions-footer"></td>
                        </tr>
                      ))}
                    </tfoot>
                    </table>
                  </div>
                </section>
              );
            })}
          </div>
        </section>
      )}

      {deleteModalOpen ? (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title">
            <div className="modal-icon">X</div>
            <h2 id="delete-title">Estas seguro?</h2>
            <p>
              De verdad quieres eliminar estos registros?<br />
              Este proceso no se puede deshacer.
            </p>
            <div className="modal-actions">
              <button className="modal-button muted" type="button" onClick={() => setDeleteModalOpen(false)} disabled={deleting}>
                Cancelar
              </button>
              <button className="modal-button danger" type="button" onClick={confirmDeleteLines} disabled={deleting}>
                {deleting ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {previousValuesOpen ? (
        <div className="modal-backdrop" role="presentation">
          <div className="previous-values-modal" role="dialog" aria-modal="true" aria-labelledby="previous-values-title">
            <div className="previous-values-header">
              <div>
                <span>Valores previos</span>
                <h2 id="previous-values-title">Elegir campaña</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setPreviousValuesOpen(false)} aria-label="Cerrar valores previos">
                X
              </button>
            </div>
            <p>
              {form.anunciante} / {form.marca} / {form.plataforma}
            </p>
            <div className="campaign-suggestion-list modal-list">
              {manualFormSuggestions.map((suggestion) => (
                <button
                  className="campaign-suggestion"
                  type="button"
                  key={suggestion.id}
                  onClick={() => applyManualSuggestion(suggestion)}
                >
                  <div className="campaign-suggestion-top">
                    <div>
                      <strong>{getCampaignSuggestionLabel(suggestion)}</strong>
                      <div className="campaign-suggestion-meta">
                        <span>{formatMonthLabel(suggestion.mes)}</span>
                        <span>{suggestion.objetivo}</span>
                      </div>
                    </div>
                  </div>
                  <dl>
                    <div>
                      <dt>Moneda</dt>
                      <dd>{suggestion.moneda}</dd>
                    </div>
                    <div>
                      <dt>Presupuesto</dt>
                      <dd>{formatMoney(suggestion.presupuesto, suggestion.moneda)}</dd>
                    </div>
                    <div>
                      <dt>Costo por resultado</dt>
                      <dd>{formatMoney(suggestion.costoPorResultado, suggestion.moneda)}</dd>
                    </div>
                    <div>
                      <dt>TKT prom</dt>
                      <dd>{formatMoney(suggestion.tktPromedio, suggestion.moneda)}</dd>
                    </div>
                  </dl>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {historyModalLine ? (
        <div className="modal-backdrop" role="presentation">
          <div className="line-history-modal" role="dialog" aria-modal="true" aria-labelledby="line-history-title">
            <div className="previous-values-header">
              <div>
                <span>Historial</span>
                <h2 id="line-history-title">{historyModalLine.marca ?? historyModalLine.anunciante}</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setHistoryModalLine(null)} aria-label="Cerrar historial">
                X
              </button>
            </div>
            <p>
              {historyModalLine.anunciante} / {historyModalLine.plataforma} / {historyModalLine.objetivo}
            </p>
            <dl className="history-line-summary">
              <div>
                <dt>Campana</dt>
                <dd>{historyModalLine.campana || '-'}</dd>
              </div>
              <div>
                <dt>Moneda</dt>
                <dd>{historyModalLine.moneda}</dd>
              </div>
              <div>
                <dt>Presupuesto</dt>
                <dd>{formatMoney(historyModalLine.presupuesto, historyModalLine.moneda)}</dd>
              </div>
              <div>
                <dt>Costo x resultado</dt>
                <dd>{formatMoney(historyModalLine.costoPorResultado, historyModalLine.moneda)}</dd>
              </div>
              <div>
                <dt>TKT prom</dt>
                <dd>{formatMoney(historyModalLine.tktPromedio, historyModalLine.moneda)}</dd>
              </div>
              <div>
                <dt>Status actual</dt>
                <dd>{historyModalLine.status === 'PRESUPUESTO_OK' ? 'Confirmado' : 'En proceso'}</dd>
              </div>
            </dl>
            {historyLoading ? (
              <div className="history-empty">Cargando historial...</div>
            ) : lineHistory.length === 0 ? (
              <div className="history-empty">Esta linea todavia no tiene movimientos registrados.</div>
            ) : (
              <div className="history-table-wrap">
                <table className="history-table">
                  <thead>
                    <tr>
                      <th>Evento</th>
                      <th>Fecha</th>
                      <th>Usuario</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineHistory.map((entry) => (
                      <tr key={entry.id}>
                        <td>
                          <span className={`history-action ${entry.action.toLowerCase()}`}>
                            {getManualLogActionLabel(entry.action)}
                          </span>
                        </td>
                        <td>{formatLastUpdate(entry.createdAt)}</td>
                        <td>{entry.userName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </main>
  );
}

function EyeIcon() {
  return (
    <svg className="button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M2.4 12s3.4-6.2 9.6-6.2 9.6 6.2 9.6 6.2-3.4 6.2-9.6 6.2S2.4 12 2.4 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </svg>
  );
}

function SummaryStrip({
  data,
  loading,
  currency,
  onCurrencyChange,
  openSelectId,
  onOpenSelect
}: {
  data: InvestmentResponse | null;
  loading: boolean;
  currency: InvestmentCurrency;
  onCurrencyChange: (currency: InvestmentCurrency) => void;
  openSelectId: string | null;
  onOpenSelect: (id: string | null) => void;
}) {
  const summary = data?.summary;
  const currencyLines = data?.lines.filter((line) => line.moneda === currency) ?? [];
  const presupuesto = currencyLines.reduce((sum, line) => sum + line.presupuesto, 0);
  const consumo = currencyLines.reduce((sum, line) => sum + line.consumo, 0);
  const restante = presupuesto - consumo;
  const completion = presupuesto > 0 ? consumo / presupuesto : 0;

  return (
    <section className="summary-strip">
      <Metric label="Dia" value={summary?.date ?? '-'} />
      <Metric label="Dias" value={loading ? '...' : String(summary?.dias ?? 0)} />
      <Metric label="Ritmo" value={`${Math.round((summary?.ritmo ?? 0) * 100)}%`} />
      <MetricWithCurrencyFilter
        label="Presupuesto"
        value={formatMoney(presupuesto, currency)}
        currency={currency}
        onCurrencyChange={onCurrencyChange}
        openSelectId={openSelectId}
        onOpenSelect={onOpenSelect}
      />
      <MetricWithCurrencyFilter
        label="$ Consumido"
        value={formatMoney(consumo, currency)}
        currency={currency}
        onCurrencyChange={onCurrencyChange}
        openSelectId={openSelectId}
        onOpenSelect={onOpenSelect}
      />
      <Metric label="Restante" value={formatMoney(restante, currency)} tone={restante < 0 ? 'bad' : 'good'} />
      <Metric label="% Completion" value={`${Math.round(completion * 100)}%`} tone={completion > 1 ? 'bad' : 'good'} />
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className={`metric ${tone ?? ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MetricWithCurrencyFilter({
  label,
  value,
  currency,
  onCurrencyChange,
  openSelectId,
  onOpenSelect
}: {
  label: string;
  value: string;
  currency: InvestmentCurrency;
  onCurrencyChange: (currency: InvestmentCurrency) => void;
  openSelectId: string | null;
  onOpenSelect: (id: string | null) => void;
}) {
  return (
    <div className="metric">
      <div className="metric-heading">
        <span>{label}</span>
        <CustomSelect
          id={`metric-${label}`}
          className="metric-filter"
          value={currency}
          options={[...currencies]}
          openSelectId={openSelectId}
          onOpenSelect={onOpenSelect}
          onChange={(option) => onCurrencyChange(option as InvestmentCurrency)}
          ariaLabel={`Filtrar ${label} por moneda`}
        />
      </div>
      <strong>{value}</strong>
    </div>
  );
}

function DateRangeControl({
  preset,
  range,
  customRange,
  openSelectId,
  onOpenSelect,
  onPresetChange,
  onCustomRangeChange
}: {
  preset: DatePreset;
  range: { startDate: string; endDate: string };
  customRange: CustomDateRange;
  openSelectId: string | null;
  onOpenSelect: (id: string | null) => void;
  onPresetChange: (preset: DatePreset) => void;
  onCustomRangeChange: (range: CustomDateRange) => void;
}) {
  return (
    <div className="date-range-control">
      <label className="month-control">
        Rango
        <CustomSelect
          id="date-preset"
          className="date-preset-select"
          value={preset}
          options={datePresetOptions.map((option) => ({ label: option.label, value: option.value }))}
          openSelectId={openSelectId}
          onOpenSelect={onOpenSelect}
          onChange={(option) => onPresetChange(option as DatePreset)}
        />
      </label>
      {preset === 'custom' ? (
        <DateRangePicker
          id="range-calendar"
          range={customRange}
          openSelectId={openSelectId}
          onOpenSelect={onOpenSelect}
          onChange={onCustomRangeChange}
        />
      ) : (
        <span className="range-pill">{range.startDate} / {range.endDate}</span>
      )}
    </div>
  );
}

const weekdayLabels = ['DOM', 'LUN', 'MAR', 'MIE', 'JUE', 'VIE', 'SAB'];

function DateRangePicker({
  id,
  range,
  openSelectId,
  onOpenSelect,
  onChange
}: {
  id: string;
  range: CustomDateRange;
  openSelectId: string | null;
  onOpenSelect: (id: string | null) => void;
  onChange: (range: CustomDateRange) => void;
}) {
  const isOpen = openSelectId === id;
  const [visibleMonth, setVisibleMonth] = useState(range.startDate.slice(0, 7));
  const [draftStart, setDraftStart] = useState(range.startDate);
  const [draftEnd, setDraftEnd] = useState(range.endDate);

  useEffect(() => {
    if (!isOpen) return;
    setVisibleMonth(range.startDate.slice(0, 7));
    setDraftStart(range.startDate);
    setDraftEnd(range.endDate);
  }, [isOpen]);

  const days = getCalendarDays(visibleMonth);
  const monthLabel = formatMonthLabel(visibleMonth);

  function selectDate(date: string) {
    if (!draftStart || (draftStart && draftEnd)) {
      setDraftStart(date);
      setDraftEnd('');
      onChange({ startDate: date, endDate: date });
      return;
    }

    const nextRange = date < draftStart
      ? { startDate: date, endDate: draftStart }
      : { startDate: draftStart, endDate: date };
    setDraftStart(nextRange.startDate);
    setDraftEnd(nextRange.endDate);
    onChange(nextRange);
  }

  return (
    <div className="date-range-picker" data-dropdown-root="true">
      <button
        className="range-pill range-trigger"
        type="button"
        onClick={() => onOpenSelect(isOpen ? null : id)}
        aria-expanded={isOpen}
      >
        {range.startDate} / {range.endDate}
      </button>
      {isOpen ? (
        <div className="range-calendar">
          <div className="range-calendar-head">
            <button type="button" onClick={() => setVisibleMonth((month) => shiftMonth(month, -1))} aria-label="Mes anterior">
              &lt;
            </button>
            <strong>{monthLabel}</strong>
            <button type="button" onClick={() => setVisibleMonth((month) => shiftMonth(month, 1))} aria-label="Mes siguiente">
              &gt;
            </button>
          </div>
          <div className="range-weekdays">
            {weekdayLabels.map((label) => <span key={label}>{label}</span>)}
          </div>
          <div className="range-days">
            {days.map((day, index) => {
              if (!day) return <span key={`empty-${index}`} className="range-day empty" />;
              const inRange = draftStart && draftEnd && day.date >= draftStart && day.date <= draftEnd;
              const selected = day.date === draftStart || day.date === draftEnd;

              return (
                <button
                  key={day.date}
                  className={`range-day ${inRange ? 'in-range' : ''} ${selected ? 'selected' : ''}`}
                  type="button"
                  onClick={() => selectDate(day.date)}
                >
                  {day.day}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function getCalendarDays(month: string): Array<{ date: string; day: number } | null> {
  const firstDate = `${month}-01`;
  const first = new Date(`${firstDate}T00:00:00.000Z`);
  const totalDays = Number(monthEnd(firstDate).slice(8, 10));
  const blanks = Array.from({ length: first.getUTCDay() }, () => null);
  const days = Array.from({ length: totalDays }, (_, index) => {
    const day = index + 1;
    return {
      date: `${month}-${String(day).padStart(2, '0')}`,
      day
    };
  });

  return [...blanks, ...days];
}

function shiftMonth(month: string, amount: number) {
  const [year, monthNumber] = month.split('-').map(Number);
  const value = new Date(Date.UTC(year, monthNumber - 1 + amount, 1));
  return value.toISOString().slice(0, 7);
}

function FilterHeader({
  filterKey,
  label,
  value,
  options,
  formatOptionLabel = (option) => option || 'Todos',
  openFilter,
  onToggle,
  onChange
}: {
  filterKey: ControlFilterKey;
  label: string;
  value: string;
  options: string[];
  formatOptionLabel?: (option: string) => string;
  openFilter: ControlFilterKey | null;
  onToggle: (filter: ControlFilterKey | null) => void;
  onChange: (value: string) => void;
}) {
  const isOpen = openFilter === filterKey;
  const allOptions = ['', ...options];
  const [typeahead, setTypeahead] = useState('');
  const typeaheadQuery = normalizeTypeaheadText(typeahead);
  const visibleOptions = typeaheadQuery
    ? allOptions.filter((option) => {
      const optionLabel = formatOptionLabel(option);
      return normalizeTypeaheadText(optionLabel).includes(typeaheadQuery)
        || normalizeTypeaheadText(option).includes(typeaheadQuery);
    })
    : allOptions;
  const typeaheadMatch = typeaheadQuery ? visibleOptions[0] ?? null : null;
  const typeaheadMatchRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setTypeahead('');
  }, [isOpen]);

  useEffect(() => {
    if (!typeahead) return;
    const timeout = window.setTimeout(() => setTypeahead(''), 3000);
    return () => window.clearTimeout(timeout);
  }, [typeahead]);

  useEffect(() => {
    if (!isOpen || !typeaheadMatch) return;
    typeaheadMatchRef.current?.scrollIntoView({ block: 'nearest' });
  }, [isOpen, typeaheadMatch]);

  function handleTypeahead(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      onToggle(null);
      return;
    }

    if (event.key === 'Backspace') {
      event.preventDefault();
      setTypeahead((current) => current.slice(0, -1));
      return;
    }

    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    if (!isOpen) onToggle(filterKey);
    setTypeahead((current) => `${current}${event.key}`);
  }

  return (
    <th>
      <div
        className={`filter-header ${value ? 'active' : ''}`}
        data-dropdown-root="true"
        onKeyDown={handleTypeahead}
      >
        <span>{label}</span>
        <button
          className="filter-trigger"
          type="button"
          onMouseDown={() => setTypeahead('')}
          onClick={() => onToggle(isOpen ? null : filterKey)}
          aria-label={`Filtrar ${label}`}
          aria-expanded={isOpen}
        >
          ▼
        </button>
        {isOpen ? (
          <div className="filter-menu">
            {visibleOptions.length > 0 ? visibleOptions.map((option) => (
              <button
                className={[
                  value === option ? 'selected' : '',
                  typeaheadMatch === option ? 'typeahead-match' : ''
                ].filter(Boolean).join(' ')}
                key={option || 'all'}
                ref={typeaheadMatch === option ? typeaheadMatchRef : undefined}
                type="button"
                onClick={() => {
                  setTypeahead('');
                  onChange(option);
                  onToggle(null);
                }}
              >
                {formatOptionLabel(option)}
              </button>
            )) : (
              <div className="custom-select-empty">Sin resultados</div>
            )}
          </div>
        ) : null}
      </div>
    </th>
  );
}

function SortHeader({
  label,
  sortKey,
  currentSort,
  onChange
}: {
  label: string;
  sortKey: SortKey;
  currentSort: ControlSort;
  onChange: (sort: ControlSort) => void;
}) {
  const isActive = currentSort?.key === sortKey;
  const nextSort: ControlSort = !isActive
    ? { key: sortKey, direction: 'desc' }
    : currentSort.direction === 'desc'
      ? { key: sortKey, direction: 'asc' }
      : null;

  return (
    <th>
      <button
        className={`sort-header ${isActive ? 'active' : ''}`}
        type="button"
        onClick={() => onChange(nextSort)}
        aria-label={`Ordenar ${label}`}
      >
        <span>{label}</span>
        <span className="sort-icon">{isActive ? (currentSort.direction === 'desc' ? '↓' : '↑') : '↕'}</span>
      </button>
    </th>
  );
}

function StatusToggle({
  value,
  compact = false,
  id,
  openSelectId,
  onOpenSelect,
  onChange
}: {
  value: InvestmentStatus;
  compact?: boolean;
  id?: string;
  openSelectId?: string | null;
  onOpenSelect?: (id: string | null) => void;
  onChange: (status: InvestmentStatus) => void;
}) {
  if (compact) {
    return (
      <CustomSelect
        id={id || 'status'}
        className={`status-select ${value === 'PRESUPUESTO_OK' ? 'green' : 'yellow'}`}
        value={value}
        options={[
          { label: 'En proceso', value: 'EN_PROCESO' },
          { label: 'Confirmado', value: 'PRESUPUESTO_OK' }
        ]}
        openSelectId={openSelectId ?? null}
        onOpenSelect={onOpenSelect ?? (() => undefined)}
        onChange={(option) => onChange(option as InvestmentStatus)}
        ariaLabel="Status"
      />
    );
  }

  return (
    <div className={`status-toggle ${compact ? 'compact' : ''}`}>
      <label className={`status-option yellow ${value === 'EN_PROCESO' ? 'active' : ''}`}>
        <input
          type="radio"
          checked={value === 'EN_PROCESO'}
          onChange={() => onChange('EN_PROCESO')}
        />
        En proceso
      </label>
      <label className={`status-option green ${value === 'PRESUPUESTO_OK' ? 'active' : ''}`}>
        <input
          type="radio"
          checked={value === 'PRESUPUESTO_OK'}
          onChange={() => onChange('PRESUPUESTO_OK')}
        />
        Confirmado
      </label>
    </div>
  );
}

function StatusBadge({ value }: { value: InvestmentStatus }) {
  return (
    <span className={`status-badge ${value === 'PRESUPUESTO_OK' ? 'green' : 'yellow'}`}>
      {value === 'PRESUPUESTO_OK' ? 'Confirmado' : 'En proceso'}
    </span>
  );
}

function CustomSelect({
  id,
  value,
  options,
  className = '',
  disabled = false,
  openSelectId,
  onOpenSelect,
  onChange,
  placeholder,
  ariaLabel
}: {
  id: string;
  value: string;
  options: Array<string | SelectOption>;
  className?: string;
  disabled?: boolean;
  openSelectId: string | null;
  onOpenSelect: (id: string | null) => void;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const normalizedOptions = options.map((option) => (
    typeof option === 'string' ? { label: option, value: option } : option
  ));
  const normalizedValue = normalizeTypeaheadText(value);
  const selected = normalizedOptions.find((option) => option.value === value)
    ?? normalizedOptions.find((option) => normalizeTypeaheadText(option.value) === normalizedValue)
    ?? normalizedOptions.find((option) => normalizeTypeaheadText(option.label) === normalizedValue);
  const isOpen = openSelectId === id;
  const [typeahead, setTypeahead] = useState('');
  const typeaheadMatchRef = useRef<HTMLButtonElement | null>(null);
  const typeaheadQuery = normalizeTypeaheadText(typeahead);
  const visibleOptions = typeaheadQuery
    ? normalizedOptions.filter((option) => {
      const label = normalizeTypeaheadText(option.label);
      const optionValue = normalizeTypeaheadText(option.value);
      return label.includes(typeaheadQuery) || optionValue.includes(typeaheadQuery);
    })
    : normalizedOptions;
  const typeaheadMatch = typeaheadQuery ? visibleOptions[0] ?? null : null;

  useEffect(() => {
    setTypeahead('');
  }, [isOpen]);

  useEffect(() => {
    if (!typeahead) return;
    const timeout = window.setTimeout(() => setTypeahead(''), 3000);
    return () => window.clearTimeout(timeout);
  }, [typeahead]);

  useEffect(() => {
    if (!isOpen || !typeaheadMatch) return;
    typeaheadMatchRef.current?.scrollIntoView({ block: 'nearest' });
  }, [isOpen, typeaheadMatch]);

  function handleTypeahead(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      onOpenSelect(null);
      return;
    }

    if (event.key === 'Backspace') {
      event.preventDefault();
      setTypeahead((current) => current.slice(0, -1));
      return;
    }

    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    if (!isOpen) onOpenSelect(id);
    setTypeahead((current) => `${current}${event.key}`);
  }

  return (
    <div
      className={`custom-select ${className} ${isOpen ? 'open' : ''} ${disabled ? 'disabled' : ''}`}
      data-dropdown-root="true"
      onKeyDown={handleTypeahead}
    >
      <button
        className="custom-select-trigger"
        type="button"
        disabled={disabled}
        onMouseDown={() => setTypeahead('')}
        onClick={() => {
          setTypeahead('');
          onOpenSelect(isOpen ? null : id);
        }}
        aria-label={ariaLabel || placeholder || id}
        aria-expanded={isOpen}
      >
        <span>{selected?.label || placeholder || 'Seleccionar'}</span>
        <span className="custom-select-arrow">▼</span>
      </button>
      {isOpen ? (
        <div className="custom-select-menu">
          {visibleOptions.length > 0 ? visibleOptions.map((option) => (
            <button
              className={[
                option.value === value ? 'selected' : '',
                typeaheadMatch?.value === option.value ? 'typeahead-match' : ''
              ].filter(Boolean).join(' ')}
              key={`${id}-${option.value || 'empty'}`}
              ref={typeaheadMatch?.value === option.value ? typeaheadMatchRef : undefined}
              type="button"
              onClick={() => {
                setTypeahead('');
                onChange(option.value);
                onOpenSelect(null);
              }}
            >
              {option.label}
            </button>
          )) : (
            <div className="custom-select-empty">Sin resultados</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, value, type = 'text', required = true, onChange }: { label: string; value: string; type?: string; required?: boolean; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} required={required} />
    </label>
  );
}

const monthPickerLabels = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function MonthField({
  id,
  label,
  value,
  openSelectId,
  onOpenSelect,
  onChange
}: {
  id: string;
  label: string;
  value: string;
  openSelectId: string | null;
  onOpenSelect: (id: string | null) => void;
  onChange: (value: string) => void;
}) {
  const selectedYear = Number(value.slice(0, 4)) || Number(currentDate.slice(0, 4));
  const selectedMonth = Number(value.slice(5, 7)) || Number(currentDate.slice(5, 7));
  const [displayYear, setDisplayYear] = useState(selectedYear);
  const isOpen = openSelectId === id;

  useEffect(() => {
    if (isOpen) setDisplayYear(selectedYear);
  }, [isOpen, selectedYear]);

  return (
    <label className="field month-picker-field">
      <span>{label}</span>
      <div className={`month-picker ${isOpen ? 'open' : ''}`} data-dropdown-root="true">
        <button
          className="month-picker-trigger"
          type="button"
          onClick={() => onOpenSelect(isOpen ? null : id)}
          aria-expanded={isOpen}
          aria-label={label}
        >
          <span>{formatMonthLabel(value)}</span>
          <span className="month-picker-icon" aria-hidden="true">▾</span>
        </button>
        {isOpen ? (
          <div className="month-picker-menu">
            <div className="month-picker-year">
              <button type="button" onClick={() => setDisplayYear((year) => year - 1)} aria-label="Año anterior">
                &lt;
              </button>
              <strong>{displayYear}</strong>
              <button type="button" onClick={() => setDisplayYear((year) => year + 1)} aria-label="Año siguiente">
                &gt;
              </button>
            </div>
            <div className="month-picker-grid">
              {monthPickerLabels.map((monthLabel, index) => {
                const month = String(index + 1).padStart(2, '0');
                const optionValue = `${displayYear}-${month}`;
                const selected = value === optionValue;

                return (
                  <button
                    className={selected ? 'selected' : ''}
                    type="button"
                    key={month}
                    onClick={() => {
                      onChange(optionValue);
                      onOpenSelect(null);
                    }}
                  >
                    {monthLabel}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </label>
  );
}

function SelectField({
  id,
  label,
  value,
  options,
  placeholder,
  disabled = false,
  openSelectId,
  onOpenSelect,
  onChange
}: {
  id?: string;
  label: string;
  value: string;
  options: string[];
  placeholder?: string;
  disabled?: boolean;
  openSelectId?: string | null;
  onOpenSelect?: (id: string | null) => void;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      {label ? <span>{label}</span> : null}
      <CustomSelect
        id={id || label || 'select'}
        value={value}
        options={placeholder ? [{ label: placeholder, value: '' }, ...options] : options}
        disabled={disabled}
        openSelectId={openSelectId ?? null}
        onOpenSelect={onOpenSelect ?? (() => undefined)}
        onChange={onChange}
        placeholder={placeholder}
      />
    </label>
  );
}

function CellSelect({
  value,
  options,
  onChange
}: {
  id: string;
  value: string;
  options: string[];
  openSelectId: string | null;
  onOpenSelect: (id: string | null) => void;
  onChange: (value: string) => void;
}) {
  return (
    <select
      className="cell-native-select"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}
