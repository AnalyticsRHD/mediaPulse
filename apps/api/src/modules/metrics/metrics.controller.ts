import { Controller, Get, Post, Put, Delete, Param, Body, Query, Logger } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { MetricsService } from './metrics.service';
import { CreateDailyMetricsDto, UpdateDailyMetricsDto } from './dto/create-daily-metrics.dto';
import { SWAGGER_TAGS } from '../../common/swagger/swagger-tags';
import {
  AdsMetricsSource,
  ExternalApisService,
  NativeAdsSource,
  SupermetricsScope,
  SupermetricsSource
} from '../../common/external-apis/external-apis.service';

const OPERATIONAL_TIME_ZONE = 'America/Argentina/Buenos_Aires';

@Controller('metrics')
export class MetricsController {
  private readonly logger = new Logger(MetricsController.name);

  constructor(
    private readonly metricsService: MetricsService,
    private readonly externalApisService: ExternalApisService
  ) {}

  @Get()
  @ApiTags(SWAGGER_TAGS.METRICS)
  getAll() {
    return this.metricsService.findAll();
  }

  @Get('range')
  @ApiTags(SWAGGER_TAGS.METRICS)
  getByDateRange(@Query('startDate') startDate: string, @Query('endDate') endDate: string) {
    return this.metricsService.findByDateRange(startDate, endDate);
  }

  @Get('campaign/:campaignId')
  @ApiTags(SWAGGER_TAGS.METRICS)
  getByCampaign(@Param('campaignId') campaignId: string) {
    return this.metricsService.findByCampaign(campaignId);
  }

  @Get('client/:cliente/date/:date')
  @ApiTags(SWAGGER_TAGS.METRICS)
  getByClientAndDate(@Param('cliente') cliente: string, @Param('date') date: string) {
    return this.metricsService.findByClientAndDate(cliente, date);
  }

  @Get('summary/:cliente/:date')
  @ApiTags(SWAGGER_TAGS.METRICS)
  getSummary(@Param('cliente') cliente: string, @Param('date') date: string) {
    return this.metricsService.getSummary(cliente, date);
  }

  @Get('sync/status')
  @ApiTags(SWAGGER_TAGS.SYNCHRONIZATION)
  getSyncStatus(@Query('key') key = 'consumption') {
    return this.metricsService.getSyncStatus(key);
  }

  @Get(':id')
  @ApiTags(SWAGGER_TAGS.METRICS)
  getById(@Param('id') id: string) {
    return this.metricsService.findById(id);
  }

  @Post()
  @ApiTags(SWAGGER_TAGS.METRICS)
  create(@Body() dto: CreateDailyMetricsDto) {
    return this.metricsService.create(dto);
  }

  @Post('upsert')
  @ApiTags(SWAGGER_TAGS.METRICS)
  upsert(@Body() dto: CreateDailyMetricsDto & { date: string; campaignId: string; plataforma: string }) {
    return this.metricsService.upsertByDateAndCampaign(
      dto.date,
      dto.campaignId,
      dto.plataforma,
      dto
    );
  }

  @Post('sync/supermetrics/facebook-ads')
  @ApiTags(SWAGGER_TAGS.SYNCHRONIZATION)
  async syncSupermetricsFacebookAds(@Query('date') date?: string) {
    return this.syncNativeAdsSource('meta', date ? 'daily' : 'monthly', date);
  }

  @Post('sync/supermetrics')
  @ApiTags(SWAGGER_TAGS.SYNCHRONIZATION)
  async syncSupermetrics(
    @Query('source') source: SupermetricsSource | 'all' = 'all',
    @Query('scope') scope: SupermetricsScope = 'daily',
    @Query('date') date?: string
  ) {
    const sources: SupermetricsSource[] = source === 'all' ? ['linkedin'] : [source];
    const results = [];

    for (const currentSource of sources) {
      results.push(await this.safeSyncSupermetricsSource(currentSource, scope, date));
    }

    return {
      scope,
      date: date || this.today(),
      totalSynced: results.reduce((sum, result) => sum + result.synced, 0),
      results
    };
  }

