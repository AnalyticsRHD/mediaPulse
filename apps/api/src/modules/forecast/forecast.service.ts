import { Injectable } from '@nestjs/common';
import { ForecastDetail } from '@mediapulse/shared';
import { CreateForecastDetailDto, UpdateForecastDetailDto } from './dto/create-forecast-detail.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class ForecastService {
  private forecasts = new Map<string, ForecastDetail>();

  getOverview() {
    return {
      total: this.forecasts.size,
      items: Array.from(this.forecasts.values())
    };
  }

  findAll(): ForecastDetail[] {
    return Array.from(this.forecasts.values());
  }

  findById(id: string): ForecastDetail | null {
    return this.forecasts.get(id) || null;
  }

  create(dto: CreateForecastDetailDto): ForecastDetail {
    const id = uuidv4();
    const detail: ForecastDetail = {
      id,
      ...dto
    };
    this.forecasts.set(id, detail);
    return detail;
  }

  update(id: string, dto: UpdateForecastDetailDto): ForecastDetail | null {
    const existing = this.forecasts.get(id);
    if (!existing) return null;

    const updated = { ...existing, ...dto };
    this.forecasts.set(id, updated);
    return updated;
  }

  delete(id: string): boolean {
    return this.forecasts.delete(id);
  }

  findByClientAndMonth(cliente: string, mes: string): ForecastDetail[] {
    return Array.from(this.forecasts.values()).filter(
      f => f.cliente === cliente && f.mes === mes
    );
  }
}
