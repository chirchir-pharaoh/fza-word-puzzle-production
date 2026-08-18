FZA  Puzzle - Free Vercel + Supabase Deployment Guide

This guide explains how to deploy the Word Puzzle challenge for demo/testing using:

- Vercel Hobby/free project
- Free Vercel subdomain, for example `your-project.vercel.app`
- Supabase Free project
- Supabase Postgres transaction pooler
- Unique challenge codes plus country selection

> Use this free setup for demo and testing only. For a formal company-wide production rollout, upgrade to paid/commercial plans and complete security review.

---

## 1. What you need before starting

Install or create the following:

1. Node.js 20 or newer
2. npm
3. Git
4. A GitHub account
5. A Vercel account
6. A Supabase account
7. The latest project ZIP package

Recommended local folder name:

```bash
fza-word-puzzle-vercel-supabase
```

---

## 2. Extract and inspect the project

Unzip the package, then open a terminal in the extracted project folder.

Expected files:

```text
api/index.js
server/
src/
public/
scripts/
migrations/
Dockerfile
docker-compose.yml
vercel.json
package.json
README.md
```

Run:

```bash
npm install
npm run preflight
```

Expected result:

```text
Smoke checks passed
Security checks passed
Static build completed
```

If `npm install` fails, confirm that Node.js and npm are installed and that your network can access the npm registry.

---

## 3. Create a free Supabase project

1. Log in to Supabase.
2. Create a new organization on the Free plan if needed.
3. Create a new project.
4. Give it a name such as:

```text
gw-word-puzzle-demo
```

5. Choose a database password and save it securely.
6. Choose a region close to your expected users.
7. Wait for Supabase to finish provisioning the project.

---

## 4. Get the Supabase database URL

In Supabase:

1. Open your project.
2. Go to **Connect** or **Project Settings > Database**.
3. Copy the **Transaction pooler** connection string.
4. Replace the placeholder password with your real database password.

It will look similar to this:

```text
postgresql://postgres.xxxxxxxxxxxxx:[YOUR-PASSWORD]@aws-0-region.pooler.supabase.com:6543/postgres
```

Use the transaction pooler URL for Vercel because Vercel functions are serverless and may create short-lived database connections.

Save this value temporarily. You will use it as `DATABASE_URL` in Vercel.

---

## 5. Generate strong secrets

From the project root, generate four secrets.

Mac/Linux:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Windows PowerShell:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Assign them as:

```text
CODE_HASH_SECRET=<secret 1>
ADMIN_API_KEY=<secret 2>
ATTEMPT_TOKEN_SALT=<secret 3>
IP_HASH_SALT=<secret 4>
```

Important: `CODE_HASH_SECRET` must be the same when you generate challenge codes and when you deploy the app to Vercel.

---

## 6. Choose your demo challenge settings

For a free demo, use a demo challenge ID and 50-100 test codes first.

Example:

```text
CHALLENGE_ID=fza-word-puzzle-demo
CHALLENGE_TITLE=Fun Zone Arena Word Puzzle Demo Challenge
CHALLENGE_START_AT=2026-06-18T00:00:00Z
CHALLENGE_END_AT=2026-06-25T23:59:59Z
CHALLENGE_STATUS=active
```

Dates must be in UTC ISO format.

---

## 7. Generate challenge codes

The app does not store raw challenge codes in Supabase. It stores only secure hashes.
For production, use `--count 1000` and a Fun Zone Arena prefix such as `FZA`. The generated private CSV includes one unique raw code and one unique two-word animal-style nickname per participant, with no numeric nickname suffixes.

Mac/Linux:

```bash
CODE_HASH_SECRET="paste-your-code-hash-secret-here" npm run codes:generate -- \
  --count 100 \
  --prefix FZADEMO \
  --challenge fza-word-puzzle-demo \
  --title "Fun Zone Arena Word Puzzle Demo Challenge" \
  --start 2026-06-18T00:00:00Z \
  --end 2026-06-25T23:59:59Z \
  --out private/generated-codes
```

