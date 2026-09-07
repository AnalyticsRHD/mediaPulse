import { Controller, Get, Param, ParseUUIDPipe, Post, Req, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { UserRole } from '../auth/auth.types';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { MaintenanceService } from './maintenance.service';

@ApiTags('Mantenimiento')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('maintenance/backups')
export class MaintenanceController {
  constructor(private readonly service: MaintenanceService) {}

  private file(createdAt: string, buffer: Buffer) {
    const month = new Intl.DateTimeFormat('es', { month: 'long', timeZone: 'UTC' }).format(new Date(createdAt)).toUpperCase();
    return new StreamableFile(buffer, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="Media-pulse-${month}.xlsx"`, length: buffer.length });
  }

  @Post(':id/cleanup')
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @ApiOperation({ summary: 'Respaldar las cuatro tablas y conservar el mes actual y los dos anteriores (UTC). ID UUID único por operación.' })
  async run(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Req() request: AuthenticatedRequest) {
    const result = await this.service.run(id, request.user!.id);
    return this.file(result.createdAt, result.excel);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Consultar estado, corte, conteos y hashes de un respaldo' })
  status(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.service.status(id); }

  @Get(':id/download')
  @ApiOperation({ summary: 'Volver a descargar un respaldo sin borrar datos' })
  async download(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const status = await this.service.status(id);
    return this.file(status.createdAt, await this.service.download(id));
  }
}
