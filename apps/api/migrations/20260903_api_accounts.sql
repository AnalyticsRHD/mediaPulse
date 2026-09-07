BEGIN;

CREATE TABLE IF NOT EXISTS api_accounts (
  id bigserial PRIMARY KEY,
  platform text NOT NULL CHECK (platform IN ('META', 'Google', 'TikTok', 'MELI')),
  account_id text NOT NULL,
  account_name text NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, account_id)
);

CREATE INDEX IF NOT EXISTS api_accounts_platform_enabled_idx
  ON api_accounts (platform, enabled);

COMMIT;
