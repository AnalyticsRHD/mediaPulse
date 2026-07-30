import { Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { createDbConfig } from '../../config/db.config';
import { getSharedDatabasePool } from '../../config/database-pool';

export type PersistedMercadoLibreOAuthState = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  updatedAt: string;
};

@Injectable()
export class MercadoLibreOAuthRepository {
  private readonly logger = new Logger(MercadoLibreOAuthRepository.name);
  private pool: Pool | null = null;
  private initialized = false;
  private initialization: Promise<boolean> | null = null;

  async find(): Promise<PersistedMercadoLibreOAuthState | null> {
    if (!(await this.init()) || !this.pool) return null;

    const result = await this.pool.query(
      `
        SELECT access_token, refresh_token, expires_at, updated_at
        FROM mercado_libre_oauth_state
        WHERE id = 'primary'
        LIMIT 1;
      `
    );
    const row = result.rows[0];
    if (!row) return null;

    return {
      accessToken: String(row.access_token || ''),
      refreshToken: String(row.refresh_token || ''),
      expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : '',
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : ''
    };
  }

  async save(state: PersistedMercadoLibreOAuthState): Promise<boolean> {
    if (!(await this.init()) || !this.pool) return false;

    await this.pool.query(
      `
        INSERT INTO mercado_libre_oauth_state (
          id, access_token, refresh_token, expires_at, updated_at
        )
        VALUES ('primary', $1, $2, $3, $4)
        ON CONFLICT (id) DO UPDATE SET
          access_token = EXCLUDED.access_token,
          refresh_token = EXCLUDED.refresh_token,
          expires_at = EXCLUDED.expires_at,
          updated_at = EXCLUDED.updated_at;
      `,
      [state.accessToken, state.refreshToken, state.expiresAt || null, state.updatedAt]
    );
    return true;
  }

  private async init(): Promise<boolean> {
    if (this.initialized) return Boolean(this.pool);
    if (this.initialization) return this.initialization;

    this.initialization = this.initialize();
    return this.initialization;
  }

  private async initialize(): Promise<boolean> {
    const dbConfig = createDbConfig();
    if (!dbConfig.url) {
      this.initialized = true;
      return false;
    }

    try {
      this.pool = getSharedDatabasePool(dbConfig);
      await this.pool.query(
        `
          CREATE TABLE IF NOT EXISTS mercado_libre_oauth_state (
            id text PRIMARY KEY,
            access_token text NOT NULL,
            refresh_token text NOT NULL,
            expires_at timestamptz NULL,
            updated_at timestamptz NOT NULL DEFAULT now()
          );
        `
      );
      this.initialized = true;
      return true;
    } catch (error) {
      this.logger.error(`Could not initialize Mercado Libre OAuth storage: ${error instanceof Error ? error.message : String(error)}`);
      this.pool = null;
      this.initialized = true;
      return false;
    }
  }
}
