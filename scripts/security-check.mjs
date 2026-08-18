import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { SERVICE_LINES, COUNTRIES } = require('../server/domain');

function read(file){
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function walk(dir, files = []){
  const absolute = path.join(root, dir);
  if (!fs.existsSync(absolute)) return files;
  for (const entry of fs.readdirSync(absolute)){
    const full = path.join(absolute, entry);
    const rel = path.relative(root, full);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(rel, files);
    else files.push(rel);
  }
  return files;
}

const runtimeTextFiles = [
  'index.html',
  'public/config.json',
  ...walk('api'),
  ...walk('server').filter((file) => !file.endsWith('.png')),
  ...walk('src'),
  ...walk('migrations')
].filter((file) => fs.existsSync(path.join(root, file)));

for (const file of runtimeTextFiles){
  const content = read(file);
  assert.doesNotMatch(content, /name=["']employee/i, `${file} must not contain employee form fields`);
  assert.doesNotMatch(content, /id=["']employee/i, `${file} must not contain employee form IDs`);
  assert.doesNotMatch(content, /employee_?number\b/i, `${file} must not contain employee-number fields`);
  assert.doesNotMatch(content, /employee_?name\b/i, `${file} must not contain employee-name fields`);
  assert.doesNotMatch(content, /name=["']name["']/i, `${file} must not collect names`);
  assert.doesNotMatch(content, /id=["']name["']/i, `${file} must not collect names`);
  assert.doesNotMatch(content, /name=["']email["']/i, `${file} must not collect email addresses`);
  assert.doesNotMatch(content, /id=["']email["']/i, `${file} must not collect email addresses`);
  assert.doesNotMatch(content, /job_?title|department/i, `${file} must not collect job title or department`);
}

assert.equal(fs.existsSync(path.join(root, 'public/assets/puzzle.png')), false, 'Puzzle image must not be public.');
assert.equal(fs.existsSync(path.join(root, 'server/assets/puzzle.png')), true, 'Protected puzzle image must exist server-side.');

const frontendBundleSources = ['index.html', ...walk('src'), ...walk('public')];
for (const file of frontendBundleSources){
  const content = read(file);
  assert.doesNotMatch(content, /const\s+SERVICE_LINES\s*=/, `${file} must not include the server answer key array`);
  assert.doesNotMatch(content, /RISK['"],\s*['"]SECURITY['"],\s*['"]FACILITIES/, `${file} must not expose the answer key list`);
}

const http = read('server/http.js');
assert.match(http, /function requireAdmin/, 'Admin guard must exist.');
assert.match(http, /timingSafeEqualText\(adminTokenFromRequest\(req\), configured\)/, 'Admin token comparison must be constant-time.');
assert.doesNotMatch(http, /console\.(log|warn|error)\([^\n]*(challengeCode|body|answers)/, 'Logs must not include request bodies, codes, or answers.');
assert.match(http, /\/api\/admin\/duplicate-device-audit\.csv/, 'Duplicate-device audit CSV must be admin-only.');
assert.match(http, /listDuplicateDeviceAudit/, 'Duplicate-device audit export must use the database audit table.');

const migration = read('migrations/001_init.sql');
assert.doesNotMatch(migration, /employee|email|department|job_title/i, 'Database schema must not include employee identity columns.');
assert.match(migration, /country text NOT NULL/, 'Submissions must store participation country for dashboard reporting.');
assert.match(migration, /CONSTRAINT uq_submission_challenge_code UNIQUE/, 'Database must enforce one submission per challenge code.');

const auditMigration = read('migrations/005_duplicate_device_audit.sql');
assert.match(auditMigration, /CREATE TABLE IF NOT EXISTS duplicate_device_audit/, 'Duplicate-device audit table must exist.');
assert.match(auditMigration, /ip_hash text NOT NULL/, 'Duplicate-device audit must store only hashed IP values.');
assert.match(auditMigration, /user_agent_hash text NOT NULL/, 'Duplicate-device audit must store only hashed browser signatures.');
assert.doesNotMatch(auditMigration, /challenge_code|raw_ip|email|employee|laptop_log/i, 'Duplicate-device audit must not store raw codes, raw IPs, employee data, or laptop logs.');

const gitignore = read('.gitignore');
assert.match(gitignore, /private\//, '.gitignore must exclude generated private challenge codes.');
assert.match(gitignore, /\.env/, '.gitignore must exclude env files.');

const dockerignore = read('.dockerignore');
assert.match(dockerignore, /private/, '.dockerignore must exclude generated private challenge codes.');
assert.match(dockerignore, /\.env/, '.dockerignore must exclude env files.');

const vercel = read('vercel.json');
assert.match(vercel, /X-Content-Type-Options/, 'Vercel headers must include nosniff.');
assert.match(vercel, /Cache-Control/, 'Vercel headers must control API caching.');
assert.match(vercel, /X-Robots-Tag/, 'Vercel headers must include search-engine noindex controls.');
assert.match(vercel, /noindex, nofollow, noarchive, nosnippet, noimageindex/, 'Vercel noindex header must block indexing/snippets/archives/images.');
assert.match(vercel, /https:\/\/fonts\.googleapis\.com/, 'CSP must allow Google Fonts stylesheet.');
assert.match(vercel, /https:\/\/fonts\.gstatic\.com/, 'CSP must allow Google Fonts font files.');
const robots = read('public/robots.txt');
assert.match(robots, /User-agent: \*/, 'robots.txt must target all crawlers.');
assert.match(robots, /Disallow: \/(?:\s|$)/, 'robots.txt must disallow crawling the demo site.');

assert.equal(Array.isArray(SERVICE_LINES), true);
assert.equal(SERVICE_LINES.length, 18);
assert.deepEqual(COUNTRIES, ['Kenya', 'Uganda', 'Tanzania', 'Burundi', 'Rwanda', 'Angola', 'DRC', 'Mozambique', 'Nigeria', 'Malawi', 'Zambia', 'South Africa', 'UAE', 'UK', 'Canada', 'Others']);

const html = read('index.html');
assert.doesNotMatch(html, /No staff PII is collected/i, 'The visible page must not show the removed privacy phrase.');
assert.match(html, /id="country"/, 'The challenge form must include the country select.');
assert.match(html, /<meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex"/, 'The app shell must include a robots noindex meta tag.');

console.log('Security checks passed: noindex controls, font CSP, no employee numbers/emails/job fields, supported country reporting, protected puzzle asset, answer key server-side, admin guard, safe logging, one-code-one-submission schema, private files ignored.');
