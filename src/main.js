// -----------------------------------------------------------------------------
// Runtime state
// -----------------------------------------------------------------------------
// config.json allows branding/API changes after deployment without rebuilding.
const SESSION_KEY = 'fun_zone_arena_attempt_session_v1';
const PENDING_CODE_KEY = 'fun_zone_arena_pending_code_v1';
const POINTS_PER_CORRECT = 3;
const SELECTED = new Set();
const FALLBACK_COUNTRIES = [
  'Kenya', 'Uganda', 'Tanzania', 'Burundi', 'Rwanda', 'Angola', 'DRC', 'Mozambique', 'Nigeria', 'Malawi', 'Zambia', 'South Africa', 'UAE', 'UK', 'Canada', 'Others'
];

let runtimeConfig = {
  apiBaseUrl: '',
  logoUrl: '',
  brandName: 'FUN ZONE ARENA',
  brandSubtitle: 'Fun Zone Arena'
};

let apiOnline = false;
let activeCountry = 'ALL';
let backendConfig = {
  challengeId: 'fun-zone-arena-2026',
  countries: FALLBACK_COUNTRIES,
  serviceLineCount: null,
  challengeWindow: {
    start: new Date().toISOString(),
    end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    started: true,
    ended: false,
    status: 'active'
  }
};

let attemptSession = null;
let pendingChallengeCode = '';
let leaderboardPoll = null;
let countdownInterval = null;
let elapsedInterval = null;
let puzzleObjectUrl = null;

const $ = (id) => document.getElementById(id);

// -----------------------------------------------------------------------------
// Small utility helpers
// -----------------------------------------------------------------------------
function escapeHtml(value){
  return String(value || '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function normalizeServiceLine(value){
  return String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function normalizeChallengeCode(value){
  return String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '');
}

function isValidChallengeCode(value){
  return /^[A-Z0-9]{8,48}$/.test(normalizeChallengeCode(value));
}

function normalizeParticipantName(value){
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80);
}

function scorePoints(value){
  return Number(value || 0) * POINTS_PER_CORRECT;
}

function formatScorePoints(value){
  const points = scorePoints(value);
  return `${points} point${points === 1 ? '' : 's'}`;
}

function countryList(){
  const countries = Array.isArray(backendConfig.countries) && backendConfig.countries.length
    ? backendConfig.countries
    : FALLBACK_COUNTRIES;
  return countries;
}

function apiBase(){
  return String(runtimeConfig.apiBaseUrl || '').replace(/\/$/, '');
}

function apiUrl(path){
  const base = apiBase();
  return base ? `${base}${path}` : path;
}

