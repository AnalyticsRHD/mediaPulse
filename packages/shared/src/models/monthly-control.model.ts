export interface MonthlyControl {
  id?: string;
  clientId: string;
  month: string;
  budgetOriginal: number;
  budgetAdjusted: number;
  consumoTotal: number;
  resultadosTotales: number;
  diasDelMes: number;
  diaActual: number;
  consumoEsperado: number;
  porcentajeConsumo: number;
  desvioPacing: number;
  semaforo: '🟢' | '🟡' | '🔴';
  consumoRestante: number;
  observaciones?: string;
}
