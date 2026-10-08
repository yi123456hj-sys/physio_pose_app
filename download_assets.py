# Downloads the MediaPipe vision bundle, WASM runtime, and the three pose
# models into the project folder so the app runs fully offline.
# Run once from the project directory:  python download_assets.py
import os
import sys
import urllib.request

BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14'

FILES = {
    'js/vision_bundle.mjs': BASE + '/vision_bundle.mjs',
    'wasm/vision_wasm_internal.js': BASE + '/wasm/vision_wasm_internal.js',
    'wasm/vision_wasm_internal.wasm': BASE + '/wasm/vision_wasm_internal.wasm',
    'wasm/vision_wasm_nosimd_internal.js': BASE + '/wasm/vision_wasm_nosimd_internal.js',
    'wasm/vision_wasm_nosimd_internal.wasm': BASE + '/wasm/vision_wasm_nosimd_internal.wasm',
    'models/pose_landmarker_full.task': 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
    'models/pose_landmarker_lite.task': 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
    'models/pose_landmarker_heavy.task': 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
}


def progress(block, block_size, total):
    done = block * block_size
    if total > 0:
        sys.stdout.write('\r  %d%%' % min(100, done * 100 // total))
        sys.stdout.flush()


ok = True
for path, url in FILES.items():
    if os.path.exists(path):
        print('skip (exists)  ', path)
        continue
    os.makedirs(os.path.dirname(path), exist_ok=True)
    print('download      ', url)
    try:
        urllib.request.urlretrieve(url, path, progress)
        print('  ->', path)
    except Exception as e:
        ok = False
        print('  FAILED:', e)
        try:
            os.remove(path)
        except OSError:
            pass

print('done' if ok else 'done with errors — rerun to retry failed files')
print('The app will now load everything locally (no internet needed while testing).')
