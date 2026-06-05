import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import { ConfigService } from '../../config/config.service';
import { DailyMetrics } from '@mediapulse/shared';
import { BrandMappingService } from '../brand-mapping/brand-mapping.service';

export type SupermetricsSource = 'google' | 'meta' | 'linkedin';
export type SupermetricsScope = 'monthly' | 'daily';
export type NativeAdsSource = 'tiktok' | 'mercadolibre';
export type AdsMetricsSource = SupermetricsSource | NativeAdsSource;

type SupermetricsSourceConfig = {
  platform: string;
  queryJson: string;
};

@Injectable()
export class ExternalApisService {
  private logger = new Logger('ExternalApisService');
  private warnedMissingConfig = new Set<string>();

  constructor(
    private configService: ConfigService,
    private brandMappingService: BrandMappingService
  ) {}

  async fetchSupermetricsMetrics(
    source: SupermetricsSource,
    scope: SupermetricsScope,
    date = this.today()
  ): Promise<DailyMetrics[]> {
    if (this.shouldPreferAdsSheets(source)) {
      return this.fetchAdsSheetsMetrics(source, scope, date);
    }

    const apiKey = this.configService.supermetricsApiKey;
    const sourceConfig = this.getSupermetricsSourceConfig(source);
    const queryJson = sourceConfig.queryJson;

    if (!apiKey || !queryJson) {
      this.warnMissingConfig(`supermetrics-${source}`, `Supermetrics ${source} query not configured.`);
      return this.fetchAdsSheetsMetrics(source, scope, date);
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
      if (axios.isAxiosError(error)) {
        const detail = this.axiosDetail(error);
        this.logExternalSyncFailure(`Supermetrics ${source} ${scope}`, detail);
        const sheetsMetrics = await this.fetchAdsSheetsMetrics(source, scope, date);
        if (sheetsMetrics.length > 0 || this.configService.adsSheetsSourceSpreadsheetId) return sheetsMetrics;
        throw new BadGatewayException(`Supermetrics ${source} sync failed (${detail})`);
      }

      this.logger.error(`Supermetrics ${source} ${scope} sync failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new ServiceUnavailableException(`Supermetrics ${source} sync failed`);
    }
  }

  async fetchSupermetricsFacebookAds(date?: string): Promise<DailyMetrics[]> {
    return this.fetchSupermetricsMetrics('meta', date ? 'daily' : 'monthly', date);
  }

  async fetchNativeAdsMetrics(
    source: NativeAdsSource,
    scope: SupermetricsScope,
    date = this.today()
  ): Promise<DailyMetrics[]> {
    if (source === 'tiktok') return this.fetchTikTokMetrics(scope, date);
    return this.fetchMercadoLibreMetrics(scope, date);
  }

  async fetchTikTokMetrics(scope: SupermetricsScope, date = this.today()): Promise<DailyMetrics[]> {
    const accessToken = this.configService.tiktokAccessToken;
    const advertiserIds = this.configService.tiktokAdvertiserIds;

    if (!accessToken || advertiserIds.length === 0) {
      this.warnMissingConfig('tiktok', 'TikTok access token or advertiser ids not configured.');
      return [];
    }

    const startDate = scope === 'monthly' ? this.monthStart(date) : date;
    const endDate = date;
    const aggregated = new Map<string, { advertiserId: string; accountName: string; spend: number }>();

    try {
      const advertiserNames = await this.fetchTikTokAdvertiserNames(accessToken);

      for (const advertiserId of advertiserIds) {
        let page = 1;
        let totalPages = 1;

        do {
          const response = await axios.get(
            `${this.configService.tiktokApiBaseUrl}/report/integrated/get/`,
            {
              headers: { 'Access-Token': accessToken },
              params: {
                advertiser_id: advertiserId,
                report_type: 'BASIC',
                data_level: 'AUCTION_ADVERTISER',
                dimensions: JSON.stringify(['stat_time_day', 'advertiser_id']),
                metrics: JSON.stringify(['spend']),
                start_date: startDate,
                end_date: endDate,
                page,
                page_size: 1000
              },
              timeout: this.configService.tiktokSyncTimeoutSeconds * 1000
            }
          );

          const data = response.data;
          if (data?.code !== undefined && data.code !== 0) {
            throw new BadGatewayException(`TikTok sync failed (${data.message || `code ${data.code}`})`);
          }

          const list = data?.data?.list || [];
          totalPages = Number(data?.data?.page_info?.total_page || 1) || 1;

          for (const item of list) {
            const dimensions = item.dimensions || item.dimension || item;
            const metrics = item.metrics || item.metric || item;
            const rawDate = String(dimensions.stat_time_day || dimensions.stat_time || startDate);
            const bucketDate = scope === 'monthly' ? this.monthStart(rawDate) : rawDate.slice(0, 10);
            const reportedAdvertiserId = String(dimensions.advertiser_id || advertiserId);
            const accountName = advertiserNames.get(reportedAdvertiserId) || advertiserNames.get(String(advertiserId)) || String(advertiserId);
            const key = `${bucketDate}||${advertiserId}||${accountName}`;
            const existing = aggregated.get(key) ?? { advertiserId, accountName, spend: 0 };
            existing.spend += this.numberValue(metrics.spend ?? item.spend);
            aggregated.set(key, existing);
          }

          page += 1;
        } while (page <= totalPages);
      }

      const out: DailyMetrics[] = [];
      let index = 0;

      for (const [key, value] of aggregated.entries()) {
        const [metricDate] = key.split('||');
        const referencia = this.inferReference(value.accountName) || value.accountName || value.advertiserId;
        const mapping = await this.brandMappingService.resolve(referencia);

        out.push({
          date: metricDate,
          cliente: mapping.cliente,
          marca: mapping.marca,
          referencia,
          accountId: value.advertiserId,
          accountName: value.accountName,
          plataforma: 'TikTok',
          campaignId: `TikTok-${value.advertiserId}-${scope}-${metricDate}-${index}`,
          campaignName: value.accountName,
          granularity: scope,
          spend: this.round2(value.spend),
          impressions: 0,
          clicks: 0,
          conversions: 0,
          revenue: 0
        });
        index += 1;
      }

      return out;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const detail = this.axiosDetail(error);
        this.logger.error(`TikTok ${scope} sync failed: ${detail}`);
        throw new BadGatewayException(`TikTok sync failed (${detail})`);
      }

      if (error instanceof BadGatewayException) throw error;
      this.logger.error(`TikTok ${scope} sync failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new ServiceUnavailableException('TikTok sync failed');
    }
  }

  async fetchMercadoLibreMetrics(scope: SupermetricsScope, date = this.today()): Promise<DailyMetrics[]> {
    const spreadsheetId = this.configService.mercadoLibreSourceSpreadsheetId;
    const rawSheets = this.configService.mercadoLibreRawSheets;

    if (!spreadsheetId || rawSheets.length === 0) {
      this.warnMissingConfig('mercadolibre', 'Mercado Libre source spreadsheet or raw sheets not configured.');
      return [];
    }

    const startDate = scope === 'monthly' ? this.monthStart(date) : date;
    const endDate = date;
    const aggregated = new Map<string, { accountName: string; spend: number }>();

    try {
      for (const sheetName of rawSheets) {
        const rows = await this.fetchGoogleSheetRows(spreadsheetId, sheetName);
        const accountName = sheetName.replace(/\s-\sDisplay$/i, '').trim();

        for (const row of rows.slice(1)) {
          const rowDate = this.normalizeSheetDate(row[2]);
          if (!rowDate || rowDate < startDate || rowDate > endDate) continue;

          const bucketDate = scope === 'monthly' ? this.monthStart(rowDate) : rowDate;
          const key = `${bucketDate}||${accountName}`;
          const existing = aggregated.get(key) ?? { accountName, spend: 0 };
          existing.spend += this.numberValue(row[5]);
          aggregated.set(key, existing);
        }
      }

      const out: DailyMetrics[] = [];
      let index = 0;

      for (const [key, value] of aggregated.entries()) {
        const [metricDate] = key.split('||');
        const referencia = value.accountName;
        const mapping = await this.brandMappingService.resolve(referencia);

        out.push({
          date: metricDate,
          cliente: mapping.cliente,
          marca: mapping.marca,
          referencia,
          accountName: value.accountName,
          plataforma: 'Merc. Libre',
          campaignId: `MercadoLibre-${this.normalizeHeader(value.accountName)}-${scope}-${metricDate}-${index}`,
          campaignName: value.accountName,
          granularity: scope,
          spend: this.round2(value.spend),
          impressions: 0,
          clicks: 0,
          conversions: 0,
          revenue: 0
        });
        index += 1;
      }

      return out.sort((a, b) => {
        if (a.date === b.date) return (a.accountName || '').localeCompare(b.accountName || '');
        return a.date.localeCompare(b.date);
      });
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const detail = this.axiosDetail(error);
        this.logger.error(`Mercado Libre ${scope} sync failed: ${detail}`);
        throw new BadGatewayException(`Mercado Libre sync failed (${detail})`);
      }

      this.logger.error(`Mercado Libre ${scope} sync failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new ServiceUnavailableException('Mercado Libre sync failed');
    }
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

  private async parseSupermetricsResponse(
    data: any,
    platform: string,
    scope: SupermetricsScope,
    dateRangeType?: string,
    forcedDate?: string
  ): Promise<DailyMetrics[]> {
    const table = this.extractSupermetricsTable(data);
    if (table.length < 2) return [];

    const headers = table[0].map((header) => this.normalizeHeader(String(header)));
    const rows = table.slice(1);
    const metrics: DailyMetrics[] = [];

    for (const [index, row] of rows.entries()) {
      const record = headers.reduce<Record<string, any>>((acc, header, headerIndex) => {
        acc[header] = row[headerIndex];
        return acc;
      }, {});

      const accountName = this.firstValue(record, ['account', 'accountname', 'account_name']);
      const referencia = this.firstValue(record, ['referencia', 'reference']) || this.inferReference(accountName) || accountName || 'Sin referencia';
      const mapping = await this.brandMappingService.resolve(referencia);
      const accountId = this.firstValue(record, ['accountid', 'account_id']);
      const campaignName = this.firstValue(record, ['campaign', 'campaignname', 'campaign_name']) || accountName || referencia;
      const campaignId = this.firstValue(record, ['campaignid', 'campaign_id']) || `${platform}-${accountId || this.normalizeHeader(referencia) || index}`;

      metrics.push({
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
      });
    }

    return metrics;
  }

  private async fetchAdsSheetsMetrics(
    source: SupermetricsSource,
    scope: SupermetricsScope,
    date = this.today()
  ): Promise<DailyMetrics[]> {
    const spreadsheetId = this.configService.adsSheetsSourceSpreadsheetId;

    if (!spreadsheetId) {
      this.warnMissingConfig('ads-sheets', 'Google/Meta source spreadsheet not configured.');
      return [];
    }

    if (source === 'linkedin') {
      this.warnMissingConfig('linkedin-sheets', 'LinkedIn Sheets sync is not configured yet.');
      return [];
    }

    const range = this.getAdsSheetsRange(source, scope);
    if (!range) return [];

    try {
      const rows = await this.fetchGoogleSheetRows(
        spreadsheetId,
        range.sheetName,
        range.rangeA1,
        this.configService.adsSheetsGoogleSheetsApiKey,
        this.configService.adsSheetsSyncTimeoutSeconds
      );

      return this.parseAdsSheetRows(rows, source, scope, date, range);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        this.logger.error(`${source} Sheets ${scope} sync failed: ${this.axiosDetail(error)}`);
        return [];
      }

      this.logger.error(`${source} Sheets ${scope} sync failed: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  private shouldPreferAdsSheets(source: SupermetricsSource): boolean {
    return Boolean(this.configService.adsSheetsSourceSpreadsheetId) && ['google', 'meta'].includes(source);
  }

  private getAdsSheetsRange(
    source: SupermetricsSource,
    scope: SupermetricsScope
  ): { sheetName: string; rangeA1: string; platform: string; startAtDataRow: boolean } | null {
    if (source === 'google') {
      return this.parseSheetRange(
        scope === 'monthly' ? this.configService.googleAdsMonthlyRange : this.configService.googleAdsDailyRange,
        'Google',
        scope === 'monthly' ? 'A:F' : 'M:P'
      );
    }

    if (source === 'meta') {
      return {
        ...this.parseSheetRange(
          scope === 'monthly' ? this.configService.metaAdsMonthlyRange : this.configService.metaAdsDailyRange,
          'Meta',
          scope === 'monthly' ? 'A:C' : 'L:N'
        ),
        platform: 'META',
        startAtDataRow: true
      };
    }

    return null;
  }

  private parseSheetRange(
    value: string,
    fallbackSheetName: string,
    fallbackRangeA1: string
  ): { sheetName: string; rangeA1: string; platform: string; startAtDataRow: boolean } {
    const [sheetName, rangeA1] = value.includes('!')
      ? value.split('!', 2)
      : [fallbackSheetName, value || fallbackRangeA1];

    return {
      sheetName: sheetName.replace(/^'|'$/g, ''),
      rangeA1: rangeA1 || fallbackRangeA1,
      platform: fallbackSheetName === 'Google' ? 'Google' : fallbackSheetName,
      startAtDataRow: true
    };
  }

  private async parseAdsSheetRows(
    rows: any[][],
    source: SupermetricsSource,
    scope: SupermetricsScope,
    date: string,
    range: { platform: string }
  ): Promise<DailyMetrics[]> {
    const metrics: DailyMetrics[] = [];
    const startDate = scope === 'monthly' ? this.monthStart(date) : date;
    const endDate = date;
    const currentMonth = Number(date.slice(5, 7));
    const rowsWithoutHeaders = rows.filter((row) => row.some((value) => String(value || '').trim() !== ''));
    const normalizedRows = rowsWithoutHeaders.filter((row) => {
      const first = this.normalizeHeader(String(row[0] || ''));
      return first !== 'month' && first !== 'mes' && first !== 'bajadagoogleads' && first !== 'consumodeayer';
    });

    for (const [index, row] of normalizedRows.entries()) {
      const month = this.numberValue(row[0]);
      const accountName = String(row[1] || '').trim();
      const spend = this.numberValue(row[2]);
      const referencia = String(row[5] || '').trim() || String(row[3] || '').trim() || this.inferReference(accountName) || accountName;

      if (!accountName || spend === 0) continue;
      if (scope === 'monthly' && month && month !== currentMonth) continue;

      const metricDate = scope === 'monthly'
        ? `${date.slice(0, 4)}-${String(month || currentMonth).padStart(2, '0')}-01`
        : date;

      if (metricDate < startDate || metricDate > endDate) continue;

      const mapping = await this.brandMappingService.resolve(referencia);

      metrics.push({
        date: metricDate,
        cliente: mapping.cliente,
        marca: mapping.marca,
        referencia,
        accountName,
        plataforma: range.platform,
        campaignId: `${range.platform}-${this.normalizeHeader(accountName)}-${scope}-${metricDate}-${index}`,
        campaignName: accountName,
        granularity: scope,
        spend: this.round2(spend),
        impressions: 0,
        clicks: 0,
        conversions: this.numberValue(row[3]),
        revenue: this.numberValue(row[4])
      });
    }

    return metrics;
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

  private round2(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private async fetchTikTokAdvertiserNames(accessToken: string): Promise<Map<string, string>> {
    const appId = this.configService.tiktokAppId;
    const secret = this.configService.tiktokAppSecret;
    const names = new Map<string, string>();

    if (!appId || !secret) return names;

    try {
      const response = await axios.get(`${this.configService.tiktokApiBaseUrl}/oauth2/advertiser/get/`, {
        headers: { 'Access-Token': accessToken },
        params: {
          app_id: appId,
          secret
        },
        timeout: this.configService.tiktokSyncTimeoutSeconds * 1000
      });

      const list = response.data?.data?.list || [];
      for (const item of list) {
        if (item.advertiser_id) {
          names.set(String(item.advertiser_id), String(item.advertiser_name || item.advertiser_id));
        }
      }
    } catch (error) {
      this.logger.warn(`Could not fetch TikTok advertiser names: ${this.axiosDetail(error)}`);
    }

    return names;
  }

  private warnMissingConfig(key: string, message: string): void {
    if (this.warnedMissingConfig.has(key)) return;
    this.warnedMissingConfig.add(key);
    this.logger.warn(message);
  }

  private logExternalSyncFailure(label: string, detail: string): void {
    if (/TRIAL_EXPIRED/i.test(detail)) {
      this.logger.warn(`${label} sync skipped: ${detail}`);
      return;
    }

    this.logger.error(`${label} sync failed: ${detail}`);
  }

  private axiosDetail(error: any): string {
    if (!axios.isAxiosError(error)) return error instanceof Error ? error.message : String(error);

    const status = error.response?.status;
    const statusText = error.response?.statusText;
    const responseMessage = this.extractResponseMessage(error.response?.data);
    const parts = [
      status ? `status ${status}` : '',
      statusText || '',
      responseMessage || error.message
    ].filter(Boolean);

    return parts.join(' - ');
  }

  private extractResponseMessage(data: any): string {
    if (!data) return '';
    if (typeof data === 'string') return data.slice(0, 240);
    if (typeof data.message === 'string') return data.message;
    if (typeof data.error === 'string') return data.error;
    try {
      return JSON.stringify(data).slice(0, 240);
    } catch {
      return '';
    }
  }

  private async fetchGoogleSheetRows(
    spreadsheetId: string,
    sheetName: string,
    rangeA1 = 'A:L',
    apiKey = this.configService.mercadoLibreGoogleSheetsApiKey,
    timeoutSeconds = this.configService.mercadoLibreSyncTimeoutSeconds
  ): Promise<any[][]> {
    const timeout = timeoutSeconds * 1000;

    if (apiKey) {
      const range = `'${sheetName.replace(/'/g, "''")}'!${rangeA1}`;
      const response = await axios.get(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
        {
          params: { key: apiKey },
          timeout
        }
      );

      return response.data?.values || [];
    }

    const response = await axios.get(
      `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/gviz/tq`,
      {
        params: {
          tqx: 'out:csv',
          sheet: sheetName,
          range: rangeA1
        },
        responseType: 'text',
        timeout
      }
    );

    return this.parseCsv(String(response.data || ''));
  }

  private parseCsv(csv: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let inQuotes = false;

    for (let index = 0; index < csv.length; index += 1) {
      const char = csv[index];
      const next = csv[index + 1];

      if (char === '"' && inQuotes && next === '"') {
        cell += '"';
        index += 1;
        continue;
      }

      if (char === '"') {
        inQuotes = !inQuotes;
        continue;
      }

      if (char === ',' && !inQuotes) {
        row.push(cell);
        cell = '';
        continue;
      }

      if ((char === '\n' || char === '\r') && !inQuotes) {
        if (char === '\r' && next === '\n') index += 1;
        row.push(cell);
        if (row.some((value) => value !== '')) rows.push(row);
        row = [];
        cell = '';
        continue;
      }

      cell += char;
    }

    row.push(cell);
    if (row.some((value) => value !== '')) rows.push(row);

    return rows;
  }

  private normalizeSheetDate(value: any): string {
    if (value === undefined || value === null || value === '') return '';

    if (typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value).trim())) {
      const serial = Number(value);
      if (serial > 20000) {
        const epoch = Date.UTC(1899, 11, 30);
        return new Date(epoch + serial * 86400000).toISOString().slice(0, 10);
      }
    }

    const raw = String(value).trim();
    const ymd = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;

    const dmy = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);

    return '';
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
