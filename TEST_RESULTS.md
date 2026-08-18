# Test Results

Date: 2026-06-17  
Package version: 2.3.1

## Summary

| Area | Status | Evidence |
|---|---:|---|
| Smoke test | Passed | `npm run smoke` |
| Code quality / syntax | Passed | `npm run check` |
| Security/privacy checks | Passed | `npm run security:check` |
| Functional unit tests | Passed | `npm test` |
| Build-time test | Passed | `npm run build` |
| 1,000-row dashboard performance smoke | Passed | `npm run perf:smoke` |
| Local Docker-compatible server smoke | Passed | `/` returned 200 and `/api/healthz` returned 200 through `server/docker-server.js` |
| Protected puzzle image route | Passed | Smoke test verifies `/api/puzzle` returns a PNG only after a valid attempt token |
| Country reporting | Passed | Config, sessions, leaderboard, country report, filters, and CSV export include country |
| Code-generation test | Passed | Generated sample codes and SQL hash import file with all migrations |
| Docker CLI build/run in this sandbox | Not executable here | Docker CLI is unavailable in this environment: `docker: command not found` |
| Real Vercel/Supabase post-deployment verification | Not executed here | Requires your deployed Vercel URL and Supabase project; script included |

## Commands executed successfully

```bash
npm run preflight
```

The preflight command completed successfully and ran:

```text
npm run check
npm test
npm run security:check
npm run smoke
npm run perf:smoke
npm run build
```

Key output from the latest run:

```text
10 tests passed
Security checks passed
Smoke checks passed: healthz, readyz, config countries, validation, protected puzzle image, leaderboard country reporting, admin auth, CSV shaping, OPTIONS handling.
Performance smoke passed: shaped 1,000 leaderboard rows and country report in 5.8ms.
Static build completed: dist/
```

## Functional behavior verified

| Behavior | Result |
|---|---:|
| Challenge code normalization supports spaces/hyphens | Passed |
| Country selection is required before code acceptance | Passed |
| Only supported countries are accepted | Passed |
| Valid code creates an attempt session with a country | Passed |
| Puzzle image route requires valid attempt session/token | Passed |
| Submissions inherit country from the accepted attempt session | Passed |
| One final submission per challenge code is enforced | Passed |
| Leaderboard shows challenge-code reference and country | Passed |
| Country participation report aggregates responses by country | Passed |
| Word-level insights remain hidden until challenge close | Passed |
| Live UI does not render the old score-bucket card | Passed |
| Unlock flow explicitly removes the puzzle overlay | Passed |
| Step 3 response card spacing/layout regression test | Passed |

## Local Docker-compatible server smoke

After `npm run build`, the Docker-compatible Node server was started on port `8099` and checked with `curl`.

Checked:

```text
GET /              -> 200
GET /api/healthz   -> 200
```

The API health response was:

```json
{"ok":true,"service":"fun-zone-arena-api","version":"2.3.1"}
```

The rendered HTML includes the country selector, Fun Zone Arena red theme metadata, How it works card, and Nickname leaderboard column.

## Code-generation smoke

Executed a 5-code generation test with a temporary secret.

Generated files:

```text
codes-private.csv
supabase-setup-and-codes.sql
README-CODES.txt
```

Confirmed that the SQL import file contains `challenge_codes.code_hash` and `challenge_codes.code_fingerprint`, plus the latest country-reporting migration. It does not store raw challenge codes in Supabase.

## Docker status

Docker support is included through:

```text
Dockerfile
docker-compose.yml
.dockerignore
server/docker-server.js
```

The Docker stack is designed to run:

```bash
docker compose up --build
npm run docker:smoke
npm run docker:smoke:submit
```

I could not execute Docker build/run inside this sandbox because no Docker CLI is installed. The Dockerfile still runs these checks during image build:

```text
npm run check
npm test
npm run security:check
npm run build
```

The mock smoke test also verifies the key Docker/Vercel behavior that caused your issue: once a valid attempt session/token exists, `/api/puzzle` returns the protected PNG image.

## Post-deployment verification

After deploying to Vercel, run:

```bash
APP_BASE_URL="https://your-project.vercel.app" npm run verify:deployment
```

For a full consuming smoke test with a dedicated test code:

```bash
APP_BASE_URL="https://your-project.vercel.app" \
CHALLENGE_ID="fun-zone-arena-2026" \
SMOKE_COUNTRY="Kenya" \
SMOKE_CHALLENGE_CODE="paste-one-test-code" \
SMOKE_SUBMIT=true \
npm run verify:deployment
```

This verifies health, readiness, config, country list, leaderboard shape, protected puzzle image loading, and one actual submission.

## Production fairness update test - 2026-08-17

Applied the requested production adjustments:

- Staff names remain enabled and visible on the dashboard, with the fun nickname shown underneath.
- The expanded country list is now the tested production list: Kenya, Uganda, Tanzania, Burundi, Rwanda, Angola, DRC, Mozambique, Nigeria, Malawi, Zambia, South Africa, UAE, UK, Canada, Others.
- Country response ranking now sorts by average score first, then top score, then response count, then fastest average time.
- The dashboard API and frontend remain locked until the participant submits their response. A valid accepted code reveals the puzzle only; dashboard results unlock after submission.
- The answer submission limit remains unchanged as requested.

Latest local result:

```text
npm run preflight
21 tests passed
Security checks passed
Smoke checks passed
Performance smoke passed: shaped 1,000 leaderboard rows and country report in 12.4ms
Static build completed: dist/
```

## 1,000-code generation check - 2026-08-17

Generated a temporary 1,000-code production-style batch using prefix `FZA`.

```text
Rows generated: 1,000
Unique raw codes: 1,000
Unique normalized codes: 1,000
Unique nicknames: 1,000
Raw code leaks in SQL import file: 0
```

The generated Supabase SQL import file stores code hashes/fingerprints/nicknames only. The raw codes remain only in `codes-private.csv` for private distribution.


## 2.3.1 validation

Validated noindex controls, font CSP, 45-second leaderboard polling, and manual dashboard refresh button with the local preflight suite.
