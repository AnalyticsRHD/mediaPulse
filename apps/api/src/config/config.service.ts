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

  get tiktokApiBaseUrl(): string {
    return process.env.TIKTOK_API_BASE_URL || 'https://business-api.tiktok.com/open_api/v1.3';
  }

  get tiktokAccessToken(): string {
    return this.cleanPlaceholder(process.env.TIKTOK_ACCESS_TOKEN || '');
  }

  get tiktokAdvertiserIds(): string[] {
    return (process.env.TIKTOK_ADVERTISER_IDS || '')
      .split(',')
      .map((value) => this.cleanPlaceholder(value))
      .filter(Boolean);
  }

  get tiktokSyncTimeoutSeconds(): number {
    return parseInt(process.env.TIKTOK_SYNC_TIMEOUT_SECONDS || '60', 10);
  }

  get mercadoLibreAccessToken(): string {
    return process.env.MERCADO_LIBRE_ACCESS_TOKEN || '';
  }

  get mercadoLibreAdvertiserIds(): string[] {
    return (process.env.MERCADO_LIBRE_ADVERTISER_IDS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  }

  get mercadoLibreSourceSpreadsheetId(): string {
    return this.cleanPlaceholder(process.env.MERCADO_LIBRE_SOURCE_SPREADSHEET_ID || '');
  }

  get mercadoLibreRawSheets(): string[] {
    const configured = process.env.MERCADO_LIBRE_RAW_SHEETS || [
      'Quiksilver',
      'Quiksilver - Display',
      'Roxy',
      'Roxy - Display',
      'DC Shoes 3P',
      'DC Shoes 3P - Display'
    ].join(',');

    return configured
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  }

  get mercadoLibreGoogleSheetsApiKey(): string {
    return this.cleanPlaceholder(process.env.MERCADO_LIBRE_GOOGLE_SHEETS_API_KEY || process.env.GOOGLE_SHEETS_API_KEY || '');
  }

  get mercadoLibreSyncTimeoutSeconds(): number {
    return parseInt(process.env.MERCADO_LIBRE_SYNC_TIMEOUT_SECONDS || '60', 10);
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

  private cleanPlaceholder(value: string): string {
    const clean = value.trim();
    if (!clean) return '';
    if (/^(your_|tu_|advertiser_id_|placeholder)/i.test(clean)) return '';
    return clean;
  }
}
