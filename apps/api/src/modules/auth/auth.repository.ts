import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { closeSharedDatabasePool, getSharedDatabasePool } from '../../config/database-pool';
import { ConfigService } from '../../config/config.service';
import { AuthUser, UserRole } from './auth.types';

type UserRow = {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: UserRole;
};

@Injectable()
export class AuthRepository implements OnModuleInit, OnApplicationShutdown {
  private pool: Pool | null = null;
  private initialized = false;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    await this.init();
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

      CREATE TABLE IF NOT EXISTS users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        email text NOT NULL UNIQUE,
        password_hash text NOT NULL,
        role text NOT NULL CHECK (role IN ('ADMIN', 'MEDIA', 'CLIENT')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz NULL
      );

    `);
    }

    return true;
  }

  async findUserByEmail(email: string): Promise<UserRow | null> {
    if (!(await this.init()) || !this.pool) return null;

    const result = await this.pool.query<UserRow>(
      `
        SELECT id, name, email, password_hash, role
        FROM users
        WHERE lower(email) = lower($1)
          AND deleted_at IS NULL
        LIMIT 1;
      `,
      [email]
    );

    return result.rows[0] ?? null;
  }

  async findUserById(id: string): Promise<AuthUser | null> {
    if (!(await this.init()) || !this.pool) return null;

    const result = await this.pool.query<AuthUser>(
      `
        SELECT id, name, email, role
        FROM users
        WHERE id = $1
          AND deleted_at IS NULL
        LIMIT 1;
      `,
      [id]
    );

    return result.rows[0] ?? null;
  }

  async countActiveUsers(): Promise<number> {
    if (!(await this.init()) || !this.pool) return 0;

    const result = await this.pool.query<{ count: string }>(
      'SELECT count(*) FROM users WHERE deleted_at IS NULL;'
    );

    return Number(result.rows[0]?.count || 0);
  }

  async createUser(input: { name: string; email: string; passwordHash: string; role: UserRole }): Promise<AuthUser> {
    if (!(await this.init()) || !this.pool) {
      throw new Error('Database is not configured');
    }

    const result = await this.pool.query<AuthUser>(
      `
        INSERT INTO users (name, email, password_hash, role)
        VALUES ($1, lower($2), $3, $4)
        RETURNING id, name, email, role;
      `,
      [input.name, input.email, input.passwordHash, input.role]
    );

    return result.rows[0];
  }

  async onApplicationShutdown(): Promise<void> {
    await closeSharedDatabasePool();
  }
}
