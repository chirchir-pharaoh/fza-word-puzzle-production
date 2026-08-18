# QA Report

Package version: `2.3.1`

Date of local validation: `2026-06-17`

## Summary

The code was updated for the revised Fun Zone Arena challenge requirements:

- Fun Zone Arena visual theme using red `#D52B1E`, black, and white.
- Country selector restored from the expanded production country list.
- Challenge code remains the only participant identifier shown on the dashboard.
- Valid country + code now unlocks the protected word-puzzle image and explicitly removes the overlay.
- The visible page no longer shows the removed privacy phrase.
- Step 3 was pushed down by a new `How it works` card and the response tile was widened/spaced for better readability.
- The leaderboard now shows country, participant challenge-code reference, country reporting, and a participation snapshot.
- The old live score-bucket card is not rendered.

The following checks were executed successfully in this sandbox:

```bash
npm run preflight
```

Result:

```text
PASS npm run check
PASS npm test
PASS npm run security:check
PASS npm run smoke
PASS npm run perf:smoke
PASS npm run build
```

## Smoke test

Command:

```bash
npm run smoke
```

Result:

```text
Smoke checks passed: healthz, readyz, config countries, validation, protected puzzle image, leaderboard country reporting, admin auth, CSV shaping, OPTIONS handling.
```

Coverage:

```text
GET /api/healthz
GET /api/readyz
GET /api/config including country list
POST /api/sessions rejects missing country
POST /api/puzzle returns PNG after valid attempt token
GET /api/leaderboard includes participant code reference and country report
GET /api/admin/export.csv includes country and code reference
OPTIONS preflight handling
```

## Code quality checks

Command:

```bash
npm run check
```

Result:

```text
PASS
```

Coverage:

```text
api/index.js
server/domain.js
server/db.js
server/http.js
server/docker-server.js
src/main.js
scripts/build-static.mjs
scripts/generate-codes.mjs
scripts/migrate.mjs
scripts/security-check.mjs
scripts/smoke-mock.mjs
scripts/performance-smoke.mjs
scripts/deployment-verify.mjs
```

## Functional unit tests

Command:

```bash
npm test
```

Result:

```text
10 tests passed
0 tests failed
```

Validated behavior:

```text
Challenge-code normalization
Secret-dependent challenge-code hashing
Answer sanitization and deduplication
Server-side scoring
Country list restored from the original package
Session payload requires challenge ID, supported country, and challenge code
Submission payload carries only attempt token fields and answers; participant name/country are captured at session start
Leaderboard uses challenge-code references and country reporting
Word stats are hidden until the challenge ends
Puzzle overlay removal is guarded by a UI regression test
Step 3 spacing/layout is guarded by a UI regression test
```

## Security checks

Command:

```bash
npm run security:check
```

Result:

```text
Security checks passed: no employee numbers/emails/job fields, supported country reporting, protected puzzle asset, answer key server-side, admin guard, safe logging, one-code-one-submission schema, private files ignored.
```

Validated controls:

```text
No employee-name form fields
No employee-number form fields
No email/department/job-title form fields
Country field is constrained to the supported list
Puzzle image is not in public/assets
Puzzle image exists only in server/assets and is served by /api/puzzle after token verification
Answer key is server-side
Admin guard exists
Admin token comparison is constant-time
Logs do not include request bodies, challenge codes, or answers
Database schema has one-submission-per-code constraint
Database schema stores country for reporting
.gitignore excludes private generated code files and env files
.dockerignore excludes private generated code files and env files
Vercel security headers are configured
```

## Functional build-time test

Command:

```bash
npm run build
```

Result:

```text
Static build completed: dist/
```

Generated files:

```text
dist/index.html
dist/assets/main.js
dist/assets/styles.css
dist/assets/logo.example.svg
dist/config.json
```

The build output was checked to confirm the production HTML references `/assets/styles.css` and `/assets/main.js`, not development-only `/src/*` paths.

## Platform and performance testing

Command:

```bash
npm run perf:smoke
```

Result:

```text
Performance smoke passed: shaped 1,000 leaderboard rows and country report in 5.8ms.
```

This validates application-level dashboard shaping for the expected 1,000 staff responses and country report aggregation.

## Docker-compatible local server smoke

A local Node server using the same runtime entry point as Docker was started after the static build.

Checked:

```text
GET /              -> 200
GET /api/healthz   -> 200
```

Health response:

```json
{"ok":true,"service":"fun-zone-arena-api","version":"2.3.1"}
```

The served HTML contains:

```text
Country selector
How it works card
Nickname leaderboard column
Fun Zone Arena red theme metadata
```

## Docker testing status

Docker files are included:

```text
Dockerfile
docker-compose.yml
.dockerignore
server/docker-server.js
```

Docker could not be executed inside this sandbox because the `docker` command is not installed. The Docker Compose configuration uses a safe local seeding path: `ALLOW_SEED_CODES_FROM_ENV=true` plus demo-only `SEED_CHALLENGE_CODES`. The following commands are ready for local execution:

```bash
docker compose up --build
npm run docker:smoke
npm run docker:smoke:submit
docker compose down -v
```

The default Docker demo codes are:

```text
FZADEMO0001
FZADEMO0002
FZADEMO0003
FZADEMO0004
FZADEMO0005
```

## Staging verification status

A staging Vercel URL and Supabase credentials are required to verify a real staging deployment. The verification script is included and ready. It checks health, readiness, config, country list, leaderboard shape, security headers, invalid code rejection, protected puzzle image loading, and optional admin/submission behavior:

```bash
APP_BASE_URL=https://your-staging-project.vercel.app npm run verify:deployment
```

## Post-deployment verification status

A production Vercel URL is required to verify production. The same script is used after deployment:

```bash
APP_BASE_URL=https://your-production-project.vercel.app npm run verify:deployment
```

For a consuming end-to-end test, add one disposable code:

```bash
APP_BASE_URL=https://your-production-project.vercel.app \
SMOKE_COUNTRY=Kenya \
SMOKE_CHALLENGE_CODE="paste-disposable-test-code" \
SMOKE_SUBMIT=true \
npm run verify:deployment
```

This consumes the disposable code.

## Production readiness update - 2026-08-17

Requested fixes applied and checked:

| Item | Result |
|---|---:|
| Staff names retained | Passed |
| Expanded country list retained and tested | Passed |
| Fair country ranking by average score, top score, response count, and average time | Passed |
| Submitted-answer maximum left unchanged by request | Passed |
| Dashboard locked until after submission | Passed |
| Full preflight | Passed |

The dashboard is now intentionally locked after code acceptance and before submission. A valid code starts the puzzle attempt only. The participant sees standings and country performance after submitting.


## Additional production fixes in 2.3.1

- Search-index controls added through robots.txt, robots meta tag, and Vercel `X-Robots-Tag` header.
- Google Fonts CSP fixed by allowing `fonts.googleapis.com` and `fonts.gstatic.com`.
- Leaderboard polling reduced from 15 seconds to 45 seconds.
- Manual **Refresh now** dashboard button added.
