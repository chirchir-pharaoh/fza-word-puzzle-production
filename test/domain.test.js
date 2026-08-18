const assert = require('node:assert/strict');
const test = require('node:test');
const {
  SERVICE_LINES,
  COUNTRIES,
  normalizeChallengeCode,
  normalizeParticipantName,
  isValidChallengeCode,
  hashChallengeCode,
  codeFingerprintFromHash,
  sanitizeAnswers,
  calculateCorrectCount,
  buildWordHits,
  isValidCountry,
  validateSessionPayload,
  validateCodeLoginPayload,
  validateAttemptPayload,
  validateSubmissionPayload,
  nicknameFromCodeRef,
  buildLeaderboardState
} = require('../server/domain');

test('challenge codes normalize spaces and hyphens', () => {
  assert.equal(normalizeChallengeCode(' fza-9k2m 7q4x '), 'FZA9K2M7Q4X');
  assert.equal(isValidChallengeCode('FZA-9K2M-7Q4X'), true);
  assert.equal(isValidChallengeCode('short'), false);
});

test('challenge code hash is deterministic and secret dependent', () => {
  const a = hashChallengeCode('FZA-9K2M-7Q4X', 'secret-one-secret-one-secret-one-secret-one');
  const b = hashChallengeCode('fza9k2m7q4x', 'secret-one-secret-one-secret-one-secret-one');
  const c = hashChallengeCode('FZA-9K2M-7Q4X', 'secret-two-secret-two-secret-two-secret-two');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(a.length, 64);
  assert.equal(codeFingerprintFromHash(a).length, 12);
});

test('answers are sanitized, deduplicated, and scored server side', () => {
  const answers = sanitizeAnswers([' risk ', 'RISK', 'Security', 'not-a-service-line', 'K9']);
  assert.deepEqual(answers, ['RISK', 'SECURITY', 'NOT-A-SERVICE-LINE', 'K9']);
  assert.equal(calculateCorrectCount(answers), 3);
  assert.deepEqual(buildWordHits(answers), { RISK: true, SECURITY: true, K9: true });
});

test('country list includes the expanded production participation list', () => {
  assert.deepEqual(COUNTRIES, ['Kenya', 'Uganda', 'Tanzania', 'Burundi', 'Rwanda', 'Angola', 'DRC', 'Mozambique', 'Nigeria', 'Malawi', 'Zambia', 'South Africa', 'UAE', 'UK', 'Canada', 'Others']);
  assert.equal(isValidCountry('Kenya'), true);
  assert.equal(isValidCountry('South Africa'), true);
  assert.equal(isValidCountry('UAE'), true);
  assert.equal(isValidCountry('Atlantis'), false);
});

test('session payload requires challenge id, supported country, and challenge code', () => {
  assert.equal(normalizeParticipantName('  Amina   Demo  '), 'Amina Demo');
  const parsed = validateSessionPayload({ challengeId: 'fun-zone-arena-2026', participantName: 'Amina Demo', country: 'Kenya', challengeCode: 'FZA-9K2M-7Q4X' });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.participantName, 'Amina Demo');
  assert.equal(parsed.value.challengeCode, 'FZA9K2M7Q4X');
  assert.equal(parsed.value.country, 'Kenya');

  const missingName = validateSessionPayload({ challengeId: 'fun-zone-arena-2026', country: 'Kenya', challengeCode: 'FZA-9K2M-7Q4X' });
  assert.equal(missingName.ok, false);
});

test('code login payload requires only challenge id and challenge code', () => {
  const parsed = validateCodeLoginPayload({ challengeId: 'fun-zone-arena-2026', challengeCode: 'FZA-9K2M-7Q4X' });
  assert.equal(parsed.ok, true);
  assert.deepEqual(Object.keys(parsed.value).sort(), ['challengeCode', 'challengeId'].sort());

  const invalid = validateCodeLoginPayload({ challengeId: 'fun-zone-arena-2026', challengeCode: 'short' });
  assert.equal(invalid.ok, false);
});

test('attempt payload contains session fields only', () => {
  const parsed = validateAttemptPayload({
    challengeId: 'fun-zone-arena-2026',
    attemptSessionId: 'session-1',
    attemptToken: 'token-1'
  });
  assert.equal(parsed.ok, true);
  assert.deepEqual(Object.keys(parsed.value).sort(), ['attemptSessionId', 'attemptToken', 'challengeId'].sort());
});

test('submission payload contains no employee identity fields', () => {
  const parsed = validateSubmissionPayload({
    challengeId: 'fun-zone-arena-2026',
    attemptSessionId: 'session-1',
    attemptToken: 'token-1',
    answers: ['risk']
  });
  assert.equal(parsed.ok, true);
  assert.deepEqual(Object.keys(parsed.value).sort(), ['answers', 'attemptSessionId', 'attemptToken', 'challengeId'].sort());
});


