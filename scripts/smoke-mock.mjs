import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { handleRequest, routeRequest, rowsToCsv, auditRowsToCsv } = require('../server/http');
const { hashAttemptToken } = require('../server/domain');

const tokenSalt = 'mock-admin-token-with-more-than-32-characters';
const mockAttemptToken = 'mock-puzzle-token';

const challenge = {
  id: 'fun-zone-arena-2026',
  title: 'Fun Zone Arena Challenge',
  starts_at: new Date(Date.now() - 3600000),
  ends_at: new Date(Date.now() + 7 * 86400000),
  status: 'active'
};

const submissions = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    challenge_id: challenge.id,
    participant_name: 'Amina Demo',
    participant_alias: 'Amina Demo',
    code_fingerprint: 'ABCDEF123456',
    code_nickname: 'Pinky Zebra',
    country: 'Kenya',
    answers: ['RISK', 'SECURITY'],
    correct_count: 2,
    word_hits: { RISK: true, SECURITY: true },
    time_taken_ms: 120000,
    submitted_at: new Date(Date.now() - 10000),
    ip_hash: 'redacted',
    user_agent_hash: 'redacted'
  }
];

const duplicateDeviceAudit = [
  {
    id: '44444444-4444-4444-8444-444444444444',
    challenge_id: challenge.id,
    detected_at: new Date(Date.now() - 5000),
    audit_reason: 'same_hashed_device_multiple_codes',
    ip_hash: 'hashed-ip-only',
    user_agent_hash: 'hashed-browser-only',
    current_submission_id: '55555555-5555-4555-8555-555555555555',
    current_code_fingerprint: 'FEDCBA654321',
    current_code_nickname: 'Witty Otter',
    current_participant_name: 'Brian Demo',
    current_country: 'Kenya',
    matched_submission_ids: [submissions[0].id],
    matched_code_fingerprints: [submissions[0].code_fingerprint],
    matched_code_nicknames: [submissions[0].code_nickname],
    matched_participant_names: [submissions[0].participant_name],
    matched_countries: [submissions[0].country],
    matched_count: 1,
    request_id: 'mock-request-id'
  }
];

const attemptSession = {
  id: '22222222-2222-4222-8222-222222222222',
  challenge_id: challenge.id,
  token_hash: hashAttemptToken(mockAttemptToken, tokenSalt),
  started_at: new Date(Date.now() - 60000),
  expires_at: new Date(Date.now() + 3600000),
  consumed_at: null,
  participant_name: 'Amina Demo',
  country: 'Kenya'
};

const submittedAttemptSession = {
  ...attemptSession,
  id: '33333333-3333-4333-8333-333333333333',
  consumed_at: new Date(Date.now() - 1000)
};

const fakePool = {
  async connect(){
    return {
      query: (sql, params) => fakePool.query(sql, params),
      release(){}
    };
  },
  async query(sql, params = []){
    const text = String(sql).replace(/\s+/g, ' ').trim();
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) return { rowCount: 0, rows: [] };
    if (text === 'SELECT 1') return { rowCount: 1, rows: [{ '?column?': 1 }] };
    if (text.includes('FROM challenges')) return { rowCount: 1, rows: [challenge] };
    if (text.includes('FROM duplicate_device_audit')) return { rowCount: duplicateDeviceAudit.length, rows: duplicateDeviceAudit };
    if (text.includes('FROM submissions')) return { rowCount: submissions.length, rows: submissions };
    if (text.includes('FROM attempt_sessions')) {
      const id = params[0];
      return { rowCount: 1, rows: [id === submittedAttemptSession.id ? submittedAttemptSession : attemptSession] };
    }
    if (text.startsWith('INSERT INTO attempt_sessions')){
      return {
        rowCount: 1,
        rows: [{
          id: '33333333-3333-4333-8333-333333333333',
          challenge_id: challenge.id,
          participant_name: submissions[0].participant_name,
          country: submissions[0].country,
          started_at: attemptSession.started_at,
          expires_at: attemptSession.expires_at,
          consumed_at: new Date()
        }]
      };
    }
    if (text.includes('FROM challenge_codes')){
      if (text.includes('code_hash')){
        return {
          rowCount: 1,
          rows: [{
            challenge_id: challenge.id,
            code_hash: params[1] || 'mock-hash',
            code_fingerprint: submissions[0].code_fingerprint,
            code_nickname: submissions[0].code_nickname,
            status: 'active',
            started_at: attemptSession.started_at,
            used_at: new Date()
          }]
        };
      }
      return { rowCount: 1, rows: [{ total_codes: 1000, started_codes: 125, used_codes: submissions.length }] };
    }
    throw new Error(`Unexpected fake SQL in smoke test: ${text}`);
  }
};

