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
