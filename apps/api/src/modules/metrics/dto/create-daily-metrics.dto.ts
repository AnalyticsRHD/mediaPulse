import { IsString, IsNumber, IsDate, IsOptional } from 'class-validator';

export class CreateDailyMetricsDto {
  @IsString()
  date!: string;

  @IsString()
  cliente!: string;

  @IsString()
  marca!: string;

  @IsString()
  plataforma!: string;

  @IsString()
  campaignId!: string;

  @IsString()
  campaignName!: string;

  @IsOptional()
  @IsString()
  adSetName?: string;

  @IsOptional()
  @IsString()
  adGroupName?: string;

  @IsOptional()
  @IsString()
  objetivo?: string;

  @IsOptional()
  @IsString()
  referencia?: string;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  accountName?: string;

  @IsOptional()
  @IsString()
  granularity?: 'daily' | 'monthly';

  @IsNumber()
  spend!: number;

  @IsNumber()
  impressions!: number;

  @IsNumber()
  clicks!: number;

  @IsNumber()
  conversions!: number;

  @IsOptional()
  @IsNumber()
  revenue?: number;
}

export class UpdateDailyMetricsDto {
  @IsOptional()
  @IsString()
  referencia?: string;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  accountName?: string;

  @IsOptional()
  @IsString()
  adSetName?: string;

  @IsOptional()
  @IsString()
  adGroupName?: string;

  @IsOptional()
  @IsString()
  objetivo?: string;

  @IsOptional()
  @IsString()
  granularity?: 'daily' | 'monthly';

  @IsOptional()
  @IsNumber()
  spend?: number;

  @IsOptional()
  @IsNumber()
  impressions?: number;

  @IsOptional()
  @IsNumber()
  clicks?: number;

  @IsOptional()
  @IsNumber()
  conversions?: number;

  @IsOptional()
  @IsNumber()
  revenue?: number;
}
