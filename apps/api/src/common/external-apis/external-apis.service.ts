import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import { ConfigService } from '../../config/config.service';
import { DailyMetrics } from '@mediapulse/shared';
import { BrandMappingService } from '../brand-mapping/brand-mapping.service';

export type SupermetricsSource = 'google' | 'meta' | 'linkedin';
export type SupermetricsScope = 'monthly' | 'daily';

type SupermetricsSourceConfig = {
  platform: string;
  queryJson: string;
};

@Injectable()
export class ExternalApisService {
  private logger = new Logger('ExternalApisService');

  constructor(
    private configService: ConfigService,
    private brandMappingService: BrandMappingService
  ) {}

  async fetchSupermetricsMetrics(
    source: SupermetricsSource,
    scope: SupermetricsScope,
    date = this.today()
  ): Promise<DailyMetrics[]> {
    const apiKey = this.configService.supermetricsApiKey;
    const sourceConfig = this.getSupermetricsSourceConfig(source);
    const queryJson = sourceConfig.queryJson;

    if (!apiKey || !queryJson) {
      this.logger.warn(`Supermetrics ${source} query not configured.`);
      return [];
    }

    let query: any;
    try {
      query = JSON.parse(queryJson);
    } catch {
      this.logger.error(`Invalid Supermetrics ${source} query JSON configuration.`);
      throw new ServiceUnavailableException(`Supermetrics ${source} query is not configured correctly`);
    }

    try {
      const datedQuery = this.withDateRange(query, scope, date);
      const response = await axios.get(`${this.configService.supermetricsApiBaseUrl}/query/data/json`, {
        params: {
          json: JSON.stringify({
            ...datedQuery,
            api_key: apiKey
          })
        },
        timeout: this.configService.supermetricsSyncTimeoutSeconds * 1000
      });

      return this.parseSupermetricsResponse(response.data, sourceConfig.platform, scope, datedQuery.date_range_type, date);
    } catch (error) {
      this.logger.error(`Error fetching Supermetrics ${source} metrics:`, error);
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const detail = status ? `status ${status}` : error.message;
        throw new BadGatewayException(`Supermetrics ${source} sync failed (${detail})`);
      }

      throw new ServiceUnavailableException(`Supermetrics ${source} sync failed`);
    }
  }

  async fetchSupermetricsFacebookAds(date?: string): Promise<DailyMetrics[]> {
    return this.fetchSupermetricsMetrics('meta', date ? 'daily' : 'monthly', date);
  }

  async fetchMetaMetrics(accountId: string, dateFrom: string, dateTo: string): Promise<DailyMetrics[]> {
    const token = this.configService.metaAccessToken;
    if (!token) {
      this.logger.warn('Meta access token not configured. Using mock data.');
      return this.getMockMetaMetrics();
    }

    try {
      const url = `https://graph.instagram.com/v18.0/${accountId}/insights`;
      const response = await axios.get(url, {
        params: {
          metric: 'spend,impressions,clicks,actions_type_onsite_conversion.action_type(purchase)',
          date_preset: 'lifetime',
          access_token: token
        },
        timeout: 10000
      });

      return this.parseMetaResponse(response.data, 'Meta');
    } catch (error) {
      this.logger.error('Error fetching Meta metrics:', error);
      return [];
    }
  }

  async fetchGoogleMetrics(customerId: string): Promise<DailyMetrics[]> {
    const token = this.configService.googleAccessToken;
    if (!token) {
      this.logger.warn('Google access token not configured. Using mock data.');
      return this.getMockGoogleMetrics();
    }

    try {
      // Placeholder for Google Ads API integration
      this.logger.log('Google Ads integration ready (endpoint configured)');
      return [];
    } catch (error) {
      this.logger.error('Error fetching Google metrics:', error);
      return [];
    }
  }

  private parseMetaResponse(data: any, platform: string): DailyMetrics[] {
    // Mock parsing - en producción, mapear respuesta real de API
    this.logger.log(`Parsed ${platform} response`);
    return [];
  }

  private parseSupermetricsResponse(
    data: any,
    platform: string,
    scope: SupermetricsScope,
    dateRangeType?: string,
    forcedDate?: string
  ): DailyMetrics[] {
    const table = this.extractSupermetricsTable(data);
    if (table.length < 2) return [];

    const headers = table[0].map((header) => this.normalizeHeader(String(header)));
    const rows = table.slice(1);

    return rows.map((row, index) => {
      const record = headers.reduce<Record<string, any>>((acc, header, headerIndex) => {
        acc[header] = row[headerIndex];
        return acc;
      }, {});

      const accountName = this.firstValue(record, ['account', 'accountname', 'account_name']);
      const referencia = this.firstValue(record, ['referencia', 'reference']) || this.inferReference(accountName) || accountName || 'Sin referencia';
      const mapping = this.brandMappingService.resolve(referencia);
      const accountId = this.firstValue(record, ['accountid', 'account_id']);
      const campaignName = this.firstValue(record, ['campaign', 'campaignname', 'campaign_name']) || accountName || referencia;
      const campaignId = this.firstValue(record, ['campaignid', 'campaign_id']) || `${platform}-${accountId || this.normalizeHeader(referencia) || index}`;

      return {
        date: this.resolveMetricDate(record, dateRangeType, forcedDate, scope),
        cliente: mapping.cliente,
        marca: mapping.marca,
        referencia,
        accountId,
        accountName,
        plataforma: platform,
        campaignId,
        campaignName,
        granularity: scope,
        spend: this.numberValue(this.firstValue(record, ['cost', 'amountspent', 'amount_spent', 'spend'])),
        impressions: this.numberValue(this.firstValue(record, ['impressions'])),
        clicks: this.numberValue(this.firstValue(record, ['clicks'])),
        conversions: this.numberValue(this.firstValue(record, ['conversions'])),
        revenue: this.numberValue(this.firstValue(record, ['totalconversionvalue', 'total_conversion_value', 'revenue']))
      };
    });
  }

  private extractSupermetricsTable(data: any): any[][] {
    if (Array.isArray(data?.data?.rows) && Array.isArray(data?.data?.headers)) {
      return [data.data.headers, ...data.data.rows];
    }

    if (Array.isArray(data?.data)) {
      return data.data.map((row: any) => Array.isArray(row?.value) ? row.value : row);
    }

    if (Array.isArray(data?.rows) && Array.isArray(data?.headers)) {
      return [data.headers, ...data.rows];
    }

    if (Array.isArray(data)) {
      return data;
    }

    return [];
  }

  private inferReference(accountName: string): string {
    if (!accountName) return '';

    const clean = accountName
      .replace(/_RHD.*$/i, '')
      .replace(/_MANAGED.*$/i, '')
      .replace(/_LINEA.*$/i, '')
      .replace(/_/g, ' ')
      .trim();

    if (!clean) return '';

    return clean.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  private getSupermetricsSourceConfig(source: SupermetricsSource): SupermetricsSourceConfig {
    const configs: Record<SupermetricsSource, SupermetricsSourceConfig> = {
      google: {
        platform: 'Google',
        queryJson: this.configService.supermetricsGoogleAdsQueryJson
      },
      meta: {
        platform: 'META',
        queryJson: this.configService.supermetricsFacebookAdsQueryJson
      },
      linkedin: {
        platform: 'LinkedIn',
        queryJson: this.configService.supermetricsLinkedinAdsQueryJson
      }
    };

    return configs[source];
  }

  private withDateRange(query: any, scope: SupermetricsScope, date: string): any {
    if (scope === 'monthly') {
      return {
        ...query,
        date_range_type: 'custom',
        start_date: this.monthStart(date),
        end_date: date
      };
    }

    return {
      ...query,
      date_range_type: 'custom',
      start_date: date,
      end_date: date
    };
  }

  private normalizeHeader(header: string): string {
    return header.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private firstValue(record: Record<string, any>, keys: string[]): string {
    for (const key of keys) {
      const value = record[this.normalizeHeader(key)];
      if (value !== undefined && value !== null && value !== '') return String(value);
    }

    return '';
  }

  private numberValue(value: any): number {
    if (value === undefined || value === null || value === '') return 0;
    return Number(String(value).replace(/[$,]/g, '')) || 0;
  }

  private resolveMetricDate(record: Record<string, any>, dateRangeType?: string, forcedDate?: string, scope: SupermetricsScope = 'daily'): string {
    if (forcedDate) return scope === 'monthly' ? this.monthStart(forcedDate) : forcedDate;

    const explicitDate = this.firstValue(record, ['date', 'day']);
    if (explicitDate) return this.normalizeDate(explicitDate);

    if (dateRangeType === 'yesterday') {
      const date = new Date();
      date.setDate(date.getDate() - 1);
      return date.toISOString().slice(0, 10);
    }

    const month = this.firstValue(record, ['month']);
    if (month) {
      const year = new Date().getFullYear();
      return `${year}-${String(Number(month)).padStart(2, '0')}-01`;
    }

    return new Date().toISOString().slice(0, 10);
  }

  private normalizeDate(value: string): string {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);

    return new Date().toISOString().slice(0, 10);
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private monthStart(date: string): string {
    return `${date.slice(0, 7)}-01`;
  }

  private getMockMetaMetrics(): DailyMetrics[] {
    const today = new Date().toISOString().split('T')[0];
    return [
      {
        date: today,
        cliente: 'Fresh Up',
        marca: 'Fresh Up',
        plataforma: 'Meta',
        campaignId: 'meta-campaign-001',
        campaignName: 'Ventas Meta',
        spend: 50000,
        impressions: 500000,
        clicks: 15000,
        conversions: 300,
        revenue: 150000
      },
      {
        date: today,
        cliente: 'Fresh Up',
        marca: 'Fresh Up',
        plataforma: 'Meta',
        campaignId: 'meta-campaign-002',
        campaignName: 'Alcance Meta',
        spend: 30000,
        impressions: 800000,
        clicks: 10000,
        conversions: 150,
        revenue: 75000
      }
    ];
  }

  private getMockGoogleMetrics(): DailyMetrics[] {
    const today = new Date().toISOString().split('T')[0];
    return [
      {
        date: today,
        cliente: 'Fresh Up',
        marca: 'Fresh Up',
        plataforma: 'Google',
        campaignId: 'google-campaign-001',
        campaignName: 'Search Google',
        spend: 45000,
        impressions: 300000,
        clicks: 20000,
        conversions: 400,
        revenue: 200000
      }
    ];
  }

  async testConnectivity(): Promise<{ meta: boolean; google: boolean }> {
    return {
      meta: !!this.configService.metaAccessToken,
      google: !!this.configService.googleAccessToken
    };
  }
}
