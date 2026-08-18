// SQL migrations are embedded here so the Vercel Function can bootstrap a new
// Supabase Postgres database without relying on runtime file-system reads.
const MIGRATIONS = [
  {
    id: '001_init',
    sql: `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS challenges (
  id text PRIMARY KEY,
  title text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'paused', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS challenge_codes (
  challenge_id text NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  code_fingerprint text NOT NULL,
  code_nickname text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  used_at timestamptz,
  PRIMARY KEY (challenge_id, code_hash),
  CONSTRAINT ck_code_hash_hex CHECK (code_hash ~ '^[a-f0-9]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_challenge_codes_status
  ON challenge_codes(challenge_id, status, used_at);

CREATE SEQUENCE IF NOT EXISTS submission_alias_seq START 1;

CREATE TABLE IF NOT EXISTS attempt_sessions (
  id uuid PRIMARY KEY,
  challenge_id text NOT NULL,
  code_hash text NOT NULL,
  token_hash text NOT NULL,
  participant_name text,
  country text,
  started_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  ip_hash text,
  user_agent_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (challenge_id, code_hash)
    REFERENCES challenge_codes(challenge_id, code_hash)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attempt_sessions_challenge_code
  ON attempt_sessions(challenge_id, code_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_attempt_sessions_expires
  ON attempt_sessions(expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS submissions (
  id uuid PRIMARY KEY,
  challenge_id text NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  attempt_session_id uuid NOT NULL UNIQUE REFERENCES attempt_sessions(id) ON DELETE RESTRICT,
  code_hash text NOT NULL,
  code_fingerprint text NOT NULL,
  code_nickname text,
  participant_name text,
  participant_alias text NOT NULL,
  country text NOT NULL,
  answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  correct_count integer NOT NULL DEFAULT 0 CHECK (correct_count >= 0),
  word_hits jsonb NOT NULL DEFAULT '{}'::jsonb,
  time_taken_ms integer NOT NULL CHECK (time_taken_ms >= 0),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  ip_hash text,
  user_agent_hash text,
  request_id text,
  FOREIGN KEY (challenge_id, code_hash)
    REFERENCES challenge_codes(challenge_id, code_hash)
    ON DELETE RESTRICT,
  CONSTRAINT uq_submission_challenge_code UNIQUE (challenge_id, code_hash)
);

CREATE INDEX IF NOT EXISTS idx_submissions_leaderboard
  ON submissions(challenge_id, correct_count DESC, time_taken_ms ASC, submitted_at ASC);

CREATE INDEX IF NOT EXISTS idx_submissions_challenge_country
  ON submissions(challenge_id, country);
    `
  },
  {
    id: '002_add_country_reporting',
    sql: `
ALTER TABLE attempt_sessions
  ADD COLUMN IF NOT EXISTS country text;

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS country text;

UPDATE submissions
SET country = 'Unspecified'
WHERE country IS NULL;

ALTER TABLE submissions
  ALTER COLUMN country SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_submissions_challenge_country
  ON submissions(challenge_id, country);
    `
  },
  {
    id: '003_add_code_nicknames',
    sql: `
ALTER TABLE challenge_codes
  ADD COLUMN IF NOT EXISTS code_nickname text;

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS code_nickname text;
    `
  },
  {
    id: '004_add_participant_names',
    sql: `
ALTER TABLE attempt_sessions
  ADD COLUMN IF NOT EXISTS participant_name text;

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS participant_name text;
    `
  },
  {
    id: '005_duplicate_device_audit',
    sql: `
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
    `
  }
];

module.exports = { MIGRATIONS };
