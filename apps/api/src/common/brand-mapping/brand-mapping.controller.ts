import { Controller, Get } from '@nestjs/common';
import { Param } from '@nestjs/common';
import { BrandMappingService } from './brand-mapping.service';

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
}
