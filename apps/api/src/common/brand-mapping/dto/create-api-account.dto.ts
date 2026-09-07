import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AdvertisingPlatform } from '../brand-mapping.types';

export class CreateApiAccountDto {
  @ApiProperty({ enum: AdvertisingPlatform, example: AdvertisingPlatform.META })
  @IsEnum(AdvertisingPlatform)
  platform!: AdvertisingPlatform;

  @ApiProperty({ example: '123456789012345' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  accountId!: string;

  @ApiPropertyOptional({ example: 'Cuenta principal RHD' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  accountName?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class CreateApiAccountTargetItemDto {
  @ApiProperty({ example: '123456789012345' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  accountId!: string;

  @ApiPropertyOptional({ example: 'Cuenta principal RHD' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  accountName?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class CreateApiAccountsBatchDto {
  @ApiProperty({ type: [String], example: ['161892734484694', '185921768771500'] })
  @IsArray()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(128, { each: true })
  accountId!: string[];

  @ApiPropertyOptional({ example: 'Cuentas BM RHD', description: 'Opcional; no interviene en la consulta de métricas' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  accountName?: string;

  @ApiPropertyOptional({ default: true, description: 'Opcional; si se omite se guarda como activa' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
