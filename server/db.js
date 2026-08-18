const crypto = require('node:crypto');
const { MIGRATIONS } = require('./schema');
const {
  createAttemptToken,
  hashAttemptToken,
  hashValue,
  calculateCorrectCount,
  buildWordHits,
  hashChallengeCode,
  timingSafeEqualText,
  codeFingerprintFromHash,
  nicknameFromCodeRef,
  normalizeChallengeCode
} = require('./domain');

class AppError extends Error {
  constructor(message, statusCode = 500, code = 'app_error'){
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

let poolInstance;

let PgPoolConstructor;

function getPgPoolConstructor(){
  if (!PgPoolConstructor){
    try {
      PgPoolConstructor = require('pg').Pool;
    } catch (error) {
      throw new AppError('The pg package is required for database access. Run npm install before starting the API.', 500, 'pg_dependency_missing');
    }
  }
  return PgPoolConstructor;
}

function parseDatabaseUrl(env = process.env){
  const raw = String(env.DATABASE_URL || '').trim();
  if (!raw){
    if (env.NODE_ENV === 'production'){
      throw new AppError('DATABASE_URL must be set in the Vercel Production environment.', 500, 'database_url_missing');
    }
    return null;
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    throw new AppError('DATABASE_URL is not a valid PostgreSQL connection string.', 500, 'database_url_invalid');
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.username){
    throw new AppError('DATABASE_URL must be a complete postgres:// or postgresql:// connection string.', 500, 'database_url_invalid');
  }

  const isSupabaseDirect = /^db\.[a-z0-9]+\.supabase\.co$/i.test(parsed.hostname)
    && (!parsed.port || parsed.port === '5432');
  const isVercel = Boolean(env.VERCEL || env.VERCEL_ENV);

  if (env.NODE_ENV === 'production' && isVercel && isSupabaseDirect && env.ALLOW_SUPABASE_DIRECT_CONNECTION !== 'true'){
    throw new AppError(
      'DATABASE_URL uses the Supabase direct database endpoint. For Vercel, copy the Transaction pooler connection string from Supabase Connect (shared pooler, port 6543).',
      500,
      'supabase_direct_database_url'
    );
  }

  return parsed;
}

function mapDatabaseError(error, env = process.env){
  if (error instanceof AppError) return error;

  const code = String(error && error.code || '');
  if (['ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'ECONNREFUSED', 'ETIMEDOUT'].includes(code)){
    const parsed = (() => {
      try { return parseDatabaseUrl({ ...env, NODE_ENV: 'development', VERCEL: '', VERCEL_ENV: '' }); }
      catch (_) { return null; }
    })();
    const supabaseHint = parsed && /\.supabase\.co$/i.test(parsed.hostname)
      ? ' Copy the Transaction pooler connection string from Supabase Connect; serverless traffic uses the shared pooler on port 6543.'
      : '';
    const mapped = new AppError(`Database host is unreachable.${supabaseHint}`, 500, 'database_host_unreachable');
    mapped.cause = error;
    return mapped;
  }

  if (code === '28P01'){
    const mapped = new AppError('Database authentication failed. Check the username and rotated database password in DATABASE_URL.', 500, 'database_authentication_failed');
    mapped.cause = error;
    return mapped;
  }

  return error;
}


// -----------------------------------------------------------------------------
// Database connection
// -----------------------------------------------------------------------------
// Vercel functions can scale horizontally, so the default pool size is 1. Use the
// Supabase transaction pooler URL in DATABASE_URL to avoid exhausting Postgres
// connections when many staff open the challenge at the same time.
function createPoolFromEnv(env = process.env){
  const parsedDatabaseUrl = parseDatabaseUrl(env);
  const Pool = getPgPoolConstructor();
  const ssl = env.PGSSLMODE === 'disable'
    ? false
    : { rejectUnauthorized: env.PGSSL_REJECT_UNAUTHORIZED === 'true' };

  if (parsedDatabaseUrl){
    return new Pool({
      connectionString: parsedDatabaseUrl.toString(),
      max: Number(env.PGPOOL_MAX || 1),
      idleTimeoutMillis: Number(env.PGPOOL_IDLE_TIMEOUT_MS || 10000),
      connectionTimeoutMillis: Number(env.PGPOOL_CONNECTION_TIMEOUT_MS || 10000),
      ssl
    });
  }

  return new Pool({
    host: env.PGHOST || 'localhost',
    port: Number(env.PGPORT || 5432),
    database: env.PGDATABASE || 'gw_challenge',
    user: env.PGUSER || 'postgres',
    password: env.PGPASSWORD || 'postgres',
    max: Number(env.PGPOOL_MAX || 4),
    idleTimeoutMillis: Number(env.PGPOOL_IDLE_TIMEOUT_MS || 10000),
    connectionTimeoutMillis: Number(env.PGPOOL_CONNECTION_TIMEOUT_MS || 10000),
    ssl: env.PGSSLMODE === 'require' ? ssl : false
  });
}

function getPool(env = process.env){
  if (!poolInstance) poolInstance = createPoolFromEnv(env);
  return poolInstance;
}

// -----------------------------------------------------------------------------
// Runtime secret checks
// -----------------------------------------------------------------------------
function looksLikePlaceholder(value){
  return !value || /replace-with|change-me|placeholder/i.test(String(value));
}

function ensureRuntimeSecrets(env = process.env){
  const production = env.NODE_ENV === 'production';
  const required = [
    ['CODE_HASH_SECRET', env.CODE_HASH_SECRET],
    ['ATTEMPT_TOKEN_SALT', env.ATTEMPT_TOKEN_SALT],
    ['IP_HASH_SALT', env.IP_HASH_SALT],
    ['ADMIN_API_KEY', env.ADMIN_API_KEY]
  ];

  if (production){
    parseDatabaseUrl(env);
    for (const [name, value] of required){
      if (looksLikePlaceholder(value) || String(value || '').length < 32){
        throw new AppError(`${name} must be set to a strong random value before production deployment.`, 500, 'weak_secret');
      }
    }
  }
}

// -----------------------------------------------------------------------------
// Migrations and challenge setup
// -----------------------------------------------------------------------------
async function migrate(pool){
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // A transaction-scoped lock is safe with Supabase transaction pooling and
    // avoids two cold starts applying migrations at the same time.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('fun-zone-arena-migrations'))`);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);

    for (const migration of MIGRATIONS){
      const already = await client.query('SELECT 1 FROM schema_migrations WHERE id = $1', [migration.id]);
      if (!already.rowCount){
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations(id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [migration.id]);
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function parseDateOrNull(value){
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function challengeWindowFromEnv(env = process.env){
  const now = new Date();
  const durationDays = Number(env.CHALLENGE_DURATION_DAYS || 7);
  const startsAt = parseDateOrNull(env.CHALLENGE_START_AT) || now;
  const endsAt = parseDateOrNull(env.CHALLENGE_END_AT) || new Date(startsAt.getTime() + durationDays * 86400000);
  if (endsAt <= startsAt) throw new Error('CHALLENGE_END_AT must be after CHALLENGE_START_AT.');
  return { startsAt, endsAt };
}

async function ensureDefaultChallenge(pool, env = process.env){
  const id = env.CHALLENGE_ID || 'fun-zone-arena-2026';
  const title = env.CHALLENGE_TITLE || 'Fun Zone Arena Challenge';
  const status = env.CHALLENGE_STATUS || 'active';
  const { startsAt, endsAt } = challengeWindowFromEnv(env);

  const existing = await pool.query('SELECT * FROM challenges WHERE id = $1', [id]);
  if (!existing.rowCount){
    await pool.query(
      `INSERT INTO challenges(id, title, starts_at, ends_at, status) VALUES ($1, $2, $3, $4, $5)`,
      [id, title, startsAt.toISOString(), endsAt.toISOString(), status]
    );
  } else if (env.SYNC_CHALLENGE_WINDOW === 'true'){
    await pool.query(
      `UPDATE challenges SET title = $2, starts_at = $3, ends_at = $4, status = $5, updated_at = now() WHERE id = $1`,
      [id, title, startsAt.toISOString(), endsAt.toISOString(), status]
    );
  }

  return getChallenge(pool, id);
}

async function getChallenge(pool, challengeId){
  const result = await pool.query('SELECT * FROM challenges WHERE id = $1', [challengeId]);
  if (!result.rowCount) throw new AppError('Challenge was not found.', 404, 'challenge_not_found');
  return result.rows[0];
}

function assertChallengeCanStart(challenge, now = new Date()){
  if (challenge.status !== 'active') throw new AppError('Challenge is not active.', 403, 'challenge_not_active');
  if (new Date(challenge.starts_at).getTime() > now.getTime()){
    throw new AppError('Challenge has not started yet.', 403, 'challenge_not_started');
  }
  if (new Date(challenge.ends_at).getTime() <= now.getTime()){
    throw new AppError('Challenge has ended. New attempts are closed.', 403, 'challenge_closed');
  }
}

function assertChallengeCanSubmit(challenge, env = process.env, now = new Date()){
  if (challenge.status !== 'active') throw new AppError('Challenge is not active.', 403, 'challenge_not_active');
  if (new Date(challenge.starts_at).getTime() > now.getTime()){
    throw new AppError('Challenge has not started yet.', 403, 'challenge_not_started');
  }
  if (env.ACCEPT_LATE_SUBMISSIONS !== 'true' && new Date(challenge.ends_at).getTime() <= now.getTime()){
    throw new AppError('Challenge has ended. New submissions are closed.', 403, 'challenge_closed');
  }
}

function codeHashForPayload(challengeCode, env = process.env){
  const codeHash = hashChallengeCode(challengeCode, env.CODE_HASH_SECRET || 'local-development-code-secret-change-me');
  if (!codeHash) throw new AppError('Challenge code is invalid or not recognized.', 403, 'invalid_challenge_code');
  return codeHash;
}


// -----------------------------------------------------------------------------
// Optional local/Docker demo-code seeding
// -----------------------------------------------------------------------------
// Production code imports should normally use scripts/generate-codes.mjs and the
// Supabase SQL Editor. This helper exists so Docker Compose can boot a complete
// demo with a few known codes. It requires ALLOW_SEED_CODES_FROM_ENV=true so raw
// codes are not accidentally passed through production environment variables.
async function seedCodesFromEnv(pool, env = process.env){
  const raw = String(env.SEED_CHALLENGE_CODES || '').trim();
  if (!raw) return { inserted: 0, skipped: 0 };
  if (env.ALLOW_SEED_CODES_FROM_ENV !== 'true'){
    throw new AppError('SEED_CHALLENGE_CODES is set but ALLOW_SEED_CODES_FROM_ENV is not true.', 500, 'seed_not_allowed');
  }

  const challengeId = env.CHALLENGE_ID || 'fun-zone-arena-2026';
  const codes = raw.split(/[\n,;]+/).map((item) => normalizeChallengeCode(item)).filter(Boolean);
  const unique = Array.from(new Set(codes));
  let inserted = 0;
  let skipped = 0;

  for (const code of unique){
    const codeHash = hashChallengeCode(code, env.CODE_HASH_SECRET || 'local-development-code-secret-change-me');
    if (!codeHash){
      skipped += 1;
      continue;
    }
    const codeFingerprint = codeFingerprintFromHash(codeHash);
    const codeNickname = nicknameFromCodeRef(codeFingerprint);
    const result = await pool.query(
      `INSERT INTO challenge_codes(challenge_id, code_hash, code_fingerprint, code_nickname, status)
       VALUES ($1, $2, $3, $4, 'active')
       ON CONFLICT (challenge_id, code_hash) DO UPDATE SET
         code_fingerprint = EXCLUDED.code_fingerprint,
         code_nickname = EXCLUDED.code_nickname`,
      [challengeId, codeHash, codeFingerprint, codeNickname]
    );
    inserted += result.rowCount || 0;
  }

  return { inserted, skipped };
}

// -----------------------------------------------------------------------------
// Attempt sessions
// -----------------------------------------------------------------------------
// The first valid code entry sets challenge_codes.started_at. Every later session
// for the same code keeps the original started_at, so refreshing the browser does
// not reset the participant timer.
async function createAttemptSession(pool, { challengeId, challengeCode, participantName, country, tokenSalt, ipHash, userAgentHash, ttlMinutes = 480 }, env = process.env){
  const client = await pool.connect();
  const now = new Date();
  const codeHash = codeHashForPayload(challengeCode, env);
  const codeFingerprint = codeFingerprintFromHash(codeHash);

  try {
    await client.query('BEGIN');

    const challengeRes = await client.query('SELECT * FROM challenges WHERE id = $1 FOR SHARE', [challengeId]);
    if (!challengeRes.rowCount) throw new AppError('Challenge was not found.', 404, 'challenge_not_found');
    const challenge = challengeRes.rows[0];
    assertChallengeCanStart(challenge, now);

    const codeRes = await client.query(
      `SELECT * FROM challenge_codes WHERE challenge_id = $1 AND code_hash = $2 FOR UPDATE`,
      [challengeId, codeHash]
    );

    if (!codeRes.rowCount || codeRes.rows[0].status !== 'active'){
      throw new AppError('Challenge code is invalid or not recognized.', 403, 'invalid_challenge_code');
    }

    const codeRow = codeRes.rows[0];
    const codeNickname = codeRow.code_nickname || nicknameFromCodeRef(codeFingerprint);
    if (codeRow.used_at){
      throw new AppError('This challenge code has already submitted for this challenge.', 409, 'duplicate_challenge_code');
    }

    const startedAt = codeRow.started_at ? new Date(codeRow.started_at) : now;
    if (!codeRow.started_at){
      await client.query(
        `UPDATE challenge_codes SET started_at = $3 WHERE challenge_id = $1 AND code_hash = $2`,
        [challengeId, codeHash, startedAt.toISOString()]
      );
    }

    const id = crypto.randomUUID();
    const token = createAttemptToken();
    const tokenHash = hashAttemptToken(token, tokenSalt);
    const expiresAt = new Date(Date.now() + Number(ttlMinutes || 480) * 60000);

    const result = await client.query(
      `INSERT INTO attempt_sessions(id, challenge_id, code_hash, token_hash, participant_name, country, started_at, expires_at, ip_hash, user_agent_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, challenge_id, participant_name, country, started_at, expires_at`,
      [id, challengeId, codeHash, tokenHash, participantName, country, startedAt.toISOString(), expiresAt.toISOString(), ipHash, userAgentHash]
    );

    await client.query('COMMIT');
    const row = result.rows[0];
    return {
      id: row.id,
      challengeId: row.challenge_id,
      startedAt: row.started_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      codeFingerprint,
      codeRef: codeFingerprint,
      nickname: codeNickname,
      participantName: row.participant_name,
      country: row.country,
      token
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function createReturningDashboardSession(pool, { challengeId, challengeCode, tokenSalt, ipHash, userAgentHash, ttlMinutes = 480 }, env = process.env){
  const client = await pool.connect();
  const now = new Date();
  const codeHash = codeHashForPayload(challengeCode, env);
  const codeFingerprint = codeFingerprintFromHash(codeHash);

  try {
    await client.query('BEGIN');

    const challengeRes = await client.query('SELECT * FROM challenges WHERE id = $1 FOR SHARE', [challengeId]);
    if (!challengeRes.rowCount) throw new AppError('Challenge was not found.', 404, 'challenge_not_found');

    const codeRes = await client.query(
      `SELECT * FROM challenge_codes WHERE challenge_id = $1 AND code_hash = $2 FOR SHARE`,
      [challengeId, codeHash]
    );
    if (!codeRes.rowCount || codeRes.rows[0].status !== 'active'){
      throw new AppError('Challenge code is invalid or not recognized.', 403, 'invalid_challenge_code');
    }

    const codeRow = codeRes.rows[0];
    const codeNickname = codeRow.code_nickname || nicknameFromCodeRef(codeFingerprint);
    if (!codeRow.used_at){
      await client.query('COMMIT');
      return {
        profileRequired: true,
        codeRef: codeFingerprint,
        nickname: codeNickname,
        message: 'This code is ready. Enter your name and country to start the challenge.'
      };
    }

    const submissionRes = await client.query(
      `SELECT * FROM submissions WHERE challenge_id = $1 AND code_hash = $2 ORDER BY submitted_at DESC LIMIT 1`,
      [challengeId, codeHash]
    );
    if (!submissionRes.rowCount){
      throw new AppError('This code was already used, but its result could not be found. Please contact the challenge administrator.', 409, 'submission_not_found');
    }

    const submission = submissionRes.rows[0];
    const id = crypto.randomUUID();
    const token = createAttemptToken();
    const tokenHash = hashAttemptToken(token, tokenSalt);
    const startedAt = codeRow.started_at || submission.submitted_at || now;
    const expiresAt = new Date(Date.now() + Number(ttlMinutes || 480) * 60000);
    const participantName = submission.participant_name || submission.participant_alias || 'Player';
    const country = submission.country || 'Unspecified';

    const result = await client.query(
      `INSERT INTO attempt_sessions(id, challenge_id, code_hash, token_hash, participant_name, country, started_at, expires_at, consumed_at, ip_hash, user_agent_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, challenge_id, participant_name, country, started_at, expires_at, consumed_at`,
      [id, challengeId, codeHash, tokenHash, participantName, country, new Date(startedAt).toISOString(), expiresAt.toISOString(), now.toISOString(), ipHash, userAgentHash]
    );

    await client.query('COMMIT');
    const row = result.rows[0];
    return {
      profileRequired: false,
      session: {
        id: row.id,
        challengeId: row.challenge_id,
        startedAt: row.started_at.toISOString(),
        expiresAt: row.expires_at.toISOString(),
        codeFingerprint,
        codeRef: codeFingerprint,
        nickname: codeNickname,
        participantName: row.participant_name,
        country: row.country,
        token,
        submitted: true,
        dashboardOnly: true
      }
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// -----------------------------------------------------------------------------
// Submission insert
// -----------------------------------------------------------------------------
async function nextParticipantAlias(client){
  const result = await client.query(`SELECT nextval('submission_alias_seq')::bigint AS n`);
  const number = Number(result.rows[0].n || 0);
  return `Participant #${String(number).padStart(4, '0')}`;
}

async function recordDuplicateDeviceAudit(client, { submission, currentCodeHash, ipHash, userAgentHash, requestId }){
  if (!ipHash || !userAgentHash) return null;

  const matchesRes = await client.query(
    `SELECT id, code_fingerprint, code_nickname, participant_name, country, submitted_at
     FROM submissions
     WHERE challenge_id = $1
       AND ip_hash = $2
       AND user_agent_hash = $3
       AND code_hash <> $4
     ORDER BY submitted_at ASC
     LIMIT 25`,
    [submission.challenge_id, ipHash, userAgentHash, currentCodeHash]
  );
  if (!matchesRes.rowCount) return null;

  const matches = matchesRes.rows;
  const auditRes = await client.query(
    `INSERT INTO duplicate_device_audit(
      id, challenge_id, audit_reason, ip_hash, user_agent_hash,
      current_submission_id, current_code_fingerprint, current_code_nickname, current_participant_name, current_country,
      matched_submission_ids, matched_code_fingerprints, matched_code_nicknames, matched_participant_names, matched_countries,
      matched_count, request_id
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::uuid[],$12::text[],$13::text[],$14::text[],$15::text[],$16,$17)
    ON CONFLICT (current_submission_id) DO NOTHING
    RETURNING *`,
    [
      crypto.randomUUID(),
      submission.challenge_id,
      'same_hashed_device_multiple_codes',
      ipHash,
      userAgentHash,
      submission.id,
      submission.code_fingerprint,
      submission.code_nickname || null,
      submission.participant_name || submission.participant_alias || null,
      submission.country || null,
      matches.map((row) => row.id),
      matches.map((row) => row.code_fingerprint || ''),
      matches.map((row) => row.code_nickname || ''),
      matches.map((row) => row.participant_name || ''),
      matches.map((row) => row.country || ''),
      matches.length,
      requestId || null
    ]
  );

  return auditRes.rows[0] || null;
}

async function insertSubmission(pool, payload, env = process.env){
  const client = await pool.connect();
  const tokenSalt = env.ATTEMPT_TOKEN_SALT || env.ADMIN_API_KEY || 'change-me-attempt-token-salt';
  const now = new Date();

  try {
    await client.query('BEGIN');

    const challengeRes = await client.query('SELECT * FROM challenges WHERE id = $1 FOR SHARE', [payload.challengeId]);
    if (!challengeRes.rowCount) throw new AppError('Challenge was not found.', 404, 'challenge_not_found');
    const challenge = challengeRes.rows[0];
    assertChallengeCanSubmit(challenge, env, now);

    const sessionRes = await client.query(
      `SELECT * FROM attempt_sessions WHERE id = $1 AND challenge_id = $2 FOR UPDATE`,
      [payload.attemptSessionId, payload.challengeId]
    );

    if (!sessionRes.rowCount){
      throw new AppError('Attempt session was not found. Please enter your challenge code again.', 400, 'session_not_found');
    }

    const session = sessionRes.rows[0];
    if (session.consumed_at) throw new AppError('This attempt session has already been submitted.', 409, 'session_consumed');
    if (new Date(session.expires_at).getTime() <= now.getTime()){
      throw new AppError('Your attempt session has expired. Please enter your challenge code again.', 400, 'session_expired');
    }

    const suppliedHash = hashAttemptToken(payload.attemptToken, tokenSalt);
    if (!timingSafeEqualText(suppliedHash, session.token_hash)){
      throw new AppError('Attempt token is invalid. Please enter your challenge code again.', 401, 'invalid_attempt_token');
    }

    const codeRes = await client.query(
      `SELECT * FROM challenge_codes WHERE challenge_id = $1 AND code_hash = $2 FOR UPDATE`,
      [payload.challengeId, session.code_hash]
    );
    if (!codeRes.rowCount || codeRes.rows[0].status !== 'active'){
      throw new AppError('Challenge code is invalid or not recognized.', 403, 'invalid_challenge_code');
    }
    if (codeRes.rows[0].used_at){
      throw new AppError('This challenge code has already submitted for this challenge.', 409, 'duplicate_challenge_code');
    }

    const timeTakenMs = Math.max(1000, now.getTime() - new Date(session.started_at).getTime());
    const correctCount = calculateCorrectCount(payload.answers);
    const wordHits = buildWordHits(payload.answers);
    const id = crypto.randomUUID();
    const codeFingerprint = codeFingerprintFromHash(session.code_hash);
    const codeNickname = codeRes.rows[0].code_nickname || nicknameFromCodeRef(codeFingerprint);
    const participantName = session.participant_name || await nextParticipantAlias(client);
    const participantAlias = participantName;
    const country = session.country;
    if (!country) throw new AppError('Participation country was not saved on this attempt. Please enter your challenge code again.', 400, 'country_missing');

    let inserted;
    try {
      const insertRes = await client.query(
        `INSERT INTO submissions(
          id, challenge_id, attempt_session_id, code_hash, code_fingerprint, code_nickname, participant_name, participant_alias, country,
          answers, correct_count, word_hits, time_taken_ms, submitted_at, ip_hash, user_agent_hash, request_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12::jsonb,$13,$14,$15,$16,$17)
        RETURNING *`,
        [
          id,
          payload.challengeId,
          payload.attemptSessionId,
          session.code_hash,
          codeFingerprint,
          codeNickname,
          participantName,
          participantAlias,
          country,
          JSON.stringify(payload.answers),
          correctCount,
          JSON.stringify(wordHits),
          timeTakenMs,
          now.toISOString(),
          payload.ipHash || null,
          payload.userAgentHash || null,
          payload.requestId || null
        ]
      );
      inserted = insertRes.rows[0];
    } catch (error) {
      if (error.code === '23505'){
        if (String(error.constraint || '').includes('challenge_code')){
          throw new AppError('This challenge code has already submitted for this challenge.', 409, 'duplicate_challenge_code');
        }
        throw new AppError('This attempt has already been submitted.', 409, 'duplicate_attempt');
      }
      throw error;
    }

    await client.query(
      `UPDATE challenge_codes SET used_at = $3 WHERE challenge_id = $1 AND code_hash = $2`,
      [payload.challengeId, session.code_hash, now.toISOString()]
    );
    await client.query('UPDATE attempt_sessions SET consumed_at = $2 WHERE id = $1', [payload.attemptSessionId, now.toISOString()]);
    await recordDuplicateDeviceAudit(client, {
      submission: inserted,
      currentCodeHash: session.code_hash,
      ipHash: payload.ipHash || null,
      userAgentHash: payload.userAgentHash || null,
      requestId: payload.requestId || null
    });
    await client.query('COMMIT');

    return inserted;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}


// -----------------------------------------------------------------------------
// Session verification for protected puzzle image delivery
// -----------------------------------------------------------------------------
async function verifyAttemptSession(pool, payload, env = process.env){
  const tokenSalt = env.ATTEMPT_TOKEN_SALT || env.ADMIN_API_KEY || 'change-me-attempt-token-salt';
  const now = new Date();

  const challengeRes = await pool.query('SELECT * FROM challenges WHERE id = $1', [payload.challengeId]);
  if (!challengeRes.rowCount) throw new AppError('Challenge was not found.', 404, 'challenge_not_found');
  assertChallengeCanSubmit(challengeRes.rows[0], env, now);

  const sessionRes = await pool.query(
    `SELECT * FROM attempt_sessions WHERE id = $1 AND challenge_id = $2`,
    [payload.attemptSessionId, payload.challengeId]
  );
  if (!sessionRes.rowCount){
    throw new AppError('Attempt session was not found. Please enter your challenge code again.', 400, 'session_not_found');
  }

  const session = sessionRes.rows[0];
  if (session.consumed_at) throw new AppError('This attempt session has already been submitted.', 409, 'session_consumed');
  if (new Date(session.expires_at).getTime() <= now.getTime()){
    throw new AppError('Your attempt session has expired. Please enter your challenge code again.', 400, 'session_expired');
  }

  const suppliedHash = hashAttemptToken(payload.attemptToken, tokenSalt);
  if (!timingSafeEqualText(suppliedHash, session.token_hash)){
    throw new AppError('Attempt token is invalid. Please enter your challenge code again.', 401, 'invalid_attempt_token');
  }

  return session;
}

async function verifyDashboardSession(pool, payload, env = process.env){
  const tokenSalt = env.ATTEMPT_TOKEN_SALT || env.ADMIN_API_KEY || 'change-me-attempt-token-salt';
  const now = new Date();

  const sessionRes = await pool.query(
    `SELECT * FROM attempt_sessions WHERE id = $1 AND challenge_id = $2`,
    [payload.attemptSessionId, payload.challengeId]
  );
  if (!sessionRes.rowCount){
    throw new AppError('Submit your challenge response before viewing the dashboard.', 401, 'dashboard_locked');
  }

  const session = sessionRes.rows[0];
  if (!session.consumed_at){
    throw new AppError('Submit your challenge response before viewing the dashboard.', 403, 'dashboard_after_submission_only');
  }
  if (new Date(session.expires_at).getTime() <= now.getTime()){
    throw new AppError('Your dashboard access expired. Please enter your challenge code again.', 401, 'session_expired');
  }

  const suppliedHash = hashAttemptToken(payload.attemptToken, tokenSalt);
  if (!timingSafeEqualText(suppliedHash, session.token_hash)){
    throw new AppError('Submit your challenge response before viewing the dashboard.', 401, 'dashboard_locked');
  }

  return session;
}

// -----------------------------------------------------------------------------
// Read/query helpers
// -----------------------------------------------------------------------------
async function listSubmissions(pool, challengeId){
  const result = await pool.query(
    `SELECT * FROM submissions WHERE challenge_id = $1 ORDER BY correct_count DESC, time_taken_ms ASC, submitted_at ASC`,
    [challengeId]
  );
  return result.rows;
}

async function listDuplicateDeviceAudit(pool, challengeId){
  const result = await pool.query(
    `SELECT *
     FROM duplicate_device_audit
     WHERE challenge_id = $1
     ORDER BY detected_at DESC`,
    [challengeId]
  );
  return result.rows;
}

async function getCodeStats(pool, challengeId){
  const result = await pool.query(
    `SELECT
       COUNT(*)::int AS total_codes,
       COUNT(started_at)::int AS started_codes,
       COUNT(used_at)::int AS used_codes
     FROM challenge_codes
     WHERE challenge_id = $1 AND status = 'active'`,
    [challengeId]
  );
  return result.rows[0] || { total_codes: 0, started_codes: 0, used_codes: 0 };
}

async function cleanupExpiredSessions(pool){
  await pool.query(`DELETE FROM attempt_sessions WHERE expires_at < now() - interval '7 days' AND consumed_at IS NULL`);
}

async function resetChallengeData(pool, challengeId){
  await pool.query('DELETE FROM submissions WHERE challenge_id = $1', [challengeId]);
  await pool.query('UPDATE challenge_codes SET started_at = NULL, used_at = NULL WHERE challenge_id = $1', [challengeId]);
  await pool.query('DELETE FROM attempt_sessions WHERE challenge_id = $1', [challengeId]);
}

function hashRequestIp(request, env = process.env){
  const forwarded = request.headers['x-forwarded-for'];
  const raw = String(Array.isArray(forwarded) ? forwarded[0] : forwarded || request.socket?.remoteAddress || '').split(',')[0].trim();
  return hashValue(raw, env.IP_HASH_SALT || env.ADMIN_API_KEY || 'change-me-ip-salt');
}

function hashUserAgent(request, env = process.env){
  return hashValue(request.headers['user-agent'] || '', env.IP_HASH_SALT || env.ADMIN_API_KEY || 'change-me-user-agent-salt');
}

function normalizeCodeForGeneration(value){
  return normalizeChallengeCode(value);
}

module.exports = {
  AppError,
  parseDatabaseUrl,
  mapDatabaseError,
  createPoolFromEnv,
  getPool,
  ensureRuntimeSecrets,
  migrate,
  ensureDefaultChallenge,
  seedCodesFromEnv,
  getChallenge,
  assertChallengeCanStart,
  assertChallengeCanSubmit,
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
  hashUserAgent,
  normalizeCodeForGeneration
};
