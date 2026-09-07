BEGIN;

ALTER TABLE brand_mappings
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz NULL;

COMMIT;
