import { BadRequestException, forwardRef, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InvestmentCurrency, InvestmentDeviationComment, InvestmentLine, InvestmentStatus, InvestmentsResponse, ManualInvestmentLine, ManualInvestmentLog } from '@mediapulse/shared';
import { v4 as uuidv4 } from 'uuid';
import { MetricsService } from '../metrics/metrics.service';
import { ManualInvestmentDto } from './dto/manual-investment.dto';
import { BrandMappingService } from '../../common/brand-mapping/brand-mapping.service';
import { ManualInvestmentsRepository } from './manual-investments.repository';
import { AuthUser } from '../auth/auth.types';

const OPERATIONAL_TIME_ZONE = 'America/Argentina/Buenos_Aires';
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
type InvestmentRangeMode = 'thisMonth' | 'today' | 'yesterday' | 'previousMonth' | 'custom';

@Injectable()
export class InvestmentsService {
  private manualLines = new Map<string, ManualInvestmentLine>();
  private manualLinesHydrated = false;

  constructor(
    @Inject(forwardRef(() => MetricsService))
    private readonly metricsService: MetricsService,
    private readonly brandMappingService: BrandMappingService,
    private readonly manualInvestmentsRepository: ManualInvestmentsRepository
  ) {}

  async findAll(
    mes = this.currentMonth(),
    date = this.getYesterdayDate(),
    startDate = date,
    endDate = date,
    includeDrafts = false,
    mode: InvestmentRangeMode = 'thisMonth'
  ): Promise<InvestmentsResponse> {
    await this.hydrateManualLines();
    const safeStartDate = this.ensureDate(startDate, 'startDate');
    const safeEndDate = this.ensureDate(endDate, 'endDate');
    const resolvedMes = this.ensureMonth(mes || safeStartDate.slice(0, 7), 'mes');
    const rangeEndDate = safeEndDate || safeStartDate || date;
    const rangeStartDate = safeStartDate || rangeEndDate;
    const rangeMode = this.ensureRangeMode(mode);
    if (rangeStartDate > rangeEndDate) {
      throw new BadRequestException('startDate must be before or equal to endDate');
    }
    const days = this.daysInMonth(resolvedMes);
    const selectedDays = this.getRangeDays(rangeStartDate, rangeEndDate);
    const displayDays = rangeMode === 'custom' ? selectedDays : days;
    const diasRestantes = this.getRemainingDays(resolvedMes, rangeEndDate);
    const remainingDayEquivalents = this.getRemainingDayEquivalents(resolvedMes, rangeEndDate);
    const ritmo = days > 0
      ? this.getRangeDayEquivalents(resolvedMes, rangeStartDate, rangeEndDate, rangeMode) / days
      : 0;
    const latestConsumptionUpdatedAt = await this.getLatestConsumptionUpdatedAt();
    const lines = Array.from(this.manualLines.values())
      .filter((line) => line.mes === resolvedMes)
      .filter((line) => includeDrafts || line.status === InvestmentStatus.PRESUPUESTO_OK)
      .sort((a, b) => this.sortManualLines(a, b));
    const latestDeviationComments = await this.manualInvestmentsRepository.findLatestDeviationCommentsByLineIds(lines.map((line) => line.id));
    const totalBudget = lines.reduce((sum, line) => sum + line.presupuesto, 0);
    const builtLines = lines.map((line) => this.toInvestmentLine(
      line,
      totalBudget,
      days,
      remainingDayEquivalents,
      ritmo,
      rangeStartDate,
      rangeEndDate,
      latestConsumptionUpdatedAt,
      rangeMode,
      latestDeviationComments.get(line.id) ?? null
    ));
    await this.persistConsumptionSnapshots(builtLines);
    const investmentLines = builtLines.map((builtLine) => builtLine.line);
    const consumoTotal = investmentLines.reduce((sum, line) => sum + line.consumo, 0);

    return {
      summary: {
        mes: resolvedMes,
        date: rangeEndDate,
        startDate: rangeStartDate,
        endDate: rangeEndDate,
        dias: displayDays,
        diasRestantes,
        diasRestantesExactos: Math.round(remainingDayEquivalents * 100) / 100,
        ritmo,
        presupuestoPlanificado: totalBudget,
        consumoTotal,
        restante: totalBudget - consumoTotal,
        completion: totalBudget > 0 ? consumoTotal / totalBudget : 0
      },
      lines: investmentLines
    };
  }

  async refreshConsumptionSnapshots(date = this.formatOperationalDate(new Date())): Promise<void> {
    const month = this.ensureMonth(date.slice(0, 7), 'mes');
    const startDate = `${month}-01`;

    await this.findAll(month, date, startDate, date, true, 'thisMonth');
  }

  async createManualLine(dto: ManualInvestmentDto, user?: AuthUser): Promise<ManualInvestmentLine> {
    await this.hydrateManualLines();
    this.ensureManualLine(dto);
    const mapping = await this.brandMappingService.resolveClientBrand(
      dto.anunciante,
      dto.marca || dto.anunciante
    );
    const line: ManualInvestmentLine = {
      id: uuidv4(),
      ...dto,
      anunciante: mapping.cliente,
      marca: mapping.marca,
      moneda: dto.moneda || InvestmentCurrency.ARS,
      status: dto.status || InvestmentStatus.EN_PROCESO,
      mes: this.ensureMonth(dto.mes || this.currentMonth(), 'mes'),
      campana: this.cleanOptionalText(dto.campana),
      lastConsumo: 0,
      lastConsumoDia: 0,
      lastConsumoHoy: 0,
      lastConsumoHoyDate: null,
      lastConsumoUpdatedAt: null,
      plataforma: this.normalizePlatform(dto.plataforma)
    };

    this.manualLines.set(line.id, line);
    await this.persistManualLine(line);
    await this.persistManualLog('CREATED', line, user);
    return line;
  }

