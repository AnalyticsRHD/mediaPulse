import { Module } from '@nestjs/common';
import { MetricsModule } from '../metrics/metrics.module';
import { InvestmentsController } from './investments.controller';
import { InvestmentsService } from './investments.service';

@Module({
  imports: [MetricsModule],
  controllers: [InvestmentsController],
  providers: [InvestmentsService],
  exports: [InvestmentsService]
})
export class InvestmentsModule {}
