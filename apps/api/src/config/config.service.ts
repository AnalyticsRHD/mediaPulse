import { Injectable } from '@nestjs/common';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { createDbConfig } from './db.config';
import type { DbConfig } from './db.config';

dotenv.config();
const workspaceEnvPath = path.resolve(process.cwd(), '..', '..', '.env');
if (fs.existsSync(workspaceEnvPath)) {
  dotenv.config({ path: workspaceEnvPath });
}

@Injectable()
export class ConfigService {
  private readonly dbConfig = createDbConfig();

  get metaAccessToken(): string {
    return this.cleanPlaceholder(process.env.META_ACCESS_TOKEN || '');
  }

  get metaCreditAllocAccessToken(): string {
    return this.cleanPlaceholder(process.env.META_ACCESS_TOKEN_ALLOC || '');
  }

  get metaApiBaseUrl(): string {
    return process.env.META_API_BASE_URL || 'https://graph.facebook.com/v21.0';
  }

  get metaAccountIds(): string[] {
    const raw = process.env.META_ACCOUNT_IDS || process.env.META_ACCOUNT_ID || '';
    return raw
      .split(',')
      .map((value) => this.cleanPlaceholder(value).replace(/^act_/i, '').trim())
      .filter(Boolean);
  }

  get metaBusinessIds(): string[] {
    const raw = process.env.META_BUSINESS_IDS || process.env.META_BUSINESS_ID || '';
    return raw
      .split(',')
      .map((value) => this.cleanPlaceholder(value).trim())
      .filter(Boolean);
  }

  get metaSyncTimeoutSeconds(): number {
    return parseInt(process.env.META_SYNC_TIMEOUT_SECONDS || '120', 10);
  }

  get metaMaxAccountsPerSync(): number {
    return parseInt(process.env.META_MAX_ACCOUNTS_PER_SYNC || '100', 10);
  }

  get googleAccessToken(): string {
    return process.env.GOOGLE_ACCESS_TOKEN || '';
  }

  get googleAdsApiBaseUrl(): string {
    return process.env.GOOGLE_ADS_API_BASE_URL || 'https://googleads.googleapis.com/v21';
  }

  get googleAdsDeveloperToken(): string {
    return this.cleanPlaceholder(process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '');
  }

  get googleAdsClientId(): string {
    return this.cleanPlaceholder(process.env.GOOGLE_ADS_CLIENT_ID || '');
  }

  get googleAdsClientSecret(): string {
    return this.cleanPlaceholder(process.env.GOOGLE_ADS_CLIENT_SECRET || '');
  }

  get googleAdsRefreshToken(): string {
    return this.cleanPlaceholder(process.env.GOOGLE_ADS_REFRESH_TOKEN || '');
  }

  get googleAdsLoginCustomerId(): string {
    return this.cleanCustomerId(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '');
  }

  get googleAdsCustomerIds(): string[] {
    const raw = process.env.GOOGLE_ADS_CUSTOMER_IDS || process.env.GOOGLE_CUSTOMER_ID || '';
    return raw
      .split(',')
      .map((value) => this.cleanCustomerId(value))
      .filter(Boolean);
  }

