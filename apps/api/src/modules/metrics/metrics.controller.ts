import { Controller, Get, Post, Put, Delete, Param, Body, Query } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { CreateDailyMetricsDto, UpdateDailyMetricsDto } from './dto/create-daily-metrics.dto';
import { ExternalApisService, SupermetricsScope, SupermetricsSource } from '../../common/external-apis/external-apis.service';

@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metricsService: MetricsService,
    private readonly externalApisService: ExternalApisService
  ) {}

  @Get()
  getAll() {
    return this.metricsService.findAll();
  }

  @Get('range')
  getByDateRange(@Query('startDate') startDate: string, @Query('endDate') endDate: string) {
    return this.metricsService.findByDateRange(startDate, endDate);
  }

  @Get('campaign/:campaignId')
  getByCampaign(@Param('campaignId') campaignId: string) {
    return this.metricsService.findByCampaign(campaignId);
  }

  @Get('client/:cliente/date/:date')
  getByClientAndDate(@Param('cliente') cliente: string, @Param('date') date: string) {
    return this.metricsService.findByClientAndDate(cliente, date);
  }

  @Get('summary/:cliente/:date')
  getSummary(@Param('cliente') cliente: string, @Param('date') date: string) {
    return this.metricsService.getSummary(cliente, date);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.metricsService.findById(id);
  }

  @Post()
  create(@Body() dto: CreateDailyMetricsDto) {
    return this.metricsService.create(dto);
  }

  @Post('upsert')
  upsert(@Body() dto: CreateDailyMetricsDto & { date: string; campaignId: string; plataforma: string }) {
    return this.metricsService.upsertByDateAndCampaign(
      dto.date,
      dto.campaignId,
      dto.plataforma,
      dto
    );
  }

  @Post('sync/supermetrics/facebook-ads')
  async syncSupermetricsFacebookAds(@Query('date') date?: string) {
    return this.syncSupermetricsSource('meta', date ? 'daily' : 'monthly', date);
  }

  @Post('sync/supermetrics')
  async syncSupermetrics(
    @Query('source') source: SupermetricsSource | 'all' = 'all',
    @Query('scope') scope: SupermetricsScope = 'daily',
    @Query('date') date?: string
  ) {
    const sources: SupermetricsSource[] = source === 'all' ? ['google', 'meta', 'linkedin'] : [source];
    const results = [];

    for (const currentSource of sources) {
      results.push(await this.safeSyncSupermetricsSource(currentSource, scope, date));
    }

    return {
      scope,
      date: date || new Date().toISOString().slice(0, 10),
      totalSynced: results.reduce((sum, result) => sum + result.synced, 0),
      results
    };
  }

  @Post('sync/supermetrics/monthly-and-daily')
  async syncSupermetricsMonthlyAndDaily(
    @Query('source') source: SupermetricsSource | 'all' = 'all',
    @Query('date') date?: string
  ) {
    const targetDate = date || new Date().toISOString().slice(0, 10);
    const yesterday = this.previousDate(targetDate);
    const sources: SupermetricsSource[] = source === 'all' ? ['google', 'meta', 'linkedin'] : [source];
    const results = [];

    for (const currentSource of sources) {
      results.push(await this.safeSyncSupermetricsSource(currentSource, 'monthly', targetDate));
      results.push(await this.safeSyncSupermetricsSource(currentSource, 'daily', yesterday));
    }

    return {
      date: targetDate,
      dailyDate: yesterday,
      totalSynced: results.reduce((sum, result) => sum + result.synced, 0),
      results
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
      date: date || new Date().toISOString().slice(0, 10),
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
        date: date || new Date().toISOString().slice(0, 10),
        synced: 0,
        status: 'failed',
        error: message,
        metrics: []
      };
    }
  }

  private previousDate(date: string): string {
    const value = new Date(`${date}T00:00:00.000Z`);
    value.setUTCDate(value.getUTCDate() - 1);
    return value.toISOString().slice(0, 10);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDailyMetricsDto) {
    return this.metricsService.update(id, dto);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    const deleted = this.metricsService.delete(id);
    return { deleted };
  }
}
