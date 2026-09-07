import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import figlet from 'figlet';

import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { SWAGGER_TAGS } from './common/swagger/swagger-tags';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  app.enableCors();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('MediaPulse RHD API')
    .setDescription(
      'API para inversiones, usuarios, consumo y carga manual.',
    )
    .setVersion('0.0.1')
    .addBearerAuth()
    .addTag(SWAGGER_TAGS.SYSTEM, 'Estado y operación general de la API.')
    .addTag(SWAGGER_TAGS.AUTH, 'Inicio de sesión y sesión autenticada.')
    .addTag(SWAGGER_TAGS.USERS, 'Administración de usuarios y permisos.')
    .addTag(
      SWAGGER_TAGS.ADVERTISERS_AND_BRANDS,
      'Administración de anunciantes, marcas y cuentas publicitarias.',
    )
    .addTag(
      SWAGGER_TAGS.CREDIT_ALLOC,
      'Gestión y sincronización de asignaciones de crédito.',
    )
    .addTag(SWAGGER_TAGS.INVESTMENTS, 'Consulta de inversiones publicitarias.')
    .addTag(SWAGGER_TAGS.MANUAL_ENTRY, 'Carga y ajuste manual de inversiones.')
    .addTag(SWAGGER_TAGS.METRICS, 'Consulta y administración de métricas.')
    .addTag(
      SWAGGER_TAGS.SYNCHRONIZATION,
      'Procesos de sincronización e importación de datos.',
    )
    .addTag(SWAGGER_TAGS.FORECAST, 'Administración de proyecciones.')
    .addTag(SWAGGER_TAGS.CONTROL, 'Control y seguimiento mensual.')
    .addTag(
      SWAGGER_TAGS.TIKTOK_INTEGRATION,
      'Autorización e integración con TikTok Ads.',
    )
    .build();

  const swaggerDocument = SwaggerModule.createDocument(
    app,
    swaggerConfig,
  );

  SwaggerModule.setup(
    'api/docs',
    app,
    swaggerDocument,
  );

  process.on('unhandledRejection', (reason) => {
    logger.error(
      'Unhandled promise rejection',
      reason instanceof Error ? reason.stack : String(reason),
    );
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', error.stack);
  });

  const port = process.env.PORT || process.env.API_PORT || 3333;

  await app.listen(port);

  const banner = figlet.textSync('RHD', {
    font: 'ANSI Shadow',
    horizontalLayout: 'full',
  });

  const terminalWidth = process.stdout.columns || 120;

  const centeredBanner = banner
    .split('\n')
    .map(
      (line) =>
        ' '.repeat(
          Math.max(
            0,
            Math.floor((terminalWidth - line.length) / 2),
          ),
        ) + line,
    )
    .join('\n');

  console.log('\x1b[32m');
  console.log(centeredBanner);
  console.log(
    '\n' +
      ' '.repeat(Math.max(0, Math.floor((terminalWidth - 20) / 2))) +
      '🚀 RHD Backend API',
  );
  console.log(
    ' '.repeat(Math.max(0, Math.floor((terminalWidth - 35) / 2))) +
      `🌐 http://localhost:${port}/api/docs`,
  );
  console.log('\x1b[0m');
}

bootstrap();
