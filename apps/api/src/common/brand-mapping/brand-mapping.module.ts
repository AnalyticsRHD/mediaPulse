import { Global, Module } from '@nestjs/common';
import { BrandMappingController } from './brand-mapping.controller';
import { BrandMappingService } from './brand-mapping.service';

@Global()
@Module({
  controllers: [BrandMappingController],
  providers: [BrandMappingService],
  exports: [BrandMappingService]
})
export class BrandMappingModule {}
