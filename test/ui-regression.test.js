const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const mainJs = fs.readFileSync('src/main.js', 'utf8');
const css = fs.readFileSync('src/styles.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

test('puzzle overlay is explicitly removed after protected image unlocks', () => {
  assert.match(mainJs, /function hidePuzzleOverlay\(\)/);
  assert.match(mainJs, /puzzleCard\.classList\.remove\('locked'\)/);
  assert.match(mainJs, /puzzleCard\.classList\.add\('unlocked'\)/);
  assert.match(mainJs, /overlay\.style\.display = 'none'/);
  assert.match(mainJs, /hidePuzzleOverlay\(\);/);
  assert.match(mainJs, /img\.decode/);
  assert.match(mainJs, /img\.hidden = false/);
  assert.match(mainJs, /Puzzle image could not be rendered by the browser/);
  assert.match(css, /\.puzzle-card\.unlocked \.locked-overlay/);
  assert.match(css, /\.locked-overlay\[hidden\]/);
  assert.match(css, /display:none !important/);
});

test('step 3 response card has expanded layout copy and spacing hooks', () => {
  assert.match(html, /class="response-title-block"/);
  assert.match(html, /class="response-intro"/);
  assert.match(html, /<div class="num">4<\/div><p>Ranking is based on the correct number of answers/);
  assert.doesNotMatch(html, /<h2>Your Response<\/h2>\s*<div id="activeParticipant"/);
  assert.match(css, /\.response-card\{[\s\S]*min-height:720px/);
  assert.match(css, /\.response-card\{[\s\S]*border:0/);
  assert.match(css, /\.response-card\{[\s\S]*box-shadow:none/);
  assert.match(css, /\.word-checklist-card\{[\s\S]*min-height:410px/);
  assert.match(css, /\.word-checklist-card\{[\s\S]*background:transparent/);
  assert.match(css, /\.selected-grid\{[\s\S]*grid-template-columns:repeat\(auto-fit,minmax\(150px,1fr\)\)/);
  assert.match(css, /\.selected-grid\{[\s\S]*border:0/);
  assert.match(css, /\.entry-row\{[\s\S]*background:var\(--gw-white\)/);
  assert.match(css, /\.entry-row\{[\s\S]*align-items:stretch/);
  assert.match(css, /#responseFields\{[\s\S]*border:0/);
});

test('leaderboard country charts show participant counts and fair country performance ranking', () => {
  assert.match(html, /id="countryScoreWrap"/);
  assert.match(html, /Country Response Ranking/);
  assert.match(mainJs, /function renderCountryScoreReport\(state\)/);
  assert.match(mainJs, /renderCountryScoreReport\(state\)/);
  assert.match(mainJs, /avgScore/);
  assert.match(mainJs, /const POINTS_PER_CORRECT = 3/);
  assert.match(mainJs, /function scorePoints\(value\)/);
  assert.match(mainJs, /\$\{scorePoints\(row\.correct\)\}/);
  assert.match(mainJs, /\$\{scorePoints\(item\.correct\)\}/);
  assert.match(mainJs, /average score, then top score, response count, and fastest average time/);
  assert.match(css, /\.country-score-card\{[\s\S]*grid-column:1 \/ -1/);
  assert.match(css, /\.country-track b\{[\s\S]*text-align:right/);
  assert.match(css, /\.score-track span\{[\s\S]*var\(--gw-black\)/);
});

test('gold podium card is taller than silver and bronze on desktop', () => {
  assert.match(css, /@media \(min-width:981px\)\{[\s\S]*\.podium-card\.rank-1\{[\s\S]*min-height:285px/);
  assert.match(css, /\.podium-card\.rank-2\{[\s\S]*min-height:215px/);
  assert.match(css, /\.podium-card\.rank-3\{[\s\S]*min-height:200px/);
});

test('leaderboard uses participant name as the public label with nickname underneath', () => {
  assert.match(html, /<th>Name<\/th>/);
  assert.match(html, /id="participantName"/);
  assert.match(mainJs, /row\.displayName \|\| row\.participantName \|\| 'Player'/);
  assert.match(mainJs, /row\.nickname \|\| row\.codeLabel \|\| ''/);
  assert.doesNotMatch(mainJs, /<small>\$\{escapeHtml\(row\.participantAlias/);
});

test('leaderboard dashboard is locked until the participant submits a response', () => {
  assert.match(html, /id="page-login"/);
  assert.match(html, /id="loginForm"/);
  assert.match(html, /id="loginBtn"/);
  assert.match(html, /id="authLink"/);
  assert.match(html, /id="challengeNavLink" hidden/);
  assert.match(html, /id="leaderboardNavLink" hidden/);
  assert.match(html, /id="pendingCodeBadge"/);
  assert.doesNotMatch(html, /Login \/ View Results/);
  assert.match(mainJs, /function renderDashboardLocked/);
  assert.match(mainJs, /function handleCodeLogin/);
  assert.match(mainJs, /function updateAuthNav/);
  assert.match(mainJs, /function logout/);
  assert.match(mainJs, /\/api\/code-login/);
  assert.match(mainJs, /PENDING_CODE_KEY/);
  assert.match(mainJs, /route === 'leaderboard' && !hasDashboardAccess\(\)/);
  assert.match(mainJs, /POST'[\s\S]*\/api\/leaderboard/);
  assert.match(mainJs, /attemptSessionId: attemptSession\.id/);
  assert.match(mainJs, /Submit your challenge response before viewing the dashboard/);
});

test('login distinguishes backend database failures from invalid participant codes', () => {
  assert.match(mainJs, /function backendErrorMessage\(error, fallback\)/);
  assert.match(mainJs, /database_host_unreachable/);
  assert.match(mainJs, /The challenge database is not connected/);
  assert.match(mainJs, /error\.status >= 500 \? backendErrorMessage/);
});

test('challenge screen does not offer switching to another staff code', () => {
  assert.match(html, /each participant may complete the competition only once/i);
  assert.doesNotMatch(html, /Use a different code/);
  assert.doesNotMatch(html, /differentCodeBtn/);
  assert.doesNotMatch(mainJs, /differentCodeBtn/);
});

test('typography uses Inter and lighter body text weights', () => {
  assert.match(html, /fonts\.googleapis\.com\/css2\?family=Inter/);
  assert.match(css, /font-family:Inter,system-ui/);
  assert.match(css, /bold is reserved for headings/);
  assert.match(css, /h1,[\s\S]*\.countdown-card h2\{[\s\S]*font-weight:700/);
  assert.match(css, /body,[\s\S]*span\{[\s\S]*font-weight:400/);
});

test('visible branding is anonymized for Fun Zone Arena', () => {
  assert.match(html, /Fun Zone Arena/);
  assert.doesNotMatch(html, /GardaWorld|GARDAWORLD|GW-/);
});


test('production deployment discourages search indexing and supports manual dashboard refresh', () => {
  const vercel = fs.readFileSync('vercel.json', 'utf8');
  const robots = fs.readFileSync('public/robots.txt', 'utf8');
  assert.match(html, /<meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex"/);
  assert.match(robots, /User-agent: \*/);
  assert.match(robots, /Disallow: \/\s*$/);
  assert.match(vercel, /X-Robots-Tag/);
  assert.match(vercel, /noindex, nofollow, noarchive, nosnippet, noimageindex/);
  assert.match(vercel, /https:\/\/fonts\.googleapis\.com/);
  assert.match(vercel, /https:\/\/fonts\.gstatic\.com/);
  assert.match(html, /id="refreshLeaderboardBtn"/);
  assert.match(mainJs, /function handleManualLeaderboardRefresh/);
  assert.match(mainJs, /addEventListener\('click', handleManualLeaderboardRefresh\)/);
  assert.match(mainJs, /refreshes every 45 seconds/);
  assert.match(mainJs, /setInterval\([\s\S]*45000\)/);
  assert.match(css, /\.leaderboard-refresh-row/);
  assert.match(css, /\.btn-compact/);
});
