import { ConflictException, ForbiddenException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import jwt, { SignOptions } from 'jsonwebtoken';
import { ConfigService } from '../../config/config.service';
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
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly configService: ConfigService
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
