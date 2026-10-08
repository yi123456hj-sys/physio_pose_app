// smoke_cdp.mjs — drives a headless Edge via CDP and verifies the test-screen flow.
// Usage: node test/smoke_cdp.mjs [port]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const PORT = process.argv[2] || '9223';
const TEST = process.argv[3] || 'sts';
const PROFILE = `${process.env.TEMP}\\edge_smoke_profile_${Date.now()}`;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  '--no-first-run', '--no-default-browser-check',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch {}
    await sleep(500);
  }
  throw new Error('Edge debugging endpoint never came up');
}

let msgId = 0;
const pending = new Map();
let ws;

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true });
  if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

async function waitFor(expression, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await evaluate(expression)) return true;
    await sleep(500);
  }
  throw new Error(`timeout waiting for: ${label}`);
}

try {
  const target = await getTarget();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  const consoleErrors = [];
  const exceptions = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push(m.params.args.map((a) => a.value || a.description || '').join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      exceptions.push(m.params.exceptionDetails.text || 'exception');
    }
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:8000/index.html?test=${TEST}` });
  await sleep(1500);

  const modelLoaded = await waitFor(
    `document.getElementById('loadingMask').hidden === true`, 180000, 'model load'
  );
  const panelShown = await waitFor(
    TEST === 'rom'
      ? `document.getElementById('romPanel').hidden === false`
      : `document.getElementById('calibPanel').hidden === false`,
    15000, 'test panel'
  );
  await sleep(3000); // let the pose loop run a few frames

  const state = await evaluate(`({
    testScreen: !document.getElementById('test').hidden,
    homeHidden: document.getElementById('home').hidden,
    modelLoaded: ${JSON.stringify(modelLoaded)},
    panelShown: ${JSON.stringify(panelShown)},
    romRecordBtnDisabled: document.getElementById('romRecordBtn').disabled,
    primaryDisabled: document.getElementById('primaryBtn').disabled,
    primaryHidden: document.getElementById('primaryBtn').hidden,
    primaryText: document.getElementById('primaryBtn').textContent,
    videoWidth: document.getElementById('video').videoWidth,
    overlayW: document.getElementById('overlay').width,
    status: document.getElementById('statusMsg').textContent,
    calibCount: document.getElementById('calibCount').textContent,
    poseLostShown: !document.getElementById('poseLost').hidden,
  })`);
  state.consoleErrors = consoleErrors.slice(0, 5);
  state.exceptions = exceptions.slice(0, 5);
  console.log(JSON.stringify(state, null, 2));

  const pass = state.modelLoaded && state.panelShown &&
    state.videoWidth > 0 && state.exceptions.length === 0;
  console.log(pass ? 'SMOKE PASS' : 'SMOKE FAIL');
  process.exitCode = pass ? 0 : 1;
} catch (e) {
  console.error('SMOKE ERROR:', e.message);
  process.exitCode = 2;
} finally {
  try { await send('Browser.close'); } catch {}
  try { ws && ws.close(); } catch {}
  edge.kill();
}
