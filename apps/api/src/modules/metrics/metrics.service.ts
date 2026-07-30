import { BadRequestException, forwardRef, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DailyMetrics } from '@mediapulse/shared';
import { CreateDailyMetricsDto, UpdateDailyMetricsDto } from './dto/create-daily-metrics.dto';
import { ManualInvestmentsRepository } from '../investments/manual-investments.repository';
import { InvestmentsService } from '../investments/investments.service';
import { v4 as uuidv4 } from 'uuid';
import {
  AdsMetricsSource,
  ExternalApisService,
  NativeAdsSource,
  SupermetricsScope,
  SupermetricsSource
} from '../../common/external-apis/external-apis.service';
import { ConfigService } from '../../config/config.service';

const OPERATIONAL_TIME_ZONE = 'America/Argentina/Buenos_Aires';
const MAX_SYNC_RANGE_DAYS = 31;

export type MetricsSyncStatus = {
  key: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: 'running' | 'success' | 'failed' | null;
  totalSynced: number | null;
  error: string | null;
};

@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly logger = new Logger(MetricsService.name);
  private metrics = new Map<string, DailyMetrics>();
  private syncStatuses = new Map<string, MetricsSyncStatus>();

  constructor(
    private readonly manualInvestmentsRepository: ManualInvestmentsRepository,
    private readonly externalApisService: ExternalApisService,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => InvestmentsService))
    private readonly investmentsService: InvestmentsService
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reloadPersistedMetrics();
  }

  async reloadPersistedMetrics(): Promise<void> {
    try {
      const persistedMetrics = await this.manualInvestmentsRepository.findAllDailyMetrics();
      this.metrics = new Map(
        persistedMetrics
          .filter((metric) => Boolean(metric.id))
          .map((metric) => [metric.id!, metric])
      );
      this.logger.log(`Loaded ${persistedMetrics.length} persisted daily metrics`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Could not load persisted daily metrics: ${message}`);
    }
  }

  findAll(): DailyMetrics[] {
    return Array.from(this.metrics.values());
  }

  findById(id: string): DailyMetrics | null {
    return this.metrics.get(id) || null;
  }

  findByDateRange(startDate: string, endDate: string): DailyMetrics[] {
    return Array.from(this.metrics.values()).filter(
      m => m.date >= startDate && m.date <= endDate
    );
  }

  findByCampaign(campaignId: string): DailyMetrics[] {
    return Array.from(this.metrics.values()).filter(
      m => m.campaignId === campaignId
    );
  }

  findByClientAndDate(cliente: string, date: string): DailyMetrics[] {
    return Array.from(this.metrics.values()).filter(
      m => m.cliente === cliente && m.date === date
    );
  }

  create(dto: CreateDailyMetricsDto): DailyMetrics {
    const id = uuidv4();
    const metric: DailyMetrics = {
      id,
      ...this.normalize(dto as any)
    };
    this.metrics.set(id, metric);
    void this.persistMetric(metric);
    return metric;
  }

  update(id: string, dto: UpdateDailyMetricsDto): DailyMetrics | null {
    const existing = this.metrics.get(id);
    if (!existing) return null;

    const updated = { ...existing, ...this.normalize(dto as any) };
    this.metrics.set(id, updated);
    void this.persistMetric(updated);
    return updated;
  }

  delete(id: string): boolean {
    const deleted = this.metrics.delete(id);
    if (deleted) void this.manualInvestmentsRepository.deleteDailyMetric(id);
    return deleted;
  }

  upsertByDateAndCampaign(date: string, campaignId: string, platform: string, dto: CreateDailyMetricsDto): DailyMetrics {
    const existing = Array.from(this.metrics.values()).find(
      m => m.date === date
        && m.campaignId === campaignId
        && m.plataforma === platform
        && (m.granularity || 'daily') === (dto.granularity || 'daily')
    );

    if (existing) {
      return this.update(existing.id!, dto as UpdateDailyMetricsDto) || existing;
    }

    return this.create(dto);
  }

  normalize(metrics: any): DailyMetrics {
    return {
      ...metrics,
      referencia: metrics.referencia || metrics.marca || metrics.cliente,
      objetivo: metrics.objetivo,
      accountId: metrics.accountId,
      accountName: metrics.accountName,
      adSetName: metrics.adSetName,
      adGroupName: metrics.adGroupName,
      granularity: metrics.granularity || 'daily',
      coverageEndDate: metrics.coverageEndDate,
      spend: Number(metrics.spend || 0),
      impressions: Number(metrics.impressions || 0),
      clicks: Number(metrics.clicks || 0),
      conversions: Number(metrics.conversions || 0),
      revenue: metrics.revenue != null ? Number(metrics.revenue) : undefined
    };
  }

  getSummary(cliente: string, date: string): any {
    const dayMetrics = this.findByClientAndDate(cliente, date);
    return {
      date,
      cliente,
      totalSpend: dayMetrics.reduce((sum, m) => sum + m.spend, 0),
      totalImpressions: dayMetrics.reduce((sum, m) => sum + m.impressions, 0),
      totalClicks: dayMetrics.reduce((sum, m) => sum + m.clicks, 0),
      totalConversions: dayMetrics.reduce((sum, m) => sum + m.conversions, 0),
      totalRevenue: dayMetrics.reduce((sum, m) => sum + (m.revenue || 0), 0),
      campaigns: dayMetrics.length
    };
  }

  async getSyncStatus(key: string): Promise<MetricsSyncStatus> {
    const persistedFinishedAt = await this.findPersistedConsumptionSyncAt();
    const fallback = this.syncStatuses.get(key);

    if (persistedFinishedAt) {
      return {
        key,
        startedAt: fallback?.startedAt || persistedFinishedAt,
        finishedAt: fallback?.finishedAt || persistedFinishedAt,
        status: fallback?.status || 'success',
        totalSynced: fallback?.totalSynced ?? null,
        error: fallback?.error ?? null
      };
    }

    return fallback || {
      key,
      startedAt: null,
      finishedAt: null,
      status: null,
      totalSynced: null,
      error: null
    };
  }

  async markSyncStarted(key: string, startedAt = new Date().toISOString()): Promise<MetricsSyncStatus> {
    const status: MetricsSyncStatus = {
      key,
      startedAt,
      finishedAt: null,
      status: 'running',
      totalSynced: null,
      error: null
    };

    this.syncStatuses.set(key, status);
    return status;
  }

  async markSyncFinished(
    key: string,
    result: { totalSynced?: number },
    error?: unknown
  ): Promise<MetricsSyncStatus> {
    const current = await this.getSyncStatus(key);
    const status: MetricsSyncStatus = {
      key,
      startedAt: current.startedAt || new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: error ? 'failed' : 'success',
      totalSynced: result.totalSynced ?? current.totalSynced ?? null,
      error: error ? (error instanceof Error ? error.message : String(error)) : null
    };

    this.syncStatuses.set(key, status);
    return status;
  }

  async syncMonthlyAndDaily(source: AdsMetricsSource | 'all' = 'all', date?: string) {
    await this.markSyncStarted('consumption');
    const targetDate = date || this.today();
    const monthlyDate = targetDate;
    const dailyDates = this.isPastMonthDate(targetDate)
      ? this.dateRange(this.monthStart(targetDate), targetDate)
      : [targetDate, this.previousDate(targetDate)];
    const sources = source === 'all' ? this.getAllAdsSources() : [source];

    try {
      const resultsBySource = await Promise.all(
        sources.map(async (currentSource) => {
          const sourceResults = [];
          {
            const backup = this.backupMetricsForSync(currentSource, 'monthly', monthlyDate);
            await this.clearMetricsForSync(currentSource, 'monthly', monthlyDate);

            const result = await this.safeSyncAdsSource(currentSource, 'monthly', monthlyDate);
            if ('status' in result && result.status === 'failed') {
              await this.restoreMetricsBackup(backup);
            }
            sourceResults.push(result);
          }
          for (const dailyDate of dailyDates) {
            const backup = this.backupMetricsForSync(currentSource, 'daily', dailyDate);
            await this.clearMetricsForSync(currentSource, 'daily', dailyDate);

            const result = await this.safeSyncAdsSource(currentSource, 'daily', dailyDate);
            if ('status' in result && result.status === 'failed') {
              await this.restoreMetricsBackup(backup);
            }
            sourceResults.push(result);
          }
          return sourceResults;
        })
      );
      const results = resultsBySource.flat();
      const response = {
        date: targetDate,
        monthlyDate,
        dailyDate: targetDate,
        previousDailyDate: this.previousDate(targetDate),
        dailyDates,
        totalSynced: results.reduce((sum, result) => sum + result.synced, 0),
        results
      };
      await this.refreshInvestmentSnapshots(targetDate);
      const syncStatus = await this.markSyncFinished('consumption', response);

      return {
        ...response,
        syncStatus
      };
    } catch (error) {
      await this.markSyncFinished('consumption', { totalSynced: 0 }, error);
      throw error;
    }
  }

  async syncDateRange(source: AdsMetricsSource | 'all' = 'all', startDate: string, endDate: string) {
    const safeStartDate = this.ensureDate(startDate || endDate || this.today());
    const safeEndDate = this.ensureDate(endDate || safeStartDate);

    if (safeStartDate > safeEndDate) {
      throw new BadRequestException('startDate must be before or equal to endDate');
    }

    const dates = this.dateRange(safeStartDate, safeEndDate);
    if (dates.length > MAX_SYNC_RANGE_DAYS) {
      throw new BadRequestException(`Date range cannot exceed ${MAX_SYNC_RANGE_DAYS} days`);
    }

    await this.markSyncStarted('consumption');
    const sources = source === 'all' ? this.getAllAdsSources() : [source];

    try {
      const results = await Promise.all(sources.map(async (currentSource) => {
        return this.safeSyncAdsSourceRange(currentSource, safeStartDate, safeEndDate);
      }));
      const response = {
        startDate: safeStartDate,
        endDate: safeEndDate,
        dates,
        totalSynced: results.reduce((sum, result) => sum + result.synced, 0),
        results
      };
      await this.refreshInvestmentSnapshots(safeEndDate);
      const syncStatus = await this.markSyncFinished('consumption', response);

      return {
        ...response,
        syncStatus
      };
    } catch (error) {
      await this.markSyncFinished('consumption', { totalSynced: 0 }, error);
      throw error;
    }
  }

  private async refreshInvestmentSnapshots(date: string): Promise<void> {
    try {
      await this.investmentsService.refreshConsumptionSnapshots(date);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Could not refresh investment consumption snapshots: ${message}`);
    }
  }

  private async syncSupermetricsSource(source: SupermetricsSource, scope: SupermetricsScope, date?: string) {
    const metrics = await this.externalApisService.fetchSupermetricsMetrics(source, scope, date);

    for (const metric of metrics) {
      await this.upsertByDateAndCampaignAsync(
        metric.date,
        metric.campaignId,
        metric.plataforma,
        metric
      );
    }

    return {
      source: `supermetrics-${source}`,
      scope,
      date: date || this.today(),
      synced: metrics.length
    };
  }

  private async syncNativeAdsSource(source: NativeAdsSource, scope: SupermetricsScope, date?: string) {
    const metrics = await this.externalApisService.fetchNativeAdsMetrics(source, scope, date);

    for (const metric of metrics) {
      await this.upsertByDateAndCampaignAsync(
        metric.date,
        metric.campaignId,
        metric.plataforma,
        metric
      );
    }

    return {
      source,
      scope,
      date: date || this.today(),
      synced: metrics.length
    };
  }

  private async safeSyncAdsSource(source: AdsMetricsSource, scope: SupermetricsScope, date?: string) {
    try {
      this.logger.log(`Starting ${source} ${scope} sync for ${date || 'today'}`);
      const result = await this.withTimeout(
        this.isSupermetricsSource(source)
          ? this.syncSupermetricsSource(source, scope, date)
          : this.syncNativeAdsSource(source, scope, date),
        60000
      );

      this.logger.log(`Finished ${source} ${scope} sync: ${result.synced} rows`);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`${source} ${scope} sync skipped: ${message}`);

      return {
        source,
        scope,
        date: date || this.today(),
        synced: 0,
        status: 'failed',
        error: message
      };
    }
  }

  private async safeSyncAdsSourceRange(source: AdsMetricsSource, startDate: string, endDate: string) {
    try {
      this.logger.log(`Starting ${source} range sync for ${startDate}..${endDate}`);
      const metrics = await this.withTimeout(
        this.externalApisService.fetchAdsMetricsRange(source, startDate, endDate),
        120000
      );

      if (metrics.some((metric) => (metric.granularity || 'daily') === 'daily')) {
        await this.clearMetricsForSyncRange(source, startDate, endDate);
      }
      if (metrics.some((metric) => metric.granularity === 'monthly')) {
        await this.clearMetricsForSync(source, 'monthly', endDate);
      }
      for (let index = 0; index < metrics.length; index += 5) {
        await Promise.all(metrics.slice(index, index + 5).map((metric) =>
          this.upsertByDateAndCampaignAsync(
            metric.date,
            metric.campaignId,
            metric.plataforma,
            metric
          )
        ));
      }

      this.logger.log(`Finished ${source} range sync: ${metrics.length} rows`);
      return {
        source,
        scope: 'daily' as const,
        date: endDate,
        startDate,
        endDate,
        synced: metrics.length
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`${source} range sync skipped: ${message}`);
      return {
        source,
        scope: 'daily' as const,
        date: endDate,
        startDate,
        endDate,
        synced: 0,
        status: 'failed' as const,
        error: message
      };
    }
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    let timeout: NodeJS.Timeout | undefined;

    const timeoutPromise = new Promise<T>((_, reject) => {
      timeout = setTimeout(() => {
        reject(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private getAllAdsSources(): AdsMetricsSource[] {
    const sources: AdsMetricsSource[] = ['google', 'meta', 'linkedin', 'tiktok'];
    if (this.configService.mercadoLibreSyncEnabled) {
      sources.push('mercadolibre');
    }
    return sources;
  }

  private getPlatformForAdsSource(source: AdsMetricsSource): string {
    switch (source) {
      case 'google': return 'Google';
      case 'meta': return 'META';
      case 'tiktok': return 'TikTok';
      case 'mercadolibre': return 'MELI';
      case 'linkedin': return 'LinkedIn';
      default: return source;
    }
  }

  private normalizePlatform(platform: string): string {
    const value = platform.trim().toLowerCase();
    if (value === 'meta' || value === 'facebook ads' || value === 'facebook') return 'META';
    if (value === 'google' || value === 'google ads') return 'Google';
    if (value === 'merc. libre' || value === 'mercado libre' || value === 'm.libre' || value === 'meli') return 'MELI';
    if (value === 'tiktok' || value === 'tik tok') return 'TikTok';
    if (value === 'linkedin') return 'LinkedIn';
    return platform.trim();
  }

  private removeMetrics(predicate: (metric: DailyMetrics) => boolean): void {
    for (const [id, metric] of this.metrics.entries()) {
      if (predicate(metric)) this.metrics.delete(id);
    }
  }

  private backupMetricsForSync(source: AdsMetricsSource, scope: SupermetricsScope, date: string): DailyMetrics[] {
    const platform = this.getPlatformForAdsSource(source);
    if (scope === 'daily') {
      return Array.from(this.metrics.values()).filter((metric) =>
        this.normalizePlatform(metric.plataforma) === platform
        && (metric.granularity || 'daily') === 'daily'
        && metric.date === date
      );
    }

    const monthDate = this.monthStart(date);
    return Array.from(this.metrics.values()).filter((metric) =>
      this.normalizePlatform(metric.plataforma) === platform
      && (metric.granularity || 'daily') === 'monthly'
      && metric.date === monthDate
    );
  }

  private async restoreMetricsBackup(metrics: DailyMetrics[]): Promise<void> {
    for (const metric of metrics) {
      if (metric.id) {
        this.metrics.set(metric.id, metric);
        await this.persistMetric(metric);
      }
    }
  }

  private async clearMetricsForSync(source: AdsMetricsSource, scope: SupermetricsScope, date: string): Promise<void> {
    const platform = this.getPlatformForAdsSource(source);
    if (scope === 'daily') {
      this.removeMetrics((metric) =>
        this.normalizePlatform(metric.plataforma) === platform
        && (metric.granularity || 'daily') === 'daily'
        && metric.date === date
      );
      await this.manualInvestmentsRepository.deleteDailyMetricsForSync(platform, 'daily', date);
      return;
    }

    const monthDate = this.monthStart(date);
    this.removeMetrics((metric) =>
      this.normalizePlatform(metric.plataforma) === platform
      && (metric.granularity || 'daily') === 'monthly'
      && metric.date === monthDate
    );
    await this.manualInvestmentsRepository.deleteDailyMetricsForSync(platform, 'monthly', monthDate);
  }

  private async clearMetricsForSyncRange(source: AdsMetricsSource, startDate: string, endDate: string): Promise<void> {
    const platform = this.getPlatformForAdsSource(source);
    this.removeMetrics((metric) =>
      this.normalizePlatform(metric.plataforma) === platform
      && (metric.granularity || 'daily') === 'daily'
      && metric.date >= startDate
      && metric.date <= endDate
    );
    await this.manualInvestmentsRepository.deleteDailyMetricsForSyncRange(platform, startDate, endDate);
  }

  private isSupermetricsSource(source: AdsMetricsSource): source is SupermetricsSource {
    return source === 'linkedin';
  }

  private previousDate(date: string): string {
    const value = new Date(`${date}T00:00:00.000Z`);
    value.setUTCDate(value.getUTCDate() - 1);
    return value.toISOString().slice(0, 10);
  }

  private monthStart(date: string): string {
    return `${date.slice(0, 7)}-01`;
  }

  private isPastMonthDate(date: string): boolean {
    return date.slice(0, 7) < this.today().slice(0, 7);
  }

  private dateRange(startDate: string, endDate: string): string[] {
    const dates: string[] = [];
    let current = startDate;

    while (current <= endDate) {
      dates.push(current);
      current = this.nextDate(current);
    }

    return dates;
  }

  private nextDate(date: string): string {
    const value = new Date(`${date}T00:00:00.000Z`);
    value.setUTCDate(value.getUTCDate() + 1);
    return value.toISOString().slice(0, 10);
  }

  private ensureDate(value: string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException('Invalid date format');
    }

    return value;
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

  private async findPersistedConsumptionSyncAt(): Promise<string | null> {
    try {
      return await this.manualInvestmentsRepository.findLatestConsumptionSyncAt();
    } catch {
      return null;
    }
  }

  private async upsertByDateAndCampaignAsync(
    date: string,
    campaignId: string,
    platform: string,
    dto: CreateDailyMetricsDto
  ): Promise<DailyMetrics> {
    const metric = this.upsertByDateAndCampaign(date, campaignId, platform, dto);
    await this.persistMetric(metric);
    return metric;
  }

  private async persistMetric(metric: DailyMetrics): Promise<void> {
    try {
      const persisted = await this.manualInvestmentsRepository.upsertDailyMetric(metric);
      if (persisted?.id && persisted.id !== metric.id) {
        this.metrics.delete(metric.id || '');
        this.metrics.set(persisted.id, persisted);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Could not persist metric ${metric.campaignId}: ${message}`);
    }
  }
}
