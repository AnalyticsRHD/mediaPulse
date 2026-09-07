import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../modules/auth/guards/roles.guard';
import { Roles } from '../../modules/auth/roles.decorator';
import { UserRole } from '../../modules/auth/auth.types';
import { SWAGGER_TAGS } from '../swagger/swagger-tags';
import { BrandMappingService } from './brand-mapping.service';
import { CreateBrandMappingDto } from './dto/create-brand-mapping.dto';
import { BrandMappingWithAccounts } from './brand-mapping.types';
import { CreateApiAccountDto, CreateApiAccountsBatchDto } from './dto/create-api-account.dto';
import { ApiBody } from '@nestjs/swagger';

@ApiTags(SWAGGER_TAGS.ADVERTISERS_AND_BRANDS)
@Controller('brand-mapping')
export class BrandMappingController {
  constructor(private readonly brandMappingService: BrandMappingService) {}

  @Get()
  async getAll() {
    return this.brandMappingService.getAll();
  }

  @Get('clients')
  async getClients() {
    return this.brandMappingService.getClients();
  }

  @Get('clients/:cliente/brands')
  async getBrandsByClient(@Param('cliente') cliente: string) {
    return this.brandMappingService.getBrandsByClient(cliente);
  }

  @Get('management')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar anunciantes, marcas y cuentas para gestion' })
  getManagementMappings(): Promise<BrandMappingWithAccounts[]> {
    return this.brandMappingService.getManagementMappings();
  }

  @Get('api-accounts')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  getApiAccounts() { return this.brandMappingService.getApiAccounts(); }

  @Post('api-accounts')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  createApiAccount(@Body() dto: CreateApiAccountDto) { return this.brandMappingService.createApiAccount(dto); }

  @Post('api-accounts/:target')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cargar cuentas API por plataforma' })
  @ApiParam({
    name: 'target',
    enum: ['meta', 'google', 'tiktok', 'mercado-libre'],
    example: 'meta',
    description: 'Plataforma de las cuentas a cargar'
  })
  @ApiBody({ type: CreateApiAccountsBatchDto })
  createApiAccounts(
    @Param('target') target: string,
    @Body() dto: CreateApiAccountsBatchDto
  ) {
    return this.brandMappingService.createApiAccounts(target, dto);
  }

  @Patch('api-accounts/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  updateApiAccount(@Param('id') id: string, @Body() dto: Partial<CreateApiAccountDto>) { return this.brandMappingService.updateApiAccount(id, dto); }

  @Patch('api-accounts/:id/enabled')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  toggleApiAccount(@Param('id') id: string, @Body('enabled') enabled: boolean) { return this.brandMappingService.updateApiAccount(id, { enabled: enabled === true }); }

  @Delete('api-accounts/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  deleteApiAccount(@Param('id') id: string) { return this.brandMappingService.deleteApiAccount(id); }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Crear un anunciante/marca' })
  async create(@Body() dto: CreateBrandMappingDto) {
    return this.brandMappingService.create(dto);
  }

  @Patch(':id/suspension')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Suspender o reactivar una relación de anunciante' })
  setSuspension(@Param('id') id: string, @Body('suspended') suspended: boolean) {
    return this.brandMappingService.setSuspended(id, suspended === true);
  }
}
