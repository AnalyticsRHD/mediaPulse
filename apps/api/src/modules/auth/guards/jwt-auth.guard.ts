import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthService } from '../auth.service';
import { AuthUser } from '../auth.types';

export type AuthenticatedRequest = {
  headers: {
    authorization?: string | string[];
  };
  user?: AuthUser;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    const authorization = Array.isArray(header) ? header[0] : header;

    request.user = await this.authService.requireUser(authorization);
    return true;
  }
}
