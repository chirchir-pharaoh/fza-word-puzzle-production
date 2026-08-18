# Fun Zone Arena Word Puzzle

Demo-ready version for **Vercel + Supabase Postgres** with a matching **Docker local/staging environment**.

The app now asks each participant for:

1. **Name** — shown on the dashboard so organizers know who submitted.
2. **Country** — selected from the expanded production country list: Kenya, Uganda, Tanzania, Burundi, Rwanda, Angola, DRC, Mozambique, Nigeria, Malawi, Zambia, South Africa, UAE, UK, Canada, Others.
3. **Challenge Code** — a unique random code generated for each participant outside the application.

It does **not** ask for employee number, email, department, or job title.

---

## What this version fixes

- Keeps a bold Fun Zone Arena theme using **red `#D52B1E`**, black, and white.
- Requires **Name + Country + Challenge Code** before the puzzle can be revealed.
- Fixes the puzzle-reveal flow by loading the protected puzzle image and explicitly removing the overlay before marking the puzzle as unlocked.
- Moves **How it works** above Step 3 and expands the Step 3 response card spacing so the answer panel looks less squeezed.
- Replaces the former score-bucket card with country/progress reporting so the target word count is not emphasized during the live challenge.
- Shows the participant **Name** on the leaderboard with the generated funny **Nickname** underneath.
- Locks the dashboard route and API so only users who have submitted a response can view results.
- Adds a returning-player code login: unused codes ask for name/country to start, while used codes open a dashboard-only results session.
- Adds country to the leaderboard table and adds a country participation report and fair country performance ranking.
- Keeps the raw challenge code out of Supabase; the database stores only an HMAC hash, short internal code reference, nickname, and participant-entered name.

---

## Project structure

```text
.
├── api/index.js                    # Vercel Function entrypoint for /api/*
├── server/
│   ├── http.js                     # HTTP routing, JSON responses, admin export, protected puzzle route
│   ├── db.js                       # Supabase/Postgres access, migrations, sessions, submissions
│   ├── domain.js                   # Answer key, country list, validation, scoring, leaderboard shaping
│   ├── schema.js                   # Embedded SQL migrations used by Vercel and Docker
│   ├── docker-server.js            # Local Docker static + API server
│   └── assets/puzzle.png           # Protected puzzle image, not public
├── src/
│   ├── main.js                     # Browser logic: code gate, puzzle reveal, answer entry, leaderboard
│   └── styles.css                  # Fun Zone Arena red/black/white visual theme
├── scripts/
│   ├── generate-codes.mjs          # Creates private raw codes and safe Supabase SQL import
│   ├── migrate.mjs                 # Runs database migrations manually
│   ├── smoke-mock.mjs              # Mock API smoke test
│   ├── security-check.mjs          # Static security assertions
│   ├── performance-smoke.mjs       # 1,000-participant leaderboard shaping test
│   └── deployment-verify.mjs       # Docker/Vercel URL verification script
├── migrations/                     # SQL files for review/manual DB setup
├── Dockerfile                      # Production-style Docker image
├── docker-compose.yml              # Local app + Postgres environment
├── vercel.json                     # Vercel build, routing, and security headers
└── package.json                    # Build/test/deployment commands
```

---

## How the main code blocks work

### `server/domain.js`

This file contains the business rules.

```js
const SERVICE_LINES = [...];
```

The correct answer key stays server-side. The frontend never imports this list, so participants cannot see the correct answers in browser source.

```js
const COUNTRIES = ['Kenya', 'Uganda', ...];
```

This uses the expanded production country list and is used by both `/api/config` and request validation.

```js
function validateSessionPayload(payload) { ... }
```

Validates the participant name, country, challenge ID, and challenge code before a session is created.

```js
function validateSubmissionPayload(payload) { ... }
```

Validates the attempt session, attempt token, and submitted answers. It intentionally does not accept employee number, email, department, or job-title fields.

```js
function buildLeaderboardState(...) { ... }
```

Ranks submissions, builds top-three results, computes country participation, and hides word-level answer insights until the challenge ends.

### `server/db.js`

This file handles all database operations.

```js
createAttemptSession(...)
```

Checks that the challenge is open, validates the challenge-code hash against `challenge_codes`, stores participant name and country on the attempt session, and returns a protected session token.

```js
insertSubmission(...)
```

Verifies the attempt token, copies the participant name and country from the attempt session, calculates the score server-side, inserts the submission, and marks the challenge code as used.

