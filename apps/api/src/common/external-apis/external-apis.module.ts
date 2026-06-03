import { Module } from '@nestjs/common';
import { ExternalApisService } from './external-apis.service';

@Module({
  providers: [ExternalApisService],
  exports: [ExternalApisService]
})
export class ExternalApisModule {}
