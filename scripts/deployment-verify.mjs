import assert from 'node:assert/strict';

const baseUrl = String(process.env.APP_BASE_URL || '').replace(/\/$/, '');
const adminApiKey = process.env.ADMIN_API_KEY || '';
const smokeChallengeCode = process.env.SMOKE_CHALLENGE_CODE || '';
const smokeSubmit = process.env.SMOKE_SUBMIT === 'true';
const smokeCountry = process.env.SMOKE_COUNTRY || 'Kenya';
const smokeParticipantName = process.env.SMOKE_PARTICIPANT_NAME || 'Demo Verifier';
const smokeResetBefore = process.env.SMOKE_RESET_BEFORE === 'true';
const challengeId = process.env.CHALLENGE_ID || 'fun-zone-arena-2026';

if (!baseUrl){
  console.error('APP_BASE_URL is required, for example: APP_BASE_URL=https://your-project.vercel.app npm run verify:deployment');
  process.exit(2);
}

async function fetchWithTimeout(path, options = {}){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.VERIFY_TIMEOUT_MS || 10000));
  try {
    const response = await fetch(`${baseUrl}${path}`, { ...options, signal: controller.signal, cache: 'no-store' });
    const contentType = response.headers.get('content-type') || '';
    let body = null;
    if (contentType.includes('application/json')) body = await response.json();
    else if (contentType.startsWith('image/')) body = Buffer.from(await response.arrayBuffer());
    else body = await response.text();
    return { response, body, contentType };
  } finally {
    clearTimeout(timer);
  }
}

async function expectJson(path, status = 200, options = {}){
  const result = await fetchWithTimeout(path, options);
  const diagnostic = result.body && typeof result.body === 'object'
    ? ` (${[result.body.code, result.body.message, result.body.requestId].filter(Boolean).join(' | ')})`
    : '';
  assert.equal(result.response.status, status, `${path} returned HTTP ${result.response.status}${diagnostic}`);
  assert.match(result.contentType, /application\/json/, `${path} must return JSON`);
  return result.body;
}

const health = await expectJson('/api/healthz');
assert.equal(health.ok, true);
assert.equal(health.service, 'fun-zone-arena-api');

if (process.env.SKIP_READYZ !== 'true'){
  const ready = await expectJson('/api/readyz');
  assert.equal(ready.ok, true);
}

const config = await expectJson('/api/config');
assert.equal(config.ok, true);
assert.equal(typeof config.challengeId, 'string');
assert.equal(config.challengeId, challengeId, 'Configured challenge ID should match CHALLENGE_ID.');
assert.equal(Boolean(config.challengeWindow), true);
assert.equal(Array.isArray(config.countries), true);
assert.ok(config.countries.includes(smokeCountry), `Configured countries should include ${smokeCountry}.`);

const lockedLeaderboard = await fetchWithTimeout('/api/leaderboard');
assert.equal(lockedLeaderboard.response.status, 401, 'Dashboard should be locked before a challenge code is accepted.');

const invalidCode = await fetchWithTimeout('/api/sessions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ challengeId, participantName: smokeParticipantName, country: smokeCountry, challengeCode: 'NOTREAL999' })
});
assert.ok([400, 403].includes(invalidCode.response.status), 'Invalid challenge code should not be accepted.');

if (adminApiKey){
  const admin = await expectJson('/api/admin/challenge', 200, {
    headers: { 'X-Admin-API-Key': adminApiKey }
  });
  assert.equal(admin.ok, true);
  assert.equal(Boolean(admin.codeStats), true);
}

if (smokeResetBefore){
  assert.ok(adminApiKey, 'SMOKE_RESET_BEFORE=true requires ADMIN_API_KEY.');
  const reset = await expectJson('/api/admin/reset', 200, {
    method: 'POST',
    headers: { 'X-Admin-API-Key': adminApiKey }
  });
  assert.equal(reset.ok, true);
}

if (smokeSubmit){
  assert.ok(smokeChallengeCode, 'SMOKE_CHALLENGE_CODE is required when SMOKE_SUBMIT=true. This will consume that code.');

  const session = await expectJson('/api/sessions', 201, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challengeId, participantName: smokeParticipantName, country: smokeCountry, challengeCode: smokeChallengeCode })
  });
  assert.equal(session.ok, true);
  assert.equal(Boolean(session.session.id), true);
  assert.equal(Boolean(session.session.token), true);
  assert.equal(session.session.country, smokeCountry);
  assert.equal(session.session.participantName, smokeParticipantName);
  assert.equal(Boolean(session.session.codeRef || session.session.codeFingerprint), true);

  const lockedBeforeSubmit = await fetchWithTimeout('/api/leaderboard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      challengeId,
      attemptSessionId: session.session.id,
      attemptToken: session.session.token
    })
  });
  assert.equal(lockedBeforeSubmit.response.status, 403, 'Dashboard should remain locked until after submission.');

  const puzzle = await fetchWithTimeout('/api/puzzle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      challengeId,
      attemptSessionId: session.session.id,
      attemptToken: session.session.token
    })
  });
  assert.equal(puzzle.response.status, 200);
  assert.match(puzzle.contentType, /image\/png/);
  assert.ok(Buffer.isBuffer(puzzle.body));
  assert.ok(puzzle.body.length > 1000);

  const submission = await expectJson('/api/submissions', 201, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      challengeId,
      attemptSessionId: session.session.id,
      attemptToken: session.session.token,
      answers: ['RISK', 'SECURITY', 'FACILITIES']
    })
  });
  assert.equal(submission.ok, true);
  assert.equal(Boolean(submission.submission.displayName), true);
  assert.equal(submission.submission.country, smokeCountry);
  assert.equal(Boolean(submission.submission.codeRef), true);
  assert.equal(Array.isArray(submission.state.leaderboard), true);
  assert.equal(Boolean(submission.state.stats), true);

  const unlockedAfterSubmit = await expectJson('/api/leaderboard', 200, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      challengeId,
      attemptSessionId: session.session.id,
      attemptToken: session.session.token
    })
  });
  assert.equal(Array.isArray(unlockedAfterSubmit.leaderboard), true);
  assert.equal(Boolean(unlockedAfterSubmit.stats), true);
}

console.log(`Deployment verification passed for ${baseUrl}${smokeSubmit ? ' with one consuming submission smoke test.' : ' with non-destructive checks.'}`);
