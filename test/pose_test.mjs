// Smoke tests for the pure measurement logic. Run: node test/pose_test.mjs
import assert from 'node:assert/strict';
import { angle2, kneeFlexionPx, hipFlexionPx, hipHeightRatio, median, sideMeasures } from '../js/pose_math.js';
import { createSTSDetector, createSTSTest } from '../js/sts_detector.js';
import { createTUG } from '../js/tug.js';
import { createROMRecorder } from '../js/rom.js';

// --- geometry ---
assert.equal(angle2([1, 0], [0, 0], [0, 1]), 90, 'right angle is 90 deg');
assert.ok(Math.abs(angle2([-1, 0], [0, 0], [1, 0]) - 180) < 1e-6, 'straight line is 180 deg');

// straight leg: hip(0,0) knee(0,-50) ankle(0,-100) -> flexion 0
assert.ok(Math.abs(kneeFlexionPx([0, 0], [0, -50], [0, -100])) < 1e-6, 'knee extension = 0 flexion');
// bent knee: hip(0,0) knee(50,0) ankle(50,50) -> flexion 90
assert.ok(Math.abs(kneeFlexionPx([0, 0], [50, 0], [50, 50]) - 90) < 1e-6, '90-deg knee flexion');
// hip: shoulder above hip, knee forward -> hip flexion 90
assert.ok(Math.abs(hipFlexionPx([0, -50], [0, 0], [50, 0]) - 90) < 1e-6, '90-deg hip flexion');

assert.equal(median([3, 1, 2]), 2, 'median odd');
assert.equal(median([1, 4, 2, 3]), 2.5, 'median even');

// hipHeightRatio with synthetic normalized landmarks (w=h=1000)
function lm(x, y, v = 1) { return { x, y, z: 0, visibility: v }; }
function makePose(hipY, ankY, shoY = 0.25) {
  const lms = Array(33).fill(null);
  [11, 12].forEach((i) => (lms[i] = lm(0.5, shoY)));
  [23, 24].forEach((i) => (lms[i] = lm(0.5, hipY)));
  [25, 26].forEach((i) => (lms[i] = lm(0.5, (hipY + ankY) / 2)));
  [27, 28].forEach((i) => (lms[i] = lm(0.5, ankY)));
  return lms;
}
const stand = hipHeightRatio(makePose(0.42, 0.92), 1000, 1000);
const seated = hipHeightRatio(makePose(0.66, 0.92), 1000, 1000);
assert.ok(stand > seated, `standing ratio (${stand}) exceeds seated (${seated})`);
assert.ok(stand > 1.0, 'standing ratio above 1');

// sideMeasures with visible joints
const side = sideMeasures(makePose(0.42, 0.92), 'left', 1000, 1000);
assert.ok(side && side.knee !== null && side.hip !== null, 'side measures computed');

// --- STS detector ---
{
  const det = createSTSDetector();
  det.calibrate(seated, stand);
  let r = det.update(seated, 0);
  assert.equal(r.state, 'seated', 'starts seated');
  // brief noise spike above threshold must not fire (dwell not met)
  r = det.update(stand, 50);
  assert.equal(r.event, null, 'no event before dwell');
  r = det.update(stand, 300);
  assert.equal(r.event, 'stand', 'stand event after dwell');
  // immediate sit attempt within minGap is ignored until gap passes
  r = det.update(seated, 400);
  assert.equal(r.event, null, 'no sit within min gap');
  r = det.update(seated, 1000);
  assert.equal(r.event, 'sit', 'sit event after gap+dwell');
}

// --- STS 30s test: 5 full cycles over 30 s ---
{
  const test = createSTSTest(30);
  test.start(0, seated, stand);
  const cycle = 3000; // one sit-stand-sit every 6 s (3 s per phase)
  let last = null;
  for (let t = 0; t <= 30000; t += 50) {
    const ph = Math.floor(t / cycle) % 2 === 0 ? 0 : 1; // 0 seated, 1 standing
    const f = ph === 0 ? seated : stand;
    last = test.update(f, t);
  }
  assert.equal(last.done, true, 'test completes at 30 s');
  assert.equal(last.standUps, 5, '5 stand-ups counted');
  assert.equal(last.cycles, 4, '4 complete cycles (5th sit lands after 30 s)');
}

// --- TUG: go -> stand (event at 1.3 s after dwell) -> sit -> total 10.0 s ---
{
  const tug = createTUG();
  tug.arm(0, seated, stand);
  tug.go(500);
  tug.update(seated, 600);
  tug.update(stand, 1000);
  let s = tug.update(stand, 1300);
  assert.equal(s.phase, 'running', 'running after stand');
  tug.update(seated, 11000);
  s = tug.update(seated, 11300);
  assert.equal(s.phase, 'done', 'done after final sit');
  assert.ok(Math.abs(s.total - 10) < 0.01, 'total = 10 s');
  assert.ok(Math.abs(s.transfer - 0.8) < 0.01, 'transfer = 0.8 s');
}

// --- TUG manual fallback ---
{
  const tug = createTUG();
  tug.arm(0, seated, stand);
  tug.manualStart(1000);
  tug.manualStop(13000);
  const s = tug.status();
  assert.equal(s.phase, 'done', 'manual stop ends test');
  assert.ok(Math.abs(s.total - 12) < 0.01, 'manual total');
  assert.equal(s.auto, false, 'flagged as manual');
}

// --- ROM recorder ---
{
  const rec = createROMRecorder({ windowMs: 3000 });
  rec.start(0);
  for (let i = 0; i < 30; i++) rec.add(i * 100, 88 + (i % 3), 55 + (i % 2), 'right');
  const out = rec.stop(3000);
  assert.ok(out, 'recorder returns result');
  assert.equal(out.peakKnee, 90, 'peak tracked');
  assert.equal(out.meanKnee, 89, 'median of [88,89,90,...]');
  assert.equal(out.side, 'right', 'side reported');
}

console.log('All pose logic tests passed.');
