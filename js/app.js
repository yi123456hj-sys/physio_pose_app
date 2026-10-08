// app.js — UI wiring for the physio pose assessment app.
import { t } from './i18n.js';
import { loadPose, detectPose } from './mediapipe.js';
import { hipHeightRatio, sideMeasures } from './pose_math.js';
import { createSTSTest } from './sts_detector.js';
import { createTUG } from './tug.js';
import { createROMRecorder } from './rom.js';

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const LS_LANG = 'physiopose.lang';
const LS_RESULTS = 'physiopose.results';

let lang = localStorage.getItem(LS_LANG) || (navigator.language && navigator.language.startsWith('zh') ? 'zh' : navigator.language.startsWith('ko') ? 'ko' : 'en');
let results = loadResults();
let landmarker = null;
let videoStream = null;
let rafId = 0;
let facingMode = 'environment';
let currentTest = null;
let session = null; // active per-test state machine { onPose(lm, ts) }

function loadResults() {
  try { return JSON.parse(localStorage.getItem(LS_RESULTS)) || []; }
  catch { return []; }
}
function persistResults() { localStorage.setItem(LS_RESULTS, JSON.stringify(results)); }

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ---------- audio ----------
let audioCtx = null;
function beep(freq = 880, durMs = 120) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.4, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durMs / 1000);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + durMs / 1000 + 0.05);
  } catch { /* audio is optional */ }
}
const beepGo = () => beep(1320, 350);

// ---------- language ----------
function applyLang() {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang === 'ko' ? 'ko' : 'en';
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(lang, el.dataset.i18n);
  });
  $('langSelect').value = lang;
  document.title = t(lang, 'appTitle');
  renderResultsTable();
  if (!$('test').hidden) refreshTestTexts();
}
function refreshTestTexts() {
  if (!currentTest) return;
  $('testTitle').textContent = t(lang, currentTest + 'Name');
  $('protocolHint').textContent = t(lang, currentTest + 'Protocol');
}

// ---------- camera ----------
async function openCamera() {
  const constraints = {
    video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  };
  videoStream = await navigator.mediaDevices.getUserMedia(constraints);
  const video = $('video');
  video.srcObject = videoStream;
  await video.play().catch(() => {});
  $('overlay').width = video.videoWidth;
  $('overlay').height = video.videoHeight;
  setMirror(facingMode === 'user');
}
// Mirror only the front camera: a mirrored rear view confuses left/right.
function setMirror(on) {
  document.querySelector('.video-wrap').classList.toggle('mirror', on);
}

// ---------- screen wake lock (phones) ----------
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch { /* not supported or not allowed: optional */ }
}
function releaseWakeLock() {
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}
function stopCamera() {
  if (videoStream) { videoStream.getTracks().forEach((tr) => tr.stop()); videoStream = null; }
  $('video').srcObject = null;
}

