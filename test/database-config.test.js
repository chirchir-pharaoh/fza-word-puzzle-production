const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AppError,
  ensureRuntimeSecrets,
  mapDatabaseError,
  parseDatabaseUrl
} = require('../server/db');

const strongSecrets = {
  CODE_HASH_SECRET: 'c'.repeat(48),
  ATTEMPT_TOKEN_SALT: 't'.repeat(48),
  IP_HASH_SALT: 'i'.repeat(48),
  ADMIN_API_KEY: 'a'.repeat(48)
};

test('production requires DATABASE_URL before the API bootstraps', () => {
  assert.throws(
    () => ensureRuntimeSecrets({ NODE_ENV: 'production', ...strongSecrets }),
    (error) => error instanceof AppError && error.code === 'database_url_missing'
  );
});

test('Vercel rejects the Supabase direct IPv6 endpoint by default', () => {
  assert.throws(
    () => parseDatabaseUrl({
      NODE_ENV: 'production',
      VERCEL: '1',
      DATABASE_URL: 'postgresql://postgres:encoded-password@db.abcdefghijklmnopqrst.supabase.co:5432/postgres'
    }),
    (error) => error instanceof AppError && error.code === 'supabase_direct_database_url'
  );
});

test('Vercel accepts a Supabase transaction pooler URL', () => {
  const parsed = parseDatabaseUrl({
    NODE_ENV: 'production',
    VERCEL: '1',
    DATABASE_URL: 'postgresql://postgres.abcdefghijklmnopqrst:encoded-password@aws-0-example.pooler.supabase.com:6543/postgres?sslmode=require'
  });
  assert.equal(parsed.hostname, 'aws-0-example.pooler.supabase.com');
  assert.equal(parsed.port, '6543');
  assert.equal(parsed.username, 'postgres.abcdefghijklmnopqrst');
});

test('database network errors become safe actionable application errors', () => {
  const source = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
  const mapped = mapDatabaseError(source, {
    DATABASE_URL: 'postgresql://postgres.abcdefghijklmnopqrst:encoded-password@aws-0-example.pooler.supabase.com:6543/postgres'
  });
  assert.equal(mapped.code, 'database_host_unreachable');
  assert.equal(mapped.statusCode, 500);
  assert.doesNotMatch(mapped.message, /encoded-password/);
});

