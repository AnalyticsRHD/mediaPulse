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
  lastConsumoHoy?: number;
  lastConsumoHoyDate?: string | null;
  lastConsumoUpdatedAt?: string | null;
  createdAt?: string;
  updatedAt?: string | null;
  deletedAt?: string | null;
}

export type ManualInvestmentLogAction = 'CREATED' | 'UPDATED' | 'DELETED';

export interface ManualInvestmentLog {
  id: string;
  action: ManualInvestmentLogAction;
  userId: string | null;
  userName: string;
  manualInvestmentLineId: string;
  manualInvestmentLineAnunciante: string;
  manualInvestmentLineSnapshot: ManualInvestmentLine;
  createdAt: string;
  updatedAt: string | null;
  deletedAt: string | null;
}

export interface InvestmentDeviationComment {
  id: string;
  manualInvestmentLineId: string;
  comment: string;
  userId: string | null;
  userName: string;
  createdAt: string;
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
  latestDeviationComment?: InvestmentDeviationComment | null;
}

export interface InvestmentSummary {
  mes: string;
  date: string;
  startDate: string;
  endDate: string;
  dias: number;
  diasRestantes: number;
  diasRestantesExactos: number;
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
