import { Pool } from 'pg';
import { DbConfig } from './db.config';

let sharedPool: Pool | null = null;
let closingPool: Promise<void> | null = null;

export function getSharedDatabasePool(dbConfig: DbConfig): Pool {
  if (sharedPool) return sharedPool;

  sharedPool = new Pool({
    connectionString: dbConfig.url,
    ssl: dbConfig.ssl,
    max: Number(process.env.DB_POOL_MAX || 5),
    idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_TIMEOUT_MS || 10000),
    connectionTimeoutMillis: Number(process.env.DB_POOL_CONNECTION_TIMEOUT_MS || 30000),
    allowExitOnIdle: true
  });

  return sharedPool;
}

export async function closeSharedDatabasePool(): Promise<void> {
  if (!sharedPool) return;
  if (!closingPool) {
    const pool = sharedPool;
    sharedPool = null;
    closingPool = pool.end().finally(() => {
      closingPool = null;
    });
  }

  await closingPool;
}
