# Login/configuration fix validation

Date: 2026-08-18

## Root cause

The production log showed `GET /api/config` returning HTTP 500 with
`ENOTFOUND`. The page loads `/api/config` before enabling Continue, so the
failure occurred before any participant code was validated. The configured
Supabase direct database endpoint was not reachable from the Vercel function.

Supabase documents the direct endpoint as IPv6 by default and recommends the
shared Transaction pooler for serverless/edge functions. The production
`DATABASE_URL` must therefore be copied from **Supabase → Connect → Transaction
pooler** and use port `6543`.

Reference: <https://supabase.com/docs/guides/database/connecting-to-postgres>

## Code changes

- Validate `DATABASE_URL` before initializing PostgreSQL.
- Detect the Supabase direct endpoint on Vercel and return the actionable
  `supabase_direct_database_url` diagnostic.
- Map DNS, reachability, timeout, and authentication failures to safe error
  codes without disclosing credentials.
- Reset a failed bootstrap promise so a warm Vercel function can recover after
  a transient database failure.
- Use a transaction-scoped migration advisory lock compatible with transaction
  pooling.
- Show users that the database is unavailable instead of implying that their
  participant code is wrong.
- Add the API request reference to the browser error for log correlation.
- Improve the deployment verifier's failure output.

## Production code-set verification

- 1,000 private participant codes detected.
- A generated code hash was independently recomputed with the supplied
  `CODE_HASH_SECRET` and matched the SQL import.
- Challenge ID: `fza-word-puzzle-production`.
- Challenge window: September 2, 2026 06:00 UTC through September 9, 2026 06:00
  UTC.
- No private raw codes or production secrets are included in this application
  archive.

## Verification results

- JavaScript syntax checks: passed.
- Automated tests: 27 passed, 0 failed.
- Security checks: passed.
- Mock API smoke checks: passed.
- 1,000-row performance smoke: passed.
- Static production build: passed.

The dependency lockfile remains pinned to `pg` 8.13.1. Installing dependencies
from the public npm registry was not possible in the restricted validation
workspace, but the manifest and lockfile are included for Vercel's normal
install step.

