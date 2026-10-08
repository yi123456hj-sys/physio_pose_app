// pose_math.js — pure geometry for pose-based clinical measurements.
// No DOM dependencies; unit-testable under Node.

// MediaPipe Pose landmark indices used by the functional tests.
export const LM = {
  leftShoulder: 11, rightShoulder: 12,
  leftHip: 23, rightHip: 24,
  leftKnee: 25, rightKnee: 26,
  leftAnkle: 27, rightAnkle: 28,
};

// Landmark -> pixel coords. MediaPipe gives normalized [0..1] x/y and a z
// scaled to hip width; angles computed from normalized coords would be
// distorted unless the video is square, so convert to pixels first.
export function toPx(lm, w, h) {
  return [lm.x * w, lm.y * h];
}

// Mean visibility of the joints involved in a measurement.
export function vis(...lms) {
  if (lms.some((l) => !l)) return 0;
  return lms.reduce((s, l) => s + l.visibility, 0) / lms.length;
}

// Angle at B between A-B and B-C, in degrees (0..180). 2D (image plane).
export function angle2(A, B, C) {
  const v1x = A[0] - B[0], v1y = A[1] - B[1];
  const v2x = C[0] - B[0], v2y = C[1] - B[1];
  const dot = v1x * v2x + v1y * v2y;
  const cross = v1x * v2y - v1y * v2x;
  const n1 = Math.hypot(v1x, v1y), n2 = Math.hypot(v2x, v2y);
  if (n1 < 1e-6 || n2 < 1e-6) return null;
  return Math.abs(Math.atan2(cross, dot)) * 180 / Math.PI;
}

// Knee flexion angle in degrees: 0 = fully extended, ~90 = seated.
// Joint order: hip (proximal), knee (vertex), ankle (distal).
export function kneeFlexionPx(hip, knee, ankle) {
  const a = angle2(hip, knee, ankle);
  return a === null ? null : 180 - a;
}

// Hip flexion angle in degrees: 0 = trunk and thigh in line, 90 = thigh
// horizontal (seated). Joint order: shoulder, hip (vertex), knee.
export function hipFlexionPx(shoulder, hip, knee) {
  const a = angle2(shoulder, hip, knee);
  return a === null ? null : 180 - a;
}

// Per-side measurement bundle from raw landmarks. Returns null when the
// joints are not visible enough to trust the numbers.
export function sideMeasures(lms, side, w, h, minVis = 0.4) {
  const s = side === 'left' ? 'left' : 'right';
  const shoulder = lms[LM[s + 'Shoulder']];
  const hip = lms[LM[s + 'Hip']];
  const kneeJ = lms[LM[s + 'Knee']];
  const ankle = lms[LM[s + 'Ankle']];
  if (vis(shoulder, hip, kneeJ, ankle) < minVis) return null;
  const sh = toPx(shoulder, w, h), hp = toPx(hip, w, h);
  const kn = toPx(kneeJ, w, h), an = toPx(ankle, w, h);
  const knee = kneeFlexionPx(hp, kn, an);
  const hipF = hipFlexionPx(sh, hp, kn);
  if (knee === null || hipF === null) return null;
  return { side: s, knee, hip: hipF, visibility: vis(shoulder, hip, kneeJ, ankle) };
}

// Vertical hip height above the ankle plane, normalized by torso length.
// Robust to camera distance and person size; used as the sit/stand feature.
// Image y grows downward: ankle below hip -> ankY > hipY; hip below
// shoulder -> hipY > shoY. Standing: roughly 1.5-3. Seated on a standard
// chair: roughly 0.4-1.0.
export function hipHeightRatio(lms, w, h, minVis = 0.4) {
  const needs = [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip,
                 LM.leftKnee, LM.rightKnee, LM.leftAnkle, LM.rightAnkle];
  const got = needs.map((i) => lms[i]);
  if (got.some((l) => !l) || vis(...got) < minVis) return null;
  const shoY = ((lms[11].y + lms[12].y) / 2) * h;
  const hipY = ((lms[23].y + lms[24].y) / 2) * h;
  const ankY = ((lms[27].y + lms[28].y) / 2) * h;
  const torso = Math.max(hipY - shoY, 0.05 * h);
  return (ankY - hipY) / torso;
}

// Median of an array (mutates a copy).
export function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
