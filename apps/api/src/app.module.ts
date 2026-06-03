import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ForecastModule } from './modules/forecast/forecast.module';
import { ControlModule } from './modules/control/control.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { ConfigModule } from './config/config.module';
import { AirtableModule } from './common/airtable/airtable.module';
import { ExternalApisModule } from './common/external-apis/external-apis.module';
import { IngestionsSchedulerModule } from './common/ingestionsScheduler/ingestionsScheduler.module';
import { InvestmentsModule } from './modules/investments/investments.module';
import { BrandMappingModule } from './common/brand-mapping/brand-mapping.module';

@Module({
  imports: [
    ConfigModule,
    BrandMappingModule,
    AirtableModule,
    ExternalApisModule,
    IngestionsSchedulerModule,
    ForecastModule,
    ControlModule,
    MetricsModule,
    InvestmentsModule
  ],
  controllers: [AppController],
  providers: [AppService]
})
export class AppModule {}