function makeReq(method, url, body = null, headers = {}){
  const chunks = body == null ? [] : [Buffer.from(JSON.stringify(body))];
  const req = Readable.from(chunks);
  req.method = method;
  req.url = url;
  req.headers = { host: 'localhost', ...headers };
  req.socket = { remoteAddress: '127.0.0.1' };
  return req;
}

function makeRes(){
  return {
    statusCode: 200,
    headers: {},
    body: Buffer.alloc(0),
    setHeader(key, value){ this.headers[String(key).toLowerCase()] = value; },
    getHeader(key){ return this.headers[String(key).toLowerCase()]; },
    end(chunk = ''){
      this.body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      this.ended = true;
    }
  };
}

async function requestViaRoute(method, url, options = {}){
  const req = makeReq(method, url, options.body, options.headers);
  const res = makeRes();
  try {
    await routeRequest(req, res, fakePool, {
      CHALLENGE_ID: challenge.id,
      ADMIN_API_KEY: tokenSalt
    });
  } catch (error) {
    res.statusCode = error.statusCode || 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, code: error.code || 'error', message: error.message }));
  }
  const text = res.body.toString('utf8');
  const json = text && String(res.getHeader('content-type') || '').includes('json') ? JSON.parse(text) : null;
  return { req, res, text, json };
}

async function requestViaHandle(method, url, options = {}){
  const req = makeReq(method, url, options.body, options.headers);
  const res = makeRes();
  await handleRequest(req, res, {
    CHALLENGE_ID: challenge.id,
    ADMIN_API_KEY: tokenSalt
  });
  const text = res.body.toString('utf8');
  const json = text && String(res.getHeader('content-type') || '').includes('json') ? JSON.parse(text) : null;
  return { req, res, text, json };
}

const health = await requestViaRoute('GET', '/api/healthz');
assert.equal(health.res.statusCode, 200);
assert.equal(health.json.ok, true);
assert.equal(health.json.service, 'fun-zone-arena-api');

const ready = await requestViaRoute('GET', '/api/readyz');
assert.equal(ready.res.statusCode, 200);
assert.equal(ready.json.ok, true);

const config = await requestViaRoute('GET', '/api/config');
assert.equal(config.res.statusCode, 200);
assert.equal(config.json.challengeId, challenge.id);
assert.equal(config.json.challengeWindow.status, 'active');
assert.equal(Array.isArray(config.json.countries), true);
assert.ok(config.json.countries.includes('Kenya'));

const invalidSession = await requestViaRoute('POST', '/api/sessions', {
  body: { challengeId: challenge.id, challengeCode: 'FZA-9K2M-7Q4X' }
});
assert.equal(invalidSession.res.statusCode, 400);
assert.match(invalidSession.json.message, /name/i);

const lockedLeaderboard = await requestViaRoute('GET', '/api/leaderboard');
assert.equal(lockedLeaderboard.res.statusCode, 401);
assert.equal(lockedLeaderboard.json.code, 'dashboard_locked');

const returningLogin = await requestViaRoute('POST', '/api/code-login', {
  body: { challengeId: challenge.id, challengeCode: 'FZA-9K2M-7Q4X' }
});
assert.equal(returningLogin.res.statusCode, 200);
assert.equal(returningLogin.json.ok, true);
assert.equal(returningLogin.json.profileRequired, false);
assert.equal(returningLogin.json.session.dashboardOnly, true);
assert.equal(returningLogin.json.session.submitted, true);
assert.equal(returningLogin.json.session.participantName, 'Amina Demo');

