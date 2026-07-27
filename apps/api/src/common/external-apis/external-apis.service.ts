import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import axios, { AxiosRequestConfig } from 'axios';
import { promises as fs } from 'fs';
import path from 'path';
import { ConfigService } from '../../config/config.service';
import { DailyMetrics } from '@mediapulse/shared';
import { BrandMappingService } from '../brand-mapping/brand-mapping.service';

const OPERATIONAL_TIME_ZONE = 'America/Argentina/Buenos_Aires';

export type SupermetricsSource = 'linkedin';
export type SupermetricsScope = 'monthly' | 'daily';
export type NativeAdsSource = 'google' | 'meta' | 'tiktok' | 'mercadolibre';
export type AdsMetricsSource = SupermetricsSource | NativeAdsSource;

type SupermetricsSourceConfig = {
  platform: string;
  queryJson: string;
};

type AdsSheetColumnMap = {
  month: number;
  accountName: number;
  campaignName?: number;
  adSetName?: number;
  adGroupName?: number;
  spend: number;
  conversions?: number;
  revenue?: number;
  referencia?: number;
};

type MercadoLibreAdvertiserConfig = {
  id: string;
  accountName?: string;
  referencia?: string;
};

type MercadoLibreWebMetricRow = {
  name?: string;
  value?: string | number;
};

type MercadoLibreOAuthState = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  updatedAt: string;
};

@Injectable()
export class ExternalApisService {
  private logger = new Logger('ExternalApisService');
  private warnedMissingConfig = new Set<string>();
  private mercadoLibreOAuthState: MercadoLibreOAuthState | null | undefined;
  private mercadoLibreRefreshPromise: Promise<string> | null = null;

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

    const datedQuery = this.withDateRange(
      query,
      scope,
      date
    );

