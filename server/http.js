const fs = require('node:fs');
const path = require('node:path');

const {
  SERVICE_LINES,
  COUNTRIES,
  validateSessionPayload,
  validateCodeLoginPayload,
  validateAttemptPayload,
  validateSubmissionPayload,
  submissionRowToPublic,
  buildLeaderboardState,
  timingSafeEqualText
} = require('./domain');
const {
  AppError,
  mapDatabaseError,
  getPool,
  ensureRuntimeSecrets,
  migrate,
  ensureDefaultChallenge,
  seedCodesFromEnv,
  getChallenge,
  createAttemptSession,
  createReturningDashboardSession,
  insertSubmission,
  verifyAttemptSession,
  verifyDashboardSession,
  listSubmissions,
  listDuplicateDeviceAudit,
  getCodeStats,
  cleanupExpiredSessions,
  resetChallengeData,
  hashRequestIp,
  hashUserAgent
} = require('./db');

let bootstrapPromise;
const rateLimitBuckets = new Map();
let puzzleImageBuffer;

// -----------------------------------------------------------------------------
// Bootstrap
// -----------------------------------------------------------------------------
// Vercel reuses warm function instances. This promise ensures the pool,
// migrations, and active challenge are initialized once per warm instance.
async function bootstrap(env = process.env){
  if (!bootstrapPromise){
    bootstrapPromise = (async () => {
      ensureRuntimeSecrets(env);
      const pool = getPool(env);
      if (env.RUN_MIGRATIONS_ON_START !== 'false') await migrate(pool);
      await ensureDefaultChallenge(pool, env);
      await seedCodesFromEnv(pool, env);
      return pool;
    })();
  }
  try {
    return await bootstrapPromise;
  } catch (error) {
    // A rejected promise must not poison a warm Vercel function forever. Reset
    // it so a transient database outage can recover on the next request.
    bootstrapPromise = undefined;
    throw mapDatabaseError(error, env);
  }
}

// -----------------------------------------------------------------------------
// HTTP response helpers
// -----------------------------------------------------------------------------
function securityHeaders(){
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    'Cache-Control': 'no-store'
  };
}

function sendJson(res, statusCode, body, extraHeaders = {}){
  res.statusCode = statusCode;
  const headers = {
    ...securityHeaders(),
    'Content-Type': 'application/json; charset=utf-8',
    ...extraHeaders
  };
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  res.end(JSON.stringify(body));
}

function sendText(res, statusCode, text, contentType, extraHeaders = {}){
  res.statusCode = statusCode;
  const headers = {
    ...securityHeaders(),
    'Content-Type': contentType,
    ...extraHeaders
  };
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  res.end(text);
}

function sendBuffer(res, statusCode, buffer, contentType, extraHeaders = {}){
  res.statusCode = statusCode;
  const headers = {
    ...securityHeaders(),
    'Content-Type': contentType,
    'Content-Length': buffer.length,
    ...extraHeaders
  };
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  res.end(buffer);
}

function getPuzzleImageBuffer(){
  if (!puzzleImageBuffer){
    puzzleImageBuffer = fs.readFileSync(path.join(__dirname, 'assets', 'puzzle.png'));
  }
  return puzzleImageBuffer;
}

