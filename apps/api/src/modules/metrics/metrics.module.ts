import { Module } from '@nestjs/common';
import { ExternalApisModule } from '../../common/external-apis/external-apis.module';
import { ManualInvestmentsRepository } from '../investments/manual-investments.repository';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

@Module({
  imports: [ExternalApisModule],
  controllers: [MetricsController],
  providers: [MetricsService, ManualInvestmentsRepository],
  exports: [MetricsService]
})
export class MetricsModule {}