const lockedBeforeSubmit = await requestViaRoute('POST', '/api/leaderboard', {
  body: {
    challengeId: challenge.id,
    attemptSessionId: attemptSession.id,
    attemptToken: mockAttemptToken
  }
});
assert.equal(lockedBeforeSubmit.res.statusCode, 403);
assert.equal(lockedBeforeSubmit.json.code, 'dashboard_after_submission_only');

const leaderboard = await requestViaRoute('POST', '/api/leaderboard', {
  body: {
    challengeId: challenge.id,
    attemptSessionId: submittedAttemptSession.id,
    attemptToken: mockAttemptToken
  }
});
assert.equal(leaderboard.res.statusCode, 200);
assert.equal(leaderboard.json.stats.issuedCodes, 1000);
assert.equal(leaderboard.json.stats.countriesParticipating, 1);
assert.equal(leaderboard.json.leaderboard[0].displayName, 'Amina Demo');
assert.equal(leaderboard.json.leaderboard[0].nickname, 'Pinky Zebra');
assert.equal(leaderboard.json.leaderboard[0].codeLabel, 'Pinky Zebra');
assert.equal(leaderboard.json.leaderboard[0].country, 'Kenya');
assert.equal(leaderboard.json.countries.find((row) => row.country === 'Kenya').responses, 1);

const puzzle = await requestViaRoute('POST', '/api/puzzle', {
  body: {
    challengeId: challenge.id,
    attemptSessionId: attemptSession.id,
    attemptToken: mockAttemptToken
  }
});
assert.equal(puzzle.res.statusCode, 200);
assert.match(String(puzzle.res.getHeader('content-type') || ''), /image\/png/);
assert.ok(puzzle.res.body.length > 1000, 'Protected puzzle response should contain the PNG image.');

assert.equal(Object.prototype.hasOwnProperty.call(leaderboard.json.leaderboard[0], 'employeeNumber'), false);
assert.equal(Object.prototype.hasOwnProperty.call(leaderboard.json.leaderboard[0], 'fullName'), false);

const adminDenied = await requestViaRoute('GET', '/api/admin/export');
assert.equal(adminDenied.res.statusCode, 401);
assert.equal(adminDenied.json.code, 'unauthorized');

const adminOk = await requestViaRoute('GET', '/api/admin/export', {
  headers: { 'x-admin-api-key': tokenSalt }
});
assert.equal(adminOk.res.statusCode, 200);
assert.equal(adminOk.json.submissions.length, 1);

const auditDenied = await requestViaRoute('GET', '/api/admin/duplicate-device-audit');
assert.equal(auditDenied.res.statusCode, 401);
assert.equal(auditDenied.json.code, 'unauthorized');

const auditOk = await requestViaRoute('GET', '/api/admin/duplicate-device-audit', {
  headers: { 'x-admin-api-key': tokenSalt }
});
assert.equal(auditOk.res.statusCode, 200);
assert.equal(auditOk.json.audit.length, 1);
assert.equal(auditOk.json.audit[0].audit_reason, 'same_hashed_device_multiple_codes');

const csv = rowsToCsv(submissions);
assert.match(csv, /participant_name/);
assert.match(csv, /participant_alias/);
assert.match(csv, /country/);
assert.match(csv, /Kenya/);
assert.doesNotMatch(csv, /employee/i);

const auditCsv = auditRowsToCsv(duplicateDeviceAudit);
assert.match(auditCsv, /same_hashed_device_multiple_codes/);
assert.match(auditCsv, /current_code_ref/);
assert.match(auditCsv, /hashed-ip-only/);
assert.doesNotMatch(auditCsv, /FZA-/);

const options = await requestViaHandle('OPTIONS', '/api/config', { headers: { origin: 'https://example.vercel.app' } });
assert.equal(options.res.statusCode, 204);

console.log('Smoke checks passed: healthz, readyz, config countries, validation, protected puzzle image, leaderboard country reporting, admin auth, duplicate-device audit, CSV shaping, OPTIONS handling.');