Windows PowerShell:

```powershell
$env:CODE_HASH_SECRET="paste-your-code-hash-secret-here"
npm run codes:generate -- --count 100 --prefix FZADEMO --challenge fza-word-puzzle-demo --title "Fun Zone Arena Word Puzzle Demo Challenge" --start 2026-06-18T00:00:00Z --end 2026-06-25T23:59:59Z --out private/generated-codes
```

This creates:

```text
private/generated-codes/codes-private.csv
private/generated-codes/supabase-setup-and-codes.sql
private/generated-codes/README-CODES.txt
```

Use `codes-private.csv` only for distributing codes to test users. Do not upload it to GitHub, Vercel, Supabase, or shared dashboards.

---

## 8. Import database schema and hashed codes into Supabase

1. Open your Supabase project.
2. Go to **SQL Editor**.
3. Open this generated local file:

```text
private/generated-codes/supabase-setup-and-codes.sql
```

4. Copy all SQL from the file.
5. Paste it into Supabase SQL Editor.
6. Click **Run**.

Expected result: the database tables are created and the hashed challenge codes are inserted.

Do not paste `codes-private.csv` into Supabase. Only the generated SQL file should be used.

---

## 9. Confirm the database was created

In Supabase SQL Editor, run:

```sql
select count(*) as code_count from participant_codes;
select count(*) as challenge_count from challenges;
```

Expected result for a 100-code demo:

```text
code_count = 100
challenge_count = 1
```

---

## 10. Push the project to a private GitHub repository

Use a private repository because the server-side answer key is part of the app source code.

From the project folder:

```bash
git init
git add .
git commit -m "Initial FZA word puzzle demo deployment"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-PRIVATE-REPO.git
git push -u origin main
```

Before pushing, confirm these are not tracked:

```bash
git status --ignored
```

Make sure the following are ignored or absent from Git:

```text
.env
.env.local
.env.production
private/
private/generated-codes/codes-private.csv
node_modules/
dist/
```

If `private/generated-codes/codes-private.csv` appears under files to be committed, stop and fix `.gitignore` before pushing.

---

## 11. Create the free Vercel project

1. Log in to Vercel.
2. Click **Add New Project**.
3. Import the private GitHub repository.
4. Keep the project on the Hobby/free account for demo/testing.
5. Use these build settings:

```text
Framework Preset: Vite
Root Directory: .
Install Command: npm install
Build Command: npm run build
Output Directory: dist
```

6. Do not deploy yet if Vercel allows you to add environment variables first. If it deploys immediately and fails, that is okay; add variables and redeploy.

---

## 12. Add Vercel environment variables

In Vercel:

1. Open the project.
2. Go to **Settings**.
3. Go to **Environment Variables**.
4. Add the variables below.
5. Apply them to **Production**. For demo preview deployments, also apply them to **Preview**.

Use this template:

```env
DATABASE_URL=postgresql://postgres.xxxxx:your-password@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=require
PGSSLMODE=require
PGPOOL_MAX=1

CODE_HASH_SECRET=paste-the-same-secret-used-for-code-generation
ADMIN_API_KEY=paste-your-admin-secret
ATTEMPT_TOKEN_SALT=paste-your-attempt-token-secret
IP_HASH_SALT=paste-your-ip-hash-secret

CHALLENGE_ID=fza-word-puzzle-demo
CHALLENGE_TITLE=Fun Zone Arena Word Puzzle Demo Challenge
CHALLENGE_START_AT=2026-06-18T00:00:00Z
CHALLENGE_END_AT=2026-06-25T23:59:59Z
CHALLENGE_STATUS=active
SYNC_CHALLENGE_WINDOW=true
ACCEPT_LATE_SUBMISSIONS=false
RUN_MIGRATIONS_ON_START=false

RATE_LIMIT_MAX=1200
RATE_LIMIT_WINDOW_MS=60000
ATTEMPT_SESSION_TTL_MINUTES=480
```

