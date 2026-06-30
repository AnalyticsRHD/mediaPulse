import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MetricsService } from '../../modules/metrics/metrics.service';
import { AdsMetricsSource, ExternalApisService, SupermetricsSource } from '../external-apis/external-apis.service';

@Injectable()
export class IngestionsSchedulerService {
  private logger = new Logger('IngestionsSchedulerService');

  constructor(
    private metricsService: MetricsService,
    private externalApisService: ExternalApisService
  ) {}

  @Cron('0 6 * * *')
  async ingestDailyMetrics() {
    this.logger.log('Starting daily metrics ingestion...');

    try {
      const today = new Date().toISOString().split('T')[0];
      const yesterday = this.previousDate(today);
      const allMetrics = [];

      for (const source of this.getAdsSources()) {
        const monthlyMetrics = await this.safeFetchAdsMetrics(source, 'monthly', today);
        const dailyMetrics = await this.safeFetchAdsMetrics(source, 'daily', yesterday);

        allMetrics.push(...monthlyMetrics, ...dailyMetrics);
      }

      for (const metric of allMetrics) {
        this.metricsService.upsertByDateAndCampaign(
          metric.date,
          metric.campaignId,
          metric.plataforma,
          metric
        );
      }
      this.logger.log(`Upserted ${allMetrics.length} metrics to local storage`);

      this.logger.log('Daily ingestion completed successfully');
    } catch (error) {
      this.logger.error('Error during daily ingestion:', error);
    }
  }

  async triggerIngestNow() {
    this.logger.log('Manual ingestion trigger');
    await this.ingestDailyMetrics();
  }

  getScheduleStatus() {
    return {
      nextRun: 'Daily at 6:00 AM (ARG timezone)',
      lastRun: new Date().toISOString(),
      status: 'active'
    };
  }

  private getSupermetricsSources(): SupermetricsSource[] {
    return ['linkedin'];
  }

  private getAdsSources(): AdsMetricsSource[] {
    return ['google', 'meta', ...this.getSupermetricsSources(), 'tiktok', 'mercadolibre'];
  }

  private async safeFetchSupermetricsMetrics(source: SupermetricsSource, scope: 'monthly' | 'daily', date: string) {
    try {
      const metrics = await this.externalApisService.fetchSupermetricsMetrics(source, scope, date);
      this.logger.log(`Fetched ${metrics.length} ${source} ${scope} metrics`);
      return metrics;
    } catch (error) {
      this.logger.error(`Skipping ${source} ${scope} metrics after Supermetrics error`, error);
      return [];
    }
  }

  private async safeFetchAdsMetrics(source: AdsMetricsSource, scope: 'monthly' | 'daily', date: string) {
    if (this.isSupermetricsSource(source)) {
      return this.safeFetchSupermetricsMetrics(source, scope, date);
    }

    try {
      const metrics = await this.externalApisService.fetchNativeAdsMetrics(source, scope, date);
      this.logger.log(`Fetched ${metrics.length} ${source} ${scope} metrics`);
      return metrics;
    } catch (error) {
      this.logger.error(`Skipping ${source} ${scope} metrics after API error`, error);
      return [];
    }
  }

  private isSupermetricsSource(source: AdsMetricsSource): source is SupermetricsSource {
    return source === 'linkedin';
  }

  private previousDate(date: string): string {
    const value = new Date(`${date}T00:00:00.000Z`);
    value.setUTCDate(value.getUTCDate() - 1);
    return value.toISOString().slice(0, 10);
  }
}
