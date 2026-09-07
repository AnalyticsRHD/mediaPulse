BEGIN;

ALTER TABLE brand_mappings
  ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;

UPDATE brand_mappings
SET enabled = false
WHERE suspended_at IS NOT NULL;

COMMIT;