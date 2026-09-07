BEGIN;

CREATE TABLE IF NOT EXISTS brand_platform_accounts (
  id bigserial PRIMARY KEY,
  brand_mapping_id bigint NOT NULL REFERENCES brand_mappings(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('META', 'Google', 'TikTok', 'MELI')),
  account_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, account_id)
);

CREATE INDEX IF NOT EXISTS brand_platform_accounts_mapping_idx
  ON brand_platform_accounts (brand_mapping_id);

ALTER TABLE brand_mappings
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz NULL;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;

CREATE UNIQUE INDEX IF NOT EXISTS users_active_email_unique_idx
  ON users (email)
  WHERE deleted_at IS NULL;

COMMIT;
