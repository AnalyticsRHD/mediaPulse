export enum AdvertisingPlatform {
  META = 'META',
  GOOGLE = 'Google',
  TIKTOK = 'TikTok',
  MERCADO_LIBRE = 'MELI'
}

export type BrandMapping = {
  cliente: string;
  marca: string;
  enabled?: boolean;
  suspendedAt?: string | null;
};

export type BrandPlatformAccount = BrandMapping & {
  id: string;
  platform: AdvertisingPlatform;
  accountId: string;
};

export type ApiAccount = {
  id: string;
  platform: AdvertisingPlatform;
  accountId: string;
  accountName?: string | null;
  enabled: boolean;
};

export type BrandMappingWithAccounts = BrandMapping & {
  id: string;
  accounts: Array<{
    id: string;
    platform: AdvertisingPlatform;
    accountId: string;
  }>;
};
