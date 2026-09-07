import { Controller, Get, Post, Put, Delete, Param, Body } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SWAGGER_TAGS } from '../../common/swagger/swagger-tags';
import { ControlService } from './control.service';
import { CreateMonthlyControlDto, UpdateMonthlyControlDto } from './dto/create-monthly-control.dto';

@ApiTags(SWAGGER_TAGS.CONTROL)
@Controller('control')
export class ControlController {
  constructor(private readonly controlService: ControlService) {}

  @Get()
  getAll() {
    return this.controlService.findAll();
  }

  @Get('health')
  getControlStatus() {
    return this.controlService.getMonthlyStatus();
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.controlService.findById(id);
  }

  @Get('client/:clientId/month/:month')
  getByClientAndMonth(@Param('clientId') clientId: string, @Param('month') month: string) {
    return this.controlService.findByClientAndMonth(clientId, month);
  }

  @Post()
  create(@Body() dto: CreateMonthlyControlDto) {
    return this.controlService.create(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateMonthlyControlDto) {
    return this.controlService.update(id, dto);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    const deleted = this.controlService.delete(id);
    return { deleted };
  }
}