  async updateManualBudget(id: string, presupuesto: number, user?: AuthUser): Promise<ManualInvestmentLine | null> {
    return this.updateManualLine(id, { presupuesto }, user);
  }

  async deleteManualLines(ids: string[], user?: AuthUser): Promise<{ deletedCount: number; deletedIds: string[] }> {
    await this.hydrateManualLines();
    const existingLines = ids
      .map((id) => this.manualLines.get(id))
      .filter((line): line is ManualInvestmentLine => Boolean(line));
    const databaseResult = await this.deleteManualLinesFromDatabase(ids);
    if (databaseResult) {
      databaseResult.deletedIds.forEach((id) => this.manualLines.delete(id));
      await Promise.all(existingLines
        .filter((line) => databaseResult.deletedIds.includes(line.id))
        .map((line) => this.persistManualLog('DELETED', line, user)));
      return databaseResult;
    }

    throw new ServiceUnavailableException('Database is required for manual investments');
  }

  async updateManualLine(id: string, dto: Partial<ManualInvestmentDto>, user?: AuthUser): Promise<ManualInvestmentLine | null> {
    await this.hydrateManualLines();
    const existing = this.manualLines.get(id);
    if (!existing) return null;
    this.ensureManualLine({ ...existing, ...dto });

    const mapping = await this.brandMappingService.resolveClientBrand(
      dto.anunciante || existing.anunciante,
      dto.marca || existing.marca || dto.anunciante || existing.anunciante
    );

    const updated: ManualInvestmentLine = {
      ...existing,
      ...dto,
      anunciante: mapping.cliente,
      marca: mapping.marca,
      moneda: dto.moneda || existing.moneda || InvestmentCurrency.ARS,
      status: dto.status || existing.status || InvestmentStatus.EN_PROCESO,
      plataforma: dto.plataforma ? this.normalizePlatform(dto.plataforma) : existing.plataforma,
      campana: dto.campana !== undefined ? this.cleanOptionalText(dto.campana) : existing.campana,
      mes: dto.mes ? this.ensureMonth(dto.mes, 'mes') : existing.mes,
      presupuesto: dto.presupuesto != null ? Number(dto.presupuesto) : existing.presupuesto,
      costoPorResultado: dto.costoPorResultado != null ? Number(dto.costoPorResultado) : existing.costoPorResultado,
      tktPromedio: dto.tktPromedio != null ? Number(dto.tktPromedio) : existing.tktPromedio
    };

    this.manualLines.set(id, updated);
    await this.persistManualLine(updated);
    await this.persistManualLog('UPDATED', updated, user);
    return updated;
  }

  async getManualLines(mes?: string): Promise<ManualInvestmentLine[]> {
    await this.hydrateManualLines();
    const lines = Array.from(this.manualLines.values());
    const filtered = mes ? lines.filter((line) => line.mes === mes) : lines;
    return filtered.sort((a, b) => this.sortManualLines(a, b));
  }

  async getManualLineHistory(id: string): Promise<ManualInvestmentLog[] | null> {
    await this.hydrateManualLines();
    const existsInCurrentLines = this.manualLines.has(id);
    const history = await this.manualInvestmentsRepository.findLogsByLineId(id);

    if (!existsInCurrentLines && history.length === 0) return null;
    return history;
  }

  async addDeviationComment(id: string, comment: unknown, user?: AuthUser): Promise<InvestmentDeviationComment | null> {
    await this.hydrateManualLines();
    if (!this.manualLines.has(id)) return null;

    const cleanComment = typeof comment === 'string' ? comment.trim() : '';
    if (!cleanComment) throw new BadRequestException('comment is required');
    if (cleanComment.length > 1000) throw new BadRequestException('comment must be 1000 characters or fewer');

    const saved = await this.manualInvestmentsRepository.insertDeviationComment(id, cleanComment, user);
    if (!saved) throw new ServiceUnavailableException('Database is required for deviation comments');
    return saved;
  }

  private toInvestmentLine(
    line: ManualInvestmentLine,
    totalBudget: number,
    days: number,
    remainingDayEquivalents: number,
    ritmo: number,
    startDate: string,
    endDate: string,
    latestConsumptionUpdatedAt: string | null,
    mode: InvestmentRangeMode,
    latestDeviationComment: InvestmentDeviationComment | null
  ): {
    line: InvestmentLine;
    sourceLine: ManualInvestmentLine;
    hasMonthlyMetrics: boolean;
    hasDailyMetrics: boolean;
  } {
    const { consumo, consumoDia, hasMonthlyMetrics, hasDailyMetrics } = this.getConsumptionSnapshot(line, startDate, endDate, mode);
    const consumoAyer = this.getDailyConsumptionSnapshot(
      line,
      this.addDays(this.getConsumoDiaDate(mode, endDate), -1),
      false
    ).consumo;
    const share = totalBudget > 0 ? line.presupuesto / totalBudget : 0;
    const porcentajeConsumo = line.presupuesto > 0 ? consumo / line.presupuesto : 0;
    const resultadosProyectados = this.getProjectedResults(line);
    const consumoRestante = line.presupuesto - consumo;
    const remainingBudgetDayEquivalents = this.getRemainingDayEquivalentsFromSync(
      line.mes,
      latestConsumptionUpdatedAt || line.lastConsumoUpdatedAt
    )
      ?? remainingDayEquivalents;
    const nuevoPresupuestoDiario = remainingBudgetDayEquivalents > 0
      ? consumoRestante / remainingBudgetDayEquivalents
      : 0;

    return {
      line: {
        ...line,
        consumo,
        consumoDia,
        consumoAyer,
        presupuestoDaily: days > 0 ? line.presupuesto / days : 0,
        nuevoPresupuestoDiario,
        share,
        resultadosProyectados,
        fcProyectada: this.isSalesObjective(line.objetivo) ? resultadosProyectados * line.tktPromedio : 0,
        consumoRestante,
        porcentajeConsumo,
        desvio: porcentajeConsumo - ritmo,
        latestDeviationComment
      },
      sourceLine: line,
      hasMonthlyMetrics,
      hasDailyMetrics
    };
  }

