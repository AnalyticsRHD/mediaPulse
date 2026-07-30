import { Module } from '@nestjs/common';
import { ExternalApisService } from './external-apis.service';
import { MercadoLibreOAuthRepository } from './mercado-libre-oauth.repository';

@Module({
  providers: [ExternalApisService, MercadoLibreOAuthRepository],
  exports: [ExternalApisService]
})
export class ExternalApisModule {}