Use `RUN_MIGRATIONS_ON_START=false` if you already ran `supabase-setup-and-codes.sql` in Supabase. Use `true` only if you intentionally want the app to attempt schema migration on startup.

---

## 13. Deploy on Vercel

After setting environment variables:

1. Go to the Vercel project **Deployments** tab.
2. Click the latest deployment.
3. Click **Redeploy**.
4. Wait for the build to complete.

When successful, Vercel gives you a free URL similar to:

```text
https://your-project-name.vercel.app
```

---

## 14. First manual test on the Vercel URL

Open the Vercel URL and test this flow:

1. Type a participant name.
2. Select a country, for example `Kenya`.
3. Open `private/generated-codes/codes-private.csv` locally.
4. Copy one unused challenge code.
5. Paste it into the challenge code field.
6. Click the start/unlock button.
7. Confirm the word puzzle appears and the overlay disappears.
8. Confirm the dashboard tab unlocks after the code is accepted.
9. Add a few words.
10. Submit.
11. Confirm the leaderboard appears.
12. Confirm the leaderboard shows:
    - participant name
    - nickname below the name
    - country
    - score
    - time
    - country participation section

Then test duplicate prevention:

1. Try using the same challenge code again.
2. The app should reject the second submission or prevent replay.

---

## 15. Run automated deployment verification

From your local project folder:

```bash
APP_BASE_URL="https://your-project-name.vercel.app" npm run verify:deployment
```

This should check the deployed health/config routes and confirm the dashboard is locked before code acceptance.

To run a full real submission test, use a disposable code. This will consume that code.

Mac/Linux:

```bash
APP_BASE_URL="https://your-project-name.vercel.app" \
SMOKE_COUNTRY="Kenya" \
SMOKE_CHALLENGE_CODE="paste-one-unused-code" \
SMOKE_SUBMIT=true \
npm run verify:deployment
```

Windows PowerShell:

```powershell
$env:APP_BASE_URL="https://your-project-name.vercel.app"
$env:SMOKE_COUNTRY="Kenya"
$env:SMOKE_CHALLENGE_CODE="paste-one-unused-code"
$env:SMOKE_SUBMIT="true"
npm run verify:deployment
```

---

## 16. Test admin CSV export

Use your `ADMIN_API_KEY`.

Mac/Linux:

```bash
curl -H "x-admin-api-key: paste-your-admin-secret" \
  "https://your-project-name.vercel.app/api/admin/export.csv" \
  -o challenge-export.csv
```

Windows PowerShell:

```powershell
curl.exe -H "x-admin-api-key: paste-your-admin-secret" "https://your-project-name.vercel.app/api/admin/export.csv" -o challenge-export.csv
```

Open `challenge-export.csv` and confirm it includes participant name, nickname, country, and challenge-code reference, but not employee number.

---

## 17. Optional: local Docker test

Docker is not required for Vercel deployment, but it is useful for local staging.

Run:

```bash
docker compose down -v
docker compose up --build
```

Open:

```text
http://localhost:8080
```

Use the local demo codes:

```text
FZADEMO0001
FZADEMO0002
FZADEMO0003
FZADEMO0004
FZADEMO0005
```

Run:

```bash
npm run docker:smoke
npm run docker:smoke:submit
```

---

## 18. Troubleshooting

### Build fails on Vercel

Check:

- `package.json` exists at the project root.
- Build command is `npm run build`.
- Output directory is `dist`.
- Node.js version is compatible with the project.
- Environment variables are added to the correct Vercel environment.

After changing environment variables, redeploy.

### Puzzle does not reveal after valid code

Check:

