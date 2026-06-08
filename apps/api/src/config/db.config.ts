
export type DbConfig = {
  url: string;
  ssl: false | { rejectUnauthorized: boolean };
  synchronize: boolean;
  logging: boolean;
  dropSchema: boolean;
};

export function createDbConfig(): DbConfig {
  return {
    url: process.env.DATABASE_URL || '',
    ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
    synchronize: process.env.DB_SYNCHRONIZE !== 'false',
    logging: process.env.DB_LOGGING === 'true',
    dropSchema: process.env.DB_DROP_SCHEMA === 'true'
  };
}
