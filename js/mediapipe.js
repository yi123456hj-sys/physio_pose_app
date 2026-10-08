// mediapipe.js — loads the MediaPipe PoseLandmarker (browser-side WASM,
// no data leaves the device) and wraps detection in a simple API.

const VISION_BUNDLE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODELS = {
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  lite: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  heavy: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
};

async function localAssetAvailable() {
  try {
    const r = await fetch('wasm/vision_wasm_internal.js', { method: 'HEAD' });
    return r.ok;
  } catch {
    return false;
  }
}

export async function loadPose(modelId = 'full', onProgress = null) {
  onProgress && onProgress('loading-library');
  // Offline mode: if download_assets.py has vendored the bundle, WASM and
  // models into this project, load everything locally instead of from CDNs.
  const local = await localAssetAvailable();
  const { FilesetResolver, PoseLandmarker } = await import(local ? './vision_bundle.mjs' : VISION_BUNDLE);
  onProgress && onProgress('loading-wasm');
  const fileset = await FilesetResolver.forVisionTasks(local ? 'wasm/' : WASM_BASE);
  const baseOptions = {
    modelAssetPath: local ? `models/pose_landmarker_${modelId}.task` : (MODELS[modelId] || MODELS.full),
  };
  const common = {
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  };
  onProgress && onProgress('loading-model');
  try {
    return await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { ...baseOptions, delegate: 'GPU' }, ...common,
    });
  } catch (e) {
    // GPU delegate unavailable (common on some phones) -> CPU fallback
    return await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { ...baseOptions, delegate: 'CPU' }, ...common,
    });
  }
}

// detect(video, tsMs) -> array of poses ({landmarks, worldLandmarks}) or [].
// PoseLandmarker returns poses[0].landmarks as 33 {x,y,z,visibility}.
export function detectPose(landmarker, video, tsMs) {
  const res = landmarker.detectForVideo(video, tsMs);
  return res && res.landmarks && res.landmarks.length ? res.landmarks[0] : null;
}