  private getConsumptionSnapshot(line: ManualInvestmentLine, startDate: string, endDate: string, mode: InvestmentRangeMode): {
    consumo: number;
    consumoDia: number;
    hasMonthlyMetrics: boolean;
    hasDailyMetrics: boolean;
  } {
    const monthlyBaseMetrics = this.getMonthlyMetricBaseCandidates(line);
    const consumoDiaSnapshot = this.getDailyConsumptionSnapshot(
      line,
      this.getConsumoDiaDate(mode, endDate),
      mode === 'thisMonth' || mode === 'today'
    );
    const consumoDia = consumoDiaSnapshot.consumo;
    const isSingleDayRange = startDate === endDate;

    if (isSingleDayRange) {
      return {
        consumo: consumoDia,
        consumoDia,
        hasMonthlyMetrics: false,
        hasDailyMetrics: consumoDiaSnapshot.hasMetrics
      };
    }

    if (mode === 'custom') {
      const rangeSnapshot = this.getDateRangeConsumptionSnapshot(line, startDate, endDate);
      const monthlyFallback = this.getMonthlyRangeFallback(line, startDate, endDate, monthlyBaseMetrics);

      return {
        consumo: rangeSnapshot.hasMetrics ? rangeSnapshot.consumo : monthlyFallback,
        consumoDia,
        hasMonthlyMetrics: !rangeSnapshot.hasMetrics && monthlyBaseMetrics.length > 0,
        hasDailyMetrics: rangeSnapshot.hasMetrics || consumoDiaSnapshot.hasMetrics
      };
    }

    const monthlyMetrics = this.getMatchedMetricsWithFallback(line, monthlyBaseMetrics);
    let mercadoLibreMonthToDateConsumo = mode === 'thisMonth' && this.isMonthToDateRange(line, startDate, endDate)
      ? this.getMercadoLibreMonthToDateConsumption(line, endDate, consumoDiaSnapshot)
      : null;
    // For Mercado Libre prefer recalculating from monthly metrics instead of
    // relying on stored snapshots which may be stale or partial.
    if (this.normalizePlatform(line.plataforma) === 'MELI') {
      mercadoLibreMonthToDateConsumo = null;
    }
    let monthlyConsumo = 0;
    if (monthlyBaseMetrics.length > 0) {
      // Special-case Mercado Libre: prefer the raw sum of monthly metrics to avoid
      // possible weighting/matching rules excluding display/product campaign rows.
      if (this.normalizePlatform(line.plataforma) === 'MELI') {
        monthlyConsumo = monthlyBaseMetrics.reduce((sum, m) => sum + Number(m.spend || 0), 0);
      } else {
        monthlyConsumo = this.getWeightedMetricSpend(monthlyMetrics, line, monthlyBaseMetrics.length === 1);
      }
    } else {
      monthlyConsumo = this.canUseStoredConsumptionFallback(line) ? line.lastConsumo || 0 : 0;
    }
    const cutoffDailyConsumo = mode === 'thisMonth'
      && this.isMonthToDateRange(line, startDate, endDate)
      && !this.metricsCoverDate(monthlyMetrics, endDate)
      ? this.getCutoffDailyConsumption(line, endDate)
      : 0;
    const consumo = mercadoLibreMonthToDateConsumo ?? monthlyConsumo + cutoffDailyConsumo;

    return {
      consumo,
      consumoDia,
      hasMonthlyMetrics: monthlyBaseMetrics.length > 0,
      hasDailyMetrics: consumoDiaSnapshot.hasMetrics
    };
  }

  private isMonthToDateRange(line: ManualInvestmentLine, startDate: string, endDate: string): boolean {
    return startDate === `${line.mes}-01` && endDate.startsWith(line.mes);
  }

  private getCutoffDailyConsumption(line: ManualInvestmentLine, endDate: string): number {
    return this.getDailyConsumptionSnapshot(line, endDate, false).consumo;
  }

  private getMercadoLibreMonthToDateConsumption(
    line: ManualInvestmentLine,
    endDate: string,
    dailySnapshot: { consumo: number; hasMetrics: boolean }
  ): number | null {
    if (this.normalizePlatform(line.plataforma) !== 'MELI') return null;
    if (!this.canUseStoredConsumptionFallback(line)) return null;

    const storedConsumo = line.lastConsumo || 0;
    if (!storedConsumo) return null;
    if (line.lastConsumoHoyDate === endDate) return storedConsumo;
    if (!dailySnapshot.hasMetrics) return storedConsumo;
    if (line.lastConsumoHoyDate && line.lastConsumoHoyDate > endDate) return storedConsumo;

    return storedConsumo + dailySnapshot.consumo;
  }

  private getConsumoDiaDate(mode: InvestmentRangeMode, endDate: string): string {
    return endDate;
  }

  private getDailyConsumptionSnapshot(line: ManualInvestmentLine, date: string, useFallback: boolean): {
    consumo: number;
    hasMetrics: boolean;
  } {
    if (!date.startsWith(line.mes)) {
      return { consumo: 0, hasMetrics: false };
    }

    const dailyBaseMetrics = this.getDailyMetricBaseCandidates(line, date, date);
    if (dailyBaseMetrics.length === 0) {
      if (line.lastConsumoHoyDate === date && useFallback) {
        return { consumo: line.lastConsumoHoy || 0, hasMetrics: true };
      }
      if (!this.canUseStoredConsumptionFallback(line) || !useFallback) {
        return { consumo: 0, hasMetrics: false };
      }
      if (line.lastConsumoHoyDate === date) {
        return { consumo: line.lastConsumoHoy || 0, hasMetrics: true };
      }
      return { consumo: 0, hasMetrics: false };
    }

    const dailyMetrics = this.getMatchedMetricsWithFallback(line, dailyBaseMetrics, true);
    if (dailyMetrics.length === 0) {
      if (line.lastConsumoHoyDate === date && useFallback) {
        return { consumo: line.lastConsumoHoy || 0, hasMetrics: true };
      }
      if (!this.canUseStoredConsumptionFallback(line)) {
        return { consumo: 0, hasMetrics: false };
      }
      if (line.lastConsumoHoyDate === date) {
        return { consumo: line.lastConsumoHoy || 0, hasMetrics: useFallback };
      }
      return { consumo: 0, hasMetrics: false };
    }

    return {
      consumo: this.getWeightedMetricSpend(dailyMetrics, line, dailyBaseMetrics.length === 1),
      hasMetrics: true
    };
  }

