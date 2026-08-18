ALTER TABLE attempt_sessions
  ADD COLUMN IF NOT EXISTS participant_name text;

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS participant_name text;
