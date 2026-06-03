import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AirtableModule } from '../airtable/airtable.module';
import { ExternalApisModule } from '../external-apis/external-apis.module';
import { MetricsModule } from '../../modules/metrics/metrics.module';
import { IngestionsSchedulerService } from './ingestionsScheduler.service';

@Module({
  imports: [ScheduleModule.forRoot(), MetricsModule, ExternalApisModule, AirtableModule],
  providers: [IngestionsSchedulerService],
  exports: [IngestionsSchedulerService]
})
export class IngestionsSchedulerModule {}
