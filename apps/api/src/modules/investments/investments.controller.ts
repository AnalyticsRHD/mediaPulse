import { BadRequestException, Body, Controller, Delete, Get, Headers, Logger, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { InvestmentsService } from './investments.service';
import { ManualInvestmentDto } from './dto/manual-investment.dto';
import { AuthService } from '../auth/auth.service';
import { ExternalApisService } from '../../common/external-apis/external-apis.service';
import { CreditAllocationsRepository } from './credit-allocations.repository';

@Controller('investments')
export class InvestmentsController {
  private readonly logger = new Logger(InvestmentsController.name);
  private creditAllocationSyncPromise: Promise<void> | null = null;
  private creditAllocationSyncStartedAt: string | null = null;
  private creditAllocationSyncFinishedAt: string | null = null;

  constructor(
    private readonly investmentsService: InvestmentsService,
    private readonly authService: AuthService,
    private readonly externalApisService: ExternalApisService,
    private readonly creditAllocationsRepository: CreditAllocationsRepository
  ) {}

  @Get('management/credit-allocations')
  async getCreditAllocations(
    @Headers('authorization') authorization?: string,
    @Query('page') pageValue?: string,
    @Query('limit') limitValue?: string,
    @Query('platform') platform = ''
  ) {
    await this.authService.requireAdmin(authorization);
    const page = Math.max(1, Number(pageValue) || 1);
    const limit = Math.min(100, Math.max(1, Number(limitValue) || 30));
    const cachedPage = await this.creditAllocationsRepository.findPage(page, limit, platform);
    if (cachedPage.total > 0) return cachedPage;
    this.startCreditAllocationSync();
    return { ...cachedPage, syncing: true };
  }

  @Get('management/credit-allocations/sync-status')
  async getCreditAllocationSyncStatus(@Headers('authorization') authorization?: string) {
    await this.authService.requireAdmin(authorization);
    return {
      running: Boolean(this.creditAllocationSyncPromise),
      startedAt: this.creditAllocationSyncStartedAt,
      finishedAt: this.creditAllocationSyncFinishedAt
    };
  }

  @Post('management/credit-allocations/sync')
  async syncCreditAllocations(
    @Headers('authorization') authorization?: string,
    @Query('page') pageValue?: string,
    @Query('limit') limitValue?: string,
    @Query('platform') platform = ''
  ) {
    await this.authService.requireAdmin(authorization);
    this.startCreditAllocationSync();
    const page = Math.max(1, Number(pageValue) || 1);
    const limit = Math.min(100, Math.max(1, Number(limitValue) || 30));
    const cachedPage = await this.creditAllocationsRepository.findPage(page, limit, platform);
    return { ...cachedPage, syncing: true };
  }

  private startCreditAllocationSync(): void {
    if (this.creditAllocationSyncPromise) return;
    this.creditAllocationSyncStartedAt = new Date().toISOString();
    this.creditAllocationSyncFinishedAt = null;
    const platforms = ['meta', 'google', 'tiktok'] as const;

    this.creditAllocationSyncPromise = Promise.allSettled(platforms.map(async (platform) => {
      this.logger.log(`Credit Alloc ${platform} sync started`);
      const rows = await this.externalApisService.fetchCreditAllocationsForPlatform(platform);
      if (rows.length > 0) await this.creditAllocationsRepository.upsertAll(rows);
      this.logger.log(`Credit Alloc ${platform} sync finished: ${rows.length} rows`);
    })).then((results) => {
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          const error = result.reason instanceof Error ? result.reason.message : String(result.reason);
          this.logger.error(`Credit Alloc ${platforms[index]} sync failed: ${error}`);
        }
      });
    }).finally(() => {
      this.creditAllocationSyncFinishedAt = new Date().toISOString();
      this.creditAllocationSyncPromise = null;
    });
  }

  @Patch('management/credit-allocations/:platform/:accountId/date')
  async updateCreditAllocationDate(
    @Param('platform') platform: string,
    @Param('accountId') accountId: string,
    @Body() body: { date?: string },
    @Headers('authorization') authorization?: string
  ) {
    await this.authService.requireAdmin(authorization);
    const date = String(body?.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
      throw new BadRequestException('Fecha invalida');
    }
    const updated = await this.creditAllocationsRepository.updateManualDate(platform, accountId, date);
    if (!updated) throw new NotFoundException('Cuenta de Credit Alloc no encontrada');
    return updated;
  }

  @Get()
  getInvestments(
    @Query('mes') mes?: string,
    @Query('date') date?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('includeDrafts') includeDrafts?: string,
    @Query('mode') mode?: 'thisMonth' | 'today' | 'yesterday' | 'previousMonth' | 'custom'
  ) {
    return this.investmentsService.findAll(mes, date, startDate, endDate, includeDrafts === 'true', mode);
  }

  @Get('manual')
  getManualLines(@Query('mes') mes?: string) {
    return this.investmentsService.getManualLines(mes);
  }

  @Get('manual/:id/history')
  async getManualLineHistory(@Param('id') id: string, @Headers('authorization') authorization?: string) {
    await this.authService.requireUser(authorization);
    const history = await this.investmentsService.getManualLineHistory(id);
    if (!history) throw new NotFoundException('Manual investment line not found');
    return history;
  }

  @Post('manual/:id/deviation-comments')
  async addDeviationComment(
    @Param('id') id: string,
    @Body('comment') comment: string,
    @Headers('authorization') authorization?: string
  ) {
    const user = await this.authService.requireUser(authorization);
    const saved = await this.investmentsService.addDeviationComment(id, comment, user);
    if (!saved) throw new NotFoundException('Manual investment line not found');
    return saved;
  }

  @Post('manual')
  async createManualLine(@Body() dto: ManualInvestmentDto, @Headers('authorization') authorization?: string) {
    const user = await this.authService.requireManualEditor(authorization);
    return this.investmentsService.createManualLine(dto, user);
  }

  @Patch('manual/:id/presupuesto')
  async updateManualBudget(@Param('id') id: string, @Body('presupuesto') presupuesto: number, @Headers('authorization') authorization?: string) {
    const user = await this.authService.requireManualEditor(authorization);
    const updated = await this.investmentsService.updateManualBudget(id, presupuesto, user);
    if (!updated) throw new NotFoundException('Manual investment line not found');
    return updated;
  }

  @Patch('manual/:id')
  async updateManualLine(@Param('id') id: string, @Body() dto: Partial<ManualInvestmentDto>, @Headers('authorization') authorization?: string) {
    const user = await this.authService.requireManualEditor(authorization);
    const updated = await this.investmentsService.updateManualLine(id, dto, user);
    if (!updated) throw new NotFoundException('Manual investment line not found');
    return updated;
  }

  @Delete('manual')
  async deleteManualLines(@Body('ids') ids: string[], @Headers('authorization') authorization?: string) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException('ids must be a non-empty array');
    }

    const user = await this.authService.requireManualEditor(authorization);
    return this.investmentsService.deleteManualLines(ids, user);
  }
}
