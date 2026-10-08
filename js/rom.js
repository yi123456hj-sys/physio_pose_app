// rom.js — range-of-motion recording logic. Pure, no DOM.
//
// While the participant holds an end-range position, samples are collected
// over a short window. The recorder returns the median (stable) angle and
// the peak reached during the window; the median is the value compared with
// the goniometer.

import { median } from './pose_math.js';

export function createROMRecorder({ windowMs = 3000 } = {}) {
  let recording = false, t0 = 0;
  let samples = [];           // {t, knee, hip, side}
  let peakKnee = null, peakHip = null;

  function start(t) {
    recording = true; t0 = t; samples = [];
    peakKnee = null; peakHip = null;
  }

  function add(t, knee, hip, side) {
    if (!recording) return;
    samples.push({ t, knee, hip, side });
    peakKnee = peakKnee === null ? knee : Math.max(peakKnee, knee);
    peakHip = peakHip === null ? hip : Math.max(peakHip, hip);
  }

  function stop(t) {
    recording = false;
    const win = samples.filter((s) => t - s.t <= windowMs + 500);
    if (!win.length) return null;
    return {
      meanKnee: median(win.map((s) => s.knee)),
      meanHip: median(win.map((s) => s.hip)),
      peakKnee, peakHip,
      n: win.length,
      durMs: win[win.length - 1].t - win[0].t,
      side: win[win.length - 1].side,
    };
  }

  function isRecording() { return recording; }
  return { start, add, stop, isRecording };
}
