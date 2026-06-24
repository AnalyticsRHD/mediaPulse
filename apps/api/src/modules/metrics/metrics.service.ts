import { Injectable } from '@nestjs/common';
import { DailyMetrics } from '@mediapulse/shared';
import { CreateDailyMetricsDto, UpdateDailyMetricsDto } from './dto/create-daily-metrics.dto';
import { ManualInvestmentsRepository } from '../investments/manual-investments.repository';
import { v4 as uuidv4 } from 'uuid';

export type MetricsSyncStatus = {
  key: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: 'running' | 'success' | 'failed' | null;
  totalSynced: number | null;
  error: string | null;
};

@Injectable()
export class MetricsService {
  private metrics = new Map<string, DailyMetrics>();
  private syncStatuses = new Map<string, MetricsSyncStatus>();

  constructor(private readonly manualInvestmentsRepository: ManualInvestmentsRepository) {}

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
    return metric;
  }

  update(id: string, dto: UpdateDailyMetricsDto): DailyMetrics | null {
    const existing = this.metrics.get(id);
    if (!existing) return null;

    const updated = { ...existing, ...this.normalize(dto as any) };
    this.metrics.set(id, updated);
    return updated;
  }

  delete(id: string): boolean {
    return this.metrics.delete(id);
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
        finishedAt: persistedFinishedAt,
        status: fallback?.status === 'running' ? 'running' : 'success',
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
    if (!error) await this.persistConsumptionSyncAt(status.finishedAt);
    return status;
  }

  private async findPersistedConsumptionSyncAt(): Promise<string | null> {
    try {
      return await this.manualInvestmentsRepository.findLatestConsumptionSyncAt();
    } catch {
      return null;
    }
  }

  private async persistConsumptionSyncAt(syncedAt: string | null): Promise<void> {
    if (!syncedAt) return;

    try {
      await this.manualInvestmentsRepository.markConsumptionSyncAt(syncedAt);
    } catch {
      return undefined;
    }
  }
}
