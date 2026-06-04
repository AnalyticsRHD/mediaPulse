'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3333';
const currencies = ['ARS', 'CHL', 'USD'] as const;
const investmentStatuses = ['EN_PROCESO', 'PRESUPUESTO_OK'] as const;
const datePresetOptions = [
  { value: 'today', label: 'Hoy' },
  { value: 'yesterday', label: 'Ayer' },
  { value: 'last7', label: 'Ultimos 7 dias' },
  { value: 'last14', label: 'Ultimos 14 dias' },
  { value: 'last30', label: 'Ultimos 30 dias' },
  { value: 'thisMonth', label: 'Este mes' },
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

type InvestmentCurrency = typeof currencies[number];
type InvestmentStatus = typeof investmentStatuses[number];
type DatePreset = typeof datePresetOptions[number]['value'];
type DateRange = { startDate: string; endDate: string };
type ControlFilterKey = 'anunciante' | 'marca' | 'moneda' | 'plataforma' | 'objetivo';
type ControlFilters = Record<ControlFilterKey, string>;
type SortDirection = 'asc' | 'desc';
type SortKey =
  | 'presupuesto'
  | 'consumo'
  | 'porcentajeConsumo'
  | 'consumoRestante'
  | 'presupuestoDaily'
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

type InvestmentLine = {
  id: string;
  anunciante: string;
  marca?: string;
  moneda: InvestmentCurrency;
  status: InvestmentStatus;
  plataforma: string;
  objetivo: string;
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
  moneda: InvestmentCurrency;
  status: InvestmentStatus;
  plataforma: string;
  objetivo: string;
  presupuesto: string;
  costoPorResultado: string;
  tktPromedio: string;
  mes: string;
};

function yesterdayDate() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10);
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
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

const defaultDate = yesterdayDate();
const currentDate = todayDate();

const defaultForm: ManualForm = {
  anunciante: '',
  marca: '',
  moneda: 'ARS',
  status: 'EN_PROCESO',
  plataforma: 'META',
  objetivo: 'Ventas',
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
  presupuestoDaily: 'Presupuesto daily',
  nuevoPresupuestoDiario: 'Nuevo presupuesto diario',
  desvio: 'Desvio',
  consumoDia: 'Consumo dia',
  resultadosProyectados: 'Resultados proyectados',
  fcProyectada: 'FC proyectada'
};

function getDateRange(preset: DatePreset, customStart: string, customEnd: string) {
  const today = todayDate();

  if (preset === 'previousMonth') {
    const previousMonthDate = addDays(monthStart(today), -1);
    return { startDate: monthStart(previousMonthDate), endDate: monthEnd(previousMonthDate) };
  }

  if (preset === 'custom') {
    const startDate = customStart || today;
    const endDate = customEnd || customStart || today;

    return startDate <= endDate
      ? { startDate, endDate }
      : { startDate: endDate, endDate: startDate };
  }

  return { startDate: monthStart(today), endDate: today };
}

function getQueryMonth(preset: DatePreset, range: DateRange) {
  if (preset === 'previousMonth' || preset === 'custom') return range.startDate.slice(0, 7);
  return currentDate.slice(0, 7);
}

const integer = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });

