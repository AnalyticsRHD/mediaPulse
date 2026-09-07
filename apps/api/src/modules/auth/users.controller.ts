import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SWAGGER_TAGS } from '../../common/swagger/swagger-tags';
import { AuthService } from './auth.service';
import { AuthUser, UserRole } from './auth.types';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './roles.decorator';

@ApiTags(SWAGGER_TAGS.USERS)
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('auth/users')
export class UsersController {
  constructor(private readonly authService: AuthService) {}

  @Get()
  @ApiOperation({ summary: 'Listar usuarios activos' })
  getUsers(): Promise<AuthUser[]> {
    return this.authService.getUsers();
  }

  @Post()
  @ApiOperation({ summary: 'Crear usuario' })
  createUser(@Body() dto: CreateUserDto) {
    return this.authService.createUser(dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Editar usuario' })
  updateUser(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateUserDto
  ) {
    return this.authService.updateUser(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar usuario' })
  async deleteUser(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<void> {
    await this.authService.deleteUser(id);
  }
}
