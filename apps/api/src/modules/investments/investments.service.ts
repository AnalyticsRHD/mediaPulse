import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InvestmentCurrency, InvestmentLine, InvestmentStatus, InvestmentsResponse, ManualInvestmentLine } from '@mediapulse/shared';
import { v4 as uuidv4 } from 'uuid';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { MetricsService } from '../metrics/metrics.service';
import { ManualInvestmentDto } from './dto/manual-investment.dto';
import { BrandMappingService } from '../../common/brand-mapping/brand-mapping.service';
import { ManualInvestmentsRepository } from './manual-investments.repository';

@Injectable()
export class InvestmentsService {
  private manualLines = new Map<string, ManualInvestmentLine>();
  private readonly manualLinesDir = join(__dirname, '../../../data');
  private readonly manualLinesPath = join(this.manualLinesDir, 'manual-investments.json');
  private manualLinesHydrated = false;

  constructor(
    private readonly metricsService: MetricsService,
    private readonly brandMappingService: BrandMappingService,
    private readonly manualInvestmentsRepository: ManualInvestmentsRepository
  ) {
    this.loadManualLines();
  }

  async findAll(
    mes = this.currentMonth(),
    date = this.getYesterdayDate(),
    startDate = date,
    endDate = date,
    includeDrafts = false
  ): Promise<InvestmentsResponse> {
    await this.hydrateManualLines();
    const safeStartDate = this.ensureDate(startDate, 'startDate');
    const safeEndDate = this.ensureDate(endDate, 'endDate');
    const resolvedMes = this.ensureMonth(mes || safeStartDate.slice(0, 7), 'mes');
    const rangeEndDate = safeEndDate || safeStartDate || date;
    const rangeStartDate = safeStartDate || rangeEndDate;
    if (rangeStartDate > rangeEndDate) {
      throw new BadRequestException('startDate must be before or equal to endDate');
    }
    const days = this.daysInMonth(resolvedMes);
    const diasRestantes = this.getRemainingDays(resolvedMes, rangeEndDate);
    const ritmo = days > 0 ? this.getElapsedDays(resolvedMes, rangeEndDate) / days : 0;
    const lines = Array.from(this.manualLines.values())
      .filter((line) => line.mes === resolvedMes)
      .filter((line) => includeDrafts || line.status === InvestmentStatus.PRESUPUESTO_OK)
      .sort((a, b) => this.sortManualLines(a, b));
    const totalBudget = lines.reduce((sum, line) => sum + line.presupuesto, 0);
    const investmentLines = lines.map((line) => this.toInvestmentLine(line, totalBudget, days, diasRestantes, ritmo, rangeStartDate, rangeEndDate));
    const consumoTotal = investmentLines.reduce((sum, line) => sum + line.consumo, 0);

    return {
      summary: {
        mes: resolvedMes,
        date: rangeEndDate,
        startDate: rangeStartDate,
        endDate: rangeEndDate,
        dias: days,
        diasRestantes,
        ritmo,
        presupuestoPlanificado: totalBudget,
        consumoTotal,
        restante: totalBudget - consumoTotal,
        completion: totalBudget > 0 ? consumoTotal / totalBudget : 0
      },
      lines: investmentLines
    };
  }

  async createManualLine(dto: ManualInvestmentDto): Promise<ManualInvestmentLine> {
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
      mes: this.currentMonth(),
      plataforma: this.normalizePlatform(dto.plataforma)
    };

