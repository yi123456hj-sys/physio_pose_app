// cdp_util.mjs — minimal CDP plumbing shared by the browser tests.
// Launches a headless Edge with a fake camera, connects over WebSocket,
// and exposes send/evaluate/waitFor helpers.
import { spawn } from 'node:child_process';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

export async function launchEdge(port) {
  const profile = `${process.env.TEMP}\\edge_cdp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--no-first-run', '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      target = list.find((t) => t.type === 'page');
    } catch { await sleep(500); }
  }
  if (!target) throw new Error('Edge debugging endpoint never came up');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let msgId = 0;
  const pending = new Map();
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

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  const waitFor = async (expression, timeoutMs, label) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (await evaluate(expression)) return true;
      await sleep(500);
    }
    throw new Error(`timeout waiting for: ${label}`);
  };

  await send('Runtime.enable');
  await send('Page.enable');
  return { profile, edge, ws, send, evaluate, waitFor, sleep, consoleErrors, exceptions };
}

export async function closeEdge(c) {
  try { await c.send('Browser.close'); } catch {}
  try { c.ws.close(); } catch {}
  c.edge.kill();
}

// Opens the app with fake camera + demo hook. c.navigate(url) then waits.
export async function openApp(c, url, { waitPanel = 'calib' } = {}) {
  await c.send('Page.navigate', { url });
  await c.sleep(1500);
  await c.waitFor(`document.getElementById('loadingMask').hidden === true`, 180000, 'model load');
  if (waitPanel === 'rom') {
    await c.waitFor(`document.getElementById('romPanel').hidden === false`, 15000, 'rom panel');
  } else {
    await c.waitFor(`document.getElementById('calibPanel').hidden === false`, 15000, 'calib panel');
  }
}
