import { Injectable } from '@nestjs/common';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();
const workspaceEnvPath = path.resolve(process.cwd(), '..', '..', '.env');
if (fs.existsSync(workspaceEnvPath)) {
  dotenv.config({ path: workspaceEnvPath });
}

@Injectable()
export class ConfigService {
  get airtableApiKey(): string {
    return process.env.AIRTABLE_API_KEY || '';
  }

  get airtableBaseId(): string {
    return process.env.AIRTABLE_BASE_ID || '';
  }

  get metaAccessToken(): string {
    return process.env.META_ACCESS_TOKEN || '';
  }

  get googleAccessToken(): string {
    return process.env.GOOGLE_ACCESS_TOKEN || '';
  }

  get supermetricsApiBaseUrl(): string {
    return process.env.SUPERMETRICS_API_BASE_URL || 'https://api.supermetrics.com/enterprise/v2';
  }

  get supermetricsApiKey(): string {
    return process.env.SUPERMETRICS_API_KEY || '';
  }

  get supermetricsFacebookAdsQueryJson(): string {
    return process.env.SUPERMETRICS_FACEBOOK_ADS_QUERY_JSON || '';
  }

  get supermetricsGoogleAdsQueryJson(): string {
    return process.env.SUPERMETRICS_GOOGLE_ADS_QUERY_JSON || '';
  }

  get supermetricsLinkedinAdsQueryJson(): string {
    return process.env.SUPERMETRICS_LINKEDIN_ADS_QUERY_JSON || '';
  }

  get supermetricsSyncTimeoutSeconds(): number {
    return parseInt(process.env.SUPERMETRICS_SYNC_TIMEOUT_SECONDS || '300', 10);
  }

  get databaseUrl(): string {
    return process.env.DATABASE_URL || '';
  }

  get apiPort(): number {
    return parseInt(process.env.API_PORT || '3333', 10);
  }

  get nodeEnv(): string {
    return process.env.NODE_ENV || 'development';
  }

  isProduction(): boolean {
    return this.nodeEnv === 'production';
  }
}
