# Security Notes

This production version collects participant name, participation country, and the unique challenge code required to start the puzzle. It does not collect employee number, email, department, job title, or raw challenge codes in the database.

## Challenge codes

- Raw challenge codes are generated outside the app with `scripts/generate-codes.mjs`.
- Supabase stores only `code_hash`, `code_fingerprint`, generated nickname metadata, participant-entered name, country, score, and timing results.
- `code_hash` is an HMAC-SHA256 value using `CODE_HASH_SECRET`.
- `code_fingerprint` is a short public reference used on the leaderboard.
- Keep `private/generated-codes/codes-private.csv` out of Git, Vercel, Docker images, and Supabase.

## Puzzle protection

The puzzle image is stored at `server/assets/puzzle.png`, not under `public/`. The browser can only retrieve it through `POST /api/puzzle` after a valid attempt session and token are created.

## Database protections

- One final submission per challenge code is enforced by `CONSTRAINT uq_submission_challenge_code UNIQUE (challenge_id, code_hash)`.
- SQL queries use parameterized statements.
- Migrations use a Postgres advisory lock to avoid concurrent cold-start migration issues.
- Vercel/Supabase should use the Supabase Transaction Pooler and `PGPOOL_MAX=1`.

## Dashboard privacy

The public leaderboard displays:

- participant-entered name;
- fun generated nickname;
- country;
- score;
- time;
- submitted timestamp.

It does not display raw challenge codes, employee numbers, email addresses, departments, or job titles.

## Admin endpoints

Admin endpoints require `ADMIN_API_KEY`. The token comparison uses `crypto.timingSafeEqual` through `timingSafeEqualText`.

Protected routes include:

```text
GET  /api/admin/challenge
GET  /api/admin/export
GET  /api/admin/export.csv
POST /api/admin/cleanup-sessions
POST /api/admin/reset
```

`POST /api/admin/reset` is disabled unless `ENABLE_ADMIN_RESET=true`. Keep that setting for local Docker only.

## Logging

The API avoids logging request bodies, challenge codes, and answer arrays. Operational logs include only safe fields such as request ID, status, and error code.
