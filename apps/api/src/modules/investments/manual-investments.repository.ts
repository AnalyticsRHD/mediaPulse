import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { InvestmentCurrency, InvestmentStatus, ManualInvestmentLine } from '@mediapulse/shared';
import { Pool } from 'pg';
import { ConfigService } from '../../config/config.service';
import { AuthUser } from '../auth/auth.types';

export type ManualInvestmentLogAction = 'CREATED' | 'UPDATED' | 'DELETED';

@Injectable()
export class ManualInvestmentsRepository implements OnApplicationShutdown {
  private pool: Pool | null = null;
  private initialized = false;

  constructor(private readonly configService: ConfigService) {}

  get enabled(): boolean {
    return Boolean(this.configService.databaseUrl);
  }

  async init(): Promise<boolean> {
    if (this.initialized) return Boolean(this.pool);
    this.initialized = true;

    if (!this.configService.databaseUrl) return false;

    const dbConfig = this.configService.database;
    this.pool = new Pool({
      connectionString: dbConfig.url,
      ssl: dbConfig.ssl
    });

    if (dbConfig.synchronize) {
      await this.pool.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;

      CREATE TABLE IF NOT EXISTS manual_investment_lines (
        id uuid PRIMARY KEY,
        anunciante text NOT NULL,
        marca text NOT NULL,
        moneda text NOT NULL,
        status text NOT NULL,
        plataforma text NOT NULL,
        objetivo text NOT NULL,
        campana text NULL,
        presupuesto numeric NOT NULL,
        costo_por_resultado numeric NOT NULL,
        tkt_promedio numeric NOT NULL,
        mes char(7) NOT NULL,
        last_consumo numeric NOT NULL DEFAULT 0,
        last_consumo_dia numeric NOT NULL DEFAULT 0,
        last_consumo_updated_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz NULL
      );

      ALTER TABLE manual_investment_lines
        ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
        ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
        ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL,
        ADD COLUMN IF NOT EXISTS campana text NULL,
        ADD COLUMN IF NOT EXISTS last_consumo numeric NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS last_consumo_dia numeric NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS last_consumo_updated_at timestamptz NULL;

      CREATE TABLE IF NOT EXISTS manual_investment_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        action text NOT NULL CHECK (action IN ('CREATED', 'UPDATED', 'DELETED')),
        user_id uuid NULL,
        user_name text NOT NULL,
        manual_investment_line_id uuid NOT NULL,
        manual_investment_line_anunciante text NOT NULL,
        manual_investment_line_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NULL,
        deleted_at timestamptz NULL
      );
    `);
    }

    return true;
  }

  async findAll(): Promise<ManualInvestmentLine[]> {
    if (!(await this.init()) || !this.pool) return [];

    const result = await this.pool.query(`
      SELECT
        id,
        anunciante,
        marca,
        moneda,
        status,
        plataforma,
        objetivo,
        campana,
        presupuesto,
        costo_por_resultado,
        tkt_promedio,
        mes,
        last_consumo,
        last_consumo_dia,
        last_consumo_updated_at,
        created_at,
        updated_at,
        deleted_at
      FROM manual_investment_lines
      WHERE deleted_at IS NULL
      ORDER BY anunciante, marca, moneda, plataforma, objetivo, campana;
    `);

    return result.rows.map((row) => this.toManualLine(row));
  }

  async upsert(line: ManualInvestmentLine): Promise<boolean> {
    if (!(await this.init()) || !this.pool) return false;

    await this.pool.query(
      `
        INSERT INTO manual_investment_lines (
          id,
          anunciante,
          marca,
          moneda,
          status,
          plataforma,
          objetivo,
          campana,
          presupuesto,
          costo_por_resultado,
          tkt_promedio,
          mes,
          last_consumo,
          last_consumo_dia,
          last_consumo_updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (id) DO UPDATE SET
          anunciante = EXCLUDED.anunciante,
          marca = EXCLUDED.marca,
          moneda = EXCLUDED.moneda,
          status = EXCLUDED.status,
          plataforma = EXCLUDED.plataforma,
          objetivo = EXCLUDED.objetivo,
          campana = EXCLUDED.campana,
          presupuesto = EXCLUDED.presupuesto,
          costo_por_resultado = EXCLUDED.costo_por_resultado,
          tkt_promedio = EXCLUDED.tkt_promedio,
          mes = EXCLUDED.mes,
          last_consumo = EXCLUDED.last_consumo,
          last_consumo_dia = EXCLUDED.last_consumo_dia,
          last_consumo_updated_at = EXCLUDED.last_consumo_updated_at,
          updated_at = now();
      `,
      [
        line.id,
        line.anunciante,
        line.marca || line.anunciante,
        line.moneda,
        line.status,
        line.plataforma,
        line.objetivo,
        line.campana?.trim() || null,
        line.presupuesto,
        line.costoPorResultado,
        line.tktPromedio,
        line.mes,
        line.lastConsumo || 0,
        line.lastConsumoDia || 0,
        line.lastConsumoUpdatedAt || null
      ]
    );

    return true;
  }

  async updateConsumptionSnapshot(
    id: string,
    snapshot: { lastConsumo: number; lastConsumoDia: number; lastConsumoUpdatedAt: string }
  ): Promise<boolean> {
    if (!(await this.init()) || !this.pool) return false;

    await this.pool.query(
      `
        UPDATE manual_investment_lines
        SET
          last_consumo = $2,
          last_consumo_dia = $3,
          last_consumo_updated_at = $4
        WHERE id = $1
          AND deleted_at IS NULL;
      `,
      [id, snapshot.lastConsumo, snapshot.lastConsumoDia, snapshot.lastConsumoUpdatedAt]
    );

    return true;
  }

  async findLatestConsumptionSyncAt(): Promise<string | null> {
    if (!(await this.init()) || !this.pool) return null;

    const result = await this.pool.query(
      `
        SELECT MAX(last_consumo_updated_at) AS last_consumo_updated_at
        FROM manual_investment_lines
        WHERE deleted_at IS NULL;
      `
    );
    const value = result.rows[0]?.last_consumo_updated_at;

    return value ? new Date(String(value)).toISOString() : null;
  }

  async markConsumptionSyncAt(syncedAt: string): Promise<boolean> {
    if (!(await this.init()) || !this.pool) return false;

    await this.pool.query(
      `
        UPDATE manual_investment_lines
        SET last_consumo_updated_at = $1
        WHERE deleted_at IS NULL;
      `,
      [syncedAt]
    );

    return true;
  }

  async deleteMany(ids: string[]): Promise<{ deletedCount: number; deletedIds: string[] } | null> {
    if (!(await this.init()) || !this.pool) return null;

    const result = await this.pool.query<{ id: string }>(
      `
        UPDATE manual_investment_lines
        SET deleted_at = now(), updated_at = now()
        WHERE id = ANY($1::uuid[])
          AND deleted_at IS NULL
        RETURNING id;
      `,
      [ids]
    );

    return {
      deletedCount: result.rowCount || 0,
      deletedIds: result.rows.map((row) => row.id)
    };
  }

  async insertLog(action: ManualInvestmentLogAction, line: ManualInvestmentLine, user?: AuthUser | null): Promise<boolean> {
    if (!(await this.init()) || !this.pool) return false;

    await this.pool.query(
      `
        INSERT INTO manual_investment_logs (
          action,
          user_id,
          user_name,
          manual_investment_line_id,
          manual_investment_line_anunciante,
          manual_investment_line_snapshot,
          updated_at,
          deleted_at
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8);
      `,
      [
        action,
        user?.id || null,
        user?.name || 'Sistema',
        line.id,
        line.anunciante,
        JSON.stringify(line),
        action === 'UPDATED' ? new Date().toISOString() : null,
        action === 'DELETED' ? new Date().toISOString() : null
      ]
    );

    return true;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool?.end();
  }

  private toManualLine(row: Record<string, unknown>): ManualInvestmentLine {
    return {
      id: String(row.id),
      anunciante: String(row.anunciante),
      marca: String(row.marca),
      moneda: String(row.moneda) as InvestmentCurrency,
      status: String(row.status) as InvestmentStatus,
      plataforma: String(row.plataforma),
      objetivo: String(row.objetivo),
      campana: row.campana ? String(row.campana) : undefined,
      presupuesto: Number(row.presupuesto),
      costoPorResultado: Number(row.costo_por_resultado),
      tktPromedio: Number(row.tkt_promedio),
      mes: String(row.mes),
      lastConsumo: Number(row.last_consumo || 0),
      lastConsumoDia: Number(row.last_consumo_dia || 0),
      lastConsumoUpdatedAt: row.last_consumo_updated_at ? new Date(String(row.last_consumo_updated_at)).toISOString() : null,
      createdAt: row.created_at ? new Date(String(row.created_at)).toISOString() : undefined,
      updatedAt: row.updated_at ? new Date(String(row.updated_at)).toISOString() : null,
      deletedAt: row.deleted_at ? new Date(String(row.deleted_at)).toISOString() : null
    };
  }
}
