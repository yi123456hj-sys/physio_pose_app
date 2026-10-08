// tug.js — Timed Up and Go logic. Pure, no DOM.
//
// Phases: idle -> ready (calibrated, person seated) -> waiting (Go given)
//         -> running (stand detected) -> done (final sit detected).
// Total time = final sit - first stand. Transfer time = first stand - Go.
// Manual start/stop buttons in the UI override the automatic detection.

import { createSTSDetector } from './sts_detector.js';

export function createTUG() {
  const det = createSTSDetector();
  let phase = 'idle'; // idle | ready | waiting | running | done
  let tGo = 0, tStart = 0, tStop = 0, auto = true;

  function arm(t, seatedVal, standingVal) {
    det.calibrate(seatedVal, standingVal);
    det.reset();
    phase = 'ready'; tGo = 0; tStart = 0; tStop = 0; auto = true;
  }

  function go(t) {
    if (phase !== 'ready') return;
    tGo = t;
    phase = 'waiting';
  }

  function update(f, t) {
    if (phase === 'waiting' || phase === 'running') {
      const { event } = det.update(f, t);
      if (phase === 'waiting' && event === 'stand') { phase = 'running'; tStart = t; }
      else if (phase === 'running' && event === 'sit') { phase = 'done'; tStop = t; }
    }
    return status();
  }

  function manualStart(t) { // operator tap: force timing to start
    if (phase === 'ready' || phase === 'waiting') { phase = 'running'; tStart = t; if (!tGo) tGo = t; auto = false; }
  }

  function manualStop(t) { // operator tap: force timing to stop
    if (phase === 'running') { phase = 'done'; tStop = t; auto = false; }
  }

  function status() {
    const total = (phase === 'done') ? (tStop - tStart) / 1000 : null;
    const transfer = (phase === 'running' || phase === 'done') ? (tStart - tGo) / 1000 : null;
    return { phase, total, transfer, auto };
  }

  return { arm, go, update, manualStart, manualStop, status, det };
}