  get googleAdsSyncTimeoutSeconds(): number {
    return parseInt(process.env.GOOGLE_ADS_SYNC_TIMEOUT_SECONDS || '120', 10);
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

  get supermetricsGoogleAdsExcludedAccountIds(): string[] {
    return (process.env.SUPERMETRICS_GOOGLE_ADS_EXCLUDED_ACCOUNT_IDS || '')
      .split(',')
      .map((accountId) => accountId.trim())
      .filter(Boolean);
  }

  get supermetricsLinkedinAdsQueryJson(): string {
    return process.env.SUPERMETRICS_LINKEDIN_ADS_QUERY_JSON || '';
  }

  get supermetricsSyncTimeoutSeconds(): number {
    return parseInt(process.env.SUPERMETRICS_SYNC_TIMEOUT_SECONDS || '300', 10);
  }

  get adsSheetsSourceSpreadsheetId(): string {
    return this.cleanPlaceholder(process.env.ADS_SHEETS_SOURCE_SPREADSHEET_ID || process.env.GOOGLE_META_SOURCE_SPREADSHEET_ID || '');
  }

  get adsSheetsGoogleSheetsApiKey(): string {
    return this.cleanPlaceholder(process.env.ADS_SHEETS_GOOGLE_SHEETS_API_KEY || process.env.GOOGLE_SHEETS_API_KEY || '');
  }

  get adsSheetsSyncTimeoutSeconds(): number {
    return parseInt(process.env.ADS_SHEETS_SYNC_TIMEOUT_SECONDS || '60', 10);
  }

  get googleAdsMonthlyRange(): string {
    return process.env.GOOGLE_ADS_SHEETS_MONTHLY_RANGE || 'Google!A:F';
  }

  get googleAdsDailyRange(): string {
    return process.env.GOOGLE_ADS_SHEETS_DAILY_RANGE || 'Google!M:P';
  }

  get metaAdsMonthlyRange(): string {
    return process.env.META_ADS_SHEETS_MONTHLY_RANGE || 'Meta!A:C';
  }

  get metaAdsDailyRange(): string {
    return process.env.META_ADS_SHEETS_DAILY_RANGE || 'Meta!L:N';
  }

  get tiktokApiBaseUrl(): string {
    return process.env.TIKTOK_API_BASE_URL || 'https://business-api.tiktok.com/open_api/v1.3';
  }

  get tiktokAppId(): string {
    return this.cleanPlaceholder(process.env.TIKTOK_APP_ID || '');
  }

  get tiktokAppSecret(): string {
    return this.cleanPlaceholder(process.env.TIKTOK_APP_SECRET || '');
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
    return this.cleanPlaceholder(process.env.MERCADO_LIBRE_ACCESS_TOKEN || '');
  }

  get mercadoLibreRefreshToken(): string {
    return this.cleanPlaceholder(process.env.MERCADO_LIBRE_REFRESH_TOKEN || '');
  }

  get mercadoLibreClientId(): string {
    return this.cleanPlaceholder(process.env.MERCADO_LIBRE_CLIENT_ID || process.env.MERCADO_LIBRE_APP_ID || '');
  }

  get mercadoLibreClientSecret(): string {
    return this.cleanPlaceholder(process.env.MERCADO_LIBRE_CLIENT_SECRET || process.env.MERCADO_LIBRE_SECRET_KEY || '');
  }

  get mercadoLibreOAuthStatePath(): string {
    return this.cleanPlaceholder(process.env.MERCADO_LIBRE_OAUTH_STATE_PATH || 'apps/api/data/mercado-libre-oauth.json');
  }

  get mercadoLibreAdvertiserIds(): string[] {
    return (process.env.MERCADO_LIBRE_ADVERTISER_IDS || '')
      .split(',')
      .map((value) => this.cleanPlaceholder(value))
      .filter(Boolean);
  }

  get tiktokBusinessCenterIds(): string[] {
    return (process.env.TIKTOK_BUSINESS_CENTER_IDS || process.env.TIKTOK_BUSINESS_CENTER_ID || '')
      .split(',')
      .map((value) => this.cleanPlaceholder(value))
      .filter(Boolean);
  }

  get mercadoLibreApiBaseUrl(): string {
    return process.env.MERCADO_LIBRE_API_BASE_URL || 'https://api.mercadolibre.com';
  }

  get mercadoLibreAdsApiBaseUrl(): string {
    return process.env.MERCADO_LIBRE_ADS_API_BASE_URL || 'https://ads.mercadolibre.com.ar/advertiser-hub/api';
  }

  get mercadoLibreProducts(): string[] {
    return (process.env.MERCADO_LIBRE_PRODUCTS || 'PADS,DSP')
      .split(',')
      .map((value) => this.cleanPlaceholder(value).trim().toUpperCase())
      .filter(Boolean);
  }

  get mercadoLibreSyncEnabled(): boolean {
    return (process.env.MERCADO_LIBRE_SYNC_ENABLED || 'true').toLowerCase() !== 'false';
  }

  get mercadoLibreWebCookie(): string {
    return this.cleanPlaceholder(process.env.MERCADO_LIBRE_WEB_COOKIE || '');
  }

  get mercadoLibreWebCsrfToken(): string {
    return this.cleanPlaceholder(
      process.env.MERCADO_LIBRE_WEB_CSRF_TOKEN
      || process.env.MERCADO_LIBRE_WEB_CSRF_TTOKEN
      || ''
    );
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
    return this.dbConfig.url;
  }

  get database(): DbConfig {
    return this.dbConfig;
  }

  get databaseSynchronize(): boolean {
    return this.dbConfig.synchronize;
  }

  get jwtSecret(): string {
    return this.cleanPlaceholder(process.env.JWT_SECRET || '') || 'mediapulse-local-dev-secret';
  }

  get jwtExpiresIn(): string {
    return process.env.JWT_EXPIRES_IN || '8h';
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

  private cleanCustomerId(value: string): string {
    return this.cleanPlaceholder(value).replace(/-/g, '').trim();
  }
}
