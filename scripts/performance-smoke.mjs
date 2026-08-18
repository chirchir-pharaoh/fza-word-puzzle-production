import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { SERVICE_LINES, COUNTRIES, nicknameFromCodeRef, buildLeaderboardState } = require('../server/domain');

let seed = 123456789;
function random(){
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
}

const now = new Date('2026-06-17T12:00:00Z');
const rows = Array.from({ length: 1000 }, (_, i) => {
  const correct = Math.floor(random() * (SERVICE_LINES.length + 1));
  const wordHits = {};
  for (let j = 0; j < correct; j += 1) wordHits[SERVICE_LINES[j]] = true;
  const codeRef = `CODE${String(i + 1).padStart(8, '0')}`.slice(0, 12);
  return {
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    participant_alias: `Participant #${String(i + 1).padStart(4, '0')}`,
    code_fingerprint: codeRef,
    code_nickname: nicknameFromCodeRef(codeRef, i),
    country: COUNTRIES[i % COUNTRIES.length],
    correct_count: correct,
    word_hits: wordHits,
    time_taken_ms: 60000 + Math.floor(random() * 1800000),
    submitted_at: new Date(now.getTime() - i * 1000).toISOString()
  };
});

const challenge = {
  id: 'fun-zone-arena-2026',
  title: 'Fun Zone Arena Challenge',
  starts_at: '2026-06-01T00:00:00Z',
  ends_at: '2026-12-31T23:59:59Z',
  status: 'active'
};

const start = performance.now();
const state = buildLeaderboardState({
  rows,
  challenge,
  codeStats: { total_codes: 1000, started_codes: 1000, used_codes: 1000 },
  now
});
const elapsedMs = performance.now() - start;

assert.equal(state.leaderboard.length, 1000);
assert.equal(state.stats.totalParticipants, 1000);
assert.equal(state.stats.issuedCodes, 1000);
assert.equal(state.stats.countriesParticipating, COUNTRIES.length);
assert.equal(state.countries.length, COUNTRIES.length);
assert.equal(state.countries.reduce((sum, row) => sum + row.responses, 0), 1000);
assert.ok(elapsedMs < 1500, `Leaderboard shaping took too long: ${elapsedMs.toFixed(1)}ms`);

console.log(`Performance smoke passed: shaped 1,000 leaderboard rows and country report in ${elapsedMs.toFixed(1)}ms.`);
