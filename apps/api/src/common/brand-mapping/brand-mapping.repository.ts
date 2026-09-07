import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { closeSharedDatabasePool, getSharedDatabasePool } from '../../config/database-pool';
import { ConfigService } from '../../config/config.service';
import {
  AdvertisingPlatform,
  BrandMapping,
  BrandMappingWithAccounts,
  BrandPlatformAccount,
  ApiAccount
} from './brand-mapping.types';

type BrandMappingRow = BrandMapping & { id: string };

type BrandPlatformAccountRow = BrandMapping & {
  id: string;
  platform: AdvertisingPlatform;
  account_id: string;
};

type BrandMappingWithAccountRow = BrandMapping & {
  mapping_id: string;
  account_record_id: string | null;
  platform: AdvertisingPlatform | null;
  account_id: string | null;
};

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
    this.pool = getSharedDatabasePool(dbConfig);

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

      CREATE TABLE IF NOT EXISTS brand_platform_accounts (
        id bigserial PRIMARY KEY,
        brand_mapping_id bigint NOT NULL REFERENCES brand_mappings(id) ON DELETE CASCADE,
        platform text NOT NULL CHECK (platform IN ('META', 'Google', 'TikTok', 'MELI')),
        account_id text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (platform, account_id)
      );

      CREATE TABLE IF NOT EXISTS api_accounts (
        id bigserial PRIMARY KEY,
        platform text NOT NULL CHECK (platform IN ('META', 'Google', 'TikTok', 'MELI')),
        account_id text NOT NULL,
        account_name text NULL,
        enabled boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (platform, account_id)
      );

      CREATE INDEX IF NOT EXISTS brand_platform_accounts_mapping_idx
        ON brand_platform_accounts (brand_mapping_id);

      ALTER TABLE brand_mappings
        ADD COLUMN IF NOT EXISTS suspended_at timestamptz NULL;

      ALTER TABLE brand_mappings
        ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;
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
      SELECT cliente, marca, enabled, suspended_at AS "suspendedAt"
      FROM brand_mappings
      ORDER BY cliente, marca;
    `);

    return result.rows;
  }

  async findAllWithAccounts(): Promise<BrandMappingWithAccounts[]> {
    if (!(await this.init()) || !this.pool) return [];

    const result = await this.pool.query<BrandMappingWithAccountRow>(`
      SELECT
        mappings.id AS mapping_id,
        mappings.cliente,
        mappings.marca,
        mappings.enabled,
        mappings.suspended_at AS "suspendedAt",
        accounts.id AS account_record_id,
        accounts.platform,
        accounts.account_id
      FROM brand_mappings mappings
      LEFT JOIN brand_platform_accounts accounts
        ON accounts.brand_mapping_id = mappings.id
      ORDER BY
        lower(mappings.cliente),
        lower(mappings.marca),
        mappings.id,
        accounts.platform,
        accounts.account_id,
        accounts.id;
    `);

    const mappings = new Map<string, BrandMappingWithAccounts>();
    for (const row of result.rows) {
      let mapping = mappings.get(row.mapping_id);
      if (!mapping) {
        mapping = {
          id: row.mapping_id,
          cliente: row.cliente,
          marca: row.marca,
          enabled: row.enabled !== false,
          suspendedAt: row.suspendedAt,
          accounts: []
        };
        mappings.set(row.mapping_id, mapping);
      }

      if (row.account_record_id && row.platform && row.account_id) {
        mapping.accounts.push({
          id: row.account_record_id,
          platform: row.platform,
          accountId: row.account_id
        });
      }
    }

    return Array.from(mappings.values());
  }

  async setSuspended(id: string, suspended: boolean): Promise<BrandMapping | null> {
    if (!(await this.init()) || !this.pool) return null;

    const result = await this.pool.query<BrandMapping>(
      `
        UPDATE brand_mappings
        SET enabled = NOT $2,
          suspended_at = CASE WHEN $2 THEN COALESCE(suspended_at, now()) ELSE NULL END,
            updated_at = now()
        WHERE id = $1
        RETURNING cliente, marca, enabled, suspended_at AS "suspendedAt";
      `,
      [id, suspended]
    );
    return result.rows[0] ?? null;
  }

  async findSuspendedKeys(): Promise<Set<string>> {
    if (!(await this.init()) || !this.pool) return new Set();

    const result = await this.pool.query<{ cliente: string; marca: string }>(`
      SELECT cliente, marca
      FROM brand_mappings
      WHERE suspended_at IS NOT NULL;
    `);
    return new Set(result.rows.map((row) => `${row.cliente}\u0000${row.marca}`));
  }

  async createWithAccounts(input: {
    cliente: string;
    marca: string;
    accounts: Array<{ platform: AdvertisingPlatform; accountId: string }>;
  }): Promise<BrandMappingWithAccounts> {
    if (!(await this.init()) || !this.pool) {
      throw new Error('Database is not configured');
    }

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      await client.query(
        `SELECT pg_advisory_xact_lock(
          hashtext(lower(trim($1::text))),
          hashtext(lower(trim($2::text)))
        );`,
        [input.cliente, input.marca]
      );

      const existingMapping = await client.query<BrandMappingRow>(
        `
          SELECT id, cliente, marca
          FROM brand_mappings
          WHERE lower(trim(cliente)) = lower(trim($1))
            AND lower(trim(marca)) = lower(trim($2))
          ORDER BY id ASC
          LIMIT 1
          FOR UPDATE;
        `,
        [input.cliente, input.marca]
      );

      let mapping = existingMapping.rows[0];
      if (!mapping) {
        const insertedMapping = await client.query<BrandMappingRow>(
          `
            INSERT INTO brand_mappings (cliente, marca)
            VALUES ($1, $2)
            RETURNING id, cliente, marca;
          `,
          [input.cliente, input.marca]
        );
        mapping = insertedMapping.rows[0];
      }

      for (const account of input.accounts) {
        const existingAccount = await client.query<{ id: string; brand_mapping_id: string }>(
          `
            SELECT id, brand_mapping_id
            FROM brand_platform_accounts
            WHERE platform = $1 AND account_id = $2
            LIMIT 1
            FOR UPDATE;
          `,
          [account.platform, account.accountId]
        );
        const assignedAccount = existingAccount.rows[0];

        if (assignedAccount && assignedAccount.brand_mapping_id !== mapping.id) {
          const error = new Error('Advertising account is already assigned to another brand') as Error & { code?: string };
          error.code = 'ACCOUNT_ALREADY_ASSIGNED';
          throw error;
        }

        if (assignedAccount) {
          await client.query(
            'UPDATE brand_platform_accounts SET updated_at = now() WHERE id = $1;',
            [assignedAccount.id]
          );
        } else {
          await client.query(
            `
              INSERT INTO brand_platform_accounts (brand_mapping_id, platform, account_id)
              VALUES ($1, $2, $3);
            `,
            [mapping.id, account.platform, account.accountId]
          );
        }
      }

      const accountsResult = await client.query<{
        id: string;
        platform: AdvertisingPlatform;
        account_id: string;
      }>(
        `
          SELECT id, platform, account_id
          FROM brand_platform_accounts
          WHERE brand_mapping_id = $1
          ORDER BY platform, account_id;
        `,
        [mapping.id]
      );

      await client.query('COMMIT');

      return {
        id: mapping.id,
        cliente: mapping.cliente,
        marca: mapping.marca,
        enabled: true,
        accounts: accountsResult.rows.map((account) => ({
          id: account.id,
          platform: account.platform,
          accountId: account.account_id
        }))
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findAccountsByPlatform(platform: AdvertisingPlatform): Promise<BrandPlatformAccount[]> {
    if (!(await this.init()) || !this.pool) return [];

    const result = await this.pool.query<BrandPlatformAccountRow>(
      `
        SELECT accounts.id, accounts.platform, accounts.account_id, mappings.cliente, mappings.marca
        FROM brand_platform_accounts accounts
        INNER JOIN brand_mappings mappings ON mappings.id = accounts.brand_mapping_id
        WHERE accounts.platform = $1
        ORDER BY accounts.account_id;
      `,
      [platform]
    );

    return result.rows.map((row) => ({
      id: row.id,
      platform: row.platform,
      accountId: row.account_id,
      cliente: row.cliente,
      marca: row.marca
    }));
  }

  async findApiAccounts(): Promise<ApiAccount[]> {
    if (!(await this.init()) || !this.pool) throw new Error('Database is not configured');
    const result = await this.pool.query(`
      SELECT id, platform, account_id, account_name, enabled
      FROM api_accounts
      ORDER BY platform, account_id;
    `);
    return result.rows.map((row) => ({
      id: String(row.id),
      platform: row.platform,
      accountId: row.account_id,
      accountName: row.account_name,
      enabled: row.enabled
    }));
  }

  async createApiAccount(input: { platform: AdvertisingPlatform; accountId: string; accountName?: string; enabled: boolean }): Promise<ApiAccount> {
    if (!(await this.init()) || !this.pool) throw new Error('Database is not configured');
    const result = await this.pool.query(`
      INSERT INTO api_accounts (platform, account_id, account_name, enabled)
      VALUES ($1, $2, $3, $4)
      RETURNING id, platform, account_id, account_name, enabled;
    `, [input.platform, input.accountId, input.accountName || null, input.enabled]);
    const row = result.rows[0];
    return { id: String(row.id), platform: row.platform, accountId: row.account_id, accountName: row.account_name, enabled: row.enabled };
  }

  async updateApiAccount(id: string, input: { accountName?: string; enabled?: boolean }): Promise<ApiAccount | null> {
    if (!(await this.init()) || !this.pool) throw new Error('Database is not configured');
    const result = await this.pool.query(`
      UPDATE api_accounts
      SET account_name = COALESCE($2, account_name), enabled = COALESCE($3, enabled), updated_at = now()
      WHERE id = $1
      RETURNING id, platform, account_id, account_name, enabled;
    `, [id, input.accountName ?? null, input.enabled ?? null]);
    const row = result.rows[0];
    return row ? { id: String(row.id), platform: row.platform, accountId: row.account_id, accountName: row.account_name, enabled: row.enabled } : null;
  }

  async deleteApiAccount(id: string): Promise<boolean> {
    if (!(await this.init()) || !this.pool) throw new Error('Database is not configured');
    const result = await this.pool.query('DELETE FROM api_accounts WHERE id = $1;', [id]);
    return Boolean(result.rowCount);
  }

  async onApplicationShutdown(): Promise<void> {
    await closeSharedDatabasePool();
  }
}