```js
migrate(...)
```

Runs embedded SQL migrations using a Postgres advisory lock so parallel Vercel cold starts do not apply migrations at the same time.

### `server/http.js`

This file exposes the API.

Important routes:

```text
GET  /api/healthz
GET  /api/readyz
GET  /api/config
POST /api/sessions
POST /api/code-login
POST /api/puzzle
POST /api/submissions
POST /api/leaderboard
GET  /api/admin/export.csv
GET  /api/admin/duplicate-device-audit.csv
```

`POST /api/puzzle` is protected. It requires a valid attempt session and token before returning `server/assets/puzzle.png`.
`POST /api/leaderboard` is also protected. It requires an accepted attempt session and token before returning dashboard data, and the session must already be submitted.
`POST /api/code-login` lets returning participants enter their challenge code again after refresh; used codes receive dashboard-only access, while unused codes must still provide name and country through `/api/sessions`.
`GET /api/admin/duplicate-device-audit.csv` is admin-only and exports only same-device, different-code audit matches. It stores hashed IP and hashed browser signature, not raw laptop logs or raw challenge codes.

### `src/main.js`

This is the browser application.

```js
handleStart(event)
```

Reads the participant name, selected country, and challenge code, calls `/api/sessions`, then unlocks the puzzle; dashboard access unlocks only after submission.

```js
loadPuzzleImage(session)
```

Calls `/api/puzzle`, receives the protected PNG, converts it to a blob URL, waits for the image to load, and then calls `hidePuzzleOverlay()` so the overlay is removed in both CSS and JavaScript.

```js
renderCountryReport(state)
```

Builds the dashboard section showing response counts and fair country performance ranked by average score, then top score, responses, and average time.

```js
renderLeaderboardTable(state)
```

Displays leaderboard rows using participant name, nickname, country, score, time, and submitted date.

### `src/styles.css`

The frontend theme uses Fun Zone Arena colors:

```css
--gw-red: #D52B1E;
--gw-black: #0E0E10;
--gw-white: #FFFFFF;
```

The layout uses a two-column desktop design. The left side shows Step 1 and Step 2; the right side shows How it Works and Step 3, so participants can view the puzzle and submit answers with minimal scrolling.

---

## Local checks

Run all non-Docker checks:

```bash
npm run preflight
```

This runs:

```text
npm run check
npm test
npm run security:check
npm run smoke
npm run perf:smoke
npm run build
```

---

## Docker local/staging test

Start local Postgres and the app:

```bash
docker compose up --build
```

Open:

```text
http://localhost:8080
```

Demo Docker challenge codes:

```text
FZADEMO0001
FZADEMO0002
FZADEMO0003
FZADEMO0004
FZADEMO0005
```

Type a name, use any supported country, for example **Kenya**, then enter one of the demo codes. The puzzle should unlock after the code is accepted; the dashboard unlocks after you submit.

Run a non-consuming Docker smoke test:

```bash
npm run docker:smoke
```

Run a consuming Docker end-to-end smoke test:

```bash
npm run docker:smoke:submit
```

That command resets the local challenge first, starts a session with `FZADEMO0001`, verifies the protected puzzle PNG, submits answers, and checks the leaderboard response.

To reset Docker data manually:

```bash
docker compose down -v
docker compose up --build
```

---

## Supabase setup

Create a Supabase project and use the **Transaction Pooler** Postgres connection string for Vercel.

In the Supabase dashboard, click **Connect**, choose **Transaction pooler**, and
copy the complete string. Do not use the direct `db.<project-ref>.supabase.co:5432`
endpoint for a Vercel function unless the Supabase IPv4 add-on is enabled and
`ALLOW_SUPABASE_DIRECT_CONNECTION=true` is deliberately set.

Set this in Vercel:

```env
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?sslmode=require
PGSSLMODE=require
PGPOOL_MAX=1
```

If the database password contains reserved URL characters such as `@`, `#`,
`/`, `?`, `%`, or `:`, use the connection string produced by Supabase Connect
or URL-encode the password. Paste the Vercel value without surrounding quotes.

---

## Generate 1,000 unique challenge codes

Generate a secret:

```bash
npm run secret
```

Use that secret to generate codes:

