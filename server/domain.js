const crypto = require('node:crypto');

// -----------------------------------------------------------------------------
// Challenge answer key
// -----------------------------------------------------------------------------
// The frontend never imports this answer list. Keeping it server-side prevents
// participants from finding the correct service lines in browser source files.
const SERVICE_LINES = [
  'RISK', 'SECURITY', 'FACILITIES', 'MEDICAL', 'INFORMATION', 'K9', 'EVENTS', 'JOURNEY', 'TECHNOLOGY',
  'EMERGENCY', 'RESPONSE', 'CONSULTING', 'GEOSHIELD', 'INVESTIGATION', 'TRACKING', 'FLEET', 'PATROL', 'ALARMS'
];

// Country list for participation reporting. Country is
// collected only for participation reporting; names and employee numbers are not
// collected anywhere in this version.
const COUNTRIES = [
  'Kenya', 'Uganda', 'Tanzania', 'Burundi', 'Rwanda', 'Angola', 'DRC', 'Mozambique', 'Nigeria', 'Malawi', 'Zambia', 'South Africa', 'UAE', 'UK', 'Canada', 'Others'
];

const COUNTRY_SET = new Set(COUNTRIES);
const SERVICE_LINE_LOOKUP = new Map(SERVICE_LINES.map((word) => [normalizeServiceLine(word), word]));

// -----------------------------------------------------------------------------
// Normalization and validation helpers
// -----------------------------------------------------------------------------
function normalizeServiceLine(value){
  return String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function sanitizeAnswers(answers){
  if (!Array.isArray(answers)) return [];
  const seen = new Set();
  const out = [];

  for (const item of answers){
    const normalized = normalizeServiceLine(item).slice(0, 80);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= 100) break;
  }

  return out;
}

function buildWordHits(words){
  const hits = {};
  for (const word of sanitizeAnswers(words)){
    const canonical = SERVICE_LINE_LOOKUP.get(normalizeServiceLine(word));
    if (canonical) hits[canonical] = true;
  }
  return hits;
}

function calculateCorrectCount(words){
  return Object.keys(buildWordHits(words)).length;
}

function toMinutes(ms){
  return Number(Math.max(Number(ms || 0) / 60000, 0.1).toFixed(1));
}

// Challenge codes are random tokens generated outside the application. We remove
// spaces and hyphens so staff can type codes with or without visual separators.
function normalizeChallengeCode(value){
  return String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '');
}

function isValidChallengeCode(value){
  const normalized = normalizeChallengeCode(value);
  return /^[A-Z0-9]{8,48}$/.test(normalized);
}

function normalizeCountry(value){
  return String(value || '').trim();
}

function normalizeParticipantName(value){
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80);
}

function isValidCountry(value){
  return COUNTRY_SET.has(normalizeCountry(value));
}

function isValidParticipantName(value){
  const normalized = normalizeParticipantName(value);
  return normalized.length >= 2 && normalized.length <= 80;
}

function hashValue(value, salt){
  if (!value) return null;
  return crypto.createHash('sha256').update(`${salt || 'change-me'}:${value}`).digest('hex');
}

function createHmac(value, secret){
  return crypto.createHmac('sha256', String(secret || '')).update(String(value || '')).digest('hex');
}

function hashChallengeCode(code, secret){
  const normalized = normalizeChallengeCode(code);
  if (!isValidChallengeCode(normalized)) return null;
  return createHmac(normalized, secret);
}

// A short public reference generated from the HMAC hash. This lets the dashboard
// identify a participant by challenge-code reference without storing or exposing
// the raw challenge code.
function codeFingerprintFromHash(codeHash){
  return String(codeHash || '').slice(0, 12).toUpperCase();
}

const NICKNAME_ADJECTIVES = [
  'Bouncy', 'Bubbly', 'Cheery', 'Chirpy', 'Cosmic', 'Dancy', 'Dapper', 'Disco', 'Dreamy', 'Fancy',
  'Fizzy', 'Fluffy', 'Funny', 'Giggle', 'Glitter', 'Goofy', 'Groovy', 'Happy', 'Jazzy', 'Jolly',
  'Jumbo', 'Lively', 'Loopy', 'Merry', 'Mighty', 'Nifty', 'Peppy', 'Perky', 'Pinky', 'Plucky',
  'Poppy', 'Quirky', 'Rainbow', 'Shiny', 'Silly', 'Snappy', 'Snazzy', 'Sparkly', 'Sunny', 'Toasty',
  'Turbo', 'Twinkly', 'Velvety', 'Wacky', 'Wiggly', 'Witty', 'Wobbly', 'Zany', 'Zesty', 'Zippy'
];

