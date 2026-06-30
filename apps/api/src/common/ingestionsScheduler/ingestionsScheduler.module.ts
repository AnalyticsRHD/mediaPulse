import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ExternalApisModule } from '../external-apis/external-apis.module';
import { MetricsModule } from '../../modules/metrics/metrics.module';
import { IngestionsSchedulerService } from './ingestionsScheduler.service';

@Module({
  imports: [ScheduleModule.forRoot(), MetricsModule, ExternalApisModule],
  providers: [IngestionsSchedulerService],
  exports: [IngestionsSchedulerService]
})
export class IngestionsSchedulerModule {}
