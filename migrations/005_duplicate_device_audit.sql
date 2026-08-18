CREATE TABLE IF NOT EXISTS duplicate_device_audit (
  id uuid PRIMARY KEY,
  challenge_id text NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  detected_at timestamptz NOT NULL DEFAULT now(),
  audit_reason text NOT NULL DEFAULT 'same_hashed_device_multiple_codes',
  ip_hash text NOT NULL,
  user_agent_hash text NOT NULL,
  current_submission_id uuid NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  current_code_fingerprint text NOT NULL,
  current_code_nickname text,
  current_participant_name text,
  current_country text,
  matched_submission_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  matched_code_fingerprints text[] NOT NULL DEFAULT '{}'::text[],
  matched_code_nicknames text[] NOT NULL DEFAULT '{}'::text[],
  matched_participant_names text[] NOT NULL DEFAULT '{}'::text[],
  matched_countries text[] NOT NULL DEFAULT '{}'::text[],
  matched_count integer NOT NULL DEFAULT 0 CHECK (matched_count >= 1),
  request_id text,
  CONSTRAINT uq_duplicate_device_audit_current_submission UNIQUE (current_submission_id)
);

CREATE INDEX IF NOT EXISTS idx_duplicate_device_audit_challenge
  ON duplicate_device_audit(challenge_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_duplicate_device_audit_device
  ON duplicate_device_audit(challenge_id, ip_hash, user_agent_hash);
