import { IsString, IsNumber, IsOptional } from 'class-validator';

export class CreateMonthlyControlDto {
  @IsString()
  clientId!: string;

  @IsString()
  month!: string;

  @IsNumber()
  budgetOriginal!: number;

  @IsNumber()
  budgetAdjusted!: number;

  @IsOptional()
  @IsString()
  observaciones?: string;
}

export class UpdateMonthlyControlDto {
  @IsOptional()
  @IsNumber()
  budgetAdjusted?: number;

  @IsOptional()
  @IsString()
  observaciones?: string;
}
