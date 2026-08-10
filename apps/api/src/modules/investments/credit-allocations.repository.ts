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
        monto_cargado, monto_cargado_updated_at, monto_cargado_date_source, consumo_ayer, consumo_mes,
        consumo_promedio_8_dias, dias_cobertura_credito
      FROM credit_allocations
      ORDER BY consumo_ayer DESC, account_name ASC, plataforma ASC, account_id ASC;
    `);

    return result.rows.map((row) => ({
      plataforma: String(row.plataforma) as MetaCreditAllocation['plataforma'],
      accountId: String(row.account_id),
      accountName: String(row.account_name),
      currency: String(row.currency),
      creditoDisponible: Number(row.credito_disponible || 0),
      montoCargado: Number(row.monto_cargado || 0),
      fecha: this.toDateOnly(row.monto_cargado_updated_at),
      fechaSource: row.monto_cargado_date_source || undefined,
      consumoAyer: Number(row.consumo_ayer || 0),
      consumoMes: Number(row.consumo_mes || 0),
      consumoPromedio8Dias: Number(row.consumo_promedio_8_dias || 0),
      diasCoberturaCredito: row.dias_cobertura_credito == null ? null : Number(row.dias_cobertura_credito)
    }));
  }

  async findPage(page: number, limit: number, platform = '') {
    await this.init();
    if (!this.pool) return { items: [], total: 0, page, limit, hasMore: false };

    const offset = (page - 1) * limit;
    const [result, countResult, platformsResult] = await Promise.all([
      this.pool.query(`
        SELECT plataforma, account_id, account_name, currency, credito_disponible,
          monto_cargado, monto_cargado_updated_at, monto_cargado_date_source, consumo_ayer, consumo_mes,
          consumo_promedio_8_dias, dias_cobertura_credito
        FROM credit_allocations
        WHERE ($3 = '' OR lower(plataforma) = lower($3))
        ORDER BY consumo_ayer DESC, account_name ASC, plataforma ASC, account_id ASC
        LIMIT $1 OFFSET $2;
      `, [limit, offset, platform]),
      this.pool.query(`
        SELECT COUNT(*)::int AS total
        FROM credit_allocations
        WHERE ($1 = '' OR lower(plataforma) = lower($1));
      `, [platform]),
      this.pool.query('SELECT DISTINCT plataforma FROM credit_allocations ORDER BY plataforma;')
    ]);
    const total = Number(countResult.rows[0]?.total || 0);
    const items = result.rows.map((row) => ({
      plataforma: String(row.plataforma) as MetaCreditAllocation['plataforma'],
      accountId: String(row.account_id),
      accountName: String(row.account_name),
      currency: String(row.currency),
      creditoDisponible: Number(row.credito_disponible || 0),
      montoCargado: Number(row.monto_cargado || 0),
      fecha: this.toDateOnly(row.monto_cargado_updated_at),
      fechaSource: row.monto_cargado_date_source || undefined,
      consumoAyer: Number(row.consumo_ayer || 0),
      consumoMes: Number(row.consumo_mes || 0),
      consumoPromedio8Dias: Number(row.consumo_promedio_8_dias || 0),
      diasCoberturaCredito: row.dias_cobertura_credito == null ? null : Number(row.dias_cobertura_credito)
    }));

    const platforms = platformsResult.rows.map((row) => String(row.plataforma));
    return { items, total, page, limit, hasMore: offset + items.length < total, platforms };
  }

  async updateManualDate(plataforma: string, accountId: string, date: string) {
    await this.init();
    if (!this.pool) throw new ServiceUnavailableException('La base de datos no esta configurada');
    const result = await this.pool.query(`
      UPDATE credit_allocations
      SET monto_cargado_updated_at = $3::date,
          monto_cargado_date_source = 'MANUAL'
      WHERE lower(plataforma) = lower($1) AND account_id = $2
      RETURNING account_id, plataforma, monto_cargado_updated_at, monto_cargado_date_source;
    `, [plataforma, accountId, date]);
    if (result.rowCount === 0) return null;
    const row = result.rows[0];
    return {
      accountId: String(row.account_id),
      plataforma: String(row.plataforma),
      fecha: this.toDateOnly(row.monto_cargado_updated_at),
      fechaSource: String(row.monto_cargado_date_source)
    };
  }

  async getLastSyncedAt(): Promise<string | null> {
    await this.init();
    if (!this.pool) return null;
    const result = await this.pool.query(`
      SELECT MAX(last_synced_at) AS last_synced_at
      FROM credit_allocations;
    `);
    const value = result.rows[0]?.last_synced_at;
    return value ? new Date(value).toISOString() : null;
  }

  async upsertAll(lines: MetaCreditAllocation[]): Promise<MetaCreditAllocation[]> {
    await this.init();
    if (!this.pool) throw new ServiceUnavailableException('La base de datos no esta configurada');

    for (const line of lines) {
      await this.pool.query(`
        INSERT INTO credit_allocations (
          plataforma, account_id, account_name, currency, credito_disponible,
          monto_cargado, monto_cargado_updated_at, monto_cargado_date_source,
          consumo_ayer, consumo_mes, consumo_promedio_8_dias, dias_cobertura_credito,
          last_synced_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $9::date, $10, $7, $8, $11, $12, now())
        ON CONFLICT (plataforma, account_id) DO UPDATE SET
          account_name = EXCLUDED.account_name,
          currency = EXCLUDED.currency,
          credito_disponible = EXCLUDED.credito_disponible,
          monto_cargado_updated_at = CASE
            WHEN credit_allocations.monto_cargado_date_source = 'MANUAL' THEN credit_allocations.monto_cargado_updated_at
            WHEN EXCLUDED.monto_cargado_date_source = 'META_ACTIVITY' THEN EXCLUDED.monto_cargado_updated_at
            WHEN credit_allocations.monto_cargado IS DISTINCT FROM EXCLUDED.monto_cargado THEN CURRENT_DATE
            WHEN credit_allocations.monto_cargado_date_source = 'ACCOUNT_CREATED' THEN NULL
            WHEN credit_allocations.monto_cargado_updated_at IS NOT NULL THEN credit_allocations.monto_cargado_updated_at
            ELSE credit_allocations.monto_cargado_updated_at
          END,
          monto_cargado_date_source = CASE
            WHEN credit_allocations.monto_cargado_date_source = 'MANUAL' THEN 'MANUAL'
            WHEN EXCLUDED.monto_cargado_date_source = 'META_ACTIVITY' THEN 'META_ACTIVITY'
            WHEN credit_allocations.monto_cargado IS DISTINCT FROM EXCLUDED.monto_cargado THEN 'DETECTED'
            WHEN credit_allocations.monto_cargado_date_source = 'ACCOUNT_CREATED' THEN NULL
            WHEN credit_allocations.monto_cargado_updated_at IS NOT NULL THEN credit_allocations.monto_cargado_date_source
            ELSE credit_allocations.monto_cargado_date_source
          END,
          monto_cargado = EXCLUDED.monto_cargado,
          consumo_ayer = EXCLUDED.consumo_ayer,
          consumo_mes = EXCLUDED.consumo_mes,
          consumo_promedio_8_dias = EXCLUDED.consumo_promedio_8_dias,
          dias_cobertura_credito = EXCLUDED.dias_cobertura_credito,
          last_synced_at = now();
      `, [
        line.plataforma,
        line.accountId,
        line.accountName,
        line.currency,
        line.creditoDisponible,
        line.montoCargado,
        line.consumoAyer,
        line.consumoMes,
        line.fecha || null,
        line.fecha ? (line.fechaSource || 'META_ACTIVITY') : null,
        line.consumoPromedio8Dias,
        line.diasCoberturaCredito
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
          monto_cargado_updated_at date NULL,
          monto_cargado_date_source text NULL,
          consumo_ayer numeric NOT NULL DEFAULT 0,
          consumo_mes numeric NOT NULL DEFAULT 0,
          consumo_promedio_8_dias numeric NOT NULL DEFAULT 0,
          dias_cobertura_credito numeric NULL,
          last_synced_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (plataforma, account_id)
        );

        CREATE INDEX IF NOT EXISTS idx_credit_allocations_consumo_ayer
          ON credit_allocations (consumo_ayer DESC);

        ALTER TABLE credit_allocations
          ADD COLUMN IF NOT EXISTS monto_cargado_date_source text NULL,
          ADD COLUMN IF NOT EXISTS consumo_promedio_8_dias numeric NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS dias_cobertura_credito numeric NULL,
          ALTER COLUMN monto_cargado_updated_at DROP NOT NULL,
          ALTER COLUMN monto_cargado_updated_at DROP DEFAULT;
      `);
    }
  }

  private toDateOnly(value: unknown): string {
    if (!value) return '';
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);
  }
}