    this.manualLines.set(line.id, line);
    await this.persistManualLine(line);
    return line;
  }

  async updateManualBudget(id: string, presupuesto: number): Promise<ManualInvestmentLine | null> {
    return this.updateManualLine(id, { presupuesto });
  }

  async deleteManualLines(ids: string[]): Promise<{ deletedCount: number; deletedIds: string[] }> {
    await this.hydrateManualLines();
    const databaseResult = await this.deleteManualLinesFromDatabase(ids);
    if (databaseResult) {
      databaseResult.deletedIds.forEach((id) => this.manualLines.delete(id));
      return databaseResult;
    }

    const deletedIds = ids.filter((id) => this.manualLines.delete(id));
    if (deletedIds.length > 0) {
      this.persistManualLines();
    }

    return {
      deletedCount: deletedIds.length,
      deletedIds
    };
  }

  async updateManualLine(id: string, dto: Partial<ManualInvestmentDto>): Promise<ManualInvestmentLine | null> {
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
      presupuesto: dto.presupuesto != null ? Number(dto.presupuesto) : existing.presupuesto,
      costoPorResultado: dto.costoPorResultado != null ? Number(dto.costoPorResultado) : existing.costoPorResultado,
      tktPromedio: dto.tktPromedio != null ? Number(dto.tktPromedio) : existing.tktPromedio
    };

    this.manualLines.set(id, updated);
    await this.persistManualLine(updated);
    return updated;
  }

  async getManualLines(mes?: string): Promise<ManualInvestmentLine[]> {
    await this.hydrateManualLines();
    const lines = Array.from(this.manualLines.values());
    const filtered = mes ? lines.filter((line) => line.mes === mes) : lines;
    return filtered.sort((a, b) => this.sortManualLines(a, b));
  }

  private toInvestmentLine(line: ManualInvestmentLine, totalBudget: number, days: number, diasRestantes: number, ritmo: number, startDate: string, endDate: string): InvestmentLine {
    const consumo = this.getConsumption(line);
    const consumoDia = this.getDateRangeConsumption(line, startDate, endDate);
    const share = totalBudget > 0 ? line.presupuesto / totalBudget : 0;
    const porcentajeConsumo = line.presupuesto > 0 ? consumo / line.presupuesto : 0;
    const resultadosProyectados = this.getProjectedResults(line);

    return {
      ...line,
      consumo,
      consumoDia,
      consumoAyer: consumoDia,
      presupuestoDaily: days > 0 ? line.presupuesto / days : 0,
      nuevoPresupuestoDiario: diasRestantes > 0 ? (line.presupuesto - consumo) / diasRestantes : 0,
      share,
      resultadosProyectados,
      fcProyectada: this.isSalesObjective(line.objetivo) ? resultadosProyectados * line.tktPromedio : 0,
      consumoRestante: line.presupuesto - consumo,
      porcentajeConsumo,
      desvio: porcentajeConsumo - ritmo
    };
  }

  private getConsumption(line: ManualInvestmentLine): number {
    const lineClient = this.normalizeReference(line.anunciante);
    const lineBrand = this.normalizeReference(line.marca || line.anunciante);

    return this.safeMetrics()
      .filter((metric) => (
        (metric.granularity || 'daily') === 'monthly'
        && this.normalizeReference(metric.cliente) === lineClient
        && this.normalizeReference(metric.marca) === lineBrand
        && this.normalizePlatform(metric.plataforma) === line.plataforma
        && metric.date.startsWith(line.mes)
      ))
      .reduce((sum, metric) => sum + metric.spend, 0);
  }

  private getDateConsumption(line: ManualInvestmentLine, date: string): number {
    return this.getDateRangeConsumption(line, date, date);
  }

  private getDateRangeConsumption(line: ManualInvestmentLine, startDate: string, endDate: string): number {
    const lineClient = this.normalizeReference(line.anunciante);
    const lineBrand = this.normalizeReference(line.marca || line.anunciante);

    return this.safeMetrics()
      .filter((metric) => (
        (metric.granularity || 'daily') === 'daily'
        && this.normalizeReference(metric.cliente) === lineClient
        && this.normalizeReference(metric.marca) === lineBrand
        && this.normalizePlatform(metric.plataforma) === line.plataforma
        && metric.date >= startDate
        && metric.date <= endDate
      ))
      .reduce((sum, metric) => sum + metric.spend, 0);
  }

  private normalizePlatform(platform: string): string {
    const value = platform.trim().toLowerCase();
    if (value === 'meta' || value === 'facebook ads' || value === 'facebook') return 'META';
    if (value === 'google' || value === 'google ads') return 'Google';
    if (value === 'merc. libre' || value === 'mercado libre') return 'Merc. Libre';
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
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return date.toISOString().slice(0, 10);
  }

  private currentMonth(): string {
    return new Date().toISOString().slice(0, 7);
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

  private sortManualLines(a: ManualInvestmentLine, b: ManualInvestmentLine): number {
    return [
      a.anunciante.localeCompare(b.anunciante),
      (a.marca || '').localeCompare(b.marca || ''),
      a.moneda.localeCompare(b.moneda),
      a.plataforma.localeCompare(b.plataforma),
      a.objetivo.localeCompare(b.objetivo)
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

  private safeMetrics() {
    try {
      return this.metricsService.findAll();
    } catch {
      return [];
    }
  }

  private async hydrateManualLines(): Promise<void> {
    if (this.manualLinesHydrated) return;
    this.manualLinesHydrated = true;

    try {
      const fileLines = Array.from(this.manualLines.values());
      if (fileLines.length > 0) {
        await this.manualInvestmentsRepository.syncFromFile(fileLines);
      }

      const databaseLines = await this.manualInvestmentsRepository.findAll();
      if (databaseLines.length > 0 || this.manualInvestmentsRepository.enabled) {
        this.manualLines = new Map(databaseLines.map((line) => [line.id, line]));
      }
    } catch {
      this.manualLinesHydrated = false;
      throw new ServiceUnavailableException('Could not load manual investments');
    }
  }

  private loadManualLines(): void {
    try {
      if (!existsSync(this.manualLinesPath)) return;
      const parsed = JSON.parse(readFileSync(this.manualLinesPath, 'utf8')) as ManualInvestmentLine[];
      parsed.forEach((line) => {
        if (line.id) this.manualLines.set(line.id, line);
      });
    } catch {
      this.manualLines.clear();
    }
  }

  private persistManualLines(): void {
    try {
      mkdirSync(this.manualLinesDir, { recursive: true });
      writeFileSync(this.manualLinesPath, JSON.stringify(Array.from(this.manualLines.values()), null, 2));
    } catch {
      throw new ServiceUnavailableException('Could not persist manual investments');
    }
  }

  private async persistManualLine(line: ManualInvestmentLine): Promise<void> {
    try {
      const persisted = await this.manualInvestmentsRepository.upsert(line);
      if (!persisted) this.persistManualLines();
    } catch {
      throw new ServiceUnavailableException('Could not persist manual investment');
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