async function fetchJson(url, options = {}){
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    cache: options.cache || 'no-store'
  });

  let body = null;
  try { body = await response.json(); } catch (_) { body = null; }

  if (!response.ok){
    const message = body && body.message ? body.message : `Request failed with HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function backendErrorMessage(error, fallback){
  const code = error && error.body && error.body.code;
  const requestId = error && error.body && error.body.requestId;
  const databaseCodes = new Set([
    'database_url_missing',
    'database_url_invalid',
    'supabase_direct_database_url',
    'database_host_unreachable',
    'database_authentication_failed'
  ]);
  const message = databaseCodes.has(code)
    ? 'The challenge database is not connected. Please contact the challenge administrator.'
    : fallback;
  return requestId ? `${message} Reference: ${requestId}` : message;
}

// -----------------------------------------------------------------------------
// Configuration and branding
// -----------------------------------------------------------------------------
async function loadRuntimeConfig(){
  try {
    const response = await fetch('/config.json', { cache: 'no-store' });
    if (response.ok) runtimeConfig = { ...runtimeConfig, ...(await response.json()) };
  } catch (error) {
    console.warn('Runtime config not found; using defaults.', error);
  }
}

async function loadBackendConfig(){
  try {
    const config = await fetchJson(apiUrl('/api/config'));
    backendConfig = {
      ...backendConfig,
      ...config,
      countries: Array.isArray(config.countries) && config.countries.length ? config.countries : backendConfig.countries
    };
    apiOnline = true;
    populateCountries(backendConfig.countries);
    showBanner('', 'info');
    return config;
  } catch (error) {
    apiOnline = false;
    populateCountries(backendConfig.countries);
    showBanner(backendErrorMessage(error, 'Backend API is not reachable. Submissions are disabled until the API is available.'), 'error');
    console.error('Unable to load backend configuration.', error);
    return backendConfig;
  }
}

function applyBranding(){
  document.querySelectorAll('.nav-brand span:last-child').forEach((el) => {
    el.textContent = runtimeConfig.brandSubtitle || 'Fun Zone Arena';
  });
}

function populateCountries(countries){
  const select = $('country');
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">Select your country</option>' + (countries || FALLBACK_COUNTRIES)
    .map((country) => `<option value="${escapeHtml(country)}">${escapeHtml(country)}</option>`)
    .join('');
  if (current && (countries || FALLBACK_COUNTRIES).includes(current)) select.value = current;
}

// -----------------------------------------------------------------------------
// Challenge window and timers
// -----------------------------------------------------------------------------
function challengeStarted(){
  return Date.now() >= new Date(backendConfig.challengeWindow.start).getTime();
}

function challengeEnded(){
  return Date.now() >= new Date(backendConfig.challengeWindow.end).getTime();
}

function challengeAccepting(){
  return apiOnline && backendConfig.challengeWindow.status === 'active' && challengeStarted() && !challengeEnded();
}

function setCountdown(prefix, d, h, m, s){
  const map = prefix === 'Form'
    ? ['cdDaysForm', 'cdHoursForm', 'cdMinsForm', 'cdSecsForm']
    : ['cdDaysLb', 'cdHoursLb', 'cdMinsLb', 'cdSecsLb'];
  [d, h, m, s].forEach((value, index) => {
    const el = $(map[index]);
    if (el) el.textContent = String(value).padStart(2, '0');
  });
}

function countdownParts(ms){
  const diff = Math.max(0, ms);
  return {
    d: Math.floor(diff / 86400000),
    h: Math.floor((diff % 86400000) / 3600000),
    m: Math.floor((diff % 3600000) / 60000),
    s: Math.floor((diff % 60000) / 1000)
  };
}

function tickCountdown(){
  const start = new Date(backendConfig.challengeWindow.start).getTime();
  const end = new Date(backendConfig.challengeWindow.end).getTime();
  const now = Date.now();

  if (now < start){
    const { d, h, m, s } = countdownParts(start - now);
    setCountdown('Form', d, h, m, s);
    setCountdown('Lb', d, h, m, s);
    if ($('countdownTextForm')) $('countdownTextForm').textContent = 'Challenge starts soon. Codes will work once the window opens.';
    if ($('countdownTextLb')) $('countdownTextLb').textContent = 'Starts in';
    setChallengeControls();
    return;
  }

  if (now >= end){
    setCountdown('Form', 0, 0, 0, 0);
    setCountdown('Lb', 0, 0, 0, 0);
    if ($('countdownTextForm')) $('countdownTextForm').textContent = 'Challenge ended. Rankings are final and word-level insights are unlocked.';
    if ($('countdownTextLb')) $('countdownTextLb').textContent = 'Challenge ended · insights unlocked';
    setChallengeControls();
    return;
  }

  const { d, h, m, s } = countdownParts(end - now);
  setCountdown('Form', d, h, m, s);
  setCountdown('Lb', d, h, m, s);
  if ($('countdownTextForm')) $('countdownTextForm').textContent = 'Challenge is live. Enter your country and code to reveal the puzzle.';
  if ($('countdownTextLb')) $('countdownTextLb').textContent = 'Live countdown · refreshes every 45 seconds';
  setChallengeControls();
}

function formatElapsed(ms){
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function tickElapsed(){
  const el = $('elapsedTimer');
  if (!el) return;
  const startedAt = attemptSession && attemptSession.startedAt ? new Date(attemptSession.startedAt).getTime() : Date.now();
  el.textContent = attemptSession ? formatElapsed(Date.now() - startedAt) : '00:00:00';
}

// -----------------------------------------------------------------------------
// UI state management
// -----------------------------------------------------------------------------
function setChallengeControls(){
  const startBtn = $('startBtn');
  if (startBtn) startBtn.disabled = !pendingChallengeCode || !challengeAccepting();

  const loginBtn = $('loginBtn');
  if (loginBtn) loginBtn.disabled = !apiOnline;

  const submitBtn = $('submitBtn');
  if (submitBtn) submitBtn.disabled = !attemptSession || attemptSession.submitted || !challengeAccepting();

  const responseFields = $('responseFields');
  if (responseFields) responseFields.disabled = !attemptSession || attemptSession.submitted || !challengeAccepting();
}

function hasChallengeAccess(){
  return Boolean(pendingChallengeCode || attemptSession);
}

function hasDashboardAccess(){
  return Boolean(attemptSession && attemptSession.submitted);
}

function updateAuthNav(activeRoute = getRouteFromHash()){
  const loggedIn = hasChallengeAccess();
  const authLink = $('authLink');
  const challengeLink = $('challengeNavLink');
  const leaderboardLink = $('leaderboardNavLink');

  if (authLink){
    authLink.textContent = loggedIn ? 'Logout' : 'Login';
    authLink.dataset.route = 'login';
    authLink.classList.toggle('active', !loggedIn && activeRoute === 'login');
  }
  if (challengeLink){
    challengeLink.hidden = !loggedIn;
    challengeLink.classList.toggle('active', activeRoute === 'form');
  }
  if (leaderboardLink){
    leaderboardLink.hidden = !hasDashboardAccess();
    leaderboardLink.classList.toggle('active', activeRoute === 'leaderboard');
  }
}

function logout(){
  attemptSession = null;
  SELECTED.clear();
  renderSelectedGrid();
  setPendingChallengeCode('');
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(PENDING_CODE_KEY);
  const codeInput = $('challengeCode');
  const nameInput = $('participantName');
  const countrySelect = $('country');
  if (codeInput) codeInput.value = '';
  if (nameInput) nameInput.value = '';
  if (countrySelect) countrySelect.value = '';
  updateAuthNav('login');
  setChallengeControls();
  location.hash = '#login';
}

function setPendingChallengeCode(code, nickname = ''){
  pendingChallengeCode = normalizeChallengeCode(code);
  if (pendingChallengeCode) sessionStorage.setItem(PENDING_CODE_KEY, JSON.stringify({ challengeId: backendConfig.challengeId, challengeCode: pendingChallengeCode, nickname }));
  else sessionStorage.removeItem(PENDING_CODE_KEY);

  const badge = $('pendingCodeBadge');
  if (badge && pendingChallengeCode){
    badge.innerHTML = `<strong>Code accepted:</strong> <span>Ready to start</span>${nickname ? ` <small>${escapeHtml(nickname)}</small>` : ''}`;
    badge.hidden = false;
  } else if (badge) {
    badge.hidden = true;
    badge.innerHTML = '';
  }
  updateAuthNav(getRouteFromHash());
  setChallengeControls();
}

function updateParticipantUI(session){
  const codeRef = session && (session.codeRef || session.codeFingerprint) ? (session.codeRef || session.codeFingerprint) : 'Accepted';
  const country = session && session.country ? session.country : '';
  const nickname = session && session.nickname ? session.nickname : '';
  const participantName = session && session.participantName ? session.participantName : 'Player';
  const html = `<strong>Player:</strong> <span>${escapeHtml(participantName)}</span>${nickname ? ` <small>${escapeHtml(nickname)}</small>` : ` <small>Code ${escapeHtml(codeRef)}</small>`}${country ? ` <em>${escapeHtml(country)}</em>` : ''}`;
  const badge = $('participantBadge');
  const active = $('activeParticipant');
  if (badge){
    badge.innerHTML = html;
    badge.hidden = false;
  }
  if (active){
    active.innerHTML = html;
    active.hidden = false;
  }
}

function setPuzzleOverlay(message, icon = '🔒'){
  const puzzleCard = $('puzzleCard');
  const overlay = $('lockedOverlay');

  if (puzzleCard){
    puzzleCard.classList.add('locked');
    puzzleCard.classList.remove('unlocked');
  }

  if (!overlay) return;
  overlay.hidden = false;
  overlay.removeAttribute('hidden');
  overlay.setAttribute('aria-hidden', 'false');
  overlay.style.removeProperty('display');
  overlay.style.removeProperty('visibility');
  overlay.style.removeProperty('opacity');
  overlay.style.removeProperty('pointer-events');
  overlay.innerHTML = `<div class="lock-ico">${icon}</div><strong>${escapeHtml(message)}</strong><span>Please wait a moment.</span>`;
}

function hidePuzzleOverlay(){
  const puzzleCard = $('puzzleCard');
  const overlay = $('lockedOverlay');

  if (puzzleCard){
    puzzleCard.classList.remove('locked');
    puzzleCard.classList.add('unlocked');
  }

  if (!overlay) return;
  overlay.hidden = true;
  overlay.setAttribute('hidden', '');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.style.display = 'none';
  overlay.style.visibility = 'hidden';
  overlay.style.opacity = '0';
  overlay.style.pointerEvents = 'none';
  overlay.innerHTML = '';
}

async function loadPuzzleImage(session){
  const img = $('puzzleImg');
  if (!img || !session) return;

  const response = await fetch(apiUrl('/api/puzzle'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({
      challengeId: backendConfig.challengeId,
      attemptSessionId: session.id,
      attemptToken: session.token
    })
  });

  if (!response.ok){
    let message = 'Unable to load the protected puzzle image.';
    try {
      const body = await response.json();
      if (body && body.message) message = body.message;
    } catch (_) {}
    throw new Error(message);
  }

  const blob = await response.blob();
  if (!blob || blob.size < 1000) throw new Error('Protected puzzle image response was empty.');
  if (puzzleObjectUrl) URL.revokeObjectURL(puzzleObjectUrl);
  puzzleObjectUrl = URL.createObjectURL(blob);

  img.hidden = false;
  img.removeAttribute('hidden');
  img.onload = null;
  img.onerror = null;
  img.decoding = 'async';

  const loadPromise = new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      if (img.complete && img.naturalWidth > 0) resolve();
      else reject(new Error('Puzzle image could not be rendered by the browser.'));
    }, 8000);

    function cleanup(){
      window.clearTimeout(timeout);
      img.onload = null;
      img.onerror = null;
    }

    img.onload = () => {
      cleanup();
      resolve();
    };
    img.onerror = () => {
      cleanup();
      reject(new Error('Puzzle image could not be rendered by the browser.'));
    };
  });
  loadPromise.catch(() => {});

  img.src = puzzleObjectUrl;

  if (img.complete && img.naturalWidth > 0) return;

  if (typeof img.decode === 'function'){
    try {
      await img.decode();
      img.onload = null;
      img.onerror = null;
      if (img.naturalWidth > 0) return;
    } catch (_) {
      if (img.complete && img.naturalWidth > 0) return;
    }
  }

  await loadPromise;
}

async function unlockChallenge(session){
  attemptSession = session;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  updateParticipantUI(session);
  updateAuthNav(getRouteFromHash());
  setPuzzleOverlay('Loading the protected puzzle image...', '⏳');

  const responseCard = $('responseCard');
  const lockPill = $('puzzleLockPill');
  const timerHint = $('timerHint');
  const codeInput = $('challengeCode');

  responseCard && responseCard.classList.remove('disabled');
  if (lockPill){
    lockPill.textContent = 'Loading';
    lockPill.classList.remove('unlocked');
  }
  if (timerHint) timerHint.textContent = 'Started when code was accepted';
  if (codeInput) codeInput.value = '';

  setChallengeControls();
  tickElapsed();

  try {
    await loadPuzzleImage(session);
    hidePuzzleOverlay();
    if (lockPill){
      lockPill.textContent = 'Unlocked';
      lockPill.classList.add('unlocked');
    }
    showBanner('Code accepted. The puzzle is unlocked and your timer is running.', 'success');
  } catch (error) {
    console.error('Unable to load protected puzzle image.', error);
    if (lockPill) lockPill.textContent = 'Image error';
    setPuzzleOverlay(error.message || 'Code accepted, but the puzzle image could not be loaded.', '⚠️');
    showBanner(error.message || 'Code accepted, but the puzzle image could not be loaded. Please refresh and try again.', 'error');
  }
}

async function restoreCachedSession(){
  try {
    const pending = JSON.parse(sessionStorage.getItem(PENDING_CODE_KEY) || 'null');
    if (pending && pending.challengeId === backendConfig.challengeId && pending.challengeCode){
      setPendingChallengeCode(pending.challengeCode, pending.nickname || '');
    }

    const cached = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    if (
      cached &&
      cached.challengeId === backendConfig.challengeId &&
      cached.expiresAt &&
      new Date(cached.expiresAt).getTime() > Date.now()
    ){
      if (cached.submitted){
        attemptSession = cached;
        updateParticipantUI(cached);
        updateAuthNav(getRouteFromHash());
        showBanner('Your dashboard access was restored.', 'info');
        setChallengeControls();
      } else {
        await unlockChallenge(cached);
        showBanner('Your previous challenge session was restored. The original timer is still running.', 'info');
      }
      return cached;
    }
  } catch (_) {
    sessionStorage.removeItem(SESSION_KEY);
  }
  setChallengeControls();
  return null;
}

function showRoute(route){
  if (route === 'form' && !pendingChallengeCode && !attemptSession){
    route = 'login';
    if (location.hash !== '#login') location.hash = '#login';
  }
  if (route === 'leaderboard' && !hasDashboardAccess()){
    route = (pendingChallengeCode || attemptSession) ? 'form' : 'login';
    const targetHash = route === 'form' ? '#form' : '#login';
    if (location.hash !== targetHash) location.hash = targetHash;
  }
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  const target = document.querySelector(`.page[data-route="${route}"]`);
  if (target) target.classList.add('active');
  document.querySelectorAll('.demo-link').forEach((l) => l.classList.toggle('active', !l.hidden && l.dataset.route === route));
  updateAuthNav(route);
  window.scrollTo({ top: 0, behavior: 'auto' });
  if (route === 'leaderboard') renderLeaderboard();
}

function getRouteFromHash(){
  const hash = (location.hash || '').replace(/^#/, '').toLowerCase();
  if (hash === 'leaderboard') return 'leaderboard';
  if (hash === 'form') return 'form';
  return 'login';
}

function showBanner(message, type = 'info'){
  const banner = $('formBanner');
  if (!banner) return;
  banner.textContent = message || '';
  banner.className = `banner ${type}`;
  banner.classList.toggle('show', Boolean(message));
}

function showLoginBanner(message, type = 'info'){
  const banner = $('loginBanner');
  if (!banner) return;
  banner.textContent = message || '';
  banner.className = `banner ${type}`;
  banner.classList.toggle('show', Boolean(message));
}

// -----------------------------------------------------------------------------
// Challenge code start flow
// -----------------------------------------------------------------------------
async function handleCodeLogin(event){
  event && event.preventDefault();
  const input = $('challengeCode');
  const loginBtn = $('loginBtn');
  const code = normalizeChallengeCode(input && input.value);

  if (!apiOnline){
    showLoginBanner('Backend API is not reachable. Please try again shortly.', 'error');
    return;
  }
  if (!isValidChallengeCode(code)){
    showLoginBanner('Enter your challenge code first. It should contain 8 to 48 letters or numbers.', 'error');
    input && input.focus();
    return;
  }

  try {
    loginBtn && loginBtn.classList.add('loading');
    if (loginBtn) loginBtn.disabled = true;

    const response = await fetchJson(apiUrl('/api/code-login'), {
      method: 'POST',
      body: JSON.stringify({ challengeId: backendConfig.challengeId, challengeCode: code })
    });

    apiOnline = true;
    if (response.session){
      attemptSession = response.session;
      setPendingChallengeCode('');
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(attemptSession));
      updateParticipantUI(attemptSession);
      updateAuthNav('leaderboard');
      setChallengeControls();
      showLoginBanner('', 'info');
      location.hash = '#leaderboard';
      await renderLeaderboard();
      return;
    }

    setPendingChallengeCode(code, response.nickname || '');
    showLoginBanner('', 'info');
    showBanner(response.message || 'This code is ready. Enter your name and country, then start the challenge.', 'info');
    location.hash = '#form';
    const nameInput = $('participantName');
    if (nameInput && !normalizeParticipantName(nameInput.value)) nameInput.focus();
  } catch (error) {
    const fallback = error.message || 'Unable to log in with that challenge code. Please check the code and try again.';
    showLoginBanner(error.status >= 500 ? backendErrorMessage(error, fallback) : fallback, 'error');
  } finally {
    loginBtn && loginBtn.classList.remove('loading');
    setChallengeControls();
  }
}

async function handleStart(event){
  event.preventDefault();
  const nameInput = $('participantName');
  const countrySelect = $('country');
  const startBtn = $('startBtn');
  const code = pendingChallengeCode;
  const participantName = normalizeParticipantName(nameInput && nameInput.value);
  const country = countrySelect ? countrySelect.value : '';

  if (!challengeAccepting()){
    showBanner(challengeEnded() ? 'Challenge has ended.' : 'Challenge is not open yet.', 'error');
    return;
  }
  if (!isValidChallengeCode(code)){
    showBanner('Enter your challenge code on the login screen first.', 'error');
    location.hash = '#login';
    return;
  }
  if (participantName.length < 2){
    showBanner('Enter your name before joining the challenge.', 'error');
    nameInput && nameInput.focus();
    return;
  }
  if (!countryList().includes(country)){
    showBanner('Select your country before entering the challenge.', 'error');
    countrySelect && countrySelect.focus();
    return;
  }
  if (!isValidChallengeCode(code)){
    showBanner('Enter the unique challenge code issued to you. It should contain 8 to 48 letters or numbers.', 'error');
    return;
  }

  try {
    startBtn && startBtn.classList.add('loading');
    if (startBtn) startBtn.disabled = true;

    const response = await fetchJson(apiUrl('/api/sessions'), {
      method: 'POST',
      body: JSON.stringify({ challengeId: backendConfig.challengeId, participantName, country, challengeCode: code })
    });

    apiOnline = true;
    setPendingChallengeCode('');
    await unlockChallenge(response.session);
  } catch (error) {
    if (error.status === 409){
      showBanner(error.message || 'This challenge code has already been submitted. Redirecting to leaderboard...', 'info');
      sessionStorage.removeItem(SESSION_KEY);
      setTimeout(() => { location.hash = '#leaderboard'; }, 1200);
    } else {
      showBanner(error.message || 'Unable to start the challenge. Please check your country/code and try again.', 'error');
    }
  } finally {
    startBtn && startBtn.classList.remove('loading');
    setChallengeControls();
  }
}

// -----------------------------------------------------------------------------
// Answer entry and submission
// -----------------------------------------------------------------------------
function renderSelectedGrid(){
  const grid = $('selectedGrid');
  const count = $('progressCount');
  const progress = $('progressPill');
  const values = Array.from(SELECTED);

  if (count) count.textContent = values.length;
  if (progress) progress.title = `${values.length} answer${values.length === 1 ? '' : 's'} added`;

  if (!grid) return;
  if (!values.length){
    grid.innerHTML = '<div class="empty-chip">No words added yet.</div>';
    return;
  }

  grid.innerHTML = values.map((word) => `
    <button class="word-chip" type="button" data-word="${escapeHtml(word)}" title="Remove ${escapeHtml(word)}">
      <span>${escapeHtml(word)}</span><b aria-hidden="true">×</b>
    </button>
  `).join('');

  grid.querySelectorAll('.word-chip').forEach((button) => {
    button.addEventListener('click', () => {
      SELECTED.delete(button.dataset.word || '');
      renderSelectedGrid();
    });
  });
}

function addWordFromInput(){
  const input = $('serviceLineInput');
  if (!input) return;
  const value = normalizeServiceLine(input.value);
  if (!value) return;
  SELECTED.add(value);
  input.value = '';
  input.focus();
  renderSelectedGrid();
}

function celebrate(){
  const stage = $('confettiStage');
  if (!stage) return;
  stage.innerHTML = '';
  for (let i = 0; i < 34; i += 1){
    const piece = document.createElement('span');
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.animationDelay = `${Math.random() * 0.4}s`;
    piece.style.transform = `rotate(${Math.random() * 180}deg)`;
    stage.appendChild(piece);
  }
  setTimeout(() => { stage.innerHTML = ''; }, 1600);
}

async function handleSubmit(event){
  event.preventDefault();
  const submitBtn = $('submitBtn');

  if (!attemptSession){
    showBanner('Enter your country and challenge code first to unlock the puzzle and start the timer.', 'error');
    return;
  }
  if (!challengeAccepting()){
    showBanner(challengeEnded() ? 'Challenge has ended.' : 'Challenge is not accepting submissions yet.', 'error');
    return;
  }
  if (!SELECTED.size){
    showBanner('Add at least one service line before submitting.', 'error');
    return;
  }

  try {
    submitBtn && submitBtn.classList.add('loading');
    if (submitBtn) submitBtn.disabled = true;

    const response = await fetchJson(apiUrl('/api/submissions'), {
      method: 'POST',
      body: JSON.stringify({
        challengeId: backendConfig.challengeId,
        attemptSessionId: attemptSession.id,
        attemptToken: attemptSession.token,
        answers: Array.from(SELECTED)
      })
    });

    SELECTED.clear();
    renderSelectedGrid();
    attemptSession = { ...attemptSession, submitted: true };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(attemptSession));
    updateAuthNav('leaderboard');
    showBanner(`Submitted successfully. You earned ${formatScorePoints(response.submission.correct)}.`, 'success');
    celebrate();
    await renderLeaderboard(response.state);
    setTimeout(() => { location.hash = '#leaderboard'; }, 900);
  } catch (error) {
    if (error.status === 409){
      showBanner(error.message || 'This challenge code has already submitted. Redirecting to leaderboard...', 'info');
      sessionStorage.removeItem(SESSION_KEY);
      setTimeout(() => { location.hash = '#leaderboard'; }, 1200);
    } else {
      showBanner(error.message || 'Unable to submit response. Please try again.', 'error');
    }
  } finally {
    submitBtn && submitBtn.classList.remove('loading');
    setChallengeControls();
  }
}


async function handleManualLeaderboardRefresh(){
  const button = $('refreshLeaderboardBtn');
  try {
    if (button){
      button.classList.add('loading');
      button.disabled = true;
    }
    await renderLeaderboard();
  } finally {
    if (button){
      button.classList.remove('loading');
      button.disabled = false;
    }
  }
}

// -----------------------------------------------------------------------------
// Leaderboard rendering
// -----------------------------------------------------------------------------
async function fetchLeaderboardState(){
  if (!hasDashboardAccess()){
    renderDashboardLocked('Submit your challenge response before viewing the dashboard.');
    return null;
  }
  try {
    const state = await fetchJson(apiUrl('/api/leaderboard'), {
      method: 'POST',
      body: JSON.stringify({
        challengeId: backendConfig.challengeId,
        attemptSessionId: attemptSession.id,
        attemptToken: attemptSession.token
      })
    });
    apiOnline = true;
    return state;
  } catch (error) {
    apiOnline = false;
    console.error('Unable to load leaderboard.', error);
    if (error.status === 401) renderDashboardLocked(error.message);
    return null;
  }
}

async function renderLeaderboard(presetState = null){
  if (!presetState && !hasDashboardAccess()){
    renderDashboardLocked('Submit your challenge response before viewing the dashboard.');
    return;
  }
  const state = presetState || await fetchLeaderboardState();
  if (!state) return;

  backendConfig.challengeWindow = state.challengeWindow || backendConfig.challengeWindow;
  backendConfig.serviceLineCount = state.serviceLineCount || backendConfig.serviceLineCount;
  backendConfig.countries = state.countriesList || backendConfig.countries;

  const stats = state.stats || {};
  if ($('statParticipants')) $('statParticipants').textContent = stats.totalParticipants || 0;
  if ($('statCountries')) $('statCountries').textContent = stats.countriesParticipating || 0;
  if ($('statPerfect')) $('statPerfect').textContent = stats.perfectScores || 0;
  if ($('statAvgTime')) $('statAvgTime').textContent = stats.avgTimeMinutes != null ? `${stats.avgTimeMinutes}m` : '—';
  if ($('statParticipantsD')) $('statParticipantsD').textContent = stats.totalParticipants ? `${stats.totalParticipants} submission${stats.totalParticipants !== 1 ? 's' : ''}` : 'awaiting entries';
  if ($('statCountriesD')) $('statCountriesD').textContent = stats.countriesParticipating ? 'represented' : 'awaiting country data';
  if ($('statPerfectD')) $('statPerfectD').textContent = stats.perfectScores ? 'highest points achieved' : 'no perfect score yet';
  if ($('statAvgTimeD')) $('statAvgTimeD').textContent = stats.avgTimeMinutes != null ? 'across submitted entries' : 'to complete';

  renderTopThree(state.topThree || []);
  renderCountryReport(state);
  renderCountryScoreReport(state);
  renderProgressSnapshot(state);
  renderWordInsights(state);
  renderCountryFilters(state);
  renderLeaderboardTable(state);
  if ($('lastUpdated')) $('lastUpdated').textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

function renderDashboardLocked(message = 'Submit your challenge response before viewing the dashboard.'){
  if ($('statParticipants')) $('statParticipants').textContent = '—';
  if ($('statCountries')) $('statCountries').textContent = '—';
  if ($('statPerfect')) $('statPerfect').textContent = '—';
  if ($('statAvgTime')) $('statAvgTime').textContent = '—';
  if ($('statParticipantsD')) $('statParticipantsD').textContent = 'locked';
  if ($('statCountriesD')) $('statCountriesD').textContent = 'locked';
  if ($('statPerfectD')) $('statPerfectD').textContent = 'locked';
  if ($('statAvgTimeD')) $('statAvgTimeD').textContent = 'locked';
  if ($('top3Wrap')) $('top3Wrap').innerHTML = `<div class="lock-card dashboard-lock"><div class="lock-ico">Locked</div><div><strong>Dashboard locked</strong><p>${escapeHtml(message)}</p><a class="btn btn-primary" href="#form">Back to challenge</a></div></div>`;
  if ($('countryWrap')) $('countryWrap').innerHTML = '<div class="empty">Dashboard locked until your response is submitted.</div>';
  if ($('progressWrap')) $('progressWrap').innerHTML = '<div class="empty">Dashboard locked until your response is submitted.</div>';
  if ($('countryScoreWrap')) $('countryScoreWrap').innerHTML = '<div class="empty">Dashboard locked until your response is submitted.</div>';
  if ($('wordWrap')) $('wordWrap').innerHTML = '<div class="lock-card"><div class="lock-ico">Locked</div><div><strong>Insights locked</strong><p>Submit your response to view dashboard details.</p></div></div>';
  if ($('countryFilters')) $('countryFilters').innerHTML = '';
  if ($('leaderboardBody')) $('leaderboardBody').innerHTML = '<tr><td colspan="6" class="empty">Dashboard locked until your response is submitted.</td></tr>';
  if ($('lastUpdated')) $('lastUpdated').textContent = 'Dashboard locked';
}

function renderTopThree(top){
  const wrap = $('top3Wrap');
  if (!wrap) return;
  if (!top.length){
    wrap.innerHTML = '<div class="podium-empty"><h3>No responses yet</h3><p>The podium will fill in as entries arrive.</p></div>';
    return;
  }

  const order = [top[1], top[0], top[2]];
  const meta = [
    { rank: 2, tier: 'Silver', cls: 'rank-2' },
    { rank: 1, tier: 'Gold', cls: 'rank-1' },
    { rank: 3, tier: 'Bronze', cls: 'rank-3' }
  ];

  wrap.innerHTML = '<div class="podium-wrap fade-in">' + order.map((item, index) => {
    const m = meta[index];
    if (!item){
      return `<div class="podium-card ${m.cls}"><div class="podium-medal">${m.rank}</div><div class="podium-tier">${m.tier}</div><div class="podium-name muted">Awaiting participant</div></div>`;
    }
    const label = item.displayName || item.participantName || 'Player';
    const codeLabel = item.nickname || item.codeLabel || '';
    return `<div class="podium-card ${m.cls}">
      <div class="podium-medal">${m.rank}</div>
      <div class="podium-tier">${m.tier}</div>
      <div class="podium-name">${escapeHtml(label)}</div>
      ${codeLabel ? `<div class="podium-code">${escapeHtml(codeLabel)}</div>` : ''}
      <div class="podium-country">${escapeHtml(item.country || '')}</div>
      <div class="podium-divider"></div>
      <div class="podium-meta">
        <div class="podium-stat"><div class="v">${scorePoints(item.correct)}</div><div class="l">Score</div></div>
        <div class="podium-stat"><div class="v">${item.timeTakenMinutes}<span>m</span></div><div class="l">Time</div></div>
      </div>
    </div>`;
  }).join('') + '</div>';
}

function renderCountryReport(state){
  const wrap = $('countryWrap');
  if (!wrap) return;
  const rows = (state.countries || []).filter((row) => Number(row.responses || 0) > 0).slice().sort((a, b) => {
    if (b.responses !== a.responses) return b.responses - a.responses;
    if (b.avgScore !== a.avgScore) return b.avgScore - a.avgScore;
    return a.country.localeCompare(b.country);
  });
  if (!rows.length){
    wrap.innerHTML = '<div class="empty">Waiting for country data.</div>';
    return;
  }
  const maxResponses = Math.max(...rows.map((row) => row.responses), 1);
  wrap.innerHTML = '<div class="country-list">' + rows.map((row, index) => {
    const width = Math.max(row.responses ? 8 : 0, Math.min(100, (row.responses / maxResponses) * 100));
    const avgTime = row.avgTimeMinutes != null ? `${row.avgTimeMinutes}m avg time` : 'no submissions yet';
    const label = `${row.responses} participant${row.responses === 1 ? '' : 's'}`;
    return `<div class="country-row${index === 0 && row.responses ? ' top' : ''}">
      <div class="country-rank">${index + 1}</div>
      <div class="country-info">
        <strong>${escapeHtml(row.country)}</strong>
        <span>${row.responses} response${row.responses === 1 ? '' : 's'} · top score ${scorePoints(row.topScore)} · avg score ${scorePoints(row.avgScore)} · ${avgTime}</span>
      </div>
      <div class="country-track" aria-label="${escapeHtml(label)}"><span style="width:${width}%"></span><b>${escapeHtml(label)}</b></div>
    </div>`;
  }).join('') + '</div>';
}

function renderCountryScoreReport(state){
  const wrap = $('countryScoreWrap');
  if (!wrap) return;
  const rows = (state.countries || [])
    .filter((row) => Number(row.responses || 0) > 0)
    .slice()
    .sort((a, b) => {
      if (Number(b.avgScore || 0) !== Number(a.avgScore || 0)) return Number(b.avgScore || 0) - Number(a.avgScore || 0);
      if (Number(b.topScore || 0) !== Number(a.topScore || 0)) return Number(b.topScore || 0) - Number(a.topScore || 0);
      if (Number(b.responses || 0) !== Number(a.responses || 0)) return Number(b.responses || 0) - Number(a.responses || 0);
      const aTime = a.avgTimeMinutes == null ? Infinity : Number(a.avgTimeMinutes);
      const bTime = b.avgTimeMinutes == null ? Infinity : Number(b.avgTimeMinutes);
      if (aTime !== bTime) return aTime - bTime;
      return a.country.localeCompare(b.country);
    });
  if (!rows.length){
    wrap.innerHTML = '<div class="empty">Waiting for country performance data.</div>';
    return;
  }
  const maxAvg = Math.max(...rows.map((row) => Number(row.avgScore || 0)), 1);
  wrap.innerHTML = '<div class="country-list country-score-list">' + rows.map((row, index) => {
    const avg = Number(row.avgScore || 0);
    const width = Math.max(avg ? 8 : 0, Math.min(100, (avg / maxAvg) * 100));
    const label = `Avg ${scorePoints(avg)}`;
    const rank = row.performanceRank || index + 1;
    const avgTime = row.avgTimeMinutes != null ? `${row.avgTimeMinutes}m avg time` : 'no time yet';
    const sampleNote = row.sampleSizeNote ? ` · ${escapeHtml(row.sampleSizeNote)}` : '';
    return `<div class="country-row score-row${index === 0 && avg ? ' top' : ''}">
      <div class="country-rank">${rank}</div>
      <div class="country-info">
        <strong>${escapeHtml(row.country)}</strong>
        <span>Avg score ${scorePoints(avg)} · top score ${scorePoints(row.topScore)} · ${row.responses} response${row.responses === 1 ? '' : 's'} · ${avgTime}${sampleNote}</span>
      </div>
      <div class="country-track score-track" aria-label="${escapeHtml(label)}"><span style="width:${width}%"></span><b>${escapeHtml(label)}</b></div>
    </div>`;
  }).join('') + '<p class="helper snapshot-note">Country ranking is sorted by average score, then top score, response count, and fastest average time.</p></div>';
}

function renderProgressSnapshot(state){
  const wrap = $('progressWrap');
  if (!wrap) return;
  const stats = state.stats || {};
  const completion = stats.completionRate == null ? '—' : `${stats.completionRate}%`;
  const issued = stats.issuedCodes || 0;
  const started = stats.startedCodes || 0;
  const used = stats.usedCodes || stats.totalParticipants || 0;
  wrap.innerHTML = `<div class="snapshot-grid">
    <div class="snapshot"><span>Codes Imported</span><strong>${issued || '—'}</strong></div>
    <div class="snapshot"><span>Attempts Started</span><strong>${started || 0}</strong></div>
    <div class="snapshot"><span>Responses Submitted</span><strong>${used || 0}</strong></div>
    <div class="snapshot"><span>Completion</span><strong>${completion}</strong></div>
  </div>
  <p class="helper snapshot-note">This live view focuses on participation, ranking, and country engagement.</p>`;
}

function renderWordInsights(state){
  const wrap = $('wordWrap');
  if (!wrap) return;
  if (state.answersHidden){
    wrap.innerHTML = '<div class="lock-card"><div class="lock-ico">🔒</div><div><strong>Word-level insights are locked</strong><p>Per-word performance unlocks only when the challenge clock reaches zero to reduce answer leakage.</p></div></div>';
  } else if (!state.wordStats || !state.wordStats.length){
    wrap.innerHTML = '<div class="empty">No word-level results available yet.</div>';
  } else {
    wrap.innerHTML = '<div class="word-grid-stats">' + state.wordStats.map((row) =>
      `<div class="word-cell"><strong>${escapeHtml(row.word)}</strong><div class="pct">${row.hits} hits · ${row.pct}%</div><div class="bar" style="width:${row.pct}%"></div></div>`
    ).join('') + '</div>';
  }
}

function renderCountryFilters(state){
  const wrap = $('countryFilters');
  if (!wrap) return;
  const activeCountries = new Set((state.countries || []).filter((row) => row.responses > 0).map((row) => row.country));
  const countries = (state.countriesList || countryList()).filter((country) => activeCountries.has(country));
  if (!countries.length){
    wrap.innerHTML = '';
    activeCountry = 'ALL';
    return;
  }
  if (activeCountry !== 'ALL' && !countries.includes(activeCountry)) activeCountry = 'ALL';
  wrap.innerHTML = ['ALL', ...countries].map((country) => {
    const label = country === 'ALL' ? 'All Countries' : country;
    const cls = activeCountry === country ? 'pill active' : 'pill';
    return `<button class="${cls}" type="button" data-country="${escapeHtml(country)}">${escapeHtml(label)}</button>`;
  }).join('');
  wrap.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => {
      activeCountry = button.dataset.country || 'ALL';
      renderLeaderboardTable(state);
      renderCountryFilters(state);
    });
  });
}

function renderLeaderboardTable(state){
  const body = $('leaderboardBody');
  if (!body) return;
  const allRows = state.leaderboard || [];
  const rows = activeCountry === 'ALL' ? allRows : allRows.filter((row) => row.country === activeCountry);
  if (!rows.length){
    body.innerHTML = '<tr><td colspan="6" class="empty">No responses yet.</td></tr>';
    return;
  }

  const scoreValues = rows.map((row) => Number(row.correct || 0));
  const maxScore = state.challengeWindow && state.challengeWindow.ended && state.serviceLineCount
    ? Number(state.serviceLineCount)
    : Math.max(1, ...scoreValues);
  body.innerHTML = rows.map((row) => {
    const pct = Math.min(100, (Number(row.correct || 0) / maxScore) * 100);
    const rankClass = row.rank === 1 ? 'r1' : row.rank === 2 ? 'r2' : row.rank === 3 ? 'r3' : '';
    const submitted = new Date(row.submittedAt);
    const submittedStr = `${submitted.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${submitted.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
    return `<tr>
      <td data-label="Rank"><span class="rank-badge ${rankClass}">${row.rank}</span></td>
      <td data-label="Name" class="name-cell"><strong>${escapeHtml(row.displayName || row.participantName || 'Player')}</strong><small>${escapeHtml(row.nickname || row.codeLabel || '')}</small></td>
      <td data-label="Country"><span class="country-cell">${escapeHtml(row.country || '')}</span></td>
      <td data-label="Score"><span class="table-score">${scorePoints(row.correct)}<span class="score-bar"><span style="width:${pct}%"></span></span></span></td>
      <td data-label="Time" class="time-cell">${row.timeTakenMinutes} min</td>
      <td data-label="Submitted" class="submitted-cell">${submittedStr}</td>
    </tr>`;
  }).join('');
}

