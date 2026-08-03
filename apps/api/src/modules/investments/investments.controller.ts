import { BadRequestException, Body, Controller, Delete, Get, Headers, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { InvestmentsService } from './investments.service';
import { ManualInvestmentDto } from './dto/manual-investment.dto';
import { AuthService } from '../auth/auth.service';
import { ExternalApisService } from '../../common/external-apis/external-apis.service';
import { CreditAllocationsRepository } from './credit-allocations.repository';

@Controller('investments')
export class InvestmentsController {
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
    @Query('limit') limitValue?: string
  ) {
    await this.authService.requireAdmin(authorization);
    const page = Math.max(1, Number(pageValue) || 1);
    const limit = Math.min(100, Math.max(1, Number(limitValue) || 30));
    const cachedPage = await this.creditAllocationsRepository.findPage(page, limit);
    if (cachedPage.total > 0) return cachedPage;
    const fetched = await this.externalApisService.fetchMetaCreditAllocations();
    await this.creditAllocationsRepository.upsertAll(fetched);
    return this.creditAllocationsRepository.findPage(page, limit);
  }

  @Post('management/credit-allocations/sync')
  async syncCreditAllocations(
    @Headers('authorization') authorization?: string,
    @Query('page') pageValue?: string,
    @Query('limit') limitValue?: string
  ) {
    await this.authService.requireAdmin(authorization);
    const fetched = await this.externalApisService.fetchMetaCreditAllocations();
    await this.creditAllocationsRepository.upsertAll(fetched);
    const page = Math.max(1, Number(pageValue) || 1);
    const limit = Math.min(100, Math.max(1, Number(limitValue) || 30));
    return this.creditAllocationsRepository.findPage(page, limit);
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
