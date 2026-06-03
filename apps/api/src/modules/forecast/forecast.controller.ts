import { Controller, Get, Post, Put, Delete, Param, Body } from '@nestjs/common';
import { ForecastService } from './forecast.service';
import { CreateForecastDetailDto, UpdateForecastDetailDto } from './dto/create-forecast-detail.dto';

@Controller('forecast')
export class ForecastController {
  constructor(private readonly forecastService: ForecastService) {}

  @Get()
  getAll() {
    return this.forecastService.findAll();
  }

  @Get('overview')
  getOverview() {
    return this.forecastService.getOverview();
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.forecastService.findById(id);
  }

  @Get('client/:cliente/month/:mes')
  getByClientAndMonth(@Param('cliente') cliente: string, @Param('mes') mes: string) {
    return this.forecastService.findByClientAndMonth(cliente, mes);
  }

  @Post()
  create(@Body() dto: CreateForecastDetailDto) {
    return this.forecastService.create(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateForecastDetailDto) {
    return this.forecastService.update(id, dto);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    const deleted = this.forecastService.delete(id);
    return { deleted };
  }
}
