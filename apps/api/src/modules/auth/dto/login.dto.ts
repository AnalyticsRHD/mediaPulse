import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'admin@redhookdata.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Cambiar123' })
  @IsString()
  @MinLength(1)
  password!: string;
}
