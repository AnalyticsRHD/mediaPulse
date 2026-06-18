import { Injectable } from '@nestjs/common';
import { MonthlyControl } from '@mediapulse/shared';
import { CreateMonthlyControlDto, UpdateMonthlyControlDto } from './dto/create-monthly-control.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class ControlService {
  private controls = new Map<string, MonthlyControl>();

  private calculateSemaforo(desvioPacing: number): '🟢' | '🟡' | '🔴' {
    const absDevio = Math.abs(desvioPacing);
    if (absDevio <= 0.15) return '🟢';
    if (absDevio <= 0.30) return '🟡';
    return '🔴';
  }

  findAll(): MonthlyControl[] {
    return Array.from(this.controls.values());
  }

  findById(id: string): MonthlyControl | null {
    return this.controls.get(id) || null;
  }

  findByClientAndMonth(clientId: string, month: string): MonthlyControl | null {
    return Array.from(this.controls.values()).find(
      c => c.clientId === clientId && c.month === month
    ) || null;
  }

  create(dto: CreateMonthlyControlDto): MonthlyControl {
    const id = uuidv4();
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const currentDay = now.getDate();
    const expectedConsumption = (dto.budgetAdjusted / daysInMonth) * currentDay;
    const consumoEsperado = expectedConsumption;
    const desvioPacing = 0;

    const control: MonthlyControl = {
      id,
      clientId: dto.clientId,
      month: dto.month,
      budgetOriginal: dto.budgetOriginal,
      budgetAdjusted: dto.budgetAdjusted,
      consumoTotal: 0,
      resultadosTotales: 0,
      diasDelMes: daysInMonth,
      diaActual: currentDay,
      consumoEsperado,
      porcentajeConsumo: 0,
      desvioPacing,
      semaforo: this.calculateSemaforo(desvioPacing),
      consumoRestante: dto.budgetAdjusted,
      observaciones: dto.observaciones
    };

    this.controls.set(id, control);
    return control;
  }

  update(id: string, dto: UpdateMonthlyControlDto): MonthlyControl | null {
    const existing = this.controls.get(id);
    if (!existing) return null;

    const updated: MonthlyControl = {
      ...existing,
      ...dto,
      porcentajeConsumo: existing.consumoTotal / (dto.budgetAdjusted || existing.budgetAdjusted),
      consumoRestante: (dto.budgetAdjusted || existing.budgetAdjusted) - existing.consumoTotal
    };

    updated.desvioPacing = existing.consumoEsperado > 0
      ? (existing.consumoTotal - existing.consumoEsperado) / existing.consumoEsperado
      : 0;
    updated.semaforo = this.calculateSemaforo(updated.desvioPacing);

    this.controls.set(id, updated);
    return updated;
  }

  delete(id: string): boolean {
    return this.controls.delete(id);
  }

  getMonthlyStatus(): MonthlyControl | null {
    return this.findAll()[0] ?? null;
  }
}
