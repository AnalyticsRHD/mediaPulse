import { InvestmentCurrency, InvestmentStatus } from '@mediapulse/shared';
import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';

export class ManualInvestmentDto {
  @IsString()
  anunciante!: string;

  @IsOptional()
  @IsString()
  marca?: string;

  @IsEnum(InvestmentCurrency)
  moneda!: InvestmentCurrency;

  @IsOptional()
  @IsEnum(InvestmentStatus)
  status?: InvestmentStatus;

  @IsString()
  plataforma!: string;

  @IsString()
  objetivo!: string;

  @IsOptional()
  @IsString()
  campana?: string;

  @IsNumber()
  presupuesto!: number;

  @IsNumber()
  costoPorResultado!: number;

  @IsNumber()
  tktPromedio!: number;

  @IsOptional()
  @IsString()
  mes?: string;
}
