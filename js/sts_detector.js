// sts_detector.js — sit-to-stand state machine and the 30-second STS test.
// Pure logic, no DOM; unit-testable under Node.

// createSTSDetector: thresholds come from a two-phase calibration
// (seated hold, standing hold). Hysteresis + dwell time + minimum interval
// between events suppress jitter from pose estimation noise.
export function createSTSDetector({ dwellMs = 250, minGapMs = 600 } = {}) {
  let state = 'unknown'; // unknown | seated | standing
  let pending = null;    // {target, since}
  let lastEventT = -Infinity;
  let lo = null, hi = null;

  function calibrate(seatedVal, standingVal) {
    if (!(standingVal > seatedVal)) throw new Error('calibration: standing value must exceed seated value');
    const mid = (seatedVal + standingVal) / 2;
    const margin = Math.max(0.1 * (standingVal - seatedVal), 0.02);
    lo = mid - margin;
    hi = mid + margin;
    state = 'unknown';
    pending = null;
    lastEventT = -Infinity;
  }

  function reset() {
    state = 'unknown';
    pending = null;
  }

  function update(f, t) {
    if (lo === null || f === null || f === undefined) return { state, event: null };
    if (state === 'unknown') {
      if (f > hi) state = 'standing';
      else if (f < lo) state = 'seated';
      return { state, event: null };
    }
    let target = null;
    if (state === 'seated' && f > hi) target = 'standing';
    else if (state === 'standing' && f < lo) target = 'seated';
    if (!target) { pending = null; return { state, event: null }; }
    if (!pending || pending.target !== target) { pending = { target, since: t }; return { state, event: null }; }
    if (t - pending.since >= dwellMs && t - lastEventT >= minGapMs) {
      const ev = target === 'standing' ? 'stand' : 'sit';
      state = target;
      pending = null;
      lastEventT = t;
      return { state, event: ev };
    }
    return { state, event: null };
  }

  return { update, calibrate, reset, get state() { return state; }, thresholds() { return { lo, hi }; } };
}

// createSTSTest: 30-second sit-to-stand. Primary metric is the number of
// stand-ups; complete sit-stand-sit cycles are also reported.
export function createSTSTest(durationSec = 30) {
  const det = createSTSDetector();
  let running = false, t0 = 0, standUps = 0, cycles = 0;

  function start(t, seatedVal, standingVal) {
    det.calibrate(seatedVal, standingVal);
    det.reset();
    running = true; t0 = t; standUps = 0; cycles = 0;
  }

  // f = sit/stand feature (e.g. hipHeightRatio), t = ms timestamp.
  function update(f, t) {
    if (!running) return { done: false };
    const { state, event } = det.update(f, t);
    if (event === 'stand') standUps += 1;
    if (event === 'sit') cycles += 1;
    const elapsed = (t - t0) / 1000;
    return { done: elapsed >= durationSec, elapsed, standUps, cycles, state };
  }

  return { update, start };
}