function csvCell(value){
  const text = value == null ? '' : String(value);
  return '"' + text.replace(/"/g, '""') + '"';
}

function rowsToCsv(rows){
  const headers = [
    'rank', 'submission_id', 'participant_name', 'nickname', 'participant_alias', 'challenge_code_ref', 'country', 'correct_count',
    'time_taken_minutes', 'time_taken_ms', 'submitted_at', 'answers', 'word_hits'
  ];
  const lines = [headers.map(csvCell).join(',')];

  rows.forEach((row, index) => {
    lines.push([
      index + 1,
      row.id,
      row.participant_name || row.participant_alias,
      row.code_nickname || row.participant_alias,
      row.participant_alias,
      row.code_fingerprint,
      row.country || '',
      row.correct_count,
      Math.max(Number(row.time_taken_ms || 0) / 60000, 0.1).toFixed(1),
      row.time_taken_ms,
      new Date(row.submitted_at).toISOString(),
      JSON.stringify(row.answers || []),
      JSON.stringify(row.word_hits || {})
    ].map(csvCell).join(','));
  });

  return lines.join('\n') + '\n';
}

function auditRowsToCsv(rows){
  const headers = [
    'detected_at', 'audit_reason', 'current_submission_id', 'current_participant_name', 'current_code_ref', 'current_nickname',
    'current_country', 'matched_count', 'matched_submission_ids', 'matched_participant_names', 'matched_code_refs',
    'matched_nicknames', 'matched_countries', 'ip_hash', 'user_agent_hash', 'request_id'
  ];
  const lines = [headers.map(csvCell).join(',')];

  rows.forEach((row) => {
    lines.push([
      new Date(row.detected_at).toISOString(),
      row.audit_reason,
      row.current_submission_id,
      row.current_participant_name || '',
      row.current_code_fingerprint,
      row.current_code_nickname || '',
      row.current_country || '',
      row.matched_count,
      JSON.stringify(row.matched_submission_ids || []),
      JSON.stringify(row.matched_participant_names || []),
      JSON.stringify(row.matched_code_fingerprints || []),
      JSON.stringify(row.matched_code_nicknames || []),
      JSON.stringify(row.matched_countries || []),
      row.ip_hash,
      row.user_agent_hash,
      row.request_id || ''
    ].map(csvCell).join(','));
  });

  return lines.join('\n') + '\n';
}

function getPath(req){
  const url = new URL(req.url || '/', 'https://local.invalid');
  const rewrittenPath = url.searchParams.get('path');
  const path = rewrittenPath ? `/api/${rewrittenPath}` : url.pathname;
  return path.replace(/\/+/g, '/').replace(/\/$/, '') || '/api';
}

function addCors(req, res, env = process.env){
  const origin = req.headers.origin;
  const configured = String(env.CORS_ORIGIN || '').trim();
  if (!origin || !configured) return;

  const allowed = configured === '*'
    ? ['*']
    : configured.split(',').map((item) => item.trim()).filter(Boolean);

  if (allowed.includes('*') || allowed.includes(origin)){
    res.setHeader('Access-Control-Allow-Origin', allowed.includes('*') ? '*' : origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Admin-API-Key,X-Request-ID');
  }
}

async function readJsonBody(req, env = process.env){
  const limit = Number(env.BODY_LIMIT_BYTES || 65536);
  const chunks = [];
  let size = 0;

  for await (const chunk of req){
    size += chunk.length;
    if (size > limit) throw new AppError('Request body is too large.', 413, 'body_too_large');
    chunks.push(chunk);
  }

  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (_) {
    throw new AppError('Request body must be valid JSON.', 400, 'invalid_json');
  }
}

function adminTokenFromRequest(req){
  const headerToken = req.headers['x-admin-api-key'];
  const auth = req.headers.authorization || '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  return String(Array.isArray(headerToken) ? headerToken[0] : headerToken || bearer || '');
}

function requireAdmin(req, env = process.env){
  const configured = env.ADMIN_API_KEY;
  if (!configured || /replace-with|change-me/i.test(configured)){
    throw new AppError('Admin API is disabled. Set ADMIN_API_KEY to enable it.', 404, 'admin_disabled');
  }
  if (!timingSafeEqualText(adminTokenFromRequest(req), configured)){
    throw new AppError('Unauthorized.', 401, 'unauthorized');
  }
}

// -----------------------------------------------------------------------------
// Best-effort rate limiting
// -----------------------------------------------------------------------------
// This protects each warm Vercel instance from accidental repeated requests. For
// a high-risk public campaign, add Vercel Firewall or a DB-backed/global limiter.
function checkRateLimit(req, env = process.env){
  const max = Number(env.RATE_LIMIT_MAX || 1200);
  const windowMs = Number(env.RATE_LIMIT_WINDOW_MS || 60000);
  if (!max || max <= 0) return;

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const route = getPath(req).split('/').slice(0, 3).join('/');
  const key = `${ip}:${route}`;
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key) || { count: 0, resetAt: now + windowMs };

  if (bucket.resetAt <= now){
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }
  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);

  if (rateLimitBuckets.size > 5000){
    for (const [bucketKey, item] of rateLimitBuckets.entries()){
      if (item.resetAt <= now) rateLimitBuckets.delete(bucketKey);
    }
  }

  if (bucket.count > max){
    throw new AppError('Too many requests. Please try again shortly.', 429, 'rate_limited');
  }
}

// -----------------------------------------------------------------------------
// Route handlers
// -----------------------------------------------------------------------------
async function buildState(pool, challengeId){
  const challenge = await getChallenge(pool, challengeId);
  const rows = await listSubmissions(pool, challengeId);
  const codeStats = await getCodeStats(pool, challengeId);
  return buildLeaderboardState({ rows, challenge, codeStats, now: new Date() });
}

