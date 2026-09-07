import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, timingSafeEqual } from 'crypto';
import { MetricsService } from '../metrics/metrics.service';
import { AuthRepository, LastAdminConflictError } from './auth.repository';
import { AuthUser, UserRole } from './auth.types';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

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
    private readonly jwtService: JwtService,
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
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
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

  async getUsers(): Promise<AuthUser[]> {
    try {
      return await this.authRepository.findAllActiveUsers();
    } catch {
      throw new ServiceUnavailableException('No se pudieron obtener los usuarios');
    }
  }

  async createUser(dto: CreateUserDto): Promise<AuthUser> {
    try {
      return await this.authRepository.createUser({
        name: dto.name.trim(),
        email: dto.email.trim(),
        passwordHash: this.sha256(dto.password),
        role: dto.role
      });
    } catch (error: unknown) {
      if (this.isDatabaseError(error, '23505')) throw new ConflictException('El email ya existe');
      throw new ServiceUnavailableException('No se pudo crear el usuario');
    }
  }

  async updateUser(id: string, dto: UpdateUserDto): Promise<AuthUser> {
    if (
      dto.name === undefined
      && dto.email === undefined
      && dto.password === undefined
      && dto.role === undefined
    ) {
      throw new BadRequestException('Debe enviar al menos name, email, password o role');
    }

    const name = dto.name?.trim();
    if (dto.name !== undefined && !name) {
      throw new BadRequestException('El nombre no puede estar vacio');
    }

    if (dto.role !== undefined && dto.role !== UserRole.ADMIN) {
      let target: AuthUser | null;
      let activeAdmins = 0;

      try {
        target = await this.authRepository.findUserById(id);
        if (target?.role === UserRole.ADMIN) {
          activeAdmins = await this.authRepository.countActiveAdmins();
        }
      } catch {
        throw new ServiceUnavailableException('No se pudo actualizar el usuario');
      }

      if (!target) throw new NotFoundException('Usuario no encontrado');
      if (target.role === UserRole.ADMIN && activeAdmins <= 1) {
        throw new ConflictException('No se puede cambiar el rol del ultimo usuario ADMIN');
      }
    }

    let updated: AuthUser | null;
    try {
      updated = await this.authRepository.updateUser(id, {
        name,
        email: dto.email?.trim(),
        passwordHash: dto.password === undefined ? undefined : this.sha256(dto.password),
        role: dto.role
      });
    } catch (error: unknown) {
      if (error instanceof LastAdminConflictError) {
        throw new ConflictException('No se puede cambiar el rol del ultimo usuario ADMIN');
      }
      if (this.isDatabaseError(error, '23505')) throw new ConflictException('El email ya existe');
      throw new ServiceUnavailableException('No se pudo actualizar el usuario');
    }

    if (!updated) throw new NotFoundException('Usuario no encontrado');
    return updated;
  }

  async deleteUser(id: string): Promise<void> {
    let target: AuthUser | null;
    let activeAdmins = 0;

    try {
      target = await this.authRepository.findUserById(id);
      if (target?.role === 'ADMIN') {
        activeAdmins = await this.authRepository.countActiveAdmins();
      }
    } catch {
      throw new ServiceUnavailableException('No se pudo eliminar el usuario');
    }

    if (!target) throw new NotFoundException('Usuario no encontrado');
    if (target.role === 'ADMIN' && activeAdmins <= 1) {
      throw new ConflictException('No se puede eliminar el ultimo usuario ADMIN');
    }

    let deleted: AuthUser | null;
    try {
      deleted = await this.authRepository.softDeleteUser(id);
    } catch (error: unknown) {
      if (error instanceof LastAdminConflictError) {
        throw new ConflictException('No se puede eliminar el ultimo usuario ADMIN');
      }
      throw new ServiceUnavailableException('No se pudo eliminar el usuario');
    }

    if (!deleted) throw new NotFoundException('Usuario no encontrado');
  }

  private extractBearerToken(authorization?: string): string {
    if (!authorization) return '';
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() || '';
  }

  private signToken(user: AuthUser): string {
    return this.jwtService.sign(
      {
        name: user.name,
        email: user.email,
        role: user.role
      },
      { subject: user.id }
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

  private isDatabaseError(error: unknown, code: string): boolean {
    return typeof error === 'object'
      && error !== null
      && 'code' in error
      && (error as { code?: unknown }).code === code;
  }
}