  private getTodayConsumptionSnapshot(line: ManualInvestmentLine): Pick<ManualInvestmentLine, 'lastConsumoHoy' | 'lastConsumoHoyDate'> {
    const today = this.formatOperationalDate(new Date());
    const snapshot = this.getDailyConsumptionSnapshot(line, today, false);

    if (!snapshot.hasMetrics) {
      if (line.lastConsumoHoyDate === today) {
        return {
          lastConsumoHoy: line.lastConsumoHoy || 0,
          lastConsumoHoyDate: today
        };
      }
      if (!this.canUseStoredConsumptionFallback(line)) {
        return {
          lastConsumoHoy: 0,
          lastConsumoHoyDate: today
        };
      }

      return {
        lastConsumoHoy: line.lastConsumoHoy || 0,
        lastConsumoHoyDate: line.lastConsumoHoyDate || null
      };
    }

    return {
      lastConsumoHoy: snapshot.consumo,
      lastConsumoHoyDate: today
    };
  }

  private metricsCoverDate(metrics: Array<{ coverageEndDate?: string }>, endDate: string): boolean {
    return metrics.length > 0 && metrics.every((metric) => (metric.coverageEndDate || '') >= endDate);
  }

  private getMatchedMetricsWithFallback(
    line: ManualInvestmentLine,
    metrics: Array<{ objetivo?: string; campaignName?: string; campaignId?: string; adSetName?: string; adGroupName?: string; spend: number; coverageEndDate?: string }>,
    allowSingleCandidateFallback = true
  ) {
    const matched = metrics.filter((metric) => this.metricMatchesLine(line, metric));
    if (matched.length > 0) return matched;

    if (this.requiresExactMetaAdSetMatch(line)) {
      const fuzzyMatches = metrics.filter((metric) => this.metaCampaignMatchesMetric(this.cleanOptionalText(line.campana) || '', metric));

      // Debugging: when the client is RHD, log candidate metrics for investigation
      try {
        const normalizedClient = this.normalizeReference(line.anunciante);
        if (normalizedClient === 'rhd') {
          const candidateSummaries = metrics.map((m) => ({ adSetName: m.adSetName, campaignName: m.campaignName, campaignId: m.campaignId, spend: m.spend }));
          // eslint-disable-next-line no-console
          console.log('DEBUG RHD metric candidates for', line.campana, '=>', JSON.stringify(candidateSummaries));
          const fuzzySummaries = fuzzyMatches.map((m) => ({ adSetName: m.adSetName, campaignName: m.campaignName, campaignId: m.campaignId, spend: m.spend }));
          // eslint-disable-next-line no-console
          console.log('DEBUG RHD fuzzy matches =>', JSON.stringify(fuzzySummaries));
        }
      } catch (e) {
        // ignore debug errors
      }

      if (fuzzyMatches.length === 1) return fuzzyMatches;
      return [];
    }

    return allowSingleCandidateFallback && metrics.length === 1 ? metrics : matched;
  }

  private canUseStoredConsumptionFallback(line: ManualInvestmentLine): boolean {
    return !this.requiresExactMetaAdSetMatch(line);
  }

  private requiresExactMetaAdSetMatch(line: ManualInvestmentLine): boolean {
    return this.normalizePlatform(line.plataforma) === 'META'
      && Boolean(this.cleanOptionalText(line.campana));
  }

  private getMonthlyMetricBaseCandidates(line: ManualInvestmentLine) {
    const lineClient = this.normalizeReference(line.anunciante);
    const lineBrand = this.normalizeReference(line.marca || line.anunciante);

    return this.safeMetrics()
      .filter((metric) => (
        (metric.granularity || 'daily') === 'monthly'
        && this.normalizePlatform(metric.plataforma) === this.normalizePlatform(line.plataforma)
        && metric.date.startsWith(line.mes)
        && (
          (this.normalizeReference(metric.cliente) === lineClient && this.normalizeReference(metric.marca) === lineBrand)
          || this.normalizeReference(metric.referencia || '') === lineBrand
          || this.normalizeReference(metric.referencia || '') === lineClient
        )
      ));
  }

  private getDateConsumption(line: ManualInvestmentLine, date: string): number {
    return this.getDateRangeConsumption(line, date, date);
  }

  private getDateRangeConsumption(line: ManualInvestmentLine, startDate: string, endDate: string): number {
    return this.getDateRangeConsumptionSnapshot(line, startDate, endDate).consumo;
  }

  private getDateRangeConsumptionSnapshot(line: ManualInvestmentLine, startDate: string, endDate: string): {
    consumo: number;
    hasMetrics: boolean;
  } {
    const dailyBaseMetrics = this.getDailyMetricBaseCandidates(line, startDate, endDate);
    if (dailyBaseMetrics.length === 0) {
      return { consumo: 0, hasMetrics: false };
    }

    const dailyMetrics = this.getMatchedMetricsWithFallback(line, dailyBaseMetrics, false);
    if (dailyMetrics.length === 0) {
      return { consumo: 0, hasMetrics: false };
    }

    return {
      consumo: this.getWeightedMetricSpend(dailyMetrics, line, dailyBaseMetrics.length === 1),
      hasMetrics: true
    };
  }

