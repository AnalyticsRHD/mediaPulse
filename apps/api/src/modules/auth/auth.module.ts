import { Global, Module } from '@nestjs/common';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { ConfigModule } from '../../config/config.module';
import { ConfigService } from '../../config/config.service';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { MetricsModule } from '../metrics/metrics.module';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { UsersController } from './users.controller';

@Global()
@Module({
  imports: [
    ConfigModule,
    MetricsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService): JwtModuleOptions => ({
        secret: configService.jwtSecret,
        signOptions: {
          algorithm: 'HS256',
          expiresIn: configService.jwtExpiresIn as NonNullable<JwtModuleOptions['signOptions']>['expiresIn']
        },
        verifyOptions: {
          algorithms: ['HS256']
        }
      })
    })
  ],
  controllers: [AuthController, UsersController],
  providers: [AuthRepository, AuthService, JwtAuthGuard, RolesGuard],
  exports: [AuthService, JwtAuthGuard, RolesGuard]
})
export class AuthModule {}
