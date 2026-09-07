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

type UpdateUserInput = {
  name?: string;
  email?: string;
  passwordHash?: string;
  role?: UserRole;
};

export class LastAdminConflictError extends Error {
  constructor() {
    super('The last active ADMIN cannot be demoted or deleted');
    this.name = 'LastAdminConflictError';
  }
}

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
        email text NOT NULL,
        password_hash text NOT NULL,
        role text NOT NULL CHECK (role IN ('ADMIN', 'MEDIA', 'CLIENT')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz NULL
      );

      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;

      CREATE UNIQUE INDEX IF NOT EXISTS users_active_email_unique_idx
        ON users (email)
        WHERE deleted_at IS NULL;

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

  async findAllActiveUsers(): Promise<AuthUser[]> {
    if (!(await this.init()) || !this.pool) return [];

    const result = await this.pool.query<AuthUser>(
      `
        SELECT id, name, email, role
        FROM users
        WHERE deleted_at IS NULL
        ORDER BY lower(name), lower(email), id;
      `
    );

    return result.rows;
  }

  async countActiveUsers(): Promise<number> {
    if (!(await this.init()) || !this.pool) return 0;

    const result = await this.pool.query<{ count: string }>(
      'SELECT count(*) FROM users WHERE deleted_at IS NULL;'
    );

    return Number(result.rows[0]?.count || 0);
  }

  async countActiveAdmins(): Promise<number> {
    if (!(await this.init()) || !this.pool) return 0;

    const result = await this.pool.query<{ count: string }>(
      `SELECT count(*) FROM users WHERE role = 'ADMIN' AND deleted_at IS NULL;`
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

  async updateUser(id: string, input: UpdateUserInput): Promise<AuthUser | null> {
    if (!(await this.init()) || !this.pool) {
      throw new Error('Database is not configured');
    }

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      if (input.role !== undefined && input.role !== UserRole.ADMIN) {
        await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE;');

        const targetResult = await client.query<Pick<AuthUser, 'role'>>(
          `
            SELECT role
            FROM users
            WHERE id = $1
              AND deleted_at IS NULL
            LIMIT 1;
          `,
          [id]
        );
        const target = targetResult.rows[0];

        if (!target) {
          await client.query('COMMIT');
          return null;
        }

        if (target.role === UserRole.ADMIN) {
          const countResult = await client.query<{ count: string }>(
            `SELECT count(*) FROM users WHERE role = 'ADMIN' AND deleted_at IS NULL;`
          );

          if (Number(countResult.rows[0]?.count || 0) <= 1) {
            throw new LastAdminConflictError();
          }
        }
      }

      const result = await client.query<AuthUser>(
        `
          UPDATE users
          SET
            name = COALESCE($2::text, name),
            email = COALESCE(lower($3::text), email),
            password_hash = COALESCE($4::text, password_hash),
            role = COALESCE($5::text, role),
            updated_at = now()
          WHERE id = $1
            AND deleted_at IS NULL
          RETURNING id, name, email, role;
        `,
        [id, input.name ?? null, input.email ?? null, input.passwordHash ?? null, input.role ?? null]
      );

      await client.query('COMMIT');
      return result.rows[0] ?? null;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async softDeleteUser(id: string): Promise<AuthUser | null> {
    if (!(await this.init()) || !this.pool) {
      throw new Error('Database is not configured');
    }

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE;');

      const targetResult = await client.query<Pick<AuthUser, 'role'>>(
        `
          SELECT role
          FROM users
          WHERE id = $1
            AND deleted_at IS NULL
          LIMIT 1;
        `,
        [id]
      );
      const target = targetResult.rows[0];

      if (!target) {
        await client.query('COMMIT');
        return null;
      }

      if (target.role === UserRole.ADMIN) {
        const countResult = await client.query<{ count: string }>(
          `SELECT count(*) FROM users WHERE role = 'ADMIN' AND deleted_at IS NULL;`
        );

        if (Number(countResult.rows[0]?.count || 0) <= 1) {
          throw new LastAdminConflictError();
        }
      }

      const result = await client.query<AuthUser>(
        `
          UPDATE users
          SET deleted_at = now(), updated_at = now()
          WHERE id = $1
            AND deleted_at IS NULL
          RETURNING id, name, email, role;
        `,
        [id]
      );

      await client.query('COMMIT');
      return result.rows[0] ?? null;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await closeSharedDatabasePool();
  }
}
