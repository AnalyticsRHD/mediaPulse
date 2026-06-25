export interface DailyMetrics {
  id?: string;
  date: string;
  cliente: string;
  marca: string;
  plataforma: string;
  campaignId: string;
  campaignName: string;
  adSetName?: string;
  adGroupName?: string;
  objetivo?: string;
  referencia?: string;
  accountId?: string;
  accountName?: string;
  granularity?: 'daily' | 'monthly';
  coverageEndDate?: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue?: number;
}
