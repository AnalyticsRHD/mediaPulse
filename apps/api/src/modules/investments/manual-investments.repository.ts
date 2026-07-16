import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { DailyMetrics, InvestmentCurrency, InvestmentDeviationComment, InvestmentStatus, ManualInvestmentLine, ManualInvestmentLog } from '@mediapulse/shared';
import { Pool } from 'pg';
import { closeSharedDatabasePool, getSharedDatabasePool } from '../../config/database-pool';
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
    this.pool = getSharedDatabasePool(dbConfig);

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
        last_consumo_hoy numeric NOT NULL DEFAULT 0,
        last_consumo_hoy_date date NULL,
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
        ADD COLUMN IF NOT EXISTS last_consumo_hoy numeric NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS last_consumo_hoy_date date NULL,
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

      CREATE TABLE IF NOT EXISTS manual_investment_deviation_comments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        manual_investment_line_id uuid NOT NULL REFERENCES manual_investment_lines(id) ON DELETE CASCADE,
        comment text NOT NULL,
        user_id uuid NULL,
        user_name text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_manual_investment_deviation_comments_line_created
        ON manual_investment_deviation_comments (manual_investment_line_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS daily_metrics (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        date date NOT NULL,
        cliente text NOT NULL,
        marca text NOT NULL,
        plataforma text NOT NULL,
        campaign_id text NOT NULL,
        campaign_name text NOT NULL,
        ad_set_name text NULL,
        ad_group_name text NULL,
        objetivo text NULL,
        referencia text NULL,
        account_id text NULL,
        account_name text NULL,
        granularity text NOT NULL DEFAULT 'daily',
        coverage_end_date date NULL,
        spend numeric NOT NULL DEFAULT 0,
        impressions numeric NOT NULL DEFAULT 0,
        clicks numeric NOT NULL DEFAULT 0,
        conversions numeric NOT NULL DEFAULT 0,
        revenue numeric NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (date, campaign_id, plataforma, granularity)
      );

      ALTER TABLE daily_metrics
        ADD COLUMN IF NOT EXISTS referencia text NULL,
        ADD COLUMN IF NOT EXISTS account_id text NULL,
        ADD COLUMN IF NOT EXISTS account_name text NULL,
        ADD COLUMN IF NOT EXISTS ad_set_name text NULL,
        ADD COLUMN IF NOT EXISTS ad_group_name text NULL,
        ADD COLUMN IF NOT EXISTS objetivo text NULL,
        ADD COLUMN IF NOT EXISTS granularity text NOT NULL DEFAULT 'daily',
        ADD COLUMN IF NOT EXISTS coverage_end_date date NULL,
        ADD COLUMN IF NOT EXISTS revenue numeric NULL,
        ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
        ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

      CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_metrics_unique_key
        ON daily_metrics (date, campaign_id, plataforma, granularity);

      CREATE INDEX IF NOT EXISTS idx_daily_metrics_date
        ON daily_metrics (date);

      CREATE INDEX IF NOT EXISTS idx_daily_metrics_platform_granularity_date
        ON daily_metrics (plataforma, granularity, date);
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
        last_consumo_hoy,
        last_consumo_hoy_date,
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
          last_consumo_hoy,
          last_consumo_hoy_date,
          last_consumo_updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
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
          last_consumo_hoy = EXCLUDED.last_consumo_hoy,
          last_consumo_hoy_date = EXCLUDED.last_consumo_hoy_date,
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
        line.lastConsumoHoy || 0,
        line.lastConsumoHoyDate || null,
        line.lastConsumoUpdatedAt || null
      ]
    );

    return true;
  }

  async updateConsumptionSnapshot(
    id: string,
    snapshot: { lastConsumo: number; lastConsumoDia: number; lastConsumoHoy: number; lastConsumoHoyDate: string | null; lastConsumoUpdatedAt: string }
  ): Promise<boolean> {
    if (!(await this.init()) || !this.pool) return false;

    await this.pool.query(
      `
        UPDATE manual_investment_lines
        SET
          last_consumo = $2,
          last_consumo_dia = $3,
          last_consumo_hoy = $4,
          last_consumo_hoy_date = $5,
          last_consumo_updated_at = $6
        WHERE id = $1
          AND deleted_at IS NULL;
      `,
      [id, snapshot.lastConsumo, snapshot.lastConsumoDia, snapshot.lastConsumoHoy, snapshot.lastConsumoHoyDate, snapshot.lastConsumoUpdatedAt]
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

  async findAllDailyMetrics(): Promise<DailyMetrics[]> {
    if (!(await this.init()) || !this.pool) return [];

    const result = await this.pool.query(`
      SELECT
        id,
        date,
        cliente,
        marca,
        plataforma,
        campaign_id,
        campaign_name,
        ad_set_name,
        ad_group_name,
        objetivo,
        referencia,
        account_id,
        account_name,
        granularity,
        coverage_end_date,
        spend,
        impressions,
        clicks,
        conversions,
        revenue
      FROM daily_metrics
      ORDER BY date, plataforma, cliente, marca, campaign_name;
    `);

    return result.rows.map((row) => this.toDailyMetric(row));
  }

  async upsertDailyMetric(metric: DailyMetrics): Promise<DailyMetrics | null> {
    if (!(await this.init()) || !this.pool) return null;

    const id = metric.id || null;
    const result = await this.pool.query(
      `
        INSERT INTO daily_metrics (
          id,
          date,
          cliente,
          marca,
          plataforma,
          campaign_id,
          campaign_name,
          ad_set_name,
          ad_group_name,
          objetivo,
          referencia,
          account_id,
          account_name,
          granularity,
          coverage_end_date,
          spend,
          impressions,
          clicks,
          conversions,
          revenue
        )
        VALUES (
          COALESCE($1::uuid, gen_random_uuid()),
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          $14,
          $15,
          $16,
          $17,
          $18,
          $19,
          $20
        )
        ON CONFLICT (date, campaign_id, plataforma, granularity) DO UPDATE SET
          cliente = EXCLUDED.cliente,
          marca = EXCLUDED.marca,
          campaign_name = EXCLUDED.campaign_name,
          ad_set_name = EXCLUDED.ad_set_name,
          ad_group_name = EXCLUDED.ad_group_name,
          objetivo = EXCLUDED.objetivo,
          referencia = EXCLUDED.referencia,
          account_id = EXCLUDED.account_id,
          account_name = EXCLUDED.account_name,
          coverage_end_date = EXCLUDED.coverage_end_date,
          spend = EXCLUDED.spend,
          impressions = EXCLUDED.impressions,
          clicks = EXCLUDED.clicks,
          conversions = EXCLUDED.conversions,
          revenue = EXCLUDED.revenue,
          updated_at = now()
        RETURNING
          id,
          date,
          cliente,
          marca,
          plataforma,
          campaign_id,
          campaign_name,
          ad_set_name,
          ad_group_name,
          objetivo,
          referencia,
          account_id,
          account_name,
          granularity,
          coverage_end_date,
          spend,
          impressions,
          clicks,
          conversions,
          revenue;
      `,
      [
        id,
        metric.date,
        metric.cliente,
        metric.marca,
        metric.plataforma,
        metric.campaignId,
        metric.campaignName,
        metric.adSetName || null,
        metric.adGroupName || null,
        metric.objetivo || null,
        metric.referencia || metric.marca || metric.cliente,
        metric.accountId || null,
        metric.accountName || null,
        metric.granularity || 'daily',
        metric.coverageEndDate || null,
        metric.spend || 0,
        metric.impressions || 0,
        metric.clicks || 0,
        metric.conversions || 0,
        metric.revenue ?? null
      ]
    );

    return this.toDailyMetric(result.rows[0]);
  }

  async deleteDailyMetric(id: string): Promise<boolean> {
    if (!(await this.init()) || !this.pool) return false;

    const result = await this.pool.query('DELETE FROM daily_metrics WHERE id = $1;', [id]);
    return Boolean(result.rowCount);
  }

  async deleteDailyMetricsForSync(platform: string, granularity: 'daily' | 'monthly', date: string): Promise<void> {
    if (!(await this.init()) || !this.pool) return;

    await this.pool.query(
      `
        DELETE FROM daily_metrics
        WHERE plataforma = $1
          AND granularity = $2
          AND date = $3;
      `,
      [platform, granularity, date]
    );
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

  async findLogsByLineId(lineId: string): Promise<ManualInvestmentLog[]> {
    if (!(await this.init()) || !this.pool) return [];

    const result = await this.pool.query(
      `
        SELECT
          id,
          action,
          user_id,
          user_name,
          manual_investment_line_id,
          manual_investment_line_anunciante,
          manual_investment_line_snapshot,
          created_at,
          updated_at,
          deleted_at
        FROM manual_investment_logs
        WHERE manual_investment_line_id = $1
        ORDER BY created_at DESC;
      `,
      [lineId]
    );

    return result.rows.map((row) => this.toManualLog(row));
  }

  async insertDeviationComment(lineId: string, comment: string, user?: AuthUser | null): Promise<InvestmentDeviationComment | null> {
    if (!(await this.init()) || !this.pool) return null;

    const result = await this.pool.query(
      `
        INSERT INTO manual_investment_deviation_comments (
          manual_investment_line_id,
          comment,
          user_id,
          user_name
        )
        VALUES ($1, $2, $3, $4)
        RETURNING id, manual_investment_line_id, comment, user_id, user_name, created_at;
      `,
      [lineId, comment, user?.id || null, user?.name || 'Sistema']
    );

    return this.toDeviationComment(result.rows[0]);
  }

  async findLatestDeviationCommentsByLineIds(lineIds: string[]): Promise<Map<string, InvestmentDeviationComment>> {
    const latestComments = new Map<string, InvestmentDeviationComment>();
    if (lineIds.length === 0 || !(await this.init()) || !this.pool) return latestComments;

    const result = await this.pool.query(
      `
        SELECT DISTINCT ON (manual_investment_line_id)
          id,
          manual_investment_line_id,
          comment,
          user_id,
          user_name,
          created_at
        FROM manual_investment_deviation_comments
        WHERE manual_investment_line_id = ANY($1::uuid[])
        ORDER BY manual_investment_line_id, created_at DESC;
      `,
      [lineIds]
    );

    result.rows.forEach((row) => {
      const comment = this.toDeviationComment(row);
      latestComments.set(comment.manualInvestmentLineId, comment);
    });

    return latestComments;
  }

  async onApplicationShutdown(): Promise<void> {
    await closeSharedDatabasePool();
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
      lastConsumoHoy: Number(row.last_consumo_hoy || 0),
      lastConsumoHoyDate: this.toDateOnly(row.last_consumo_hoy_date),
      lastConsumoUpdatedAt: row.last_consumo_updated_at ? new Date(String(row.last_consumo_updated_at)).toISOString() : null,
      createdAt: row.created_at ? new Date(String(row.created_at)).toISOString() : undefined,
      updatedAt: row.updated_at ? new Date(String(row.updated_at)).toISOString() : null,
      deletedAt: row.deleted_at ? new Date(String(row.deleted_at)).toISOString() : null
    };
  }

  private toManualLog(row: Record<string, unknown>): ManualInvestmentLog {
    return {
      id: String(row.id),
      action: String(row.action) as ManualInvestmentLogAction,
      userId: row.user_id ? String(row.user_id) : null,
      userName: String(row.user_name || 'Sistema'),
      manualInvestmentLineId: String(row.manual_investment_line_id),
      manualInvestmentLineAnunciante: String(row.manual_investment_line_anunciante),
      manualInvestmentLineSnapshot: this.toManualSnapshot(row.manual_investment_line_snapshot),
      createdAt: row.created_at ? new Date(String(row.created_at)).toISOString() : new Date().toISOString(),
      updatedAt: row.updated_at ? new Date(String(row.updated_at)).toISOString() : null,
      deletedAt: row.deleted_at ? new Date(String(row.deleted_at)).toISOString() : null
    };
  }

  private toDailyMetric(row: Record<string, unknown>): DailyMetrics {
    return {
      id: String(row.id),
      date: this.toDateOnly(row.date) || '',
      cliente: String(row.cliente || ''),
      marca: String(row.marca || ''),
      plataforma: String(row.plataforma || ''),
      campaignId: String(row.campaign_id || ''),
      campaignName: String(row.campaign_name || ''),
      adSetName: row.ad_set_name ? String(row.ad_set_name) : undefined,
      adGroupName: row.ad_group_name ? String(row.ad_group_name) : undefined,
      objetivo: row.objetivo ? String(row.objetivo) : undefined,
      referencia: row.referencia ? String(row.referencia) : undefined,
      accountId: row.account_id ? String(row.account_id) : undefined,
      accountName: row.account_name ? String(row.account_name) : undefined,
      granularity: (String(row.granularity || 'daily') === 'monthly' ? 'monthly' : 'daily'),
      coverageEndDate: this.toDateOnly(row.coverage_end_date) || undefined,
      spend: Number(row.spend || 0),
      impressions: Number(row.impressions || 0),
      clicks: Number(row.clicks || 0),
      conversions: Number(row.conversions || 0),
      revenue: row.revenue === null || row.revenue === undefined ? undefined : Number(row.revenue)
    };
  }

  private toDeviationComment(row: Record<string, unknown>): InvestmentDeviationComment {
    return {
      id: String(row.id),
      manualInvestmentLineId: String(row.manual_investment_line_id),
      comment: String(row.comment || ''),
      userId: row.user_id ? String(row.user_id) : null,
      userName: String(row.user_name || 'Sistema'),
      createdAt: row.created_at ? new Date(String(row.created_at)).toISOString() : new Date().toISOString()
    };
  }

  private toManualSnapshot(value: unknown): ManualInvestmentLine {
    try {
      const snapshot = typeof value === 'string' ? JSON.parse(value) : value;
      if (snapshot && typeof snapshot === 'object') return snapshot as ManualInvestmentLine;
    } catch {
      return {} as ManualInvestmentLine;
    }

    return {} as ManualInvestmentLine;
  }

  private toDateOnly(value: unknown): string | null {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    const text = String(value);
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
  }
}
