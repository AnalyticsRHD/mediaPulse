import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';
import { SWAGGER_TAGS } from './common/swagger/swagger-tags';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('health')
  @ApiTags(SWAGGER_TAGS.SYSTEM)
  health() {
    return this.appService.health();
  }

  @Get('tiktok/callback')
  @ApiTags(SWAGGER_TAGS.TIKTOK_INTEGRATION)
  @Header('Cache-Control', 'no-store')
  tiktokCallback(
    @Query('auth_code') authCode?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
    @Query('error_description') errorDescription?: string
  ) {
    if (error) {
      return {
        status: 'error',
        error,
        message: errorDescription || 'TikTok no autorizo la aplicacion'
      };
    }

    if (!authCode) {
      return {
        status: 'ready',
        message: 'Callback de TikTok operativo. Falta iniciar la autorizacion.'
      };
    }

    return {
      status: 'authorized',
      message: 'Codigo de autorizacion recibido. Copialo para generar el access token.',
      authCode,
      state: state || null
    };
  }
}