// ---------- skeleton overlay ----------
const SKELETON = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
];
function drawSkeleton(lms) {
  const canvas = $('overlay');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!lms) return;
  ctx.strokeStyle = 'rgba(45, 212, 191, .9)';
  ctx.lineWidth = Math.max(3, canvas.width / 280);
  for (const [a, b] of SKELETON) {
    const p = lms[a], q = lms[b];
    if (p.visibility > 0.5 && q.visibility > 0.5) {
      ctx.beginPath();
      ctx.moveTo(p.x * canvas.width, p.y * canvas.height);
      ctx.lineTo(q.x * canvas.width, q.y * canvas.height);
      ctx.stroke();
    }
  }
  ctx.fillStyle = 'rgba(20, 184, 166, .95)';
  for (const p of lms) {
    if (p.visibility > 0.5) {
      ctx.beginPath();
      ctx.arc(p.x * canvas.width, p.y * canvas.height, Math.max(3, canvas.width / 220), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ---------- pose loop ----------
function poseLoop(ts) {
  rafId = requestAnimationFrame(poseLoop);
  if (!landmarker) return;
  const video = $('video');
  if (!video.videoWidth || !video.srcObject) return;
  const lm = detectPose(landmarker, video, ts);
  drawSkeleton(lm);
  $('poseLost').hidden = !!lm;
  if (lm && session && session.onPose) session.onPose(lm, ts);
}

// ---------- screen switching ----------
function showScreen(name) {
  $('home').hidden = name !== 'home';
  $('test').hidden = name !== 'test';
}
function exitTest() {
  cancelAnimationFrame(rafId); rafId = 0;
  stopCamera();
  releaseWakeLock();
  session = null;
  landmarker = null; // model reloads on next entry
  window.calib = [null, null];
  window.calibReady = false;
  showScreen('home');
  renderResultsTable();
}

// ---------- entering a test ----------
async function enterTest(testId) {
  currentTest = testId;
  showScreen('test');
  requestWakeLock();
  refreshTestTexts();
  hidePanels();
  $('hud').hidden = true;
  $('poseLost').hidden = true;
  $('statusMsg').textContent = '';
  $('primaryBtn').hidden = false;
  $('primaryBtn').disabled = false;
  $('primaryBtn').textContent = t(lang, 'start');
  $('primaryBtn').onclick = null;
  $('stopBtn').hidden = true;
  $('stopBtn').onclick = null;
  setLoading(true);

  try {
    landmarker = await loadPose($('modelSelect').value, (stage) => ($('loadingMsg').textContent = t(lang, stage)));
    setLoading(false);
    await openCamera();
    rafId = requestAnimationFrame(poseLoop);
    if (testId === 'rom') startROM();
    else startCalibration();
  } catch (e) {
    setLoading(false);
    if (!videoStream) {
      $('statusMsg').textContent = t(lang, 'cameraError');
      $('primaryBtn').hidden = true;
    }
    console.error(e);
  }
}

function setLoading(on) { $('loadingMask').hidden = !on; }
function hidePanels() {
  $('calibPanel').hidden = true;
  $('romPanel').hidden = true;
  $('resultPanel').hidden = true;
}

// --- shared sit/stand calibration (STS + TUG) ---
const CALIB_SECONDS = 3;
function startCalibration() {
  hidePanels();
  $('calibPanel').hidden = false;
  $('primaryBtn').disabled = true;
  window.calib = [null, null];
  window.calibReady = false;
  const samples = [];
  let phase = 0; // 0 sit, 1 stand
  let phaseStart = 0;
  let lastCount = -1;
  const stepEl = $('calibStep');
  const hintEl = $('calibHint');
  const countEl = $('calibCount');

  const showPhase = (p) => {
    stepEl.textContent = t(lang, p === 0 ? 'calibSit' : 'calibStand');
    hintEl.textContent = t(lang, p === 0 ? 'calibSitHint' : 'calibStandHint');
  };
  showPhase(0);

  session = {
    onPose(lm, ts) {
      if (phase > 1) return;
      if (!phaseStart) phaseStart = ts;
      const elapsed = (ts - phaseStart) / 1000;
      const remaining = Math.max(1, Math.ceil(CALIB_SECONDS - elapsed));
      if (remaining !== lastCount) { countEl.textContent = remaining; lastCount = remaining; }
      const f = hipHeightRatio(lm, $('overlay').width, $('overlay').height);
      if (f !== null) samples.push({ phase, f });
      if (elapsed < CALIB_SECONDS) return;
      const vals = samples.filter((s) => s.phase === phase).map((s) => s.f);
      if (vals.length < 5) { phaseStart = ts; return; } // too few samples: extend the phase
      window.calib[phase] = median(vals);
      phase++;
      phaseStart = ts;
      lastCount = -1;
      if (phase === 1) {
        showPhase(1);
        beep(880, 150);
      } else {
        countEl.textContent = '✓';
        stepEl.textContent = t(lang, 'calibDone');
        hintEl.textContent = '';
        beep(1320, 250);
        $('primaryBtn').disabled = false;
        $('primaryBtn').textContent = t(lang, 'start');
        window.calibReady = true;
        session = null;
      }
    },
  };
}

// --- STS run ---
function runSTS() {
  const [seatedVal, standingVal] = window.calib;
  window.calibReady = false;
  $('calibPanel').hidden = true;
  $('hud').hidden = false;
  $('hudSub').textContent = t(lang, 'ready');
  $('primaryBtn').hidden = true;
  $('stopBtn').hidden = false;
  $('statusMsg').textContent = t(lang, 'ready');
  // 3-2-1 countdown so the participant starts from a quiet seated position
  let countStart = 0;
  let lastShown = -1;
  session = {
    onPose(lm, ts) {
      if (!countStart) countStart = ts;
      const shown = 3 - Math.floor((ts - countStart) / 1000);
      if (shown !== lastShown) {
        lastShown = shown;
        if (shown > 0) { $('hudMain').textContent = shown; beep(660, 120); }
        else { $('hudMain').textContent = t(lang, 'go'); beepGo(); }
      }
      if (ts - countStart >= 3000) startSTSClock(seatedVal, standingVal);
    },
  };
  $('stopBtn').onclick = () => { // cancel countdown, back to calibration
    session = null;
    $('stopBtn').hidden = true;
    $('stopBtn').onclick = null;
    $('hud').hidden = true;
    $('statusMsg').textContent = '';
    startCalibration();
  };
}

function startSTSClock(seatedVal, standingVal) {
  const test = createSTSTest(30);
  const startT = performance.now();
  test.start(startT, seatedVal, standingVal);
  $('hudMain').textContent = '0';
  $('hudSub').textContent = '30';
  $('statusMsg').textContent = t(lang, 'go');
  let lastF = standingVal;
  session = {
    onPose(lm, ts) {
      const f = hipHeightRatio(lm, $('overlay').width, $('overlay').height);
      if (f === null) return;
      lastF = f;
      const r = test.update(f, ts);
      $('hudMain').textContent = r.standUps;
      $('hudSub').textContent = Math.max(0, Math.ceil(r.remaining / 1000));
      if (r.done) finishSTS(r, startT);
    },
  };
  $('stopBtn').onclick = () => {
    const r = test.update(lastF, startT + 31000); // force completion at current count
    finishSTS(r, startT);
  };
}
function finishSTS(r, startT) {
  session = null;
  $('stopBtn').hidden = true;
  $('stopBtn').onclick = null;
  $('hudSub').textContent = '';
  beep(660, 400);
  $('statusMsg').textContent = t(lang, 'testDone');
  showResult(
    [
      { label: t(lang, 'standUps'), value: r.standUps, big: true },
      { label: t(lang, 'cycles'), value: r.cycles },
      { label: t(lang, 'elapsed'), value: Math.min(30, Math.round((performance.now() - startT) / 1000)) + ' s' },
    ],
    { standUps: r.standUps, cycles: r.cycles, durationSec: 30 }
  );
}

// --- TUG run ---
function runTUG() {
  const [seatedVal, standingVal] = window.calib;
  const tug = createTUG();
  tug.arm(performance.now(), seatedVal, standingVal);
  window.calibReady = false;
  window.tugRunStart = null;
  $('calibPanel').hidden = true;
  $('hud').hidden = false;
  $('hudMain').textContent = '0.0';
  $('hudSub').textContent = t(lang, 'ready');
  $('stopBtn').hidden = false;
  $('statusMsg').textContent = t(lang, 'ready');
  session = {
    onPose(lm, ts) {
      const f = hipHeightRatio(lm, $('overlay').width, $('overlay').height);
      if (f === null) return;
      const s = tug.update(f, ts);
      if (s.phase === 'running') {
        if (window.tugRunStart === null) window.tugRunStart = ts;
        $('hudMain').textContent = ((ts - window.tugRunStart) / 1000).toFixed(1);
        $('hudSub').textContent = t(lang, 'elapsed');
      }
      if (s.phase === 'done') finishTUG(s, true);
    },
  };
  $('primaryBtn').disabled = false;
  $('primaryBtn').textContent = t(lang, 'go');
  $('primaryBtn').onclick = () => {
    tug.go(performance.now());
    $('primaryBtn').hidden = true;
    $('statusMsg').textContent = t(lang, 'go');
    beepGo();
  };
  $('stopBtn').onclick = () => {
    tug.manualStop(performance.now());
    finishTUG(tug.status(), false);
  };
}
function finishTUG(s, auto) {
  session = null;
  $('stopBtn').hidden = true;
  $('stopBtn').onclick = null;
  $('primaryBtn').hidden = true;
  $('primaryBtn').onclick = null;
  beep(660, 400);
  $('statusMsg').textContent = t(lang, 'testDone');
  showResult(
    [
      { label: t(lang, 'totalTime'), value: s.total.toFixed(2) + ' s', big: true },
      { label: t(lang, 'transferTime'), value: s.transfer === null ? '--' : s.transfer.toFixed(2) + ' s' },
      { label: t(lang, auto ? 'autoNote' : 'manualNote'), value: auto ? '✓' : '!' },
    ],
    { totalSec: +s.total.toFixed(2), transferSec: s.transfer === null ? null : +s.transfer.toFixed(2), auto }
  );
}

// --- ROM flow ---
function startROM() {
  hidePanels();
  $('romPanel').hidden = false;
  $('primaryBtn').hidden = true;
  $('stopBtn').hidden = true;
  $('statusMsg').textContent = t(lang, 'romHint');
  const recorder = createROMRecorder({ windowMs: 3000 });
  window.romRecorder = recorder;
  window.romStartT = 0;
  session = {
    onPose(lm, ts) {
      const w = $('overlay').width, h = $('overlay').height;
      const L = sideMeasures(lm, 'left', w, h);
      const R = sideMeasures(lm, 'right', w, h);
      const show = (s, kneeEl, hipEl) => {
        kneeEl.textContent = s && s.knee !== null ? Math.round(s.knee) + '°' : '--';
        hipEl.textContent = s && s.hip !== null ? Math.round(s.hip) + '°' : '--';
      };
      show(L, $('kneeL'), $('hipL'));
      show(R, $('kneeR'), $('hipR'));
      if (recorder.isRecording()) {
        const side = L && R ? (L.visibility >= R.visibility ? 'left' : 'right') : L ? 'left' : 'right';
        const s = side === 'left' ? L : R;
        if (s) recorder.add(ts, s.knee, s.hip, side);
        const prog = $('romRecordProgress');
        prog.hidden = false;
        prog.textContent = t(lang, 'recording') + ' ' + ((ts - window.romStartT) / 1000).toFixed(1) + ' s';
      }
    },
  };
  $('romRecordBtn').onclick = () => {
    if (recorder.isRecording()) return;
    beep(880, 120);
    window.romStartT = performance.now();
    recorder.start(window.romStartT);
    $('romRecordBtn').disabled = true;
    setTimeout(() => {
      const out = recorder.stop(performance.now());
      $('romRecordBtn').disabled = false;
      $('romRecordProgress').hidden = true;
      if (!out || out.n < 3) {
        $('statusMsg').textContent = t(lang, 'poseLost');
        return;
      }
      beep(1320, 250);
      finishROM(out);
    }, 3000);
  };
}
function finishROM(out) {
  session = null;
  $('statusMsg').textContent = t(lang, 'testDone');
  const deg = (v) => (v === null ? '--' : Math.round(v) + '°');
  showResult(
    [
      { label: t(lang, 'side'), value: t(lang, out.side) },
      { label: t(lang, 'kneeFlexion') + ' · ' + t(lang, 'mean'), value: deg(out.meanKnee), big: true },
      { label: t(lang, 'kneeFlexion') + ' · ' + t(lang, 'peak'), value: deg(out.peakKnee) },
      { label: t(lang, 'hipFlexion') + ' · ' + t(lang, 'mean'), value: deg(out.meanHip) },
      { label: t(lang, 'hipFlexion') + ' · ' + t(lang, 'peak'), value: deg(out.peakHip) },
    ],
    {
      side: out.side,
      meanKnee: out.meanKnee === null ? null : +out.meanKnee.toFixed(1),
      peakKnee: out.peakKnee === null ? null : +out.peakKnee.toFixed(1),
      meanHip: out.meanHip === null ? null : +out.meanHip.toFixed(1),
      peakHip: out.peakHip === null ? null : +out.peakHip.toFixed(1),
    }
  );
}

// --- shared result display ---
let pendingResult = null;
function showResult(rows, metrics) {
  hidePanels();
  $('resultPanel').hidden = false;
  const body = $('resultBody');
  body.innerHTML = '';
  for (const row of rows) {
    const div = document.createElement('div');
    div.className = 'result-row';
    const spanL = document.createElement('span');
    spanL.textContent = row.label;
    const spanV = document.createElement('b');
    spanV.textContent = String(row.value);
    if (row.big) spanV.className = 'big';
    div.append(spanL, spanV);
    body.append(div);
  }
  pendingResult = metrics;
}

// ---------- saving ----------
function saveResult() {
  if (!pendingResult) return;
  const record = {
    id: Date.now(),
    ts: new Date().toISOString(),
    participant: $('participantId').value.trim() || '—',
    test: currentTest,
    trial: +$('trialSelect').value,
    model: $('modelSelect').value,
    metrics: pendingResult,
  };
  results.push(record);
  persistResults();
  renderResultsTable();
  $('statusMsg').textContent = t(lang, 'resultsSaved');
  pendingResult = null;
  $('resultPanel').hidden = true;
  // next trial ready: advance the trial selector for the same participant
  const trialSel = $('trialSelect');
  trialSel.value = String(Math.min(3, (+trialSel.value) + 1));
  if (currentTest === 'rom') {
    startROM();
  } else {
    $('primaryBtn').hidden = false;
    $('primaryBtn').disabled = false;
    $('primaryBtn').textContent = t(lang, 'start');
    $('primaryBtn').onclick = null;
    startCalibration();
  }
}

// ---------- results table + export ----------
const TEST_KEYS = { sts: 'stsName', tug: 'tugName', rom: 'romName' };
function summarize(r) {
  const m = r.metrics || {};
  if (r.test === 'sts') return t(lang, 'standUps') + ': ' + m.standUps;
  if (r.test === 'tug') return m.totalSec + ' s' + (m.auto ? '' : ' · ' + t(lang, 'manualNote'));
  if (r.test === 'rom') {
    return (m.side ? t(lang, m.side) + ' · ' : '') + t(lang, 'kneeFlexion') + ' ' + (m.meanKnee ?? '--') + '°';
  }
  return '';
}
function renderResultsTable() {
  const body = $('resultsBody');
  body.innerHTML = '';
  const has = results.length > 0;
  $('resultsEmpty').hidden = has;
  $('resultsTable').hidden = !has;
  for (const r of [...results].reverse()) {
    const tr = document.createElement('tr');
    for (const v of [r.participant, t(lang, TEST_KEYS[r.test] || r.test), r.trial, summarize(r)]) {
      const td = document.createElement('td');
      td.textContent = v;
      tr.append(td);
    }
    body.append(tr);
  }
}

function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function exportJSON() {
  if (!results.length) return;
  download('physiopose_results.json', JSON.stringify(results, null, 2), 'application/json');
}
function exportCSV() {
  if (!results.length) return;
  const head = 'participant,test,trial,timestamp,model,metric1,metric2,metric3,metric4,metric5';
  const lines = [head];
  for (const r of results) {
    const m = r.metrics || {};
    const cells = [r.participant, r.test, r.trial, r.ts, r.model];
    if (r.test === 'sts') cells.push(m.standUps, m.cycles, m.durationSec, '', '');
    else if (r.test === 'tug') cells.push(m.totalSec, m.transferSec ?? '', m.auto ? 'auto' : 'manual', '', '');
    else cells.push(m.side, m.meanKnee ?? '', m.peakKnee ?? '', m.meanHip ?? '', m.peakHip ?? '');
    lines.push(cells.map((c) => (c === null || c === undefined ? '' : String(c))).join(','));
  }
  download('physiopose_results.csv', lines.join('\n'), 'text/csv');
}
function clearResults() {
  if (!confirm(t(lang, 'clear') + '?')) return;
  results = [];
  persistResults();
  renderResultsTable();
}

// ---------- events ----------
$('langSelect').addEventListener('change', (e) => {
  lang = e.target.value;
  localStorage.setItem(LS_LANG, lang);
  applyLang();
});

// Wake locks auto-release when the tab is hidden; re-acquire while testing.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('test').hidden) requestWakeLock();
});

document.querySelectorAll('.test-card').forEach((btn) => {
  btn.addEventListener('click', () => enterTest(btn.dataset.test));
});

$('backBtn').addEventListener('click', exitTest);
$('flipBtn').addEventListener('click', async () => {
  facingMode = facingMode === 'environment' ? 'user' : 'environment';
  stopCamera();
  try { await openCamera(); }
  catch {
    facingMode = facingMode === 'environment' ? 'user' : 'environment';
    openCamera().catch(() => {});
  }
});

$('primaryBtn').addEventListener('click', () => {
  if (!window.calibReady || currentTest === 'rom') return;
  $('primaryBtn').disabled = true;
  if (currentTest === 'sts') runSTS();
  else if (currentTest === 'tug') runTUG();
});

$('saveBtn').addEventListener('click', saveResult);
$('exportJson').addEventListener('click', exportJSON);
$('exportCsv').addEventListener('click', exportCSV);
$('clearResults').addEventListener('click', clearResults);

// PWA
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

applyLang();

// Direct entry: ?test=sts|tug|rom jumps straight into a test (bookmark-friendly).
const qsTest = new URLSearchParams(location.search).get('test');
if (qsTest && ['sts', 'tug', 'rom'].includes(qsTest)) enterTest(qsTest);

// Test/demo hook: with ?demo, automated tests (test/e2e_*.mjs) and offline
// demos can feed synthetic landmarks straight into the active test flow.
if (new URLSearchParams(location.search).has('demo')) {
  window.__physioDemo = {
    feed(lms, ts) {
      drawSkeleton(lms);
      if (session && session.onPose) session.onPose(lms, ts ?? performance.now());
    },
  };
}
