import { Global, Module } from '@nestjs/common';
import { BrandMappingController } from './brand-mapping.controller';
import { BrandMappingService } from './brand-mapping.service';
import { BrandMappingRepository } from './brand-mapping.repository';

@Global()
@Module({
  controllers: [BrandMappingController],
  providers: [BrandMappingService, BrandMappingRepository],
  exports: [BrandMappingService]
})
export class BrandMappingModule {}