test('country performance ranking favors best average response quality before volume', () => {
  const now = new Date('2026-06-25T10:00:00Z');
  const challenge = {
    id: 'fun-zone-arena-2026',
    starts_at: '2026-06-24T06:00:00Z',
    ends_at: '2026-07-01T06:00:00Z',
    status: 'active'
  };
  const rows = [
    { id: 'k1', participant_name: 'K1', code_fingerprint: 'K1', country: 'Kenya', correct_count: 8, time_taken_ms: 120000, submitted_at: '2026-06-25T09:00:00Z' },
    { id: 'k2', participant_name: 'K2', code_fingerprint: 'K2', country: 'Kenya', correct_count: 8, time_taken_ms: 180000, submitted_at: '2026-06-25T09:01:00Z' },
    { id: 'k3', participant_name: 'K3', code_fingerprint: 'K3', country: 'Kenya', correct_count: 8, time_taken_ms: 190000, submitted_at: '2026-06-25T09:02:00Z' },
    { id: 'u1', participant_name: 'U1', code_fingerprint: 'U1', country: 'Uganda', correct_count: 12, time_taken_ms: 240000, submitted_at: '2026-06-25T09:03:00Z' }
  ];
  const state = buildLeaderboardState({ rows, challenge, codeStats: { total_codes: 1000, started_codes: 4, used_codes: 4 }, now });
  const kenya = state.countries.find((row) => row.country === 'Kenya');
  const uganda = state.countries.find((row) => row.country === 'Uganda');
  assert.equal(kenya.correctTotal, 24);
  assert.equal(uganda.correctTotal, 12);
  assert.equal(uganda.avgScore, 12);
  assert.equal(kenya.avgScore, 8);
  assert.equal(uganda.performanceRank, 1);
  assert.equal(kenya.performanceRank, 2);
  assert.equal(kenya.participationRank, 1);
});

test('generated public nicknames are funny animal phrases without trailing numbers', () => {
  const nickname = nicknameFromCodeRef('ABCDEF123456');
  assert.equal(nickname.split(' ').length, 2);
  assert.doesNotMatch(nickname, /\d+$/);
  assert.match(nickname, /\b(Aardvark|Alpaca|Badger|Beaver|Buffalo|Capybara|Cheetah|Chinchilla|Dolphin|Falcon|Ferret|Flamingo|Fox|Gecko|Giraffe|Hamster|Hedgehog|Hippo|Koala|Lemur|Llama|Manatee|Meerkat|Narwhal|Otter|Panda|Pangolin|Penguin|Porcupine|Quokka|Rhino|Seal|Sloth|Tapir|Tiger|Turtle|Walrus|Wombat|Yak|Zebra)\b/);
});

test('nickname variants provide enough unique labels for a 1,000-person challenge', () => {
  const nicknames = new Set();
  for (let i = 0; i < 1000; i += 1){
    for (let variant = 0; variant < 5000; variant += 1){
      const nickname = nicknameFromCodeRef(`CODE${String(i).padStart(8, 'A')}`, variant);
      if (nicknames.has(nickname)) continue;
      nicknames.add(nickname);
      break;
    }
  }
  assert.equal(nicknames.size, 1000);
});

test('leaderboard uses challenge-code references, country reporting, and hides word stats until end', () => {
  const now = new Date('2026-06-25T10:00:00Z');
  const challenge = {
    id: 'fun-zone-arena-2026',
    starts_at: '2026-06-24T06:00:00Z',
    ends_at: '2026-07-01T06:00:00Z',
    status: 'active'
  };
  const rows = [
    {
      id: 'sub-1',
      participant_name: 'Amina Demo',
      participant_alias: 'Amina Demo',
      code_fingerprint: 'ABCDEF123456',
      code_nickname: 'Pinky Zebra',
      country: 'Kenya',
      correct_count: SERVICE_LINES.length,
      time_taken_ms: 90000,
      submitted_at: '2026-06-25T09:00:00Z',
      word_hits: { RISK: true }
    },
    {
      id: 'sub-2',
      participant_name: 'Brian Demo',
      participant_alias: 'Brian Demo',
      code_fingerprint: 'XYZ987654321',
      code_nickname: 'Turbo Otter',
      country: 'Kenya',
      correct_count: 3,
      time_taken_ms: 120000,
      submitted_at: '2026-06-25T09:30:00Z',
      word_hits: { RISK: true }
    }
  ];
  const state = buildLeaderboardState({ rows, challenge, codeStats: { total_codes: 1000, started_codes: 2, used_codes: 2 }, now });
  assert.equal(state.stats.totalParticipants, 2);
  assert.equal(state.stats.issuedCodes, 1000);
  assert.equal(state.stats.countriesParticipating, 1);
  assert.equal(state.leaderboard[0].displayName, 'Amina Demo');
  assert.equal(state.leaderboard[0].participantAlias, 'Amina Demo');
  assert.equal(state.leaderboard[0].participantName, 'Amina Demo');
  assert.equal(state.leaderboard[0].nickname, 'Pinky Zebra');
  assert.equal(state.leaderboard[0].codeLabel, 'Pinky Zebra');
  assert.equal(state.leaderboard[0].codeRef, 'ABCDEF123456');
  assert.equal(state.leaderboard[0].country, 'Kenya');
  assert.equal(state.countries.find((row) => row.country === 'Kenya').responses, 2);
  assert.equal(state.countries.find((row) => row.country === 'Kenya').correctTotal, SERVICE_LINES.length + 3);
  assert.equal(state.countries.find((row) => row.country === 'Kenya').performanceRank, 1);
  assert.equal(state.countries.find((row) => row.country === 'Kenya').participationRank, 1);
  assert.equal(state.answersHidden, true);
  assert.deepEqual(state.wordStats, []);
});
