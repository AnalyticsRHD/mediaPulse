import { ConflictException, ForbiddenException, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import jwt, { SignOptions } from 'jsonwebtoken';
import { ConfigService } from '../../config/config.service';
import { MetricsService } from '../metrics/metrics.service';
import { AuthRepository } from './auth.repository';
import { AuthUser } from './auth.types';
import { CreateUserDto } from './dto/create-user.dto';

type JwtPayload = {
  sub: string;
  name: string;
  email: string;
  role: AuthUser['role'];
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly authRepository: AuthRepository,
    private readonly configService: ConfigService,
    private readonly metricsService: MetricsService
  ) {}

  async login(email: string, password: string): Promise<{ token: string; user: AuthUser }> {
    const user = await this.authRepository.findUserByEmail(email);
    if (!user || !this.matchesPassword(password, user.password_hash)) {
      throw new UnauthorizedException('Credenciales invalidas');
    }

    const authUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    };
    const token = this.signToken(authUser);
    this.syncConsumptionAfterLogin(authUser);

    return {
      token,
      user: authUser
    };
  }

  async getUserFromAuthorization(authorization?: string): Promise<AuthUser | null> {
    const token = this.extractBearerToken(authorization);
    if (!token) return null;

    try {
      const payload = jwt.verify(token, this.configService.jwtSecret) as JwtPayload;
      if (!payload.sub) return null;

      return this.authRepository.findUserById(payload.sub);
    } catch {
      return null;
    }
  }

  async requireUser(authorization?: string): Promise<AuthUser> {
    const user = await this.getUserFromAuthorization(authorization);
    if (!user) throw new UnauthorizedException('Sesion requerida');
    return user;
  }

  async requireManualEditor(authorization?: string): Promise<AuthUser> {
    const user = await this.requireUser(authorization);
    if (!['ADMIN', 'MEDIA'].includes(user.role)) {
      throw new ForbiddenException('Solo ADMIN o MEDIA puede modificar cargas manuales');
    }

    return user;
  }

  async requireAdmin(authorization?: string): Promise<AuthUser> {
    const user = await this.requireUser(authorization);
    if (user.role !== 'ADMIN') {
      throw new ForbiddenException('Solo ADMIN puede acceder a Gestion');
    }

    return user;
  }

  async createUser(dto: CreateUserDto, authorization?: string): Promise<AuthUser> {
    const usersCount = await this.authRepository.countActiveUsers();
    try {
      return await this.authRepository.createUser({
        name: dto.name.trim(),
        email: dto.email.trim(),
        passwordHash: this.sha256(dto.password),
        role: dto.role
      });
    } catch (error: any) {
      if (error?.code === '23505') throw new ConflictException('El email ya existe');
      throw new ServiceUnavailableException('No se pudo crear el usuario');
    }
  }

  private extractBearerToken(authorization?: string): string {
    if (!authorization) return '';
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() || '';
  }

  private signToken(user: AuthUser): string {
    return jwt.sign(
      {
        name: user.name,
        email: user.email,
        role: user.role
      },
      this.configService.jwtSecret,
      {
        subject: user.id,
        expiresIn: this.configService.jwtExpiresIn as SignOptions['expiresIn']
      }
    );
  }

  private syncConsumptionAfterLogin(user: AuthUser): void {
    void this.metricsService.syncMonthlyAndDaily('all')
      .then((result) => {
        this.logger.log(`Consumption sync after login for ${user.email}: ${result.totalSynced} rows`);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Consumption sync after login failed for ${user.email}: ${message}`);
      });
  }

  private matchesPassword(password: string, storedHash: string): boolean {
    const stored = storedHash.trim();
    const hashed = this.sha256(password);

    if (stored.length === hashed.length && this.safeEqual(stored, hashed)) return true;
    return this.safeEqual(stored, password);
  }

  private safeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    if (leftBuffer.length !== rightBuffer.length) return false;
    return timingSafeEqual(leftBuffer, rightBuffer);
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
