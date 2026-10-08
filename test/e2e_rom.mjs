// e2e_rom.mjs — end-to-end ROM flow: live angles, 3 s record, result, save.
// Usage: node test/e2e_rom.mjs
import { launchEdge, closeEdge, openApp } from './cdp_util.mjs';

const c = await launchEdge('9231');
const pass = async (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) process.exitCode = 1;
};

try {
  await openApp(c, 'http://127.0.0.1:8000/index.html?test=rom&demo', { waitPanel: 'rom' });

  // side-view pose with a bent knee (left side visible)
  await c.evaluate(`
    window.__mkSide = () => {
      const lms = Array(33).fill(null);
      for (let i = 0; i < 33; i++) lms[i] = { x: 0.35, y: 0.5, z: 0, visibility: 1 };
      [11, 12].forEach((i) => (lms[i] = { x: 0.32, y: 0.15, z: 0, visibility: 1 }));
      [23, 24].forEach((i) => (lms[i] = { x: 0.32, y: 0.4, z: 0, visibility: 1 }));
      [25, 26].forEach((i) => (lms[i] = { x: 0.38, y: 0.62, z: 0, visibility: 1 }));
      [27, 28].forEach((i) => (lms[i] = { x: 0.32, y: 0.88, z: 0, visibility: 1 }));
      return lms;
    };
  `);

  // live angle display updates from a feed
  await c.evaluate(`__physioDemo.feed(__mkSide())`);
  await c.sleep(500);
  const kneeL = await c.evaluate(`document.getElementById('kneeL').textContent`);
  await pass(kneeL !== '--' && kneeL.endsWith('°'), `live knee angle shown (left: ${kneeL})`);

  // record for 3 s with feeds inside the window
  await c.evaluate(`document.getElementById('romRecordBtn').click()`);
  const t0 = await c.evaluate('performance.now()');
  await c.evaluate(`((t0) => { for (let i = 0; i < 20; i++) __physioDemo.feed(__mkSide(), t0 + i * 140); })(${t0})`);
  await c.sleep(3400); // let the 3 s window close and stop() run

  const resultShown = await c.evaluate(`!document.getElementById('resultPanel').hidden`);
  const body = await c.evaluate(`document.getElementById('resultBody').textContent`);
  await pass(resultShown, 'result panel appears after recording');
  await pass(body.includes('膝屈曲'), 'result shows knee flexion rows');

  await c.evaluate(`document.getElementById('saveBtn').click()`);
  const saved = await c.evaluate(`JSON.parse(localStorage.getItem('physiopose.results') || '[]')`);
  await pass(saved.length === 1 && saved[0].test === 'rom' && typeof saved[0].metrics.meanKnee === 'number', 'rom record saved with angle metrics');

  console.log('console errors:', JSON.stringify(c.consoleErrors.slice(0, 3)));
  console.log('exceptions:', JSON.stringify(c.exceptions.slice(0, 3)));
  await pass(c.exceptions.length === 0, 'no uncaught exceptions');
} catch (e) {
  console.error('E2E ERROR:', e.message);
  process.exitCode = 1;
} finally {
  await closeEdge(c);
}