```bash
CODE_HASH_SECRET="paste-the-secret-here" npm run codes:generate -- \
  --count 1000 \
  --prefix FZA \
  --challenge fun-zone-arena-2026 \
  --title "Fun Zone Arena Challenge" \
  --start 2026-06-24T06:00:00Z \
  --end 2026-07-01T06:00:00Z \
  --out private/generated-codes
```

Generated files:

```text
private/generated-codes/codes-private.csv
private/generated-codes/supabase-setup-and-codes.sql
private/generated-codes/README-CODES.txt
```

The CSV contains 1,000 unique Fun Zone Arena codes and 1,000 unique two-word animal-style nicknames without numeric suffixes. Use `codes-private.csv` only for internal distribution. Do not upload it to GitHub, Vercel, or Supabase.

Run `supabase-setup-and-codes.sql` in Supabase SQL Editor. It imports only hashed codes and public code references.

---

## Vercel deployment

Use the free Vercel subdomain for the project.

Recommended Vercel settings:

```text
Framework Preset: Other
Build Command: npm run build
Output Directory: dist
Install Command: npm install
```

Required Vercel environment variables:

```env
DATABASE_URL=<Supabase transaction pooler URL>
PGSSLMODE=require
PGPOOL_MAX=1
CODE_HASH_SECRET=<same secret used to generate the codes>
ADMIN_API_KEY=<long random secret>
ATTEMPT_TOKEN_SALT=<long random secret>
IP_HASH_SALT=<long random secret>
CHALLENGE_ID=fun-zone-arena-2026
CHALLENGE_TITLE=Fun Zone Arena Challenge
CHALLENGE_START_AT=2026-06-24T06:00:00Z
CHALLENGE_END_AT=2026-07-01T06:00:00Z
CHALLENGE_STATUS=active
SYNC_CHALLENGE_WINDOW=true
RUN_MIGRATIONS_ON_START=true
ACCEPT_LATE_SUBMISSIONS=false
RATE_LIMIT_MAX=1200
RATE_LIMIT_WINDOW_MS=60000
BODY_LIMIT_BYTES=65536
```

After deployment:

```bash
APP_BASE_URL=https://your-project-name.vercel.app npm run verify:deployment
```

For a full consuming test on staging, use a disposable code:

```bash
APP_BASE_URL=https://your-staging-project.vercel.app \
CHALLENGE_ID=fun-zone-arena-2026 \
SMOKE_COUNTRY=Kenya \
SMOKE_CHALLENGE_CODE=<disposable-code> \
SMOKE_SUBMIT=true \
npm run verify:deployment
```

---

## Admin export

CSV export:

```bash
curl -H "X-Admin-API-Key: $ADMIN_API_KEY" \
  https://your-project-name.vercel.app/api/admin/export.csv
```

The CSV includes:

```text
rank, submission_id, participant_name, nickname, participant_alias, challenge_code_ref,
country, correct_count, time_taken_minutes, time_taken_ms, submitted_at, answers, word_hits
```

Duplicate-device audit export:

```bash
curl -H "X-Admin-API-Key: $ADMIN_API_KEY" \
  https://your-project-name.vercel.app/api/admin/duplicate-device-audit.csv
```

This CSV is empty unless a submitted response matches an earlier response from the same hashed IP and hashed browser signature but with a different challenge code.

---

## Production checklist

Before sending the challenge link to staff:

```text
[ ] Supabase SQL import completed
[ ] Vercel env vars set
[ ] CODE_HASH_SECRET matches the code-generation secret
[ ] Vercel deployment succeeds
[ ] /api/healthz returns ok
[ ] /api/readyz returns ok
[ ] Name field and country dropdown load
[ ] Test code unlocks puzzle image
[ ] Dashboard is locked before code entry
[ ] Test submission appears on leaderboard with name above nickname
[ ] Country report updates after submission
[ ] Admin CSV export works
[ ] Private raw code CSV is stored securely outside the repository
```


## Production privacy: search indexing controls

This package includes three public-discovery controls for the Vercel demo domain:

- `public/robots.txt` disallows crawling.
- `index.html` includes a `noindex, nofollow, noarchive, nosnippet, noimageindex` robots meta tag.
- `vercel.json` sends the same rule as an `X-Robots-Tag` response header.

These controls reduce accidental search discovery. They are not authentication. Continue sharing the Vercel URL only with intended participants.

## Dashboard refresh behavior

The leaderboard/dashboard now refreshes automatically every 45 seconds and includes a **Refresh now** button for manual updates after a participant submits their response.