// -----------------------------------------------------------------------------
// Event wiring and startup
// -----------------------------------------------------------------------------
function wireEvents(){
  window.addEventListener('hashchange', () => showRoute(getRouteFromHash()));
  if ($('authLink')) $('authLink').addEventListener('click', (event) => {
    if (hasChallengeAccess()){
      event.preventDefault();
      logout();
    }
  });
  if ($('loginForm')) $('loginForm').addEventListener('submit', handleCodeLogin);
  if ($('codeForm')) $('codeForm').addEventListener('submit', handleStart);
  if ($('addWordBtn')) $('addWordBtn').addEventListener('click', addWordFromInput);
  if ($('serviceLineInput')) $('serviceLineInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter'){
      event.preventDefault();
      addWordFromInput();
    }
  });
  if ($('challengeForm')) $('challengeForm').addEventListener('submit', handleSubmit);
  if ($('refreshLeaderboardBtn')) $('refreshLeaderboardBtn').addEventListener('click', handleManualLeaderboardRefresh);
}

async function start(){
  wireEvents();
  renderSelectedGrid();
  await loadRuntimeConfig();
  applyBranding();
  await loadBackendConfig();
  await restoreCachedSession();
  tickCountdown();
  tickElapsed();

  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = setInterval(tickCountdown, 1000);
  if (elapsedInterval) clearInterval(elapsedInterval);
  elapsedInterval = setInterval(tickElapsed, 1000);

  showRoute(getRouteFromHash());
  if (leaderboardPoll) clearInterval(leaderboardPoll);
  leaderboardPoll = setInterval(() => {
    if (getRouteFromHash() === 'leaderboard' && hasDashboardAccess()) renderLeaderboard();
  }, 45000);
}

start().catch((error) => {
  console.error('Application failed to start.', error);
  showBanner('Application failed to initialize. Please refresh the page or contact the administrator.', 'error');
});
