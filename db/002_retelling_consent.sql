ALTER TABLE retellings ADD COLUMN IF NOT EXISTS consent_at timestamptz NOT NULL DEFAULT now();
