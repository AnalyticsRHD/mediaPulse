import { forwardRef, Module } from '@nestjs/common';
import { MetricsModule } from '../metrics/metrics.module';
import { InvestmentsController } from './investments.controller';
import { InvestmentsService } from './investments.service';
import { ManualInvestmentsRepository } from './manual-investments.repository';

@Module({
  imports: [forwardRef(() => MetricsModule)],
  controllers: [InvestmentsController],
  providers: [InvestmentsService, ManualInvestmentsRepository],
  exports: [InvestmentsService]
})
export class InvestmentsModule {}