const NICKNAME_ANIMALS = [
  'Aardvark', 'Alpaca', 'Badger', 'Beaver', 'Buffalo', 'Capybara', 'Cheetah', 'Chinchilla', 'Dolphin', 'Falcon',
  'Ferret', 'Flamingo', 'Fox', 'Gecko', 'Giraffe', 'Hamster', 'Hedgehog', 'Hippo', 'Koala', 'Lemur',
  'Llama', 'Manatee', 'Meerkat', 'Narwhal', 'Otter', 'Panda', 'Pangolin', 'Penguin', 'Porcupine', 'Quokka',
  'Rhino', 'Seal', 'Sloth', 'Tapir', 'Tiger', 'Turtle', 'Walrus', 'Wombat', 'Yak', 'Zebra'
];

function hashTextToUInt(text){
  let hash = 0;
  for (const char of String(text || '')){
    hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function nicknameFromCodeRef(codeRef, variant = 0){
  const text = String(codeRef || '').toUpperCase();
  const hash = hashTextToUInt(`${text}:${variant}`);
  const adjective = NICKNAME_ADJECTIVES[hash % NICKNAME_ADJECTIVES.length];
  const animal = NICKNAME_ANIMALS[Math.floor(hash / NICKNAME_ADJECTIVES.length) % NICKNAME_ANIMALS.length];
  return `${adjective} ${animal}`;
}

function createAttemptToken(){
  return crypto.randomBytes(32).toString('base64url');
}

function hashAttemptToken(token, salt){
  return hashValue(token, salt || 'attempt-token-salt');
}

function timingSafeEqualText(a, b){
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

// -----------------------------------------------------------------------------
// Request validation
// -----------------------------------------------------------------------------
function validateSessionPayload(payload){
  const errors = [];
  const challengeId = String(payload && payload.challengeId || '').trim();
  const challengeCode = normalizeChallengeCode(payload && payload.challengeCode);
  const country = normalizeCountry(payload && payload.country);
  const participantName = normalizeParticipantName(payload && payload.participantName);

  if (!challengeId || challengeId.length > 80) errors.push('Challenge ID is missing or invalid.');
  if (!isValidParticipantName(participantName)) errors.push('Enter your name before joining the challenge.');
  if (!isValidCountry(country)) errors.push('Select a supported participation country.');
  if (!isValidChallengeCode(challengeCode)) errors.push('Challenge code must be 8 to 48 letters or numbers.');

  return {
    ok: errors.length === 0,
    errors,
    value: { challengeId, challengeCode, country, participantName }
  };
}

function validateCodeLoginPayload(payload){
  const errors = [];
  const challengeId = String(payload && payload.challengeId || '').trim();
  const challengeCode = normalizeChallengeCode(payload && payload.challengeCode);

  if (!challengeId || challengeId.length > 80) errors.push('Challenge ID is missing or invalid.');
  if (!isValidChallengeCode(challengeCode)) errors.push('Challenge code must be 8 to 48 letters or numbers.');

  return {
    ok: errors.length === 0,
    errors,
    value: { challengeId, challengeCode }
  };
}

function validateAttemptPayload(payload){
  const errors = [];
  const challengeId = String(payload && payload.challengeId || '').trim();
  const attemptSessionId = String(payload && payload.attemptSessionId || '').trim();
  const attemptToken = String(payload && payload.attemptToken || '').trim();

  if (!challengeId || challengeId.length > 80) errors.push('Challenge ID is missing or invalid.');
  if (!attemptSessionId || attemptSessionId.length > 80) errors.push('Attempt session is missing or invalid.');
  if (!attemptToken || attemptToken.length > 160) errors.push('Attempt token is missing or invalid.');

  return {
    ok: errors.length === 0,
    errors,
    value: { challengeId, attemptSessionId, attemptToken }
  };
}

function validateSubmissionPayload(payload){
  const parsedAttempt = validateAttemptPayload(payload);
  const answers = sanitizeAnswers(payload && payload.answers);
  const errors = parsedAttempt.errors.slice();

  if (!answers.length) errors.push('At least one answer is required.');

  return {
    ok: errors.length === 0,
    errors,
    value: { ...parsedAttempt.value, answers }
  };
}

// -----------------------------------------------------------------------------
// Public leaderboard shaping
// -----------------------------------------------------------------------------
function rankSubmissions(arr){
  return arr.slice().sort((a, b) => {
    const aCorrect = Number(a.correct || a.correct_count || 0);
    const bCorrect = Number(b.correct || b.correct_count || 0);
    if (bCorrect !== aCorrect) return bCorrect - aCorrect;

    const aTime = Number.isFinite(Number(a.timeTakenMs || a.time_taken_ms)) ? Number(a.timeTakenMs || a.time_taken_ms) : Infinity;
    const bTime = Number.isFinite(Number(b.timeTakenMs || b.time_taken_ms)) ? Number(b.timeTakenMs || b.time_taken_ms) : Infinity;
    if (aTime !== bTime) return aTime - bTime;

    return new Date(a.submittedAt || a.submitted_at).getTime() - new Date(b.submittedAt || b.submitted_at).getTime();
  }).map((item, i) => ({ ...item, rank: i + 1 }));
}

function submissionRowToPublic(row, includeWordHits = false){
  const timeTakenMs = Number(row.time_taken_ms || row.timeTakenMs || 0);
  const codeRef = row.code_fingerprint || codeFingerprintFromHash(row.code_hash);
  const nickname = row.code_nickname || row.codeNickname || nicknameFromCodeRef(codeRef) || row.participant_alias || 'Player';
  const participantName = row.participant_name || row.participantName || row.participant_alias || 'Player';
  const publicRow = {
    id: row.id,
    participantName,
    participantAlias: participantName,
    displayName: participantName,
    nickname,
    codeRef,
    codeLabel: nickname,
    country: row.country || 'Unspecified',
    correct: Number(row.correct_count || row.correct || 0),
    timeTakenMinutes: toMinutes(timeTakenMs),
    submittedAt: new Date(row.submitted_at || row.submittedAt).toISOString()
  };
  if (includeWordHits) publicRow.wordHits = row.word_hits || row.wordHits || {};
  return publicRow;
}

function buildScoreDistribution(leaderboard, maxScore){
  const buckets = new Map();
  for (const row of leaderboard){
    const key = String(row.correct);
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }

  return Array.from({ length: maxScore + 1 }, (_, score) => ({
    score,
    participants: buckets.get(String(score)) || 0
  })).reverse();
}

function buildCountrySummary(leaderboard, countries = COUNTRIES){
  const baseCountries = Array.isArray(countries) ? countries : COUNTRIES;
  const observedExtras = Array.from(new Set(leaderboard.map((row) => row.country).filter(Boolean)))
    .filter((country) => !baseCountries.includes(country));
  const allCountries = [...baseCountries, ...observedExtras];

  const rows = allCountries.map((country) => {
    const countryRows = leaderboard.filter((row) => row.country === country);
    const totalScore = countryRows.reduce((sum, row) => sum + Number(row.correct || 0), 0);
    const totalTime = countryRows.reduce((sum, row) => sum + Number(row.timeTakenMinutes || 0), 0);
    return {
      country,
      responses: countryRows.length,
      correctTotal: totalScore,
      avgScore: countryRows.length ? Number((totalScore / countryRows.length).toFixed(1)) : 0,
      topScore: countryRows.length ? Math.max(...countryRows.map((row) => Number(row.correct || 0))) : 0,
      avgTimeMinutes: countryRows.length ? Number((totalTime / countryRows.length).toFixed(1)) : null,
      performanceRank: null,
      participationRank: null,
      sampleSizeNote: countryRows.length && countryRows.length < 5 ? 'Early sample' : ''
    };
  });

  rows
    .filter((row) => row.responses > 0)
    .sort((a, b) => {
      if (Number(b.avgScore || 0) !== Number(a.avgScore || 0)) return Number(b.avgScore || 0) - Number(a.avgScore || 0);
      if (Number(b.topScore || 0) !== Number(a.topScore || 0)) return Number(b.topScore || 0) - Number(a.topScore || 0);
      if (Number(b.responses || 0) !== Number(a.responses || 0)) return Number(b.responses || 0) - Number(a.responses || 0);
      const aTime = a.avgTimeMinutes == null ? Infinity : Number(a.avgTimeMinutes);
      const bTime = b.avgTimeMinutes == null ? Infinity : Number(b.avgTimeMinutes);
      if (aTime !== bTime) return aTime - bTime;
      return a.country.localeCompare(b.country);
    })
    .forEach((row, index) => { row.performanceRank = index + 1; });

  rows
    .filter((row) => row.responses > 0)
    .sort((a, b) => {
      if (Number(b.responses || 0) !== Number(a.responses || 0)) return Number(b.responses || 0) - Number(a.responses || 0);
      if (Number(b.avgScore || 0) !== Number(a.avgScore || 0)) return Number(b.avgScore || 0) - Number(a.avgScore || 0);
      return a.country.localeCompare(b.country);
    })
    .forEach((row, index) => { row.participationRank = index + 1; });

  return rows;
}

function buildLeaderboardState({ rows = [], challenge, codeStats = {}, now = new Date(), countries = COUNTRIES }){
  const challengeStart = new Date(challenge.starts_at || challenge.start || challenge.startsAt);
  const challengeEnd = new Date(challenge.ends_at || challenge.end || challenge.endsAt);
  const started = now.getTime() >= challengeStart.getTime();
  const ended = now.getTime() >= challengeEnd.getTime();
  const ranked = rankSubmissions(rows);
  const leaderboard = ranked.map((row) => ({
    ...submissionRowToPublic(row, ended),
    rank: row.rank
  }));
  const topThree = ranked.slice(0, 3).map((row) => ({
    ...submissionRowToPublic(row, false),
    rank: row.rank
  }));

  const totalCorrect = leaderboard.reduce((s, r) => s + r.correct, 0);
  const avgAccuracy = leaderboard.length ? (totalCorrect / (leaderboard.length * SERVICE_LINES.length)) * 100 : 0;
  const avgTime = leaderboard.length ? leaderboard.reduce((s, r) => s + Number(r.timeTakenMinutes || 0), 0) / leaderboard.length : 0;
  const wordStats = ended ? SERVICE_LINES.map((word) => {
    const hits = ranked.filter((r) => {
      const wordHits = r.word_hits || r.wordHits || {};
      return Boolean(wordHits && wordHits[word]);
    }).length;
    const pct = ranked.length ? (hits / ranked.length) * 100 : 0;
    return { word, hits, pct: Number(pct.toFixed(0)) };
  }).sort((a, b) => b.hits - a.hits || a.word.localeCompare(b.word)) : [];

  const issuedCodes = Number(codeStats.total_codes || codeStats.totalCodes || 0);
  const startedCodes = Number(codeStats.started_codes || codeStats.startedCodes || 0);
  const usedCodes = Number(codeStats.used_codes || codeStats.usedCodes || leaderboard.length || 0);
  const countriesSummary = buildCountrySummary(leaderboard, countries);

  return {
    challengeId: challenge.id,
    countriesList: countries,
    // Reveal the target count only after the challenge ends so the live dashboard
    // does not emphasize how many words participants are expected to find.
    serviceLineCount: ended ? SERVICE_LINES.length : null,
    stats: {
      totalParticipants: leaderboard.length,
      countriesParticipating: new Set(leaderboard.map((r) => r.country).filter(Boolean)).size,
      issuedCodes,
      startedCodes,
      usedCodes,
      completionRate: issuedCodes ? Number(((usedCodes / issuedCodes) * 100).toFixed(1)) : null,
      perfectScores: leaderboard.filter((r) => r.correct === SERVICE_LINES.length).length,
      avgTimeMinutes: leaderboard.length ? Number(avgTime.toFixed(1)) : null,
      avgAccuracy: Number(avgAccuracy.toFixed(1))
    },
    challengeWindow: {
      start: challengeStart.toISOString(),
      end: challengeEnd.toISOString(),
      started,
      ended,
      status: challenge.status
    },
    topThree,
    leaderboard,
    countries: countriesSummary,
    // Keep the API shape, but expose detailed score buckets only after closing.
    scoreDistribution: ended ? buildScoreDistribution(leaderboard, SERVICE_LINES.length) : [],
    wordStats,
    answersHidden: !ended
  };
}

module.exports = {
  SERVICE_LINES,
  COUNTRIES,
  normalizeServiceLine,
  sanitizeAnswers,
  buildWordHits,
  calculateCorrectCount,
  toMinutes,
  normalizeChallengeCode,
  isValidChallengeCode,
  normalizeCountry,
  normalizeParticipantName,
  isValidCountry,
  isValidParticipantName,
  hashValue,
  hashChallengeCode,
  codeFingerprintFromHash,
  nicknameFromCodeRef,
  createAttemptToken,
  hashAttemptToken,
  timingSafeEqualText,
  validateSessionPayload,
  validateCodeLoginPayload,
  validateAttemptPayload,
  validateSubmissionPayload,
  rankSubmissions,
  submissionRowToPublic,
  buildScoreDistribution,
  buildCountrySummary,
  buildLeaderboardState
};
