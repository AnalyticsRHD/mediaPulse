import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AdvertisingPlatform } from '../brand-mapping.types';

export class CreateBrandPlatformAccountDto {
  @ApiProperty({ enum: AdvertisingPlatform, example: AdvertisingPlatform.META })
  @IsEnum(AdvertisingPlatform)
  platform!: AdvertisingPlatform;

  @ApiProperty({ example: '123456789012345' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  accountId!: string;
}

export class CreateBrandMappingDto {
  @ApiProperty({ example: 'WORLD SPORT', description: 'Nombre del anunciante' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  cliente!: string;

  @ApiProperty({ example: 'Quiksilver' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  marca!: string;

  @ApiPropertyOptional({
    type: [CreateBrandPlatformAccountDto],
    description: 'Cuentas hijas asociadas a la marca. Admite varias cuentas por plataforma.'
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateBrandPlatformAccountDto)
  accounts: CreateBrandPlatformAccountDto[] = [];

  @ApiPropertyOptional({ example: '123456789012345' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  metaAccountId?: string;

  @ApiPropertyOptional({ example: '987-654-3210' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  googleAccountId?: string;

  @ApiPropertyOptional({ example: '12345' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  mercadoLibreAccountId?: string;

  @ApiPropertyOptional({ example: '700000000001' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  tiktokAccountId?: string;
}