async function handleGetConfig(pool, env){
  const challengeId = env.CHALLENGE_ID || 'fun-zone-arena-2026';
  const challenge = await getChallenge(pool, challengeId);
  const now = Date.now();
  const start = new Date(challenge.starts_at).getTime();
  const end = new Date(challenge.ends_at).getTime();

  return {
    ok: true,
    challengeId: challenge.id,
    title: challenge.title,
    serviceLineCount: now >= end ? SERVICE_LINES.length : null,
    countries: COUNTRIES,
    challengeWindow: {
      start: new Date(challenge.starts_at).toISOString(),
      end: new Date(challenge.ends_at).toISOString(),
      started: now >= start,
      ended: now >= end,
      status: challenge.status
    }
  };
}

async function routeRequest(req, res, pool, env = process.env){
  const path = getPath(req);
  const method = String(req.method || 'GET').toUpperCase();
  const challengeId = env.CHALLENGE_ID || 'fun-zone-arena-2026';

  if (method === 'GET' && (path === '/api/healthz' || path === '/api')){
    return sendJson(res, 200, { ok: true, service: 'fun-zone-arena-api', version: '2.3.2' });
  }

  if (method === 'GET' && path === '/api/readyz'){
    await pool.query('SELECT 1');
    return sendJson(res, 200, { ok: true });
  }

  if (method === 'GET' && path === '/api/config'){
    return sendJson(res, 200, await handleGetConfig(pool, env));
  }

  if (method === 'POST' && path === '/api/code-login'){
    const body = await readJsonBody(req, env);
    const parsed = validateCodeLoginPayload(body);
    if (!parsed.ok) return sendJson(res, 400, { ok: false, message: parsed.errors[0], errors: parsed.errors });
    if (parsed.value.challengeId !== challengeId){
      throw new AppError('Challenge ID does not match the active challenge.', 400, 'challenge_mismatch');
    }

    const result = await createReturningDashboardSession(pool, {
      challengeId,
      challengeCode: parsed.value.challengeCode,
      tokenSalt: env.ATTEMPT_TOKEN_SALT || env.ADMIN_API_KEY || 'change-me-attempt-token-salt',
      ipHash: hashRequestIp(req, env),
      userAgentHash: hashUserAgent(req, env),
      ttlMinutes: Number(env.ATTEMPT_SESSION_TTL_MINUTES || 480)
    }, env);

    return sendJson(res, 200, { ok: true, ...result });
  }

  if (method === 'POST' && path === '/api/sessions'){
    const body = await readJsonBody(req, env);
    const parsed = validateSessionPayload(body);
    if (!parsed.ok) return sendJson(res, 400, { ok: false, message: parsed.errors[0], errors: parsed.errors });
    if (parsed.value.challengeId !== challengeId){
      throw new AppError('Challenge ID does not match the active challenge.', 400, 'challenge_mismatch');
    }

    const session = await createAttemptSession(pool, {
      challengeId,
      challengeCode: parsed.value.challengeCode,
      participantName: parsed.value.participantName,
      country: parsed.value.country,
      tokenSalt: env.ATTEMPT_TOKEN_SALT || env.ADMIN_API_KEY || 'change-me-attempt-token-salt',
      ipHash: hashRequestIp(req, env),
      userAgentHash: hashUserAgent(req, env),
      ttlMinutes: Number(env.ATTEMPT_SESSION_TTL_MINUTES || 480)
    }, env);

    return sendJson(res, 201, { ok: true, session });
  }

  if (method === 'POST' && path === '/api/puzzle'){
    const body = await readJsonBody(req, env);
    const parsed = validateAttemptPayload(body);
    if (!parsed.ok) return sendJson(res, 400, { ok: false, message: parsed.errors[0], errors: parsed.errors });
    if (parsed.value.challengeId !== challengeId){
      throw new AppError('Challenge ID does not match the active challenge.', 400, 'challenge_mismatch');
    }

    await verifyAttemptSession(pool, parsed.value, env);
    return sendBuffer(res, 200, getPuzzleImageBuffer(), 'image/png');
  }

  if (method === 'POST' && path === '/api/submissions'){
    const body = await readJsonBody(req, env);
    const parsed = validateSubmissionPayload(body);
    if (!parsed.ok) return sendJson(res, 400, { ok: false, message: parsed.errors[0], errors: parsed.errors });
    if (parsed.value.challengeId !== challengeId){
      throw new AppError('Challenge ID does not match the active challenge.', 400, 'challenge_mismatch');
    }

    const inserted = await insertSubmission(pool, {
      ...parsed.value,
      ipHash: hashRequestIp(req, env),
      userAgentHash: hashUserAgent(req, env),
      requestId: req.requestId
    }, env);
    const state = await buildState(pool, challengeId);

    return sendJson(res, 201, { ok: true, submission: submissionRowToPublic(inserted, false), state });
  }

  if (method === 'GET' && path === '/api/leaderboard'){
    throw new AppError('Submit your challenge response before viewing the dashboard.', 401, 'dashboard_locked');
  }

  if (method === 'POST' && path === '/api/leaderboard'){
    const body = await readJsonBody(req, env);
    const parsed = validateAttemptPayload(body);
    if (!parsed.ok) return sendJson(res, 400, { ok: false, message: parsed.errors[0], errors: parsed.errors });
    if (parsed.value.challengeId !== challengeId){
      throw new AppError('Challenge ID does not match the active challenge.', 400, 'challenge_mismatch');
    }
    await verifyDashboardSession(pool, parsed.value, env);
    return sendJson(res, 200, await buildState(pool, challengeId));
  }

  if (method === 'GET' && path === '/api/admin/challenge'){
    requireAdmin(req, env);
    const challenge = await getChallenge(pool, challengeId);
    const state = await buildState(pool, challengeId);
    const codeStats = await getCodeStats(pool, challengeId);
    return sendJson(res, 200, { ok: true, challenge, codeStats, stats: state.stats });
  }

  if (method === 'GET' && path === '/api/admin/export'){
    requireAdmin(req, env);
    const rows = await listSubmissions(pool, challengeId);
    return sendJson(res, 200, { ok: true, challengeId, submissions: rows });
  }

  if (method === 'GET' && path === '/api/admin/export.csv'){
    requireAdmin(req, env);
    const rows = await listSubmissions(pool, challengeId);
    return sendText(res, 200, rowsToCsv(rows), 'text/csv; charset=utf-8', {
      'Content-Disposition': `attachment; filename="${challengeId}-submissions.csv"`
    });
  }

  if (method === 'GET' && path === '/api/admin/duplicate-device-audit'){
    requireAdmin(req, env);
    const rows = await listDuplicateDeviceAudit(pool, challengeId);
    return sendJson(res, 200, { ok: true, challengeId, audit: rows });
  }

  if (method === 'GET' && path === '/api/admin/duplicate-device-audit.csv'){
    requireAdmin(req, env);
    const rows = await listDuplicateDeviceAudit(pool, challengeId);
    return sendText(res, 200, auditRowsToCsv(rows), 'text/csv; charset=utf-8', {
      'Content-Disposition': `attachment; filename="${challengeId}-duplicate-device-audit.csv"`
    });
  }

  if (method === 'POST' && path === '/api/admin/cleanup-sessions'){
    requireAdmin(req, env);
    await cleanupExpiredSessions(pool);
    return sendJson(res, 200, { ok: true });
  }

  if (method === 'POST' && path === '/api/admin/reset'){
    requireAdmin(req, env);
    if (env.ENABLE_ADMIN_RESET !== 'true'){
      throw new AppError('Reset is disabled. Set ENABLE_ADMIN_RESET=true to allow it.', 403, 'reset_disabled');
    }
    await resetChallengeData(pool, challengeId);
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { ok: false, message: 'Route not found.' });
}

