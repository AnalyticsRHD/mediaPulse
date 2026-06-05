import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsString, MinLength } from 'class-validator';
import { UserRole } from '../auth.types';

export class CreateUserDto {
  @ApiProperty({ example: 'Admin MediaPulse' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ example: 'admin@redhookdata.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Cambiar123', minLength: 6 })
  @IsString()
  @MinLength(6)
  password!: string;

  @ApiProperty({ enum: UserRole, example: UserRole.ADMIN })
  @IsIn(Object.values(UserRole))
  role!: UserRole;
}
