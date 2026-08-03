import { forwardRef, Module } from '@nestjs/common';
import { MetricsModule } from '../metrics/metrics.module';
import { InvestmentsController } from './investments.controller';
import { InvestmentsService } from './investments.service';
import { ManualInvestmentsRepository } from './manual-investments.repository';
import { ExternalApisModule } from '../../common/external-apis/external-apis.module';
import { CreditAllocationsRepository } from './credit-allocations.repository';

@Module({
  imports: [forwardRef(() => MetricsModule), ExternalApisModule],
  controllers: [InvestmentsController],
  providers: [InvestmentsService, ManualInvestmentsRepository, CreditAllocationsRepository],
  exports: [InvestmentsService]
})
export class InvestmentsModule {}