  @Post('sync/supermetrics/monthly-and-daily')
  @ApiTags(SWAGGER_TAGS.SYNCHRONIZATION)
  async syncSupermetricsMonthlyAndDaily(
    @Query('source') source: SupermetricsSource | 'all' = 'all',
    @Query('date') date?: string
  ) {
    await this.metricsService.markSyncStarted('consumption');
    const targetDate = date || this.today();
    const monthlyDate = targetDate;
    const dailyDate = targetDate;
    const previousDailyDate = this.previousDate(targetDate);
    const sources: SupermetricsSource[] = source === 'all' ? ['linkedin'] : [source];
    const results = [];

    try {
      for (const currentSource of sources) {
        results.push(await this.safeSyncSupermetricsSource(currentSource, 'monthly', monthlyDate));
        results.push(await this.safeSyncSupermetricsSource(currentSource, 'daily', dailyDate));
        results.push(await this.safeSyncSupermetricsSource(currentSource, 'daily', previousDailyDate));
      }

      const response = {
        date: targetDate,
        monthlyDate,
        dailyDate,
        previousDailyDate,
        totalSynced: results.reduce((sum, result) => sum + result.synced, 0),
        results
      };
      const syncStatus = await this.metricsService.markSyncFinished('consumption', response);

      return {
        ...response,
        syncStatus
      };
    } catch (error) {
      await this.metricsService.markSyncFinished('consumption', { totalSynced: 0 }, error);
      throw error;
    }
  }

  @Post('sync/monthly-and-daily')
  @ApiTags(SWAGGER_TAGS.SYNCHRONIZATION)
  async syncMonthlyAndDaily(
    @Query('source') source: AdsMetricsSource | 'all' = 'all',
    @Query('date') date?: string
  ) {
    return this.metricsService.syncMonthlyAndDaily(source, date);
  }

  @Post('sync/date-range')
  @ApiTags(SWAGGER_TAGS.SYNCHRONIZATION)
  async syncDateRange(
    @Query('source') source: AdsMetricsSource | 'all' = 'all',
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string
  ) {
    return this.metricsService.syncDateRange(source, startDate, endDate);
  }

  @Post('sync/date-range/start')
  @ApiTags(SWAGGER_TAGS.SYNCHRONIZATION)
  async startDateRangeSync(
    @Query('source') source: AdsMetricsSource | 'all' = 'all',
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string
  ) {
    const current = await this.metricsService.getSyncStatus('consumption');
    if (current.status === 'running') {
      return { accepted: false, syncStatus: current };
    }

    void this.metricsService.syncDateRange(source, startDate, endDate).catch((error) => {
      this.logger.error(`Background range sync failed: ${error instanceof Error ? error.message : String(error)}`);
    });

    return {
      accepted: true,
      syncStatus: await this.metricsService.getSyncStatus('consumption')
    };
  }

  private async syncSupermetricsSource(source: SupermetricsSource, scope: SupermetricsScope, date?: string) {
    const metrics = await this.externalApisService.fetchSupermetricsMetrics(source, scope, date);

    for (const metric of metrics) {
      this.metricsService.upsertByDateAndCampaign(
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
      synced: metrics.length,
      metrics
    };
  }

  private async safeSyncSupermetricsSource(source: SupermetricsSource, scope: SupermetricsScope, date?: string) {
    try {
      return await this.syncSupermetricsSource(source, scope, date);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      return {
        source: `supermetrics-${source}`,
        scope,
        date: date || this.today(),
        synced: 0,
        status: 'failed',
        error: message,
        metrics: []
      };
    }
  }

  private async syncNativeAdsSource(source: NativeAdsSource, scope: SupermetricsScope, date?: string) {
    const metrics = await this.externalApisService.fetchNativeAdsMetrics(source, scope, date);

    for (const metric of metrics) {
      this.metricsService.upsertByDateAndCampaign(
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
      synced: metrics.length,
      metrics
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
        error: message,
        metrics: []
      };
    }
  }

  private async withTimeout<T extends { source: string; scope: SupermetricsScope; date: string; synced: number; metrics: any[] }>(
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
    return ['google', 'meta', 'linkedin', 'tiktok', 'mercadolibre'];
  }

  private isSupermetricsSource(source: AdsMetricsSource): source is SupermetricsSource {
    return source === 'linkedin';
  }

  private previousDate(date: string): string {
    const value = new Date(`${date}T00:00:00.000Z`);
    value.setUTCDate(value.getUTCDate() - 1);
    return value.toISOString().slice(0, 10);
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

  @Put(':id')
  @ApiTags(SWAGGER_TAGS.METRICS)
  update(@Param('id') id: string, @Body() dto: UpdateDailyMetricsDto) {
    return this.metricsService.update(id, dto);
  }

  @Delete(':id')
  @ApiTags(SWAGGER_TAGS.METRICS)
  delete(@Param('id') id: string) {
    const deleted = this.metricsService.delete(id);
    return { deleted };
  }
}
