# Vercel login fix for the 1,000-code production set

The supplied 1,000-code set is internally consistent. It is configured for:

- Challenge ID: `fza-word-puzzle-production`
- Start: `2026-09-02T06:00:00Z`
- End: `2026-09-09T06:00:00Z`

## Why Continue is disabled

The page calls `/api/config` before it enables Continue. A Vercel log containing
`ENOTFOUND` means the API could not resolve the PostgreSQL hostname. No challenge
code has been checked yet.

## Required correction

1. Rotate the database password that was previously exposed.
2. In Supabase, click **Connect** and select **Transaction pooler**.
3. Copy the complete connection string. It must use a pooler hostname, the
   project-qualified username (`postgres.<project-ref>`), and port `6543`.
4. Put that exact value in Vercel as `DATABASE_URL`, enabled for **Production**.
   Paste the value without surrounding quotes. Do not use
   `db.<project-ref>.supabase.co:5432`.
5. Set `PGSSLMODE=require` and `PGPOOL_MAX=1`.
6. Run `supabase-setup-and-codes.sql` from the separate private code pack in the
   Supabase SQL Editor.
7. Copy the values from `VERCEL_ENV_VALUES_USE_WITH_THESE_CODES.txt` in that
   private code pack. `CODE_HASH_SECRET` must be exact, without quotes or spaces.
8. Set separate strong values (at least 32 characters) for `ADMIN_API_KEY`,
   `ATTEMPT_TOKEN_SALT`, and `IP_HASH_SALT`.
9. Do not add `SUPABASE_URL`, `SUPABASE_ANON_KEY`, or
   `SUPABASE_SERVICE_ROLE_KEY`; this application connects only through
   `DATABASE_URL`.
10. Redeploy the Vercel Production deployment after saving the variables.

## Verify in this order

- `/api/healthz` returns HTTP 200.
- `/api/readyz` returns HTTP 200.
- `/api/config` returns HTTP 200 and challenge ID
  `fza-word-puzzle-production`.
- A code from the private CSV advances from login to the name/country form.

The puzzle itself will not start before September 2, 2026 at 06:00 UTC with the
supplied production dates. For an earlier test, temporarily use an earlier start
time with `SYNC_CHALLENGE_WINDOW=true`, redeploy, and restore the production time
before distribution.

