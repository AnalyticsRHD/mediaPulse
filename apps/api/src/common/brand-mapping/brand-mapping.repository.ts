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
      await this.pool.query(
        `
          INSERT INTO brand_mappings (cliente, marca)
          VALUES ($1, $2)
          ON CONFLICT (cliente, marca) DO NOTHING;
        `,
        [mapping.cliente, mapping.marca]
      );
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
