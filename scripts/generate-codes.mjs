#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { hashChallengeCode, codeFingerprintFromHash, nicknameFromCodeRef, normalizeChallengeCode } = require('../server/domain.js');
const { MIGRATIONS } = require('../server/schema.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// -----------------------------------------------------------------------------
// Argument parsing
// -----------------------------------------------------------------------------
function parseArgs(argv){
  const args = {
    count: 1000,
    prefix: 'FZA',
    out: path.join(rootDir, 'private', 'generated-codes'),
    challenge: process.env.CHALLENGE_ID || 'fun-zone-arena-2026',
    title: process.env.CHALLENGE_TITLE || 'Fun Zone Arena Challenge',
    start: process.env.CHALLENGE_START_AT || new Date().toISOString(),
    end: process.env.CHALLENGE_END_AT || new Date(Date.now() + 7 * 86400000).toISOString()
  };

  for (let i = 0; i < argv.length; i += 1){
    const item = argv[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    if (key === 'count') args.count = Number(value);
    else if (key === 'prefix') args.prefix = value;
    else if (key === 'out') args.out = path.resolve(value);
    else if (key === 'challenge') args.challenge = value;
    else if (key === 'title') args.title = value;
    else if (key === 'start') args.start = value;
    else if (key === 'end') args.end = value;
  }

  if (!Number.isInteger(args.count) || args.count < 1 || args.count > 100000){
    throw new Error('--count must be an integer from 1 to 100000.');
  }
  if (new Date(args.end) <= new Date(args.start)){
    throw new Error('--end must be after --start.');
  }
  return args;
}

function sqlString(value){
  return `'${String(value).replace(/'/g, "''")}'`;
}

function csvCell(value){
  return '"' + String(value ?? '').replace(/"/g, '""') + '"';
}

// -----------------------------------------------------------------------------
// Code generation
// -----------------------------------------------------------------------------
// Codes are random, not derived from employee numbers. Store the private CSV
// securely and distribute each raw code through your internal channel.
function randomCode(prefix){
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // avoids I/O/1/0 confusion
  let raw = '';
  while (raw.length < 12){
    const bytes = crypto.randomBytes(12);
    for (const byte of bytes){
      raw += alphabet[byte % alphabet.length];
      if (raw.length >= 12) break;
    }
  }
  const grouped = raw.match(/.{1,4}/g).join('-');
  const cleanPrefix = String(prefix || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return cleanPrefix ? `${cleanPrefix}-${grouped}` : grouped;
}

function generateCodeRows({ count, prefix, secret }){
  const seen = new Set();
  const seenNicknames = new Set();
  const rows = [];

  while (rows.length < count){
    const code = randomCode(prefix);
    const normalized = normalizeChallengeCode(code);
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    const codeHash = hashChallengeCode(code, secret);
    const codeFingerprint = codeFingerprintFromHash(codeHash);
    const codeNickname = uniqueNicknameForCodeRef(codeFingerprint, seenNicknames);
    rows.push({
      challenge_code: code,
      normalized_code: normalized,
      code_hash: codeHash,
      code_fingerprint: codeFingerprint,
      code_nickname: codeNickname
    });
  }

  return rows;
}

function uniqueNicknameForCodeRef(codeRef, seenNicknames){
  for (let variant = 0; variant < 5000; variant += 1){
    const nickname = nicknameFromCodeRef(codeRef, variant);
    if (seenNicknames.has(nickname)) continue;
    seenNicknames.add(nickname);
    return nickname;
  }
  throw new Error('Unable to generate a unique nickname. Increase nickname word pools before generating this many codes.');
}

function buildSql({ args, rows }){
  const values = rows.map((row) => `  (${sqlString(args.challenge)}, ${sqlString(row.code_hash)}, ${sqlString(row.code_fingerprint)}, ${sqlString(row.code_nickname)})`).join(',\n');
  const migrationSql = MIGRATIONS.map((migration) => `-- Migration: ${migration.id}\n${migration.sql.trim()}`).join('\n\n');

  return `-- Fun Zone Arena Supabase setup and challenge-code import
-- Generated: ${new Date().toISOString()}
-- Raw challenge codes are intentionally NOT included in this SQL file.

${migrationSql}

BEGIN;

INSERT INTO challenges(id, title, starts_at, ends_at, status)
VALUES (${sqlString(args.challenge)}, ${sqlString(args.title)}, ${sqlString(new Date(args.start).toISOString())}, ${sqlString(new Date(args.end).toISOString())}, 'active')
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  starts_at = EXCLUDED.starts_at,
  ends_at = EXCLUDED.ends_at,
  status = EXCLUDED.status,
  updated_at = now();

-- Replace all existing codes for this challenge so previously generated codes
-- are declined after this import. This also clears old demo attempts/results.
DELETE FROM submissions
WHERE challenge_id = ${sqlString(args.challenge)};

DELETE FROM attempt_sessions
WHERE challenge_id = ${sqlString(args.challenge)};

DELETE FROM challenge_codes
WHERE challenge_id = ${sqlString(args.challenge)};

INSERT INTO challenge_codes(challenge_id, code_hash, code_fingerprint, code_nickname)
VALUES
${values}
ON CONFLICT (challenge_id, code_hash) DO NOTHING;

COMMIT;
`;
}

function buildReadme({ args }){
  return `Fun Zone Arena generated codes\n\nFiles in this folder:\n- codes-private.csv: raw challenge codes and unique two-word fun animal nicknames. Keep this file private. Distribute one code per participant.\n- supabase-setup-and-codes.sql: safe SQL import. It contains only HMAC hashes/fingerprints/nicknames, not raw codes.\n\nChallenge ID: ${args.challenge}\nChallenge title: ${args.title}\nChallenge start UTC: ${new Date(args.start).toISOString()}\nChallenge end UTC: ${new Date(args.end).toISOString()}\n\nImportant:\nUse the same CODE_HASH_SECRET in Vercel that was used to generate this folder. If the secret changes, imported code hashes will no longer match participant-entered codes.\n`;
}

function main(){
  const args = parseArgs(process.argv.slice(2));
  const secret = process.env.CODE_HASH_SECRET;

  if (!secret || /replace-with|change-me|placeholder/i.test(secret) || secret.length < 32){
    throw new Error('Set CODE_HASH_SECRET to a strong random value before generating codes. Run: npm run secret');
  }

  fs.mkdirSync(args.out, { recursive: true });
  const rows = generateCodeRows({ count: args.count, prefix: args.prefix, secret });

  const privateCsv = [
    ['challenge_code', 'normalized_code', 'code_fingerprint', 'nickname'].map(csvCell).join(','),
    ...rows.map((row) => [row.challenge_code, row.normalized_code, row.code_fingerprint, row.code_nickname].map(csvCell).join(','))
  ].join('\n') + '\n';

  fs.writeFileSync(path.join(args.out, 'codes-private.csv'), privateCsv, 'utf8');
  fs.writeFileSync(path.join(args.out, 'supabase-setup-and-codes.sql'), buildSql({ args, rows }), 'utf8');
  fs.writeFileSync(path.join(args.out, 'README-CODES.txt'), buildReadme({ args }), 'utf8');

  console.log(`Generated ${rows.length} codes in ${args.out}`);
  console.log('Private distribution file: codes-private.csv');
  console.log('Supabase import file: supabase-setup-and-codes.sql');
}

main();