async function handleRequest(req, res, env = process.env){
  req.requestId = cryptoRandomId();
  addCors(req, res, env);
  res.setHeader('X-Request-ID', req.requestId);

  if (String(req.method || '').toUpperCase() === 'OPTIONS'){
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    checkRateLimit(req, env);

    // Health checks must remain lightweight and must not require a database
    // connection. This lets Docker/Vercel determine that the function process is
    // alive even if Supabase is temporarily unavailable. /api/readyz performs
    // the database-backed readiness check.
    const method = String(req.method || 'GET').toUpperCase();
    const path = getPath(req);
    if (method === 'GET' && (path === '/api/healthz' || path === '/api')){
      await routeRequest(req, res, null, env);
      return;
    }

    const pool = await bootstrap(env);
    await routeRequest(req, res, pool, env);
  } catch (error) {
    const status = error.statusCode || (error instanceof AppError ? error.statusCode : 500);
    const code = error.code || 'error';
    const message = status >= 500 ? 'Internal server error.' : error.message;

    // Do not log request bodies or challenge codes. Only safe operational fields.
    if (status >= 500){
      console.error(JSON.stringify({ level: 'error', code, status, requestId: req.requestId, message: error.message, stack: error.stack }));
    } else {
      console.warn(JSON.stringify({ level: 'warn', code, status, requestId: req.requestId, message: error.message }));
    }

    sendJson(res, status, { ok: false, code, message, requestId: req.requestId });
  }
}

function cryptoRandomId(){
  return require('node:crypto').randomUUID();
}

module.exports = {
  bootstrap,
  handleRequest,
  routeRequest,
  getPath,
  rowsToCsv,
  auditRowsToCsv
};