    try {
      const response = await this.requestSupermetricsData(datedQuery, apiKey);
      return this.parseSupermetricsResponse(response.data, sourceConfig.platform, scope, datedQuery.date_range_type, date);
    } catch (error) {
      return this.handleSupermetricsFailure(error, source, scope, date);
    }
  }

  private requestSupermetricsData(query: any, apiKey: string) {
    return axios.get(`${this.configService.supermetricsApiBaseUrl}/query/data/json`, {
      params: {
        json: JSON.stringify({
          ...query,
          api_key: apiKey
        })
      },
      timeout: this.configService.supermetricsSyncTimeoutSeconds * 1000
    });
  }

  private async handleSupermetricsFailure(
    error: unknown,
    source: SupermetricsSource,
    scope: SupermetricsScope,
    date: string
  ): Promise<DailyMetrics[]> {
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

  async fetchSupermetricsFacebookAds(date?: string): Promise<DailyMetrics[]> {
    return this.fetchMetaAdsMetrics(date ? 'daily' : 'monthly', date);
  }

  async fetchNativeAdsMetrics(
    source: NativeAdsSource,
    scope: SupermetricsScope,
    date = this.today()
  ): Promise<DailyMetrics[]> {
    if (source === 'google') return this.fetchGoogleAdsMetrics(scope, date);
    if (source === 'meta') return this.fetchMetaAdsMetrics(scope, date);
    if (source === 'tiktok') return this.fetchTikTokMetrics(scope, date);
    if (!this.configService.mercadoLibreSyncEnabled) {
      this.logger.warn('Mercado Libre sync skipped: MERCADO_LIBRE_SYNC_ENABLED=false');
      return [];
    }
    return this.fetchMercadoLibreMetrics(scope, date);
  }

  async fetchMetaAdsMetrics(scope: SupermetricsScope, date = this.today()): Promise<DailyMetrics[]> {
    const accessToken = this.configService.metaAccessToken;
    const accountIds = this.configService.metaAccountIds;

    if (!accessToken || accountIds.length === 0) {
      this.warnMissingConfig('meta-marketing-api', 'Meta access token or ad account ids not configured.');
      return [];
    }

    const maxAccounts = this.configService.metaMaxAccountsPerSync;
    if (accountIds.length > maxAccounts) {
      this.logger.warn(
        `Meta sync skipped: ${accountIds.length} ad accounts configured. Keep META_ACCOUNT_IDS under ${maxAccounts} accounts or increase META_MAX_ACCOUNTS_PER_SYNC.`
      );
      return [];
    }

    const startDate = scope === 'monthly' ? this.monthStart(date) : date;
    const endDate = date;
    const aggregated = new Map<string, {
      date: string;
      accountId: string;
      accountName: string;
      campaignId: string;
      campaignName: string;
      adSetId: string;
      adSetName: string;
      spend: number;
      impressions: number;
      clicks: number;
      conversions: number;
      revenue: number;
    }>();

    const accountBatches = this.chunkArray(accountIds, 8);
    let fetchedRows = 0;
    let filteredRows = 0;

    for (const batch of accountBatches) {
      const batchResults = await Promise.all(
        batch.map(async (accountId) => ({
          accountId,
          rows: await this.fetchMetaAccountInsights(accountId, startDate, endDate, accessToken)
        }))
      );

      for (const { accountId, rows } of batchResults) {
        fetchedRows += rows.length;
        for (const row of rows) {
          const accountName = String(row.account_name || row.accountName || '');
          if (accountName && !this.isManagedAdsAccount(accountName)) {
            filteredRows += 1;
            continue;
          }

          const spend = this.numberValue(row.spend);
          if (!spend) continue;

          const adSetName = String(row.adset_name || row.adSetName || '');
          const adSetId = String(row.adset_id || row.adSetId || this.normalizeHeader(adSetName));
          const campaignName = String(row.campaign_name || row.campaignName || '');
          const campaignId = String(row.campaign_id || row.campaignId || this.normalizeHeader(campaignName));
          const metricDate = scope === 'monthly' ? this.monthStart(date) : String(row.date_start || date).slice(0, 10);
          const key = [accountId, campaignId, adSetId, scope, metricDate].join('||');
          const current = aggregated.get(key) || {
            date: metricDate,
            accountId,
            accountName,
            campaignId,
            campaignName,
            adSetId,
            adSetName,
            spend: 0,
            impressions: 0,
            clicks: 0,
            conversions: 0,
            revenue: 0
          };

          current.spend += spend;
          current.impressions += this.numberValue(row.impressions);
          current.clicks += this.numberValue(row.clicks);
          current.conversions += this.sumMetaActions(row.actions, ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead', 'purchase', 'omni_purchase']);
          current.revenue += this.sumMetaActions(row.action_values, ['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase']);
          aggregated.set(key, current);
        }
      }
    }

    this.logger.log(
      `Meta ${scope} sync read ${fetchedRows} rows, filtered ${filteredRows}, aggregated ${aggregated.size} rows.`
    );

    const metrics: DailyMetrics[] = [];

    for (const item of aggregated.values()) {
      const referencia = this.inferReference(item.accountName) || item.accountName;
      let mapping = await this.brandMappingService.resolve(referencia);
      // Fallback: some Meta accounts include RHD in the account name (e.g. RED_HOOK_DATA_RHD_GESTION_CO)
      // brandMapping.resolve may return 'SIN MAPEO' for the cleaned reference. If account name
      // contains RHD or RED_HOOK, map it to the RHD client so metrics match manual lines.
      if (mapping.cliente === 'SIN MAPEO') {
        const acct = String(item.accountName || '').toUpperCase();
        if (acct.includes('RHD') || acct.includes('RED_HOOK')) {
          mapping = { cliente: 'RHD', marca: 'RHD' };
        }
      }
      const metricCampaignId = [
        'META',
        item.accountId,
        item.campaignId,
        item.adSetId,
        scope,
        item.date
      ].join('-');

      metrics.push({
        date: item.date,
        cliente: mapping.cliente,
        marca: mapping.marca,
        referencia,
        accountId: item.accountId,
        accountName: item.accountName,
        plataforma: 'META',
        campaignId: metricCampaignId,
        campaignName: item.campaignName || item.adSetName || item.accountName,
        adSetName: item.adSetName,
        objetivo: this.inferObjective(item.campaignName || item.adSetName),
        granularity: scope,
        coverageEndDate: scope === 'monthly' ? endDate : undefined,
        spend: this.round2(item.spend),
        impressions: item.impressions,
        clicks: item.clicks,
        conversions: item.conversions,
        revenue: item.revenue
      });
    }

    return metrics;
  }

  private async fetchMetaAccountInsights(accountId: string, startDate: string, endDate: string, accessToken: string): Promise<any[]> {
    const rows: any[] = [];
    let nextUrl = `${this.configService.metaApiBaseUrl}/act_${accountId}/insights`;
    let params: Record<string, any> | undefined = {
      access_token: accessToken,
      level: 'adset',
      fields: [
        'account_id',
        'account_name',
        'campaign_id',
        'campaign_name',
        'adset_id',
        'adset_name',
        'spend',
        'date_start',
        'date_stop'
      ].join(','),
      time_range: JSON.stringify({ since: startDate, until: endDate }),
      limit: 500
    };

    try {
      while (nextUrl) {
        const response = await axios.get(nextUrl, {
          params,
          timeout: Math.min(this.configService.metaSyncTimeoutSeconds * 1000, 20000)
        });

        rows.push(...(response.data?.data || []));
        nextUrl = response.data?.paging?.next || '';
        params = undefined;
      }
    } catch (error) {
      this.logger.error(`Meta account ${accountId} sync failed: ${this.axiosDetail(error)}`);
    }

    return rows;
  }

  private sumMetaActions(actions: any, actionTypes: string[]): number {
    if (!Array.isArray(actions)) return 0;
    const wanted = new Set(actionTypes.map((type) => this.normalizeHeader(type)));

    return actions.reduce((sum, action) => {
      const type = this.normalizeHeader(String(action.action_type || action.actionType || ''));
      if (!wanted.has(type)) return sum;
      return sum + this.numberValue(action.value);
    }, 0);
  }

  private isManagedAdsAccount(accountName: string): boolean {
    const compact = this.compactText(accountName);
    return compact.includes('gestion')
      || compact.includes('managed')
      || compact.includes('rhd');
  }

  private chunkArray<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];

    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }

    return chunks;
  }

  async fetchGoogleAdsMetrics(scope: SupermetricsScope, date = this.today()): Promise<DailyMetrics[]> {
    const customerIds = this.configService.googleAdsCustomerIds;

    if (
      !this.configService.googleAdsDeveloperToken
      || !this.configService.googleAdsClientId
      || !this.configService.googleAdsClientSecret
      || !this.configService.googleAdsRefreshToken
      || customerIds.length === 0
    ) {
      this.warnMissingConfig('google-ads-api', 'Google Ads API credentials or customer ids not configured.');
      return [];
    }

    const accessToken = await this.fetchGoogleAdsAccessToken();
    const startDate = scope === 'monthly' ? this.monthStart(date) : date;
    const endDate = date;
    const rows: any[] = [];

    for (const customerId of customerIds) {
      const customerRows = await this.searchGoogleAdsCustomer(customerId, this.googleAdsQuery(startDate, endDate), accessToken);
      rows.push(...customerRows.map((row) => ({ ...row, __customerId: customerId })));
    }

    const aggregated = new Map<string, {
      date: string;
      customerId: string;
      accountName: string;
      campaignId: string;
      campaignName: string;
      spend: number;
      impressions: number;
      clicks: number;
      conversions: number;
      revenue: number;
    }>();

    for (const row of rows) {
      const customer = row.customer || {};
      const campaign = row.campaign || {};
      const rawMetrics = row.metrics || {};
      const segments = row.segments || {};
      const customerId = String(row.__customerId || customer.id || '');
      const accountName = String(customer.descriptiveName || customer.descriptive_name || '');

      if (!this.compactText(accountName).includes('managed')) continue;

      const spend = Number(rawMetrics.costMicros || rawMetrics.cost_micros || 0) / 1_000_000;
      if (!spend) continue;

      const campaignName = String(campaign.name || '');
      const metricDate = scope === 'monthly' ? this.monthStart(date) : String(segments.date || date).slice(0, 10);
      const googleCampaignId = String(campaign.id || campaign.resourceName || this.normalizeHeader(campaignName));
      const key = [customerId, googleCampaignId, scope, metricDate].join('||');
      const current = aggregated.get(key) || {
        date: metricDate,
        customerId,
        accountName,
        campaignId: googleCampaignId,
        campaignName,
        spend: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        revenue: 0
      };

      current.spend += spend;
      current.impressions += this.numberValue(rawMetrics.impressions);
      current.clicks += this.numberValue(rawMetrics.clicks);
      current.conversions += this.numberValue(rawMetrics.conversions);
      current.revenue += this.numberValue(rawMetrics.conversionsValue || rawMetrics.conversions_value);
      aggregated.set(key, current);
    }

    const metrics: DailyMetrics[] = [];

    for (const [index, item] of Array.from(aggregated.values()).entries()) {
      const referencia = this.inferReference(item.accountName) || item.accountName;
      const mapping = await this.brandMappingService.resolve(referencia);
      const campaignId = [
        'Google',
        item.customerId,
        item.campaignId,
        scope,
        item.date
      ].join('-');

      metrics.push({
        date: item.date,
        cliente: mapping.cliente,
        marca: mapping.marca,
        referencia,
        accountId: item.customerId,
        accountName: item.accountName,
        plataforma: 'Google',
        campaignId,
        campaignName: item.campaignName || item.accountName,
        objetivo: this.inferObjective(item.campaignName),
        granularity: scope,
        coverageEndDate: scope === 'monthly' ? endDate : undefined,
        spend: this.round2(item.spend),
        impressions: item.impressions,
        clicks: item.clicks,
        conversions: item.conversions,
        revenue: item.revenue,
      });
    }

    return metrics;
  }

  private async fetchGoogleAdsAccessToken(): Promise<string> {
    try {
      const response = await axios.post(
        'https://oauth2.googleapis.com/token',
        new URLSearchParams({
          client_id: this.configService.googleAdsClientId,
          client_secret: this.configService.googleAdsClientSecret,
          refresh_token: this.configService.googleAdsRefreshToken,
          grant_type: 'refresh_token'
        }).toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: this.configService.googleAdsSyncTimeoutSeconds * 1000
        }
      );

      const token = response.data?.access_token;
      if (!token) throw new ServiceUnavailableException('Google Ads OAuth did not return an access token');

      return token;
    } catch (error) {
      const detail = this.axiosDetail(error);
      this.logger.error(`Google Ads OAuth failed: ${detail}`);
      throw new BadGatewayException(`Google Ads OAuth failed (${detail})`);
    }
  }

  private async searchGoogleAdsCustomer(customerId: string, query: string, accessToken: string): Promise<any[]> {
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        'developer-token': this.configService.googleAdsDeveloperToken,
        'Content-Type': 'application/json'
      };

      if (this.configService.googleAdsLoginCustomerId) {
        headers['login-customer-id'] = this.configService.googleAdsLoginCustomerId;
      }

      const url = `${this.configService.googleAdsApiBaseUrl}/customers/${customerId}/googleAds:searchStream`;
      const response = await axios.post(
        url,
        { query },
        {
          headers,
          timeout: this.configService.googleAdsSyncTimeoutSeconds * 1000
        }
      );

      const chunks = Array.isArray(response.data) ? response.data : [];
      return chunks.flatMap((chunk) => Array.isArray(chunk.results) ? chunk.results : []);
    } catch (error) {
      const detail = this.axiosDetail(error);
      this.logger.error(`Google Ads customer ${customerId} sync failed at ${this.configService.googleAdsApiBaseUrl}: ${detail}`);
      return [];
    }
  }

  private googleAdsQuery(startDate: string, endDate: string): string {
    return `
      SELECT
        segments.date,
        customer.id,
        customer.descriptive_name,
        campaign.id,
        campaign.name,
        metrics.cost_micros
      FROM campaign
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND campaign.status != 'REMOVED'
        AND metrics.cost_micros > 0
    `.replace(/\s+/g, ' ').trim();
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
    const aggregated = new Map<string, {
      advertiserId: string;
      accountName: string;
      campaignId: string;
      campaignName: string;
      objetivo?: string;
      spend: number;
    }>();

    try {
      const advertiserNames = await this.fetchTikTokAdvertiserNames(accessToken);
      const campaignNames = new Map<string, string>();

      for (const advertiserId of advertiserIds) {
        try {
          const advertiserCampaignNames = await this.fetchTikTokCampaignNames(accessToken, advertiserId);
          for (const [campaignId, campaignName] of advertiserCampaignNames.entries()) {
            campaignNames.set(`${advertiserId}:${campaignId}`, campaignName);
          }

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
                  data_level: 'AUCTION_CAMPAIGN',
                  dimensions: JSON.stringify(['stat_time_day', 'campaign_id']),
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
              throw new BadGatewayException(`TikTok sync failed for advertiser ${advertiserId} (${data.message || `code ${data.code}`})`);
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
              const campaignId = String(dimensions.campaign_id || dimensions.campaignId || `${advertiserId}-${page}`);
              const campaignName = String(
                dimensions.campaign_name
                || dimensions.campaignName
                || item.campaign_name
                || campaignNames.get(`${advertiserId}:${campaignId}`)
                || campaignNames.get(`${reportedAdvertiserId}:${campaignId}`)
                || campaignId
              );
              const objetivo = this.inferObjective(campaignName);
              const key = `${bucketDate}||${advertiserId}||${accountName}||${campaignId}||${campaignName}||${objetivo || ''}`;
              const existing = aggregated.get(key) ?? { advertiserId, accountName, campaignId, campaignName, objetivo, spend: 0 };
              existing.spend += this.numberValue(metrics.spend ?? item.spend);
              aggregated.set(key, existing);
            }

            page += 1;
          } while (page <= totalPages);
        } catch (error) {
          const detail = axios.isAxiosError(error) ? this.axiosDetail(error) : (error instanceof Error ? error.message : String(error));
          this.logger.warn(`TikTok advertiser ${advertiserId} sync skipped: ${detail}`);
          continue;
        }
      }

      const out: DailyMetrics[] = [];
      let index = 0;

      for (const [key, value] of aggregated.entries()) {
        const [metricDate] = key.split('||');
        const accountReference = this.inferReference(value.accountName) || value.accountName || value.advertiserId;
        const campaignReference = this.inferReference(value.campaignName) || value.campaignName || '';
        let referencia = accountReference;
        let mapping = await this.brandMappingService.resolve(referencia);

        if (mapping.cliente === 'SIN MAPEO' && campaignReference) {
          const campaignMapping = await this.brandMappingService.resolve(campaignReference);
          if (campaignMapping.cliente !== 'SIN MAPEO') {
            mapping = campaignMapping;
            referencia = campaignReference;
          }
        }

        out.push({
          date: metricDate,
          cliente: mapping.cliente,
          marca: mapping.marca,
          referencia,
          accountId: value.advertiserId,
          accountName: value.accountName,
          plataforma: 'TikTok',
          campaignId: `TikTok-${value.advertiserId}-${value.campaignId}-${scope}-${metricDate}-${index}`,
          campaignName: value.campaignName,
          objetivo: value.objetivo,
          granularity: scope,
          coverageEndDate: scope === 'monthly' ? endDate : undefined,
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
    try {
      return await this.fetchMercadoLibreApiMetrics(scope, date);
    } catch (error) {
      this.logger.warn(`Mercado Libre API ${scope} sync returned no metrics: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  private async fetchMercadoLibreWebMetrics(scope: SupermetricsScope, date = this.today()): Promise<DailyMetrics[]> {
    const cookie = this.configService.mercadoLibreWebCookie;
    const csrfToken = this.configService.mercadoLibreWebCsrfToken;
    const products = this.configService.mercadoLibreProducts;
    const configuredAdvertisers = this.parseMercadoLibreAdvertisers(this.configService.mercadoLibreAdvertiserIds);
    const accessToken = this.configService.mercadoLibreAccessToken;

    if (!cookie || !csrfToken || products.length === 0) return [];

    const startDate = scope === 'monthly' ? this.monthStart(date) : date;
    const endDate = date;

    try {
      const advertisers = configuredAdvertisers.length > 0
        ? configuredAdvertisers
        : accessToken
          ? await this.fetchMercadoLibreAdvertisers(accessToken)
          : [];

      if (advertisers.length === 0) {
        this.warnMissingConfig(
          'mercadolibre-web-advertisers',
          'Mercado Libre web sync requires MERCADO_LIBRE_ADVERTISER_IDS or a valid access token to discover advertisers.'
        );
        return [];
      }

      const out: DailyMetrics[] = [];
      let index = 0;

      for (const advertiser of advertisers) {
        let spend = 0;

        for (const product of products) {
          const rows = await this.fetchMercadoLibreWebProductMetrics(
            advertiser.id,
            product,
            startDate,
            endDate,
            cookie,
            csrfToken
          );
          const investment = rows.find((row) => String(row.name || '').toLowerCase() === 'investment');
          const value = this.numberValue(investment?.value);
          if (value) {
            spend += value;
          }
        }

        if (!spend) continue;

        const accountName = advertiser.accountName || advertiser.referencia || advertiser.id;
        const referencia = advertiser.referencia || accountName;
        const mapping = await this.brandMappingService.resolve(referencia);
        const metricDate = scope === 'monthly' ? this.monthStart(date) : date;

        out.push({
          date: metricDate,
          cliente: mapping.cliente,
          marca: mapping.marca,
          referencia,
          accountId: advertiser.id,
          accountName,
          plataforma: 'MELI',
          campaignId: `MercadoLibre-${advertiser.id}-web-${scope}-${metricDate}-${index}`,
          campaignName: accountName,
          granularity: scope,
          coverageEndDate: scope === 'monthly' ? endDate : undefined,
          spend: this.round2(spend),
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
      const detail = axios.isAxiosError(error) ? this.axiosDetail(error) : error instanceof Error ? error.message : String(error);
      this.logger.warn(`Mercado Libre web ${scope} sync skipped, falling back to API/Sheets: ${detail}`);
      return [];
    }
  }

  private async fetchMercadoLibreWebProductMetrics(
    advertiserId: string,
    productId: string,
    startDate: string,
    endDate: string,
    cookie: string,
    csrfToken: string
  ): Promise<MercadoLibreWebMetricRow[]> {
    const baseUrl = this.configService.mercadoLibreAdsApiBaseUrl.replace(/\/+$/, '');
    const webOrigin = 'https://ads.mercadolibre.com.ar';
    const response = await axios.get(
      `${baseUrl}/advertiser/${encodeURIComponent(advertiserId)}/product/${encodeURIComponent(productId)}/metrics`,
      {
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'en,en-US;q=0.9,es;q=0.8',
          'Cache-Control': 'no-cache',
          Cookie: this.normalizeCookieHeader(cookie),
          'Device-Memory': '16',
          Downlink: '10',
          Dpr: '1.125',
          Ect: '4g',
          Origin: webOrigin,
          Pragma: 'no-cache',
          Priority: 'u=1, i',
          Referer: `${webOrigin}/hub/summary?advertiserId=${encodeURIComponent(advertiserId)}`,
          'Sec-Ch-Ua': '"Not,A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Windows"',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-origin',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
          'Csrf-Token': csrfToken,
          'csrf-token': csrfToken,
          'x-csrf-token': csrfToken
        },
        params: {
          date_from: startDate,
          date_to: endDate,
          siteId: 'MLA'
        },
        timeout: this.configService.mercadoLibreSyncTimeoutSeconds * 1000,
        maxRedirects: 0,
        validateStatus: (status) => (status >= 200 && status < 300) || status === 400 || status === 404
      }
    );

    if (response.status === 400 || response.status === 404) return [];
    return Array.isArray(response.data) ? response.data : [];
  }

  private normalizeCookieHeader(cookie: string): string {
    return String(cookie || '')
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s*;\s*/g, '; ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  private async fetchMercadoLibreProductAdsSpend(
    advertiserId: string,
    scope: SupermetricsScope,
    date: string,
    accessToken: string
  ): Promise<number> {
    const startDate = scope === 'monthly' ? this.monthStart(date) : date;
    const officialSpend = await this.fetchMercadoLibreProductAdsOfficialSpend(
      accessToken,
      advertiserId,
      startDate,
      date
    );

    const cookie = this.configService.mercadoLibreWebCookie;
    const csrfToken = this.configService.mercadoLibreWebCsrfToken;
    if (!cookie || !csrfToken) {
      return officialSpend;
    }

    try {
      const rows = await this.fetchMercadoLibreWebProductMetrics(
        advertiserId,
        'PADS',
        startDate,
        date,
        cookie,
        csrfToken
      );
      const investment = rows.find((row) => String(row.name || '').toLowerCase() === 'investment');
      const webSpend = this.numberValue(investment?.value);
      const selectedSpend = Math.max(officialSpend, webSpend);

      if (this.round2(officialSpend) !== this.round2(webSpend)) {
        this.logger.warn(
          `Mercado Libre PADS coverage advertiser ${advertiserId}: official=${this.round2(officialSpend)}, web=${this.round2(webSpend)}, selected=${this.round2(selectedSpend)}`
        );
      }

      return selectedSpend;
    } catch (error) {
      const detail = axios.isAxiosError(error) ? this.axiosDetail(error) : error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Mercado Libre PADS web comparison unavailable for advertiser ${advertiserId}; using official API total ${this.round2(officialSpend)}: ${detail}`
      );
      return officialSpend;
    }
  }

  private async fetchMercadoLibreProductAdsOfficialSpend(
    accessToken: string,
    advertiserId: string,
    startDate: string,
    endDate: string
  ): Promise<number> {
    let offset = 0;
    const limit = 50;
    let totalSpend = 0;

    do {
      const response = await this.mercadoLibreApiGet(
        `${this.configService.mercadoLibreApiBaseUrl}/advertising/MLA/advertisers/${encodeURIComponent(advertiserId)}/product_ads/campaigns/search`,
        {
          accessToken,
          headers: {
            'api-version': '2'
          },
          params: {
            offset,
            limit,
            date_from: startDate,
            date_to: endDate,
            metrics: 'cost',
            metrics_summary: true
          },
          timeout: this.configService.mercadoLibreSyncTimeoutSeconds * 1000
        }
      );
      const rows = this.extractMercadoLibreList(response.data);

      for (const row of rows) {
        totalSpend += this.numberValue(
          row?.metrics_summary?.cost
          ?? row?.metrics?.cost
          ?? row?.cost
        );
      }

      const total = Number(response.data?.paging?.total || 0);
      offset += limit;
      if (rows.length < limit || (total > 0 && offset >= total)) break;
    } while (offset < 10000);

    return totalSpend;
  }

  private async fetchMercadoLibreApiMetrics(scope: SupermetricsScope, date = this.today()): Promise<DailyMetrics[]> {
    const configuredAdvertisers = this.parseMercadoLibreAdvertisers(this.configService.mercadoLibreAdvertiserIds);
    const accessToken = await this.getMercadoLibreAccessToken();

    if (!accessToken) {
      throw new ServiceUnavailableException('Mercado Libre access token/refresh token not configured');
    }

    const startDate = scope === 'monthly' ? this.monthStart(date) : date;
    const endDate = date;
    const aggregated = new Map<string, {
      advertiserId: string;
      accountName: string;
      referencia: string;
      spend: number;
    }>();

    try {
      const products = new Set(this.configService.mercadoLibreProducts.map((product) => product.toUpperCase()));
      const includeProductAds = products.size === 0 || products.has('PADS');
      const includeDisplay = products.has('DSP') || products.has('DISPLAY');
      const advertisers = configuredAdvertisers.length > 0
        ? configuredAdvertisers
        : await this.fetchMercadoLibreAdvertisers(accessToken);
      const productAdsFailures: string[] = [];
      const displayFailures: string[] = [];

      for (const advertiser of advertisers) {
        if (includeProductAds) {
          try {
            const spend = await this.fetchMercadoLibreProductAdsSpend(
              advertiser.id,
              scope,
              date,
              accessToken
            );
            this.logger.log(`Mercado Libre PADS ${scope} advertiser ${advertiser.id} returned spend ${this.round2(spend)}`);

            if (spend > 0) {
              this.addMercadoLibreSpend(
                aggregated,
                advertiser,
                scope,
                endDate,
                { date: endDate },
                spend
              );
            }
          } catch (error) {
            const detail = axios.isAxiosError(error) ? this.axiosDetail(error) : error instanceof Error ? error.message : String(error);
            productAdsFailures.push(`${advertiser.id}: ${detail}`);
            this.logger.warn(`Mercado Libre PADS ${scope} sync skipped for advertiser ${advertiser.id}: ${detail}`);
          }
        }

        if (includeDisplay) {
          try {
            const campaigns = await this.fetchMercadoLibreDisplayCampaigns(accessToken, advertiser.id);

            for (const campaign of campaigns) {
              const metricRows = await this.fetchMercadoLibreDisplayCampaignMetrics(
                accessToken,
                advertiser.id,
                String(campaign.id),
                startDate,
                endDate
              );

              for (const metricRow of metricRows) {
                this.addMercadoLibreSpend(
                  aggregated,
                  advertiser,
                  scope,
                  endDate,
                  metricRow,
                  this.numberValue(metricRow.consumed_budget)
                );
              }
            }
          } catch (error) {
            const detail = axios.isAxiosError(error) ? this.axiosDetail(error) : error instanceof Error ? error.message : String(error);
            displayFailures.push(`${advertiser.id}: ${detail}`);
            this.logger.warn(`Mercado Libre DSP ${scope} sync skipped for advertiser ${advertiser.id}: ${detail}`);
          }
        }
      }

      if (includeProductAds && productAdsFailures.length > 0) {
        throw new BadGatewayException(`Mercado Libre PADS ${scope} sync incomplete (${productAdsFailures.join('; ')})`);
      }
      if (includeDisplay && displayFailures.length > 0) {
        throw new BadGatewayException(`Mercado Libre DSP ${scope} sync incomplete (${displayFailures.join('; ')})`);
      }

      const out: DailyMetrics[] = [];
      let index = 0;

      for (const [key, value] of aggregated.entries()) {
        const [metricDate] = key.split('||');
        const mapping = await this.brandMappingService.resolve(value.referencia);

        out.push({
          date: metricDate,
          cliente: mapping.cliente,
          marca: mapping.marca,
          referencia: value.referencia,
          accountId: value.advertiserId,
          accountName: value.accountName,
          plataforma: 'MELI',
          campaignId: `MercadoLibre-${value.advertiserId}-all-${scope}-${metricDate}-${index}`,
          campaignName: value.accountName,
          granularity: scope,
          coverageEndDate: scope === 'monthly' ? endDate : undefined,
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
      const detail = axios.isAxiosError(error) ? this.axiosDetail(error) : error instanceof Error ? error.message : String(error);
      throw new BadGatewayException(`Mercado Libre API ${scope} sync failed (${detail})`);
    }
  }

  private async fetchMercadoLibreSheetMetrics(scope: SupermetricsScope, date = this.today()): Promise<DailyMetrics[]> {
    const spreadsheetId = this.configService.mercadoLibreSourceSpreadsheetId;
    const rawSheets = this.configService.mercadoLibreRawSheets;

    if (!spreadsheetId || rawSheets.length === 0) {
      this.warnMissingConfig('mercadolibre', 'Mercado Libre source spreadsheet or raw sheets not configured.');
      return [];
    }

    const startDate = scope === 'monthly' ? this.monthStart(date) : date;
    const endDate = date;
    const aggregated = new Map<string, { accountName: string; spend: number; coverageEndDate: string }>();

    try {
      for (const sheetName of rawSheets) {
        const rows = await this.fetchGoogleSheetRows(spreadsheetId, sheetName);
        const accountName = sheetName.replace(/\s-\sDisplay$/i, '').trim();
        const columnMap = this.getMercadoLibreSheetColumnMap(rows[0]);

        for (const row of rows.slice(1)) {
          const rowDate = this.normalizeSheetDate(row[columnMap.date]);
          if (!rowDate || rowDate < startDate || rowDate > endDate) continue;

          const bucketDate = scope === 'monthly' ? this.monthStart(rowDate) : rowDate;
          const key = `${bucketDate}||${accountName}`;
          const existing = aggregated.get(key) ?? { accountName, spend: 0, coverageEndDate: rowDate };
          existing.spend += this.numberValue(row[columnMap.cost]);
          if (rowDate > existing.coverageEndDate) existing.coverageEndDate = rowDate;
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
          plataforma: 'MELI',
          campaignId: `MercadoLibre-${this.normalizeHeader(value.accountName)}-${scope}-${metricDate}-${index}`,
          campaignName: value.accountName,
          granularity: scope,
          coverageEndDate: scope === 'monthly' ? value.coverageEndDate : undefined,
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

  private parseMercadoLibreAdvertisers(rawAdvertisers: string[]): MercadoLibreAdvertiserConfig[] {
    return rawAdvertisers
      .map((raw): MercadoLibreAdvertiserConfig | null => {
        const [idPart, accountNamePart, referenciaPart] = raw.split(':').map((value) => value.trim());
        const id = idPart || '';
        if (!id) return null;

        return {
          id,
          accountName: accountNamePart || undefined,
          referencia: referenciaPart || accountNamePart || undefined
        };
      })
      .filter((value: MercadoLibreAdvertiserConfig | null): value is MercadoLibreAdvertiserConfig => Boolean(value));
  }

  private async fetchMercadoLibreAdvertisers(accessToken: string): Promise<MercadoLibreAdvertiserConfig[]> {
    const response = await this.mercadoLibreApiGet(
      `${this.configService.mercadoLibreApiBaseUrl}/advertising/advertisers`,
      {
        accessToken,
        params: { product_id: 'PADS' },
        timeout: this.configService.mercadoLibreSyncTimeoutSeconds * 1000
      }
    );
    const advertisers = response.data?.advertisers || this.extractMercadoLibreList(response.data);

    return advertisers
      .map((advertiser: any): MercadoLibreAdvertiserConfig | null => {
        const id = String(advertiser.advertiser_id || advertiser.id || '');
        if (!id) return null;
        const accountName = String(advertiser.advertiser_name || advertiser.name || advertiser.account_name || id);

        return {
          id,
          accountName,
          referencia: accountName
        };
      })
      .filter((value: MercadoLibreAdvertiserConfig | null): value is MercadoLibreAdvertiserConfig => Boolean(value));
  }

  private async fetchMercadoLibreCampaigns(
    accessToken: string,
    advertiserId: string,
    startDate?: string,
    endDate?: string
  ): Promise<any[]> {
    const campaigns: any[] = [];
    let offset = 0;
    const limit = 50;

    do {
      const response = await this.mercadoLibreApiGet(
        `${this.configService.mercadoLibreApiBaseUrl}/advertising/advertisers/${encodeURIComponent(advertiserId)}/product_ads/campaigns`,
        {
          accessToken,
          params: {
            offset,
            limit,
            ...(startDate && endDate
              ? {
                date_from: startDate,
                date_to: endDate,
                metrics: 'cost'
              }
              : {})
          },
          timeout: this.configService.mercadoLibreSyncTimeoutSeconds * 1000
        }
      );
      const rows = this.extractMercadoLibreList(response.data);

      rows.forEach((row) => {
        const id = String(row.id || row.campaign_id || row.campaignId || '');
        if (!id) return;
        campaigns.push({
          id,
          name: row.name || row.campaign_name || row.campaignName,
          metrics: row.metrics
        });
      });

      if (rows.length < limit) break;
      offset += limit;
    } while (offset < 10000);

    return campaigns;
  }

  private async fetchMercadoLibreDisplayCampaigns(accessToken: string, advertiserId: string): Promise<any[]> {
    const campaigns: any[] = [];
    let offset = 0;
    const limit = 50;

    do {
      const response = await this.mercadoLibreApiGet(
        `${this.configService.mercadoLibreApiBaseUrl}/advertising/advertisers/${encodeURIComponent(advertiserId)}/display/campaigns`,
        {
          accessToken,
          params: { offset, limit },
          timeout: this.configService.mercadoLibreSyncTimeoutSeconds * 1000
        }
      );
      const rows = this.extractMercadoLibreList(response.data);

      rows.forEach((row) => {
        const id = String(row.id || row.campaign_id || row.campaignId || '');
        if (!id) return;
        campaigns.push({
          id,
          name: row.name || row.campaign_name || row.campaignName,
          goal: row.goal
        });
      });

      if (rows.length < limit) break;
      offset += limit;
    } while (offset < 10000);

    return campaigns;
  }

  private async fetchMercadoLibreDisplayCampaignMetrics(
    accessToken: string,
    advertiserId: string,
    campaignId: string,
    startDate: string,
    endDate: string
  ): Promise<any[]> {
    const response = await this.mercadoLibreApiGet(
      `${this.configService.mercadoLibreApiBaseUrl}/advertising/advertisers/${encodeURIComponent(advertiserId)}/display/campaigns/${encodeURIComponent(campaignId)}/metrics`,
      {
        accessToken,
        params: {
          date_from: startDate,
          date_to: endDate
        },
        timeout: this.configService.mercadoLibreSyncTimeoutSeconds * 1000
      }
    );
    const rows = Array.isArray(response.data?.metrics) ? response.data.metrics : [];

    if (rows.length > 0) return rows;
    return response.data?.summary ? [response.data.summary] : [];
  }

  private addMercadoLibreSpend(
    aggregated: Map<string, {
      advertiserId: string;
      accountName: string;
      referencia: string;
      spend: number;
    }>,
    advertiser: MercadoLibreAdvertiserConfig,
    scope: SupermetricsScope,
    endDate: string,
    row: any,
    spend: number
  ): void {
    if (spend === 0) return;

    const accountName = advertiser.accountName || advertiser.referencia || advertiser.id;
    const referencia = advertiser.referencia || accountName;
    const metricDate = String(
      row.date
      || row.day
      || row.stat_time_day
      || row.period
      || endDate
    ).slice(0, 10);
    const bucketDate = scope === 'monthly' ? this.monthStart(metricDate) : metricDate;
    const key = `${bucketDate}||${advertiser.id}||${accountName}`;
    const existing = aggregated.get(key) ?? {
      advertiserId: advertiser.id,
      accountName,
      referencia,
      spend: 0
    };
    existing.spend += spend;
    aggregated.set(key, existing);
  }

  private async fetchMercadoLibreCampaignMetrics(
    accessToken: string,
    campaignId: string,
    startDate: string,
    endDate: string
  ): Promise<any[]> {
    const response = await this.mercadoLibreApiGet(
      `${this.configService.mercadoLibreApiBaseUrl}/advertising/product_ads/campaigns/${encodeURIComponent(campaignId)}/metrics`,
      {
        accessToken,
        params: {
          date_from: startDate,
          date_to: endDate,
          metrics: 'cost,spend,investment'
        },
        timeout: this.configService.mercadoLibreSyncTimeoutSeconds * 1000
      }
    );
    const rows = this.extractMercadoLibreList(response.data);

    if (rows.length > 0) return rows;
    return [response.data];
  }

  private async mercadoLibreApiGet<T = any>(
    url: string,
    config: AxiosRequestConfig & { accessToken?: string } = {}
  ) {
    const { accessToken, headers, ...axiosConfig } = config;
    const token = accessToken || await this.getMercadoLibreAccessToken();
    try {
      return await axios.get<T>(url, {
        ...axiosConfig,
        headers: {
          ...headers,
          Authorization: `Bearer ${token}`
        }
      });
    } catch (error) {
      if (!axios.isAxiosError(error) || error.response?.status !== 401) throw error;

      const refreshedToken = await this.refreshMercadoLibreAccessToken(true);
      return axios.get<T>(url, {
        ...axiosConfig,
        headers: {
          ...headers,
          Authorization: `Bearer ${refreshedToken}`
        }
      });
    }
  }

  private async getMercadoLibreAccessToken(): Promise<string> {
    const state = await this.loadMercadoLibreOAuthState();
    const stateAccessToken = state?.accessToken || '';

    if (state && stateAccessToken && !this.isMercadoLibreTokenExpiring(state)) {
      return stateAccessToken;
    }

    const canRefresh = Boolean(state?.refreshToken || this.configService.mercadoLibreRefreshToken);
    if (canRefresh) {
      return this.refreshMercadoLibreAccessToken(false);
    }

    return stateAccessToken || this.configService.mercadoLibreAccessToken;
  }

  private async refreshMercadoLibreAccessToken(force: boolean): Promise<string> {
    if (this.mercadoLibreRefreshPromise) return this.mercadoLibreRefreshPromise;

    this.mercadoLibreRefreshPromise = this.doRefreshMercadoLibreAccessToken(force)
      .finally(() => {
        this.mercadoLibreRefreshPromise = null;
      });

    return this.mercadoLibreRefreshPromise;
  }

  private async doRefreshMercadoLibreAccessToken(force: boolean): Promise<string> {
    const state = await this.loadMercadoLibreOAuthState();
    if (!force && state?.accessToken && !this.isMercadoLibreTokenExpiring(state)) {
      return state.accessToken;
    }

    const clientId = this.configService.mercadoLibreClientId;
    const clientSecret = this.configService.mercadoLibreClientSecret;
    const refreshToken = state?.refreshToken || this.configService.mercadoLibreRefreshToken;

    if (!clientId || !clientSecret || !refreshToken) {
      return state?.accessToken || this.configService.mercadoLibreAccessToken;
    }

    const response = await axios.post(
      `${this.configService.mercadoLibreApiBaseUrl}/oauth/token`,
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken
      }).toString(),
      {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: this.configService.mercadoLibreSyncTimeoutSeconds * 1000
      }
    );

    const accessToken = String(response.data?.access_token || '');
    const nextRefreshToken = String(response.data?.refresh_token || '');
    const expiresIn = Number(response.data?.expires_in || 0);

    if (!accessToken || !nextRefreshToken || !expiresIn) {
      throw new ServiceUnavailableException('Mercado Libre OAuth refresh did not return a complete token response');
    }

    const nextState: MercadoLibreOAuthState = {
      accessToken,
      refreshToken: nextRefreshToken,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      updatedAt: new Date().toISOString()
    };

    await this.saveMercadoLibreOAuthState(nextState);
    this.mercadoLibreOAuthState = nextState;
    return accessToken;
  }

  private async loadMercadoLibreOAuthState(): Promise<MercadoLibreOAuthState | null> {
    if (this.mercadoLibreOAuthState !== undefined) return this.mercadoLibreOAuthState;

    const statePath = this.getMercadoLibreOAuthStatePath();
    try {
      const raw = await fs.readFile(statePath, 'utf8');
      const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
      this.mercadoLibreOAuthState = {
        accessToken: String(parsed.accessToken || ''),
        refreshToken: String(parsed.refreshToken || ''),
        expiresAt: String(parsed.expiresAt || ''),
        updatedAt: String(parsed.updatedAt || '')
      };
      return this.mercadoLibreOAuthState;
    } catch {
      const accessToken = this.configService.mercadoLibreAccessToken;
      const refreshToken = this.configService.mercadoLibreRefreshToken;
      this.mercadoLibreOAuthState = accessToken || refreshToken
        ? {
          accessToken,
          refreshToken,
          expiresAt: '',
          updatedAt: ''
        }
        : null;
      return this.mercadoLibreOAuthState;
    }
  }

  private async saveMercadoLibreOAuthState(state: MercadoLibreOAuthState): Promise<void> {
    const statePath = this.getMercadoLibreOAuthStatePath();
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  }

  private getMercadoLibreOAuthStatePath(): string {
    const configured = this.configService.mercadoLibreOAuthStatePath;
    if (path.isAbsolute(configured)) return configured;

    const cwd = process.cwd();
    const apiRelative = path.join('apps', 'api');
    return cwd.endsWith(apiRelative)
      ? path.resolve(cwd, configured.replace(/^apps[\\/]api[\\/]/, ''))
      : path.resolve(cwd, configured);
  }

  private isMercadoLibreTokenExpiring(state: MercadoLibreOAuthState): boolean {
    const expiresAt = new Date(state.expiresAt).getTime();
    if (!Number.isFinite(expiresAt)) return true;
    return expiresAt <= Date.now() + 5 * 60 * 1000;
  }

  private extractMercadoLibreList(data: any): any[] {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return [];

    const candidates = [
      data.results,
      data.campaigns,
      data.metrics,
      data.list,
      data.data?.results,
      data.data?.campaigns,
      data.data?.metrics,
      data.data?.list
    ];
    const list = candidates.find((value) => Array.isArray(value));
    return list || [];
  }

  private getMercadoLibreSheetColumnMap(headerRow: any[] | undefined): { date: number; cost: number } {
    const fallback = { date: 2, cost: 5 };
    if (!headerRow) return fallback;

    const headers = headerRow.map((value) => this.normalizeHeader(String(value || '')));
    const indexOf = (names: string[]) => {
      const index = headers.findIndex((header) => names.includes(header));
      return index >= 0 ? index : undefined;
    };

    return {
      date: indexOf(['date', 'day', 'fecha', 'dia']) ?? fallback.date,
      cost: indexOf(['cost', 'costs', 'spend', 'amountspent', 'amount_spent', 'consumo', 'costo', 'inversion', 'inversin']) ?? fallback.cost
    };
  }

  async fetchMetaMetrics(accountId: string, dateFrom: string, dateTo: string): Promise<DailyMetrics[]> {
    const token = this.configService.metaAccessToken;
    if (!token) {
      this.logger.warn('Meta access token not configured.');
      return [];
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
      this.logger.warn('Google access token not configured.');
      return [];
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
      if (platform === 'Google' && !this.compactText(accountName).includes('managed')) continue;
      const referencia = this.firstValue(record, ['referencia', 'reference']) || this.inferReference(accountName) || accountName || 'Sin referencia';
      const mapping = await this.brandMappingService.resolve(referencia);
      const accountId = this.firstValue(record, ['accountid', 'account_id']);
      const adSetName = this.firstValue(record, [
        'adset',
        'adsetname',
        'ad_set_name',
        'adset_name',
        'conjuntodeanuncios',
        'conjunto_de_anuncios',
        'conjuntodeads',
        'conjunto_de_ads'
      ]);
      const adGroupName = this.firstValue(record, [
        'adgroup',
        'adgroupname',
        'ad_group_name',
        'adgroup_name',
        'adgroupid',
        'ad_group_id',
        'grupodeanuncios',
        'grupo_de_anuncios'
      ]);
      const campaignName = this.firstValue(record, ['campaign', 'campaignname', 'campaign_name']) || adSetName || adGroupName || accountName || referencia;
      const campaignId = this.firstValue(record, ['campaignid', 'campaign_id']) || `${platform}-${accountId || this.normalizeHeader(referencia) || index}`;
      const objectiveSource = adSetName || adGroupName || campaignName;
      const objetivo = this.inferObjective(objectiveSource);

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
        adSetName,
        adGroupName,
        objetivo,
        granularity: scope,
        coverageEndDate: scope === 'monthly' ? this.resolveMetricCoverageEndDate(record, dateRangeType, forcedDate) : undefined,
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
    return false;
  }

  private getAdsSheetsRange(
    source: SupermetricsSource,
    scope: SupermetricsScope
  ): { sheetName: string; rangeA1: string; platform: string; startAtDataRow: boolean } | null {
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
    const headerRow = rowsWithoutHeaders.find((row) => {
      const normalized = row.map((value) => this.normalizeHeader(String(value || '')));
      return normalized.includes('month') || normalized.includes('mes');
    });
    const columnMap = this.getAdsSheetColumnMap(headerRow, source);
    const normalizedRows = rowsWithoutHeaders.filter((row) => {
      const first = this.normalizeHeader(String(row[0] || ''));
      return first !== 'month' && first !== 'mes' && first !== 'bajadagoogleads' && first !== 'consumodeayer';
    });

    for (const [index, row] of normalizedRows.entries()) {
      const effectiveColumnMap = this.getEffectiveAdsSheetColumnMap(row, columnMap, source, Boolean(headerRow));
      const month = this.numberValue(row[effectiveColumnMap.month]);
      const accountName = String(row[effectiveColumnMap.accountName] || '').trim();
      const campaignName = effectiveColumnMap.campaignName != null ? String(row[effectiveColumnMap.campaignName] || '').trim() : '';
      const adSetName = effectiveColumnMap.adSetName != null ? String(row[effectiveColumnMap.adSetName] || '').trim() : '';
      const adGroupName = effectiveColumnMap.adGroupName != null ? String(row[effectiveColumnMap.adGroupName] || '').trim() : '';
      const spend = this.numberValue(row[effectiveColumnMap.spend]);
      const referencia = effectiveColumnMap.referencia != null
        ? String(row[effectiveColumnMap.referencia] || '').trim()
        : '';
      const resolvedReference = referencia || this.inferReference(accountName) || accountName;
      const metricCampaignName = campaignName || adSetName || adGroupName || accountName;

      if (!accountName || spend === 0) continue;
      if (scope === 'monthly' && month && month !== currentMonth) continue;

      const metricDate = scope === 'monthly'
        ? `${date.slice(0, 4)}-${String(month || currentMonth).padStart(2, '0')}-01`
        : date;

      if (metricDate < startDate || metricDate > endDate) continue;

      const mapping = await this.brandMappingService.resolve(resolvedReference);
      const objectiveSource = range.platform === 'Google'
        ? [metricCampaignName, adGroupName, adSetName].filter(Boolean).join(' ')
        : [adSetName, adGroupName, metricCampaignName].filter(Boolean).join(' ');
      const objetivo = this.inferObjective(objectiveSource);

      metrics.push({
        date: metricDate,
        cliente: mapping.cliente,
        marca: mapping.marca,
        referencia: resolvedReference,
        accountName,
        plataforma: range.platform,
        campaignId: `${range.platform}-${this.normalizeHeader(accountName)}-${this.normalizeHeader(metricCampaignName)}-${scope}-${metricDate}-${index}`,
        campaignName: metricCampaignName,
        adSetName,
        adGroupName,
        objetivo,
        granularity: scope,
        coverageEndDate: scope === 'monthly' ? date : undefined,
        spend: this.round2(spend),
        impressions: 0,
        clicks: 0,
        conversions: effectiveColumnMap.conversions != null ? this.numberValue(row[effectiveColumnMap.conversions]) : 0,
        revenue: effectiveColumnMap.revenue != null ? this.numberValue(row[effectiveColumnMap.revenue]) : 0
      });
    }

    return metrics;
  }

  private getAdsSheetColumnMap(headerRow: any[] | undefined, source: SupermetricsSource): AdsSheetColumnMap {
    if (headerRow) {
      const headers = headerRow.map((value) => this.normalizeHeader(String(value || '')));
      const indexOf = (names: string[]) => {
        const index = headers.findIndex((header) => names.includes(header));
        return index >= 0 ? index : undefined;
      };

      return {
        month: indexOf(['month', 'mes']) ?? 0,
        accountName: indexOf(['account', 'accountname', 'account_name', 'cuenta']) ?? 1,
        campaignName: indexOf(['campaign', 'campaignname', 'campaign_name', 'campana', 'campania']),
        adSetName: indexOf(['adset', 'adsetname', 'ad_set_name', 'adset_name', 'conjuntodeanuncios', 'conjunto_de_anuncios', 'conjuntodeads', 'conjunto_de_ads']),
        adGroupName: indexOf(['adgroup', 'adgroupname', 'ad_group_name', 'adgroup_name', 'grupodeanuncios', 'grupo_de_anuncios']),
        spend: indexOf(['cost', 'spend', 'amountspent', 'amount_spent', 'consumo']) ?? 2,
        conversions: indexOf(['conversions', 'conversionsmanyperclick', 'conversiones']),
        revenue: indexOf(['totalconversionvalue', 'total_conversion_value', 'conversionvalue', 'valorconversion']),
        referencia: indexOf(['referencia', 'reference', 'marca'])
      };
    }

    return {
      month: 0,
      accountName: 1,
      spend: 2,
      referencia: 5
    };
  }

  private getEffectiveAdsSheetColumnMap(
    row: any[],
    columnMap: AdsSheetColumnMap,
    source: SupermetricsSource,
    hasHeader: boolean
  ): AdsSheetColumnMap {
    return columnMap;
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

  private inferObjective(value: string): string | undefined {
    const normalized = this.normalizeHeader(value);
    if (!normalized) return undefined;
    if (normalized.includes('alcance') || normalized.includes('reach')) return 'Alcance';
    if (normalized.includes('leadsmensajes') || normalized.includes('mensajes')) return 'Leads-mensajes';
    if (normalized.includes('lead')) return this.withGoogleObjectiveSubtype('Leads', value);
    if (normalized.includes('youtube')) return 'Youtube';
    if (normalized.includes('local')) return 'Local campaing';
    if (normalized.includes('visitasalperfil') || normalized.includes('perfil')) return 'Visitas al perfil';
    if (normalized.includes('interaccion') || normalized.includes('engagement')) return 'Interaccion';
    if (normalized.includes('trafico') || normalized.includes('traffic')) return this.withGoogleObjectiveSubtype('Trafico', value);
    if (normalized.includes('ventas') || normalized.includes('venta') || normalized.includes('sales') || normalized.includes('purchase') || normalized.includes('compra')) {
      return this.withGoogleObjectiveSubtype('Ventas', value);
    }

    return undefined;
  }

  private withGoogleObjectiveSubtype(objective: 'Leads' | 'Trafico' | 'Ventas', value: string): string {
    if (this.hasPmaxSignal(value)) return `${objective}-PMAX`;
    if (this.hasSearchSignal(value)) return `${objective}-Search`;
    return objective;
  }

  private compactText(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  private hasPmaxSignal(value: string): boolean {
    const compact = this.compactText(value);
    return compact.includes('pmax')
      || compact.includes('performancemax')
      || compact.includes('maximorendimiento');
  }

  private hasSearchSignal(value: string): boolean {
    const compact = this.compactText(value);
    return compact.includes('search')
      || compact.includes('sear')
      || compact.includes('busqueda');
  }

  private getSupermetricsSourceConfig(source: SupermetricsSource): SupermetricsSourceConfig {
    const configs: Record<SupermetricsSource, SupermetricsSourceConfig> = {
      linkedin: {
        platform: 'LinkedIn',
        queryJson: this.configService.supermetricsLinkedinAdsQueryJson
      }
    };

    return configs[source];
  }

  private withGoogleAdsBreakdown(query: any): any {
    const excludedAccountIds = this.configService.supermetricsGoogleAdsExcludedAccountIds;
    const existingFilters = Array.isArray(query.filterArr) ? query.filterArr : [];
    const filters = [
      ...existingFilters,
      { combineToPrev: ';', field: 'Accountname', operator: '=@', value: 'MANAGED' },
      { combineToPrev: ';', field: 'Impressions', operator: '>', value: '0' }
    ];
    const cleanQuery = this.withoutSupermetricsAccounts(query, excludedAccountIds) || query;

    return {
      ...cleanQuery,
      fields: [
        { id: 'Month' },
        { id: 'Accountname' },
        { id: 'Campaignname' },
        { id: 'Adgroupname' },
        { id: 'Cost' },
        { id: 'Conversionsmanyperclick' },
        { id: 'Totalconversionvalue' }
      ],
      filterArr: filters,
      max_rows: Number(query.max_rows || 10000)
    };
  }

  private withoutSupermetricsAccount(query: any, accountId: string): any | null {
    return this.withoutSupermetricsAccounts(query, [accountId]);
  }

  private withoutSupermetricsAccounts(query: any, accountIds: string[]): any | null {
    const excluded = new Set(accountIds.map((accountId) => accountId.trim()).filter(Boolean));
    if (excluded.size === 0) return null;

    const removeUnavailable = (account: any) => {
      const value = String(account || '');
      const id = value.split('`')[0].trim();
      return !excluded.has(id);
    };

    const nextQuery = { ...query };
    let changed = false;

    for (const key of ['ds_accounts', 'profiles']) {
      if (!Array.isArray(query[key])) continue;
      const filtered = query[key].filter(removeUnavailable);
      if (filtered.length !== query[key].length) {
        nextQuery[key] = filtered;
        changed = true;
      }
    }

    return changed ? nextQuery : null;
  }

  private extractUnavailableSupermetricsAccountId(data: any): string {
    const message = this.extractResponseMessage(data);
    const match = message.match(/Google Ads account\s+"?(\d+)"?\s+is not available/i)
      || message.match(/account\s+"?(\d+)"?\s+is not available/i);

    return match?.[1] || '';
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
      return this.previousDate(this.today());
    }

    const month = this.firstValue(record, ['month']);
    if (month) {
      const year = this.today().slice(0, 4);
      return `${year}-${String(Number(month)).padStart(2, '0')}-01`;
    }

    return this.today();
  }

  private resolveMetricCoverageEndDate(record: Record<string, any>, dateRangeType?: string, forcedDate?: string): string {
    if (forcedDate) return forcedDate;

    const explicitEndDate = this.firstValue(record, ['end_date', 'date_to', 'enddate']);
    if (explicitEndDate) return this.normalizeDate(explicitEndDate);

    if (dateRangeType === 'yesterday') {
      return this.previousDate(this.today());
    }

    return this.today();
  }

  private normalizeDate(value: string): string {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);

    return this.today();
  }

  private today(): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: OPERATIONAL_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());
    const getPart = (type: string) => parts.find((part) => part.type === type)?.value || '00';

    return `${getPart('year')}-${getPart('month')}-${getPart('day')}`;
  }

  private previousDate(date: string): string {
    const value = new Date(`${date}T00:00:00.000Z`);
    value.setUTCDate(value.getUTCDate() - 1);
    return value.toISOString().slice(0, 10);
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

  private async fetchTikTokCampaignNames(accessToken: string, advertiserId: string): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    let page = 1;
    let totalPages = 1;

    try {
      do {
        const response = await axios.get(`${this.configService.tiktokApiBaseUrl}/campaign/get/`, {
          headers: { 'Access-Token': accessToken },
          params: {
            advertiser_id: advertiserId,
            page,
            page_size: 1000
          },
          timeout: this.configService.tiktokSyncTimeoutSeconds * 1000
        });

        const data = response.data;
        if (data?.code !== undefined && data.code !== 0) {
          this.logger.warn(`Could not fetch TikTok campaign names for ${advertiserId}: ${data.message || `code ${data.code}`}`);
          return names;
        }

        const list = data?.data?.list || [];
        for (const item of list) {
          const campaignId = String(item.campaign_id || item.campaignId || '');
          const campaignName = String(item.campaign_name || item.campaignName || '');
          if (campaignId && campaignName) names.set(campaignId, campaignName);
        }

        totalPages = Number(data?.data?.page_info?.total_page || 1) || 1;
        page += 1;
      } while (page <= totalPages);
    } catch (error) {
      this.logger.warn(`Could not fetch TikTok campaign names for ${advertiserId}: ${this.axiosDetail(error)}`);
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

  async testConnectivity(): Promise<{ meta: boolean; google: boolean }> {
    return {
      meta: !!this.configService.metaAccessToken,
      google: !!this.configService.googleAccessToken
    };
  }
}