- The selected country is valid.
- The challenge code exists in `codes-private.csv`.
- `CODE_HASH_SECRET` in Vercel exactly matches the secret used during code generation.
- `CHALLENGE_ID` in Vercel exactly matches the `--challenge` value used during code generation.
- `CHALLENGE_STATUS=active`.
- Current UTC time is between `CHALLENGE_START_AT` and `CHALLENGE_END_AT`.
- Browser network tab shows `/api/puzzle` returning HTTP 200.

### Every code is invalid

Most likely causes:

- `CODE_HASH_SECRET` mismatch.
- Wrong Supabase database URL.
- Codes were generated for a different `CHALLENGE_ID`.
- Generated SQL was not run in Supabase.
- Vercel deployment was not redeployed after environment variables changed.

### Database connection fails

Check:

- You used the Supabase transaction pooler URL, not the direct database URL.
- In Supabase, click **Connect**, select **Transaction pooler**, and copy the complete URL; do not manually guess the region or pooler hostname.
- The URL hostname ends in `.pooler.supabase.com`, its username starts with `postgres.`, and its port is `6543`.
- Password is correctly inserted into the URL.
- Special characters in the password are URL encoded.
- `PGSSLMODE=require` is set.
- `PGPOOL_MAX=1` is set.
- The variables are enabled for **Production**, and the project was redeployed after the change.

If Vercel logs show `ENOTFOUND`, the failure occurs before challenge-code
validation: the database hostname cannot be resolved. `/api/config` therefore
returns 500 and the browser intentionally disables Continue. Replace
`DATABASE_URL` with the exact Transaction pooler URL and redeploy.

### Challenge says closed

Check:

```text
CHALLENGE_START_AT
CHALLENGE_END_AT
CHALLENGE_STATUS
SYNC_CHALLENGE_WINDOW
```

Set the dates in UTC.

### Leaderboard is empty

This is normal before the first successful submission. Enter a valid code to unlock the dashboard, submit one test response, then refresh the leaderboard.

---

## 19. Security checklist before sharing demo link

Confirm:

- GitHub repository is private.
- `.env` files are not committed.
- `private/generated-codes/codes-private.csv` is not committed.
- Raw challenge codes are distributed privately only.
- `ADMIN_API_KEY` is not shared in screenshots or browser bookmarks.
- `DATABASE_URL` is only stored in Vercel environment variables.
- Supabase SQL Editor received only the generated SQL file, not the raw code CSV.
- You tested invalid code, duplicate code, valid code, and admin export.

---

## 20. Free demo limits to watch

For a demo, this app should fit free-tier usage because it is lightweight. Watch the following:

- Avoid leaving the dashboard open on many devices for many hours.
- Start with 50-100 codes, then generate 1,000 after successful testing.
- Keep the Supabase database below free-tier limits.
- Use the Vercel free subdomain for demo only.

---

## 21. Final deployment checklist

Before inviting testers:

```text
[ ] Supabase project created
[ ] Supabase transaction pooler DATABASE_URL copied
[ ] Strong secrets generated
[ ] Challenge codes generated
[ ] Supabase setup SQL executed
[ ] participant_codes count confirmed
[ ] Project pushed to private GitHub repo
[ ] Vercel project created on Hobby/free account
[ ] Environment variables added to Production and Preview
[ ] Vercel redeployed successfully
[ ] App opened on .vercel.app URL
[ ] Dashboard is locked before code acceptance
[ ] Valid code reveals puzzle and unlocks dashboard
[ ] Overlay disappears
[ ] Submission works
[ ] Duplicate code is blocked
[ ] Leaderboard shows participant name with nickname below it
[ ] Leaderboard shows country
[ ] Country participation report updates
[ ] Admin CSV export works
[ ] Raw code CSV stored securely offline
```


## Search-index controls included

The production package already includes:

- `public/robots.txt`
- a robots `noindex` meta tag in `index.html`
- an `X-Robots-Tag` noindex header in `vercel.json`

After changing these settings, push to GitHub and redeploy Vercel so the headers apply.
