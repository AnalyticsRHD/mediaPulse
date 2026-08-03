import { Injectable, OnApplicationShutdown, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';
import { closeSharedDatabasePool, getSharedDatabasePool } from '../../config/database-pool';
import { ConfigService } from '../../config/config.service';
import { MetaCreditAllocation } from '../../common/external-apis/external-apis.service';

@Injectable()
export class CreditAllocationsRepository implements OnApplicationShutdown {
  private pool: Pool | null = null;
  private initialized = false;

  constructor(private readonly configService: ConfigService) {}

  async findAll(): Promise<MetaCreditAllocation[]> {
    await this.init();
    if (!this.pool) return [];

    const result = await this.pool.query(`
      SELECT plataforma, account_id, account_name, currency, credito_disponible,
        monto_cargado, monto_cargado_updated_at, consumo_ayer, consumo_mes
      FROM credit_allocations
      ORDER BY consumo_ayer DESC, account_name ASC;
    `);

    return result.rows.map((row) => ({
      plataforma: String(row.plataforma) as 'META',
      accountId: String(row.account_id),
      accountName: String(row.account_name),
      currency: String(row.currency),
      creditoDisponible: Number(row.credito_disponible || 0),
      montoCargado: Number(row.monto_cargado || 0),
      fecha: this.toDateOnly(row.monto_cargado_updated_at),
      consumoAyer: Number(row.consumo_ayer || 0),
      consumoMes: Number(row.consumo_mes || 0)
    }));
  }

  async upsertAll(lines: MetaCreditAllocation[]): Promise<MetaCreditAllocation[]> {
    await this.init();
    if (!this.pool) throw new ServiceUnavailableException('La base de datos no esta configurada');

    for (const line of lines) {
      await this.pool.query(`
        INSERT INTO credit_allocations (
          plataforma, account_id, account_name, currency, credito_disponible,
          monto_cargado, monto_cargado_updated_at, consumo_ayer, consumo_mes, last_synced_at
        ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE, $7, $8, now())
        ON CONFLICT (plataforma, account_id) DO UPDATE SET
          account_name = EXCLUDED.account_name,
          currency = EXCLUDED.currency,
          credito_disponible = EXCLUDED.credito_disponible,
          monto_cargado_updated_at = CASE
            WHEN credit_allocations.monto_cargado IS DISTINCT FROM EXCLUDED.monto_cargado THEN CURRENT_DATE
            ELSE credit_allocations.monto_cargado_updated_at
          END,
          monto_cargado = EXCLUDED.monto_cargado,
          consumo_ayer = EXCLUDED.consumo_ayer,
          consumo_mes = EXCLUDED.consumo_mes,
          last_synced_at = now();
      `, [
        line.plataforma,
        line.accountId,
        line.accountName,
        line.currency,
        line.creditoDisponible,
        line.montoCargado,
        line.consumoAyer,
        line.consumoMes
      ]);
    }

    return this.findAll();
  }

  async onApplicationShutdown(): Promise<void> {
    await closeSharedDatabasePool();
  }

  private async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    if (!this.configService.databaseUrl) return;

    const dbConfig = this.configService.database;
    this.pool = getSharedDatabasePool(dbConfig);
    if (dbConfig.synchronize) {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS credit_allocations (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          plataforma text NOT NULL,
          account_id text NOT NULL,
          account_name text NOT NULL,
          currency text NOT NULL,
          credito_disponible numeric NOT NULL DEFAULT 0,
          monto_cargado numeric NOT NULL DEFAULT 0,
          monto_cargado_updated_at date NOT NULL DEFAULT CURRENT_DATE,
          consumo_ayer numeric NOT NULL DEFAULT 0,
          consumo_mes numeric NOT NULL DEFAULT 0,
          last_synced_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (plataforma, account_id)
        );

        CREATE INDEX IF NOT EXISTS idx_credit_allocations_consumo_ayer
          ON credit_allocations (consumo_ayer DESC);
      `);
    }
  }

  private toDateOnly(value: unknown): string {
    if (!value) return '';
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);
  }
}
