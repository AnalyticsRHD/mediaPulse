
export type DbConfig = {
  url: string;
  ssl: false | { rejectUnauthorized: boolean };
  synchronize: boolean;
  dropSchema?: boolean;
};

export function createDbConfig(): DbConfig {
  return {
    url: process.env.DATABASE_URL || '',
    ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
    synchronize: process.env.DB_SYNCHRONIZE !== 'false',
    dropSchema: true,
  };
}
