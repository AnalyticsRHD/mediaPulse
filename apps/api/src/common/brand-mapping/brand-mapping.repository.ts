import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { ConfigService } from '../../config/config.service';
import type { BrandMapping } from './brand-mapping.service';

@Injectable()
export class BrandMappingRepository implements OnApplicationShutdown {
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
      CREATE TABLE IF NOT EXISTS brand_mappings (
        id bigserial PRIMARY KEY,
        cliente text NOT NULL,
        marca text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (cliente, marca)
      );
    `);
    }

    return true;
  }

  async seed(mappings: BrandMapping[]): Promise<boolean> {
    if (!(await this.init()) || !this.pool) return false;

    for (const mapping of mappings) {
      await this.pool.query('BEGIN');
      try {
        const existing = await this.pool.query<{ id: string }>(
          `
            SELECT id
            FROM brand_mappings
            WHERE lower(trim(cliente)) = lower(trim($1))
              AND lower(trim(marca)) = lower(trim($2))
            ORDER BY id ASC;
          `,
          [mapping.cliente, mapping.marca]
        );

        if (existing.rows.length > 0) {
          const canonicalId = existing.rows[0].id;
          const duplicateIds = existing.rows.slice(1).map((row) => row.id);

          if (duplicateIds.length > 0) {
            await this.pool.query(
              'DELETE FROM brand_mappings WHERE id = ANY($1::bigint[])',
              [duplicateIds]
            );
          }

          await this.pool.query(
            `
              UPDATE brand_mappings
              SET cliente = $1,
                  marca = $2,
                  updated_at = now()
              WHERE id = $3;
            `,
            [mapping.cliente, mapping.marca, canonicalId]
          );
        } else {
          await this.pool.query(
            `
              INSERT INTO brand_mappings (cliente, marca)
              VALUES ($1, $2)
              ON CONFLICT (cliente, marca) DO UPDATE
              SET cliente = EXCLUDED.cliente,
                  marca = EXCLUDED.marca,
                  updated_at = now();
            `,
            [mapping.cliente, mapping.marca]
          );
        }

        await this.pool.query('COMMIT');
      } catch (error) {
        await this.pool.query('ROLLBACK');
        throw error;
      }
    }

    return true;
  }

  async findAll(): Promise<BrandMapping[]> {
    if (!(await this.init()) || !this.pool) return [];

    const result = await this.pool.query<BrandMapping>(`
      SELECT cliente, marca
      FROM brand_mappings
      ORDER BY cliente, marca;
    `);

    return result.rows;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool?.end();
  }
}