  private getMonthlyRangeFallback(
    line: ManualInvestmentLine,
    startDate: string,
    endDate: string,
    monthlyBaseMetrics: Array<{ objetivo?: string; campaignName?: string; campaignId?: string; adSetName?: string; adGroupName?: string; spend: number; coverageEndDate?: string }>
  ): number {
    if (monthlyBaseMetrics.length === 0) return 0;

    const monthlyConsumo = this.getMonthlyMetricSpend(line, monthlyBaseMetrics);
    if (!monthlyConsumo) return 0;

    const rangeDayEquivalents = this.getRangeDayEquivalents(line.mes, startDate, endDate, 'custom');
    const monthDayEquivalents = this.daysInMonth(line.mes);
    return monthDayEquivalents > 0
      ? monthlyConsumo * Math.min(rangeDayEquivalents / monthDayEquivalents, 1)
      : 0;
  }

  private getDailyMetricBaseCandidates(line: ManualInvestmentLine, startDate: string, endDate: string) {
    const lineClient = this.normalizeReference(line.anunciante);
    const lineBrand = this.normalizeReference(line.marca || line.anunciante);

    return this.safeMetrics()
      .filter((metric) => (
        (metric.granularity || 'daily') === 'daily'
        && this.normalizePlatform(metric.plataforma) === this.normalizePlatform(line.plataforma)
        && metric.date >= startDate
        && metric.date <= endDate
        && (
          (this.normalizeReference(metric.cliente) === lineClient && this.normalizeReference(metric.marca) === lineBrand)
          || this.normalizeReference(metric.referencia || '') === lineBrand
          || this.normalizeReference(metric.referencia || '') === lineClient
        )
      ));
  }

  private getWeightedMetricSpend(
    metrics: Array<{ objetivo?: string; campaignName?: string; adSetName?: string; adGroupName?: string; spend: number }>,
    line: ManualInvestmentLine,
    trustSingleCandidate = false
  ): number {
    return metrics.reduce((sum, metric) => {
      const weight = this.getMetricLineWeight(metric, line);
      return sum + metric.spend * (trustSingleCandidate && weight === 0 ? 1 : weight);
    }, 0);
  }

  private getMonthlyMetricSpend(
    line: ManualInvestmentLine,
    monthlyBaseMetrics: Array<{ objetivo?: string; campaignName?: string; campaignId?: string; adSetName?: string; adGroupName?: string; spend: number; coverageEndDate?: string }>
  ): number {
    if (monthlyBaseMetrics.length === 0) return 0;
    if (this.normalizePlatform(line.plataforma) === 'MELI') {
      return monthlyBaseMetrics.reduce((sum, metric) => sum + Number(metric.spend || 0), 0);
    }

    const monthlyMetrics = this.getMatchedMetricsWithFallback(line, monthlyBaseMetrics);
    return this.getWeightedMetricSpend(monthlyMetrics, line, monthlyBaseMetrics.length === 1);
  }

  private metricMatchesLine(line: ManualInvestmentLine, metric: { objetivo?: string; campaignName?: string; campaignId?: string; adSetName?: string; adGroupName?: string }): boolean {
    return this.metricMatchesCampana(line, metric) && this.getMetricLineWeight(metric, line) > 0;
  }

  private metricMatchesCampana(line: ManualInvestmentLine, metric: { campaignName?: string; campaignId?: string; adSetName?: string; adGroupName?: string }): boolean {
    const campana = this.cleanOptionalText(line.campana);
    if (!campana) return true;

    const needle = this.compactText(campana);
    if (this.normalizePlatform(line.plataforma) === 'META') {
      return this.compactText(metric.adSetName || '') === needle;
    }

    return this.getCampaignMatchFields(line, metric)
      .some((value) => this.compactText(value || '').includes(needle));
  }

  private metaCampaignMatchesMetric(
    needle: string,
    metric: { campaignName?: string; campaignId?: string; adSetName?: string; adGroupName?: string }
  ): boolean {
    const normalizedNeedle = this.normalizeMetaMatchText(needle);
    if (!normalizedNeedle) return false;

    const candidates = [metric.adSetName, metric.campaignName, metric.adGroupName, metric.campaignId]
      .filter((value): value is string => Boolean(value));

    return candidates.some((value) => {
      const normalizedCandidate = this.normalizeMetaMatchText(String(value));
      if (!normalizedCandidate) return false;
      if (normalizedCandidate === normalizedNeedle) return true;
      if (normalizedCandidate.includes(normalizedNeedle) || normalizedNeedle.includes(normalizedCandidate)) {
        return normalizedCandidate.length > 3 && normalizedNeedle.length > 3;
      }

      const needleTokens = normalizedNeedle.split(' ').filter(Boolean);
      const candidateTokens = normalizedCandidate.split(' ').filter(Boolean);
      const overlap = needleTokens.filter((token) => candidateTokens.includes(token));
      return overlap.length >= 1 && overlap.length >= Math.min(2, Math.min(needleTokens.length, candidateTokens.length));
    });
  }

