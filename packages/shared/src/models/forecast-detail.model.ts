export interface ForecastDetail {
  id?: string;
  monthlyControlId?: string;
  cliente: string;
  marca: string;
  plataforma: string;
  campaña: string;
  mes: string;
  budget: number;
  cpaEsperado: number;
  resultadosProyectados: number;
  campaignId?: string;
  campaignName?: string;
}
