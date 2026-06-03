import { Controller, Get } from '@nestjs/common';
import { Param } from '@nestjs/common';
import { BrandMappingService } from './brand-mapping.service';

@Controller('brand-mapping')
export class BrandMappingController {
  constructor(private readonly brandMappingService: BrandMappingService) {}

  @Get()
  getAll() {
    return this.brandMappingService.getAll();
  }

  @Get('clients')
  getClients() {
    return this.brandMappingService.getClients();
  }

  @Get('clients/:cliente/brands')
  getBrandsByClient(@Param('cliente') cliente: string) {
    return this.brandMappingService.getBrandsByClient(cliente);
  }
}