  private normalizeMetaMatchText(value: string): string {
    return String(value)
      .toLowerCase()
      .replace(/[_\-/]+/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter((token) => !['rhd', 'gestion', 'managed', 'data', 'co', 'ads', 'meta', 'facebook', 'account', 'campaign', 'campana', 'adset', 'adgroup', 'marketing'].includes(token))
      .join(' ');
  }

  private getCampaignMatchFields(line: ManualInvestmentLine, metric: { campaignName?: string; campaignId?: string; adSetName?: string; adGroupName?: string }): Array<string | undefined> {
    const platform = this.normalizePlatform(line.plataforma);

    if (platform === 'Google') {
      return [metric.campaignName, metric.campaignId];
    }

    if (platform === 'META') {
      return [
        metric.adSetName,
        metric.campaignName,
        metric.adGroupName,
        metric.campaignId
      ];
    }

    return [
      metric.adSetName,
      metric.adGroupName,
      metric.campaignName,
      metric.campaignId
    ];
  }

  private getMetricLineWeight(metric: { objetivo?: string; campaignName?: string; adSetName?: string; adGroupName?: string }, line: ManualInvestmentLine): number {
    const metricObjective = this.normalizeObjective(metric.objetivo || this.inferObjectiveFromText(this.getMetricDescriptor(metric)));
    const lineObjective = this.normalizeObjective(line.objetivo);

    if (metricObjective) {
      if (metricObjective === lineObjective) return 1;
      if (this.objectivesAreCompatible(lineObjective, metricObjective)) return 1;
      const lineBaseObjective = this.baseObjective(lineObjective);
      const metricBaseObjective = this.baseObjective(metricObjective);
      if (lineBaseObjective !== metricBaseObjective) return 0;
      return this.hasObjectiveSiblings(line) ? 0 : 1;
    }

    if (this.requiresExplicitObjective(line)) {
      return this.shouldShareUnclassifiedMetric(line, metric) ? this.getUnclassifiedMetricShare(line) : 0;
    }

    return this.getUnclassifiedMetricShare(line);
  }

  private shouldShareUnclassifiedMetric(
    line: ManualInvestmentLine,
    metric: { campaignName?: string; adSetName?: string; adGroupName?: string }
  ): boolean {
    if (this.normalizePlatform(line.plataforma) !== 'TikTok') return false;
    return !this.inferObjectiveFromText(this.getMetricDescriptor(metric));
  }

  private getObjectiveSiblingLines(line: ManualInvestmentLine): ManualInvestmentLine[] {
    const lineClient = this.normalizeReference(line.anunciante);
    const lineBrand = this.normalizeReference(line.marca || line.anunciante);

    return Array.from(this.manualLines.values())
      .filter((currentLine) => (
        currentLine.mes === line.mes
        && this.normalizeReference(currentLine.anunciante) === lineClient
        && this.normalizeReference(currentLine.marca || currentLine.anunciante) === lineBrand
        && this.normalizePlatform(currentLine.plataforma) === this.normalizePlatform(line.plataforma)
      ));
  }

  private hasObjectiveSiblings(line: ManualInvestmentLine): boolean {
    const objectives = new Set(
      this.getObjectiveSiblingLines(line)
        .map((currentLine) => this.normalizeObjective(currentLine.objetivo))
    );

    return objectives.size > 1;
  }

  private getUnclassifiedMetricShare(line: ManualInvestmentLine): number {
    const siblingLines = this.getObjectiveSiblingLines(line);
    if (siblingLines.length <= 1) return 1;

    const totalBudget = siblingLines.reduce((sum, currentLine) => sum + Math.max(currentLine.presupuesto, 0), 0);
    if (totalBudget <= 0) return 1 / siblingLines.length;

    return Math.max(line.presupuesto, 0) / totalBudget;
  }

  private requiresExplicitObjective(line: ManualInvestmentLine): boolean {
    return this.hasObjectiveSiblings(line);
  }

  private getMetricDescriptor(metric: { campaignName?: string; adSetName?: string; adGroupName?: string }): string {
    return [
      metric.adSetName,
      metric.adGroupName,
      metric.campaignName
    ].filter(Boolean).join(' ');
  }

  private inferObjectiveFromText(value: string): string {
    const normalized = this.normalizeObjective(value);
    if (!normalized) return '';
    if (normalized.includes('alcance') || normalized.includes('reach')) return 'Alcance';
    if (normalized.includes('lead')) return normalized.includes('mensaje') ? 'Leads-mensajes' : this.withGoogleObjectiveSubtype('Leads', value);
    if (normalized.includes('youtube')) return 'Youtube';
    if (normalized.includes('local')) return 'Local campaing';
    if (normalized.includes('perfil')) return 'Visitas al perfil';
    if (normalized.includes('interaccion') || normalized.includes('engagement')) return 'Interaccion';
    if (normalized.includes('trafico') || normalized.includes('traffic')) return this.withGoogleObjectiveSubtype('Trafico', value);
    if (normalized.includes('venta') || normalized.includes('sales')) {
      return this.withGoogleObjectiveSubtype('Ventas', value);
    }
    return '';
  }

  private normalizeObjective(value: string): string {
    return this.normalizeReference(value)
      .replace(/\s+/g, '-')
      .toLowerCase();
  }

  private withGoogleObjectiveSubtype(objective: 'Leads' | 'Trafico' | 'Ventas', value: string): string {
    if (this.hasPmaxSignal(value)) return `${objective}-PMAX`;
    if (this.hasSearchSignal(value)) return `${objective}-Search`;
    return objective;
  }

  private baseObjective(value: string): string {
    return value.replace(/-(pmax|search)$/i, '');
  }

  private objectivesAreCompatible(lineObjective: string, metricObjective: string): boolean {
    const compatibleGroups = [
      ['visitas-al-perfil', 'trafico'],
      ['leads-mensajes', 'leads']
    ];

    return compatibleGroups.some((group) => (
      group.includes(lineObjective) && group.includes(metricObjective)
    ));
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

  private normalizePlatform(platform: string): string {
    const value = platform.trim().toLowerCase();
    if (value === 'meta' || value === 'facebook ads' || value === 'facebook') return 'META';
    if (value === 'google' || value === 'google ads') return 'Google';
    if (value === 'merc. libre' || value === 'mercado libre' || value === 'm.libre' || value === 'meli') return 'MELI';
    if (value === 'tiktok' || value === 'tik tok') return 'TikTok';
    return platform.trim();
  }

  private getProjectedResults(line: ManualInvestmentLine): number {
    if (line.costoPorResultado <= 0) return 0;

    const base = line.presupuesto / line.costoPorResultado;
    return this.normalizeReference(line.objetivo) === 'alcance' ? base * 1000 : base;
  }

  private isSalesObjective(objective: string): boolean {
    const normalized = this.normalizeReference(objective);
    return normalized === 'ventas'
      || normalized === 'venta'
      || normalized.startsWith('venta-')
      || normalized.startsWith('ventas-');
  }

  private normalizeReference(value: string): string {
    return this.brandMappingService.normalize(value);
  }

  private getYesterdayDate(): string {
    const todayParts = this.getOperationalDateParts(new Date());
    const todayStart = this.getZonedDateTime(
      Number(todayParts.year),
      Number(todayParts.month),
      Number(todayParts.day)
    );

    return this.formatOperationalDate(new Date(todayStart - MILLISECONDS_PER_DAY));
  }

  private addDays(date: string, days: number): string {
    const value = new Date(`${date}T00:00:00.000Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
  }

  private currentMonth(): string {
    return this.formatOperationalDate(new Date()).slice(0, 7);
  }

  private daysInMonth(mes: string): number {
    const [year, month] = mes.split('-').map(Number);
    return new Date(year, month, 0).getDate();
  }

  private getElapsedDays(mes: string, date: string): number {
    const days = this.daysInMonth(mes);
    if (!date.startsWith(mes)) return 0;

    const day = Number(date.slice(8, 10));
    return Math.min(Math.max(day, 0), days);
  }

  private getRemainingDays(mes: string, date: string): number {
    return Math.max(this.daysInMonth(mes) - this.getElapsedDays(mes, date), 0);
  }

  private getElapsedDayEquivalents(mes: string, date: string): number {
    return this.getElapsedMinutes(mes, date) / 1440;
  }

  private getRangeDayEquivalents(mes: string, startDate: string, endDate: string, mode: InvestmentRangeMode): number {
    if (mode !== 'custom') return this.getElapsedDayEquivalents(mes, endDate);
    if (!startDate.startsWith(mes) || !endDate.startsWith(mes)) return 0;

    const startDay = Math.min(Math.max(Number(startDate.slice(8, 10)), 1), this.daysInMonth(mes));
    const startElapsedMinutes = Math.max(startDay - 1, 0) * 1440;
    return Math.max(this.getElapsedMinutes(mes, endDate) - startElapsedMinutes, 0) / 1440;
  }

  private getRangeDays(startDate: string, endDate: string): number {
    const start = new Date(`${startDate}T00:00:00.000Z`);
    const end = new Date(`${endDate}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;

    return Math.max(Math.floor((end.getTime() - start.getTime()) / MILLISECONDS_PER_DAY) + 1, 0);
  }

  private getRemainingDayEquivalents(mes: string, date: string): number {
    if (date < `${mes}-01`) return this.daysInMonth(mes);
    if (date > `${mes}-${String(this.daysInMonth(mes)).padStart(2, '0')}`) return 0;

    return Math.max(this.daysInMonth(mes) - this.getElapsedDayEquivalents(mes, date), 0);
  }

  private getRemainingDayEquivalentsFromSync(mes: string, syncedAt?: string | null): number | null {
    if (!syncedAt) return null;

    const syncDate = new Date(syncedAt);
    if (Number.isNaN(syncDate.getTime())) return null;

    const [year, month] = mes.split('-').map(Number);
    const monthStart = this.getZonedDateTime(year, month, 1);
    const monthEndStart = this.getZonedDateTime(year, month, this.daysInMonth(mes));
    if (syncDate.getTime() < monthStart) return this.daysInMonth(mes);

    return Math.max((monthEndStart - syncDate.getTime()) / MILLISECONDS_PER_DAY, 0)+1;
  }

  private getElapsedMinutes(mes: string, date: string): number {
    const days = this.daysInMonth(mes);
    if (!date.startsWith(mes)) return 0;

    const day = Math.min(Math.max(Number(date.slice(8, 10)), 0), days);
    if (this.isTodayInMonth(mes, date)) {
      const now = this.getOperationalDateParts(new Date());
      return Math.min(
        ((day - 1) * 1440) + (now.hour * 60) + now.minute + (now.second / 60),
        days * 1440
      );
    }

    return day * 1440;
  }

  private isTodayInMonth(mes: string, date: string): boolean {
    return date === this.formatOperationalDate(new Date()) && date.startsWith(mes);
  }

  private formatOperationalDate(date: Date): string {
    const { year, month, day } = this.getOperationalDateParts(date);
    return `${year}-${month}-${day}`;
  }

  private getZonedDateTime(year: number, month: number, day: number): number {
    const utcWallTime = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
    let offset = this.getTimeZoneOffset(new Date(utcWallTime));
    const firstPass = utcWallTime - offset;
    offset = this.getTimeZoneOffset(new Date(firstPass));
    return utcWallTime - offset;
  }

  private getTimeZoneOffset(date: Date): number {
    const parts = this.getOperationalDateParts(date);
    const utcWallTime = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      parts.hour,
      parts.minute,
      parts.second
    );

    return utcWallTime - date.getTime();
  }

  private getOperationalDateParts(date: Date): {
    year: string;
    month: string;
    day: string;
    hour: number;
    minute: number;
    second: number;
  } {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: OPERATIONAL_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(date);
    const getPart = (type: string) => parts.find((part) => part.type === type)?.value || '00';

    return {
      year: getPart('year'),
      month: getPart('month'),
      day: getPart('day'),
      hour: Number(getPart('hour')),
      minute: Number(getPart('minute')),
      second: Number(getPart('second'))
    };
  }

  private sortManualLines(a: ManualInvestmentLine, b: ManualInvestmentLine): number {
    return [
      a.anunciante.localeCompare(b.anunciante),
      (a.marca || '').localeCompare(b.marca || ''),
      a.moneda.localeCompare(b.moneda),
      a.plataforma.localeCompare(b.plataforma),
      a.objetivo.localeCompare(b.objetivo),
      (a.campana || '').localeCompare(b.campana || '')
    ].find((result) => result !== 0) || 0;
  }

  private ensureManualLine(dto: Partial<ManualInvestmentDto>): void {
    if (!dto.anunciante?.trim()) throw new BadRequestException('anunciante is required');
    if (!dto.marca?.trim()) throw new BadRequestException('marca is required');
    if (!dto.plataforma?.trim()) throw new BadRequestException('plataforma is required');
    if (!dto.objetivo?.trim()) throw new BadRequestException('objetivo is required');
    this.ensureFiniteNumber(dto.presupuesto, 'presupuesto');
    this.ensureFiniteNumber(dto.costoPorResultado, 'costoPorResultado');
    this.ensureFiniteNumber(dto.tktPromedio, 'tktPromedio');
  }

  private cleanOptionalText(value: string | undefined): string | undefined {
    const clean = value?.trim();
    if (!clean || this.compactText(clean).length === 0) return undefined;
    if (this.compactText(clean) === '') return undefined;
    if (['-', 'sin-campana', 'sincampana', 'na', 'n-a'].includes(this.normalizeReference(clean))) return undefined;
    return clean;
  }

  private ensureFiniteNumber(value: unknown, field: string): void {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new BadRequestException(`${field} must be a valid number`);
    }
  }

  private ensureDate(value: string | undefined, field: string): string {
    if (!value || /^\d{4}-\d{2}-\d{2}$/.test(value)) return value || this.getYesterdayDate();
    throw new BadRequestException(`${field} must use YYYY-MM-DD format`);
  }

  private ensureMonth(value: string, field: string): string {
    if (/^\d{4}-\d{2}$/.test(value)) return value;
    throw new BadRequestException(`${field} must use YYYY-MM format`);
  }

  private ensureRangeMode(value: InvestmentRangeMode | undefined): InvestmentRangeMode {
    if (value && ['thisMonth', 'today', 'yesterday', 'previousMonth', 'custom'].includes(value)) return value;
    return 'thisMonth';
  }

  private previousDate(date: string): string {
    const value = new Date(`${date}T00:00:00.000Z`);
    value.setUTCDate(value.getUTCDate() - 1);
    return value.toISOString().slice(0, 10);
  }

  private safeMetrics() {
    try {
      return this.metricsService.findAll();
    } catch {
      return [];
    }
  }

  private async getLatestConsumptionUpdatedAt(): Promise<string | null> {
    try {
      const status = await this.metricsService.getSyncStatus('consumption');
      return status.finishedAt || status.startedAt || null;
    } catch {
      return null;
    }
  }

  private async hydrateManualLines(): Promise<void> {
    try {
      const databaseLines = await this.manualInvestmentsRepository.findAll();
      this.manualLines = new Map(databaseLines.map((line) => [line.id, line]));
      this.manualLinesHydrated = true;
    } catch {
      this.manualLinesHydrated = false;
      throw new ServiceUnavailableException('No se pudieron cargar las inversiones');
    }
  }

  private async persistManualLine(line: ManualInvestmentLine): Promise<void> {
    try {
      const persisted = await this.manualInvestmentsRepository.upsert(line);
      if (!persisted) throw new Error('Database is not configured');
    } catch {
      throw new ServiceUnavailableException('No se pudo persistir la inversión manual');
    }
  }

  private async persistConsumptionSnapshots(builtLines: Array<{
    line: InvestmentLine;
    sourceLine: ManualInvestmentLine;
    hasMonthlyMetrics: boolean;
    hasDailyMetrics: boolean;
  }>): Promise<void> {
    const now = new Date().toISOString();

    await Promise.all(builtLines.map(async (builtLine) => {
      if (!builtLine.hasMonthlyMetrics && !builtLine.hasDailyMetrics) return;

      const nextLine: ManualInvestmentLine = {
        ...builtLine.sourceLine,
        lastConsumo: builtLine.hasMonthlyMetrics ? builtLine.line.consumo : builtLine.sourceLine.lastConsumo || 0,
        lastConsumoDia: builtLine.hasDailyMetrics ? builtLine.line.consumoDia : builtLine.sourceLine.lastConsumoDia || 0,
        ...this.getTodayConsumptionSnapshot(builtLine.sourceLine),
        lastConsumoUpdatedAt: now
      };

      if (
        nextLine.lastConsumo === (builtLine.sourceLine.lastConsumo || 0)
        && nextLine.lastConsumoDia === (builtLine.sourceLine.lastConsumoDia || 0)
        && nextLine.lastConsumoHoy === (builtLine.sourceLine.lastConsumoHoy || 0)
        && nextLine.lastConsumoHoyDate === (builtLine.sourceLine.lastConsumoHoyDate || null)
      ) {
        return;
      }

      try {
        await this.manualInvestmentsRepository.updateConsumptionSnapshot(nextLine.id, {
          lastConsumo: nextLine.lastConsumo || 0,
          lastConsumoDia: nextLine.lastConsumoDia || 0,
          lastConsumoHoy: nextLine.lastConsumoHoy || 0,
          lastConsumoHoyDate: nextLine.lastConsumoHoyDate || null,
          lastConsumoUpdatedAt: nextLine.lastConsumoUpdatedAt || now
        });
        this.manualLines.set(nextLine.id, nextLine);
      } catch {
        // The control view should still render even if the snapshot persistence fails.
      }
    }));
  }

  private async persistManualLog(action: 'CREATED' | 'UPDATED' | 'DELETED', line: ManualInvestmentLine, user?: AuthUser): Promise<void> {
    try {
      await this.manualInvestmentsRepository.insertLog(action, line, user);
    } catch {
      throw new ServiceUnavailableException('Could not persist manual investment log');
    }
  }

  private async deleteManualLinesFromDatabase(ids: string[]): Promise<{ deletedCount: number; deletedIds: string[] } | null> {
    try {
      return await this.manualInvestmentsRepository.deleteMany(ids);
    } catch {
      throw new ServiceUnavailableException('Could not delete manual investments');
    }
  }
}
