import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { InvestmentsService } from './investments.service';
import { ManualInvestmentDto } from './dto/manual-investment.dto';

@Controller('investments')
export class InvestmentsController {
  constructor(private readonly investmentsService: InvestmentsService) {}

  @Get()
  getInvestments(
    @Query('mes') mes?: string,
    @Query('date') date?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('includeDrafts') includeDrafts?: string
  ) {
    return this.investmentsService.findAll(mes, date, startDate, endDate, includeDrafts === 'true');
  }

  @Get('manual')
  getManualLines(@Query('mes') mes?: string) {
    return this.investmentsService.getManualLines(mes);
  }

  @Post('manual')
  createManualLine(@Body() dto: ManualInvestmentDto) {
    return this.investmentsService.createManualLine(dto);
  }

  @Patch('manual/:id/presupuesto')
  async updateManualBudget(@Param('id') id: string, @Body('presupuesto') presupuesto: number) {
    const updated = await this.investmentsService.updateManualBudget(id, presupuesto);
    if (!updated) throw new NotFoundException('Manual investment line not found');
    return updated;
  }

  @Patch('manual/:id')
  async updateManualLine(@Param('id') id: string, @Body() dto: Partial<ManualInvestmentDto>) {
    const updated = await this.investmentsService.updateManualLine(id, dto);
    if (!updated) throw new NotFoundException('Manual investment line not found');
    return updated;
  }

  @Delete('manual')
  deleteManualLines(@Body('ids') ids: string[]) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException('ids must be a non-empty array');
    }

    return this.investmentsService.deleteManualLines(ids);
  }
}
