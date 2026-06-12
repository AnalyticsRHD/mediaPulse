export enum InvestmentCurrency {
  ARS = 'ARS',
  CHL = 'CHL',
  USD = 'USD'
}

export enum InvestmentStatus {
  EN_PROCESO = 'EN_PROCESO',
  PRESUPUESTO_OK = 'PRESUPUESTO_OK'
}

export interface ManualInvestmentLine {
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
  lastConsumo?: number;
  lastConsumoDia?: number;
  lastConsumoUpdatedAt?: string | null;
  createdAt?: string;
  updatedAt?: string | null;
  deletedAt?: string | null;
}

export interface InvestmentLine extends ManualInvestmentLine {
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
}

export interface InvestmentSummary {
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
}

export interface InvestmentsResponse {
  summary: InvestmentSummary;
  lines: InvestmentLine[];
}
