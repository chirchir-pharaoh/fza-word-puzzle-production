# Production Retest Report - 2026-08-17

Package tested: `fza-word-puzzle-production-indexing-refresh-fixed.zip`

## Result

I support moving to production after completing live Vercel + Supabase verification with production environment variables and a small pilot submission test.

## Local automated checks completed

Command run:

```bash
npm run preflight
```

Passed checks:

- JavaScript syntax check
- Node unit tests
- Security checks
- Mock smoke test
- Performance smoke test
- Static build

Summary:

- 22 tests passed
- 0 tests failed
- Security checks passed
- Smoke checks passed
- Performance smoke passed
- Static build completed

## Performance result

The local performance smoke test shaped 1,000 leaderboard rows and the country report in approximately 10 ms.

## Code generation check

A fresh 1,000-code batch was generated for testing. Results:

- 1,000 rows generated
- 1,000 unique raw codes
- 1,000 unique normalized codes
- No raw challenge codes leaked into the SQL import file

## Minor fixes applied during retest

- Changed visible form label from `Service Lines Found` to `Words Found`.
- Cleaned stale deployment-guide examples that still referenced old `GWDEMO` and `gw-service-lines-demo` demo values.

## Live checks still required after deployment

These require real Vercel and Supabase credentials/URLs and were not possible in the sandbox:

- Supabase database connection test
- Vercel production deployment verification
- Admin CSV export from the deployed URL
- 5 to 10 real pilot submissions using disposable production codes
- Duplicate-code rejection on the deployed URL
- Dashboard lock before submission on the deployed URL
- Dashboard unlock after submission on the deployed URL

## Go / no-go recommendation

Go for production after live deployment verification passes. Use paid Vercel/Supabase plans for a formal organization-wide production event if this is not just a controlled demo/pilot.