function formatMoney(value: number, moneda: InvestmentCurrency = 'CHL') {
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

function getObjectiveOptions(platform: string) {
  if (platform !== 'Google') return baseObjectives;

  const googleObjectiveBases = ['Trafico', 'Leads', 'Ventas'];
  const googleObjectives = googleObjectiveBases.flatMap((objective) => (
    googleObjectiveSuffixes.map((suffix) => `${objective}-${suffix}`)
  ));

  return [...baseObjectives, ...googleObjectives];
}

function getBrandTotals(lines: InvestmentLine[]) {
  const totals = new Map<string, { marca: string; presupuesto: number; fcProyectada: number }>();

  lines.forEach((line) => {
    const marca = line.marca ?? 'Sin marca';
    const existing = totals.get(marca) ?? { marca, presupuesto: 0, fcProyectada: 0 };
    totals.set(marca, {
      marca,
      presupuesto: existing.presupuesto + line.presupuesto,
      fcProyectada: existing.fcProyectada + line.fcProyectada
    });
  });

  return Array.from(totals.values()).sort((a, b) => a.marca.localeCompare(b.marca));
}

function getClientTotals(lines: InvestmentLine[]) {
  const totals = new Map<string, { cliente: string; presupuesto: number; fcProyectada: number }>();

  lines.forEach((line) => {
    const existing = totals.get(line.anunciante) ?? { cliente: line.anunciante, presupuesto: 0, fcProyectada: 0 };
    totals.set(line.anunciante, {
      cliente: line.anunciante,
      presupuesto: existing.presupuesto + line.presupuesto,
      fcProyectada: existing.fcProyectada + line.fcProyectada
    });
  });

  return Array.from(totals.values()).sort((a, b) => a.cliente.localeCompare(b.cliente));
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

function getDeviationClass(value: number) {
  const percent = value * 100;
  if (percent >= 5 || percent <= -5) return 'deviation-cell danger';
  if ((percent >= 3 && percent <= 4) || (percent <= -3 && percent >= -4)) return 'deviation-cell warning';
  if (percent >= -3 && percent <= 3) return 'deviation-cell good';
  return 'deviation-cell';
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<'control' | 'manual'>('control');
  const [data, setData] = useState<InvestmentResponse | null>(null);
  const [manualData, setManualData] = useState<InvestmentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);
  const [datePreset, setDatePreset] = useState<DatePreset>('today');
  const [customStartDate, setCustomStartDate] = useState(defaultDate);
  const [customEndDate, setCustomEndDate] = useState(currentDate);
  const [syncing, setSyncing] = useState(false);
  const [brandCatalog, setBrandCatalog] = useState<Record<string, string[]>>({});
  const [summaryCurrency, setSummaryCurrency] = useState<InvestmentCurrency>('ARS');
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [lineDraft, setLineDraft] = useState<ManualForm | null>(null);
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

  const selectedRange = useMemo(
    () => getDateRange(datePreset, customStartDate, customEndDate),
    [datePreset, customStartDate, customEndDate]
  );
  const clients = useMemo(() => Object.keys(brandCatalog).sort(), [brandCatalog]);
  const selectedBrands = useMemo(() => brandCatalog[form.anunciante] ?? [], [brandCatalog, form.anunciante]);
  const controlFilterOptions = useMemo(() => getControlFilterOptions(data?.lines ?? []), [data]);
  const filteredControlLines = useMemo(() => {
    const lines = (data?.lines ?? []).filter((line) => (
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
  }, [data, controlFilters, controlSort]);
  const previewBrands = useMemo(() => {
    const lines = manualData?.lines ?? [];
    return Array.from(new Set(
      lines
        .filter((line) => !previewClientFilter || line.anunciante === previewClientFilter)
        .map((line) => line.marca ?? '')
        .filter(Boolean)
    )).sort();
  }, [manualData, previewClientFilter]);
  const objectiveOptions = useMemo(() => getObjectiveOptions(form.plataforma), [form.plataforma]);

  const groupedLines = useMemo(() => {
    const groups = new Map<string, InvestmentLine[]>();
    manualData?.lines
      .filter((line) => !previewClientFilter || line.anunciante === previewClientFilter)
      .filter((line) => !previewBrandFilter || line.marca === previewBrandFilter)
      .forEach((line) => {
      const key = `${line.anunciante}-${line.moneda}`;
      groups.set(key, [...(groups.get(key) ?? []), line]);
    });
    return Array.from(groups.entries()).map(([key, lines]) => ({ key, lines }));
  }, [manualData, previewClientFilter, previewBrandFilter]);

  async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = payload?.message;
      throw new Error(Array.isArray(message) ? message.join(', ') : message || 'No se pudo completar la operacion');
    }
    return payload as T;
  }

  async function loadInvestments(range = selectedRange, preset = datePreset) {
    setLoading(true);
    setErrorMessage('');
    try {
      const mes = getQueryMonth(preset, range);
      const payload = await requestJson<InvestmentResponse>(`${API_BASE}/investments?mes=${mes}&startDate=${range.startDate}&endDate=${range.endDate}`, { cache: 'no-store' });
      setData(payload);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo cargar inversiones');
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  async function loadManualPreview() {
    try {
      const monthRange = { startDate: monthStart(currentDate), endDate: currentDate };
      const payload = await requestJson<InvestmentResponse>(`${API_BASE}/investments?mes=${currentDate.slice(0, 7)}&startDate=${monthRange.startDate}&endDate=${monthRange.endDate}&includeDrafts=true`, { cache: 'no-store' });
      setManualData(payload);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo cargar la carga manual');
      setManualData(null);
    }
  }

  useEffect(() => {
    loadInvestments().catch(() => setLoading(false));
  }, [datePreset, selectedRange.startDate, selectedRange.endDate]);

  useEffect(() => {
    loadManualPreview().catch(() => undefined);
  }, []);

  useEffect(() => {
    async function loadBrandCatalog() {
      const response = await fetch(`${API_BASE}/brand-mapping`, { cache: 'no-store' });
      const mappings: Array<{ cliente: string; marca: string }> = await response.json();
      const grouped = mappings.reduce<Record<string, string[]>>((acc, item) => {
        acc[item.cliente] = [...(acc[item.cliente] ?? []), item.marca];
        return acc;
      }, {});

      Object.keys(grouped).forEach((cliente) => {
        grouped[cliente] = Array.from(new Set(grouped[cliente])).sort();
      });

      setBrandCatalog(grouped);

      const firstClient = Object.keys(grouped).sort()[0] ?? '';
      const firstBrand = firstClient ? grouped[firstClient][0] ?? '' : '';
      setForm((current) => current.anunciante ? current : {
        ...current,
        anunciante: firstClient,
        marca: firstBrand
      });
    }

    loadBrandCatalog().catch(() => setBrandCatalog({}));
  }, []);

  async function syncSupermetrics() {
    setSyncing(true);
    try {
      setErrorMessage('');
      await requestJson(`${API_BASE}/metrics/sync/supermetrics/monthly-and-daily?source=all&date=${selectedRange.endDate}`, {
        method: 'POST'
      });
      await loadInvestments();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo actualizar consumo');
    } finally {
      setSyncing(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
        moneda: current.moneda,
        plataforma: current.plataforma,
        anunciante: current.anunciante,
        marca: current.marca
      }));
      await loadInvestments(getDateRange(datePreset, customStartDate, customEndDate), datePreset);
      await loadManualPreview();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo guardar la linea');
    } finally {
      setSaving(false);
    }
  }

  async function saveLine(line: InvestmentLine) {
    if (!lineDraft) return;

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
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo editar la linea');
    }
  }

  async function updateLineStatus(line: InvestmentLine, status: InvestmentStatus) {
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
          presupuesto: line.presupuesto,
          costoPorResultado: line.costoPorResultado,
          tktPromedio: line.tktPromedio,
          status
        })
      });
      await loadInvestments();
      await loadManualPreview();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo actualizar el status');
    }
  }

  async function updateGroupStatus(lines: InvestmentLine[], status: InvestmentStatus) {
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
          presupuesto: line.presupuesto,
          costoPorResultado: line.costoPorResultado,
          tktPromedio: line.tktPromedio,
          status
        })
      })));
      await loadInvestments();
      await loadManualPreview();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo actualizar el status');
    }
  }

  function startLineEdit(line: InvestmentLine) {
    setDeleteMode(false);
    setSelectedDeleteIds([]);
    setEditingLineId(line.id);
    setLineDraft({
      anunciante: line.anunciante,
      marca: line.marca ?? '',
      moneda: line.moneda,
      plataforma: line.plataforma,
      objetivo: line.objetivo,
      presupuesto: String(line.presupuesto),
      costoPorResultado: String(line.costoPorResultado),
      tktPromedio: String(line.tktPromedio),
      status: line.status,
      mes: line.mes
    });
  }

  function toggleDeleteMode() {
    setEditingLineId(null);
    setLineDraft(null);
    setDeleteMode((current) => {
      if (current) setSelectedDeleteIds([]);
      return !current;
    });
  }

  function toggleDeleteSelection(id: string) {
    setSelectedDeleteIds((current) => (
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    ));
  }

  async function confirmDeleteLines() {
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
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudieron eliminar las lineas');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">MediaPulse RHD</p>
          <h1>Inversiones</h1>
        </div>
        <div className="date-actions">
          <DateRangeControl
            preset={datePreset}
            range={selectedRange}
            customStartDate={customStartDate}
            customEndDate={customEndDate}
            openSelectId={openSelectId}
            onOpenSelect={setOpenSelectId}
            onPresetChange={setDatePreset}
            onCustomStartChange={setCustomStartDate}
            onCustomEndChange={setCustomEndDate}
          />
          <button className="sync-button" type="button" onClick={syncSupermetrics} disabled={syncing}>
            {syncing ? 'Sincronizando...' : 'Actualizar consumo'}
          </button>
        </div>
      </header>

      <nav className="tabs" aria-label="Vistas de inversiones">
        <button className={activeTab === 'control' ? 'active' : ''} onClick={() => setActiveTab('control')}>
          Control
        </button>
        <button className={activeTab === 'manual' ? 'active' : ''} onClick={() => setActiveTab('manual')}>
          Carga manual
        </button>
      </nav>

      {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}

      {activeTab === 'control' ? (
        <section className="workspace">
          <SummaryStrip
            data={data}
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
                    options={controlFilterOptions.anunciante}
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
                  {Object.entries(sortLabels).map(([key, label]) => (
                    <SortHeader
                      key={key}
                      label={label}
                      sortKey={key as SortKey}
                      currentSort={controlSort}
                      onChange={setControlSort}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredControlLines.map((line) => (
                  <tr key={line.id}>
                    <td>{line.anunciante}</td>
                    <td>{line.marca ?? '-'}</td>
                    <td>{line.moneda}</td>
                    <td><span className={`platform platform-${line.plataforma.toLowerCase().replace(/\s|\./g, '-')}`}>{line.plataforma}</span></td>
                    <td>{line.objetivo}</td>
                    <td>{formatMoney(line.presupuesto, line.moneda)}</td>
                    <td>{formatMoney(line.consumo, line.moneda)}</td>
                    <td>{Math.round(line.porcentajeConsumo * 100)}%</td>
                    <td className={line.consumoRestante < 0 ? 'negative' : ''}>{formatMoney(line.consumoRestante, line.moneda)}</td>
                    <td>{formatMoney(line.presupuestoDaily, line.moneda)}</td>
                    <td>{formatMoney(line.nuevoPresupuestoDiario, line.moneda)}</td>
                    <td className={getDeviationClass(line.desvio)}>{Math.round(line.desvio * 100)}%</td>
                    <td>{formatMoney(line.consumoDia, line.moneda)}</td>
                    <td>{integer.format(line.resultadosProyectados)}</td>
                    <td>{formatMoney(line.fcProyectada, line.moneda)}</td>
                  </tr>
                ))}
                {!loading && filteredControlLines.length === 0 ? (
                  <tr>
                    <td colSpan={15} className="empty">No hay inversiones cargadas para este mes.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="manual-grid">
          <form className="manual-form" onSubmit={handleSubmit}>
            <h2>Nuevo Presupuesto</h2>
            <div className="form-grid">
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
              <SelectField label="Moneda" value={form.moneda} options={[...currencies]} id="manual-moneda" openSelectId={openSelectId} onOpenSelect={setOpenSelectId} onChange={(value) => setForm({ ...form, moneda: value as InvestmentCurrency })} />
              <SelectField
                label="Plataforma"
                value={form.plataforma}
                options={['META', 'Google', 'Merc. Libre', 'TikTok']}
                id="manual-plataforma"
                openSelectId={openSelectId}
                onOpenSelect={setOpenSelectId}
                onChange={(value) => {
                  const options = getObjectiveOptions(value);
                  setForm({ ...form, plataforma: value, objetivo: options.includes(form.objetivo) ? form.objetivo : options[0] });
                }}
              />
              <SelectField label="Objetivo" value={form.objetivo} options={objectiveOptions} id="manual-objetivo" openSelectId={openSelectId} onOpenSelect={setOpenSelectId} onChange={(value) => setForm({ ...form, objetivo: value })} />
              <Field label="Presupuesto" type="number" value={form.presupuesto} onChange={(value) => setForm({ ...form, presupuesto: value })} />
              <Field label="Costo x resultado" type="number" value={form.costoPorResultado} onChange={(value) => setForm({ ...form, costoPorResultado: value })} />
              <Field label="TKT prom" type="number" value={form.tktPromedio} onChange={(value) => setForm({ ...form, tktPromedio: value })} />
            </div>
            <button className="primary-button" type="submit" disabled={saving || !form.anunciante || !form.marca}>
              {saving ? 'Guardando...' : 'Agregar'}
            </button>
          </form>

          <div className="manual-preview">
            <div className="preview-header">
              <h2>Carga actual</h2>
              <div className="preview-filters">
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
                No hay cargas manuales para este mes.
              </div>
            ) : null}
            {groupedLines.map((group) => {
              const clientTotals = getClientTotals(group.lines);
              const brandTotals = getBrandTotals(group.lines);
              const groupStatus = group.lines.every((line) => line.status === 'PRESUPUESTO_OK')
                ? 'PRESUPUESTO_OK'
                : 'EN_PROCESO';
              return (
                <section className="preview-block" key={group.key}>
                  <div className="preview-title">
                    <div className="preview-title-main">
                      <strong>{group.lines[0].anunciante}</strong>
                      <span className="currency-badge">{group.lines[0].moneda}</span>
                      <StatusToggle
                        value={groupStatus}
                        onChange={(status) => updateGroupStatus(group.lines, status)}
                        compact
                        id={`group-status-${group.key}`}
                        openSelectId={openSelectId}
                        onOpenSelect={setOpenSelectId}
                      />
                    </div>
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
                  </div>
                  <table>
                    <thead>
                      <tr>
                        <th>Marca</th>
                        <th>Plataforma</th>
                        <th>Objetivo</th>
                        <th>Presupuesto</th>
                        <th>Costo x resultado</th>
                        <th>TKT prom</th>
                        <th>Share</th>
                        <th>Resultado proyectado</th>
                        <th>FC proyectada</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.lines.map((line) => (
                        <tr key={line.id}>
                          <td>
                            {editingLineId === line.id && lineDraft ? (
                              <SelectField
                                label=""
                                value={lineDraft.marca}
                                options={brandCatalog[lineDraft.anunciante] ?? []}
                                id={`edit-marca-${line.id}`}
                                openSelectId={openSelectId}
                                onOpenSelect={setOpenSelectId}
                                onChange={(value) => setLineDraft({ ...lineDraft, marca: value })}
                              />
                            ) : (
                              <div className="brand-cell">
                                {deleteMode ? (
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
                              <SelectField
                                label=""
                                value={lineDraft.plataforma}
                                options={['META', 'Google', 'Merc. Libre', 'TikTok']}
                                id={`edit-plataforma-${line.id}`}
                                openSelectId={openSelectId}
                                onOpenSelect={setOpenSelectId}
                                onChange={(value) => {
                                  const options = getObjectiveOptions(value);
                                  setLineDraft({ ...lineDraft, plataforma: value, objetivo: options.includes(lineDraft.objetivo) ? lineDraft.objetivo : options[0] });
                                }}
                              />
                            ) : line.plataforma}
                          </td>
                          <td>
                            {editingLineId === line.id && lineDraft ? (
                              <SelectField
                                label=""
                                value={lineDraft.objetivo}
                                options={getObjectiveOptions(lineDraft.plataforma)}
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
                          <td>{Math.round(line.share * 100)}%</td>
                          <td>{integer.format(line.resultadosProyectados)}</td>
                          <td>{formatMoney(line.fcProyectada, line.moneda)}</td>
                          <td className="actions-cell">
                            {editingLineId === line.id ? (
                              <div className="inline-actions">
                                <button className="icon-button confirm" type="button" onClick={() => saveLine(line)} aria-label="Guardar linea">✓</button>
                                <button className="icon-button" type="button" onClick={() => setEditingLineId(null)} aria-label="Cancelar edicion">X</button>
                              </div>
                            ) : (
                              <button className="icon-button" type="button" onClick={() => startLineEdit(line)} aria-label="Editar linea" disabled={deleteMode}>
                                <img src="/assets/edit.svg" alt="" aria-hidden="true" />
                              </button>
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
                          <td>{formatMoney(item.presupuesto, group.lines[0].moneda)}</td>
                          <td></td>
                          <td></td>
                          <td></td>
                          <td></td>
                          <td>{formatMoney(item.fcProyectada, group.lines[0].moneda)}</td>
                          <td></td>
                        </tr>
                      ))}
                      {clientTotals.map((item) => (
                        <tr key={item.cliente}>
                          <td>Total cliente: {item.cliente}</td>
                          <td></td>
                          <td></td>
                          <td>{formatMoney(item.presupuesto, group.lines[0].moneda)}</td>
                          <td></td>
                          <td></td>
                          <td></td>
                          <td></td>
                          <td>{formatMoney(item.fcProyectada, group.lines[0].moneda)}</td>
                          <td></td>
                        </tr>
                      ))}
                    </tfoot>
                  </table>
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
    </main>
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
  customStartDate,
  customEndDate,
  openSelectId,
  onOpenSelect,
  onPresetChange,
  onCustomStartChange,
  onCustomEndChange
}: {
  preset: DatePreset;
  range: { startDate: string; endDate: string };
  customStartDate: string;
  customEndDate: string;
  openSelectId: string | null;
  onOpenSelect: (id: string | null) => void;
  onPresetChange: (preset: DatePreset) => void;
  onCustomStartChange: (date: string) => void;
  onCustomEndChange: (date: string) => void;
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
        <div className="custom-range">
          <label className="month-control">
            Desde
            <input type="date" value={customStartDate} onChange={(event) => onCustomStartChange(event.target.value)} />
          </label>
          <label className="month-control">
            Hasta
            <input type="date" value={customEndDate} onChange={(event) => onCustomEndChange(event.target.value)} />
          </label>
        </div>
      ) : (
        <span className="range-pill">{range.startDate} / {range.endDate}</span>
      )}
    </div>
  );
}

function FilterHeader({
  filterKey,
  label,
  value,
  options,
  openFilter,
  onToggle,
  onChange
}: {
  filterKey: ControlFilterKey;
  label: string;
  value: string;
  options: string[];
  openFilter: ControlFilterKey | null;
  onToggle: (filter: ControlFilterKey | null) => void;
  onChange: (value: string) => void;
}) {
  const isOpen = openFilter === filterKey;
  const allOptions = ['', ...options];

  return (
    <th>
      <div className={`filter-header ${value ? 'active' : ''}`}>
        <span>{label}</span>
        <button
          className="filter-trigger"
          type="button"
          onClick={() => onToggle(isOpen ? null : filterKey)}
          aria-label={`Filtrar ${label}`}
          aria-expanded={isOpen}
        >
          ▼
        </button>
        {isOpen ? (
          <div className="filter-menu">
            {allOptions.map((option) => (
              <button
                className={value === option ? 'selected' : ''}
                key={option || 'all'}
                type="button"
                onClick={() => {
                  onChange(option);
                  onToggle(null);
                }}
              >
                {option || 'Todos'}
              </button>
            ))}
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
  const selected = normalizedOptions.find((option) => option.value === value);
  const isOpen = openSelectId === id;

  return (
    <div className={`custom-select ${className} ${isOpen ? 'open' : ''} ${disabled ? 'disabled' : ''}`}>
      <button
        className="custom-select-trigger"
        type="button"
        disabled={disabled}
        onClick={() => onOpenSelect(isOpen ? null : id)}
        aria-label={ariaLabel || placeholder || id}
        aria-expanded={isOpen}
      >
        <span>{selected?.label || placeholder || 'Seleccionar'}</span>
        <span className="custom-select-arrow">▼</span>
      </button>
      {isOpen ? (
        <div className="custom-select-menu">
          {normalizedOptions.map((option) => (
            <button
              className={option.value === value ? 'selected' : ''}
              key={`${id}-${option.value || 'empty'}`}
              type="button"
              onClick={() => {
                onChange(option.value);
                onOpenSelect(null);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, value, type = 'text', onChange }: { label: string; value: string; type?: string; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} required />
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
