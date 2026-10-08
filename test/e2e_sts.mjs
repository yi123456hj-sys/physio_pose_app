// e2e_sts.mjs — full end-to-end STS flow with synthetic poses through the
// real UI: calibration -> 3-2-1 countdown -> 30 s run -> result -> save.
// Usage: node test/e2e_sts.mjs
import { launchEdge, closeEdge, openApp } from './cdp_util.mjs';

const c = await launchEdge('9230');
const pass = async (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) process.exitCode = 1;
};

try {
  await openApp(c, 'http://127.0.0.1:8000/index.html?test=sts&demo');

  // synthetic pose builder in the page context
  await c.evaluate(`
    window.__mk = (hipY) => {
      const lms = Array(33).fill(null);
      for (let i = 0; i < 33; i++) lms[i] = { x: 0.5, y: 0.5, z: 0, visibility: 1 };
      [11, 12].forEach((i) => (lms[i] = { x: 0.5, y: 0.25, z: 0, visibility: 1 }));
      [23, 24].forEach((i) => (lms[i] = { x: 0.5, y: hipY, z: 0, visibility: 1 }));
      [25, 26].forEach((i) => (lms[i] = { x: 0.5, y: (hipY + 0.92) / 2, z: 0, visibility: 1 }));
      [27, 28].forEach((i) => (lms[i] = { x: 0.5, y: 0.92, z: 0, visibility: 1 }));
      return lms;
    };
  `);

  // calibration: seated 3.4 s, then standing 3.4 s (ts injected)
  const t0 = await c.evaluate('performance.now()');
  await c.evaluate(`((t0) => { for (let i = 0; i < 34; i++) __physioDemo.feed(__mk(0.66), t0 + i * 100); })(${t0})`);
  await c.evaluate(`((t0) => { for (let i = 0; i < 35; i++) __physioDemo.feed(__mk(0.42), t0 + 3600 + i * 100); })(${t0})`);

  const calibReady = await c.evaluate(`window.calibReady === true`);
  const btnEnabled = await c.evaluate(`!document.getElementById('primaryBtn').disabled`);
  await pass(calibReady && btnEnabled, 'calibration completes, start button enabled');

  // start: 3-2-1 countdown then the 30 s clock
  await c.evaluate(`document.getElementById('primaryBtn').click()`);
  const S = await c.evaluate('performance.now()');
  await c.evaluate(`((S) => { for (let i = 0; i < 31; i++) __physioDemo.feed(__mk(0.66), S + i * 100); })(${S})`);
  const hudShowsGo = await c.evaluate(`document.getElementById('hudMain').textContent`);
  await pass(hudShowsGo !== '3' && hudShowsGo !== '2' && hudShowsGo !== '1', 'countdown reached GO (hud shows: ' + hudShowsGo + ')');

  // 30 s of sit-stand cycles (1.5 s per phase)
  await c.evaluate(`((S) => {
    let t = S + 3200;
    for (let k = 0; k < 10; k++) {
      for (let i = 0; i < 15; i++) { __physioDemo.feed(__mk(0.66), t); t += 100; }
      for (let i = 0; i < 15; i++) { __physioDemo.feed(__mk(0.42), t); t += 100; }
    }
  })(${S})`);

  const hud = await c.evaluate(`document.getElementById('hudMain').textContent`);
  const resultShown = await c.evaluate(`!document.getElementById('resultPanel').hidden`);
  const standUps = +hud;
  await pass(resultShown, 'result panel appears after 30 s');
  await pass(standUps >= 9, `stand-ups counted correctly (hud: ${hud}, expected ~10)`);

  // save -> results table + localStorage + trial auto-increment
  await c.evaluate(`document.getElementById('saveBtn').click()`);
  const saved = await c.evaluate(`JSON.parse(localStorage.getItem('physiopose.results') || '[]')`);
  const rows = await c.evaluate(`document.querySelectorAll('#resultsBody tr').length`);
  const trial = await c.evaluate(`document.getElementById('trialSelect').value`);
  await pass(saved.length === 1 && saved[0].test === 'sts' && typeof saved[0].metrics.standUps === 'number', 'record saved with sts metrics');
  await pass(rows === 1, 'results table shows one row');
  await pass(trial === '2', 'trial selector advanced to 2');

  console.log('console errors:', JSON.stringify(c.consoleErrors.slice(0, 3)));
  console.log('exceptions:', JSON.stringify(c.exceptions.slice(0, 3)));
  await pass(c.exceptions.length === 0, 'no uncaught exceptions');
} catch (e) {
  console.error('E2E ERROR:', e.message);
  process.exitCode = 1;
} finally {
  await closeEdge(c);
}
