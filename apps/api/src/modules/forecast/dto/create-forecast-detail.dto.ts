import { IsString, IsNumber, IsOptional } from 'class-validator';

export class CreateForecastDetailDto {
  @IsString()
  cliente!: string;

  @IsString()
  marca!: string;

  @IsString()
  plataforma!: string;

  @IsString()
  campaña!: string;

  @IsString()
  mes!: string;

  @IsNumber()
  budget!: number;

  @IsNumber()
  cpaEsperado!: number;

  @IsNumber()
  resultadosProyectados!: number;

  @IsOptional()
  @IsString()
  campaignId?: string;

  @IsOptional()
  @IsString()
  campaignName?: string;

  @IsOptional()
  @IsString()
  monthlyControlId?: string;
}

export class UpdateForecastDetailDto {
  @IsOptional()
  @IsNumber()
  budget?: number;

  @IsOptional()
  @IsNumber()
  cpaEsperado?: number;

  @IsOptional()
  @IsNumber()
  resultadosProyectados?: number;

  @IsOptional()
  @IsString()
  campaignId?: string;
}
