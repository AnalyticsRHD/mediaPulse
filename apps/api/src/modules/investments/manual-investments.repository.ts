import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { InvestmentCurrency, InvestmentStatus, ManualInvestmentLine } from '@mediapulse/shared';
import { Pool } from 'pg';
import { ConfigService } from '../../config/config.service';

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

    this.pool = new Pool({
      connectionString: this.configService.databaseUrl,
      ssl: { rejectUnauthorized: false }
    });

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS manual_investment_lines (
        id uuid PRIMARY KEY,
        anunciante text NOT NULL,
        marca text NOT NULL,
        moneda text NOT NULL,
        status text NOT NULL,
        plataforma text NOT NULL,
        objetivo text NOT NULL,
        presupuesto numeric NOT NULL,
        costo_por_resultado numeric NOT NULL,
        tkt_promedio numeric NOT NULL,
        mes char(7) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);

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
        presupuesto,
        costo_por_resultado,
        tkt_promedio,
        mes
      FROM manual_investment_lines
      ORDER BY anunciante, marca, moneda, plataforma, objetivo;
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
          presupuesto,
          costo_por_resultado,
          tkt_promedio,
          mes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (id) DO UPDATE SET
          anunciante = EXCLUDED.anunciante,
          marca = EXCLUDED.marca,
          moneda = EXCLUDED.moneda,
          status = EXCLUDED.status,
          plataforma = EXCLUDED.plataforma,
          objetivo = EXCLUDED.objetivo,
          presupuesto = EXCLUDED.presupuesto,
          costo_por_resultado = EXCLUDED.costo_por_resultado,
          tkt_promedio = EXCLUDED.tkt_promedio,
          mes = EXCLUDED.mes,
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
        line.presupuesto,
        line.costoPorResultado,
        line.tktPromedio,
        line.mes
      ]
    );

    return true;
  }

  async deleteMany(ids: string[]): Promise<{ deletedCount: number; deletedIds: string[] } | null> {
    if (!(await this.init()) || !this.pool) return null;

    const result = await this.pool.query<{ id: string }>(
      'DELETE FROM manual_investment_lines WHERE id = ANY($1::uuid[]) RETURNING id;',
      [ids]
    );

    return {
      deletedCount: result.rowCount || 0,
      deletedIds: result.rows.map((row) => row.id)
    };
  }

  async syncFromFile(lines: ManualInvestmentLine[]): Promise<boolean> {
    if (!(await this.init()) || !this.pool) return false;

    for (const line of lines) {
      await this.upsert(line);
    }

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
      presupuesto: Number(row.presupuesto),
      costoPorResultado: Number(row.costo_por_resultado),
      tktPromedio: Number(row.tkt_promedio),
      mes: String(row.mes)
    };
  }
}
