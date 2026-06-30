import { forwardRef, Module } from '@nestjs/common';
import { ExternalApisModule } from '../../common/external-apis/external-apis.module';
import { InvestmentsModule } from '../investments/investments.module';
import { ManualInvestmentsRepository } from '../investments/manual-investments.repository';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

@Module({
  imports: [ExternalApisModule, forwardRef(() => InvestmentsModule)],
  controllers: [MetricsController],
  providers: [MetricsService, ManualInvestmentsRepository],
  exports: [MetricsService]
})
export class MetricsModule {}
