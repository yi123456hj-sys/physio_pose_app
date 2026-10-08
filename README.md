# PhysioPose Assess

Browser-based pose estimation (MediaPipe) for automatic assessment of physiotherapy
functional tests: 30-second sit-to-stand counting, Timed Up and Go timing, and
knee/hip flexion range-of-motion measurement.

All processing runs locally in the browser via WebAssembly. No video or image is
ever recorded, stored, or transmitted. Built as the measurement tool for a
concurrent-validity and reliability study against therapist-administered gold
standards (manual counting, stopwatch, goniometer).

## Requirements

- A browser with webcam access: current Chrome or Edge on desktop, Chrome on Android, Safari on iOS.
- A secure context: `https://` or `localhost`. Camera access is blocked on plain `http://` except localhost.
- Internet connection on first use, unless the assets are vendored locally (see Offline use below).

## Offline use (recommended for data collection)

Run `python download_assets.py` once to download the MediaPipe bundle, WASM
runtime, and the three pose models into this project (about 60 MB). The app
then detects the local copies and loads everything from the same server, so
data-collection sessions need no internet at all.

## Run locally

```powershell
cd C:\Users\HP\physio_pose_app
python -m http.server 8000
```

Then open http://localhost:8000.

## Use on phones (HTTPS tunnel)

Camera access on phones requires HTTPS, which a Cloudflare quick tunnel provides:

```powershell
cd C:\Users\HP\physio_pose_app
.\start_tunnel.ps1
```

The script starts the local server (if needed), opens a tunnel, and pops up a QR
code. Scan it with the phone (any recent iPhone, Samsung or Huawei browser works)
and the app loads from the phone's own camera. Ctrl+C stops the tunnel.

Notes:

- The phone URL is new on every tunnel start; re-scan the QR each session.
- Phones need internet access (the tunnel goes through Cloudflare's edge);
  the app itself still runs and measures fully in the phone's browser.
- Install-to-home-screen does not survive across sessions because the origin
  changes with each tunnel URL. For a fixed URL later, deploy to GitHub Pages
  (below) — the app is identical.
- One-time setup: `winget install Cloudflare.cloudflared` and
  `pip install qrcode pillow`.

## Deploy (GitHub Pages)

Push this folder to a repository and enable Pages (root or `docs/`). Everything
is static; no build step. The app is a PWA: on a phone, "Add to home screen"
installs it and the shell works offline.

## Measurement protocol (for study operators)

- Participant faces the camera for STS and TUG (front view), or stands in profile for ROM (side view).
- Full body from head to feet must be visible; 2.5 to 4 m from the camera works well.
- Chair: about 46 cm seat height, no armrests. Arms crossed on the chest during STS.
- Each test begins with a 3-second sit calibration and a 3-second stand calibration.
- STS starts with a 3-2-1 countdown so the participant begins from a quiet seated position.
- Record three trials per test; the trial selector advances automatically after each save.
- TUG: press Go once, walk 3 m at usual pace, turn around a marker, return, sit. Detection is automatic; the Stop button is a manual fallback and is flagged in the results.

## Data

Results are stored in the browser's localStorage under `physiopose.results` and can
be exported as JSON or CSV from the home screen. Clear the results at the end of
each data-collection session.

## Validation study

The accompanying study protocol lives in the local `docs/` folder only (research
plan, IRB application, OSF preregistration) — it is kept out of the public
repository via `.gitignore`. The study plans a concurrent-validity and
intra-rater reliability study in 30 to 40 healthy adults, comparing this tool with
physiotherapist-administered assessments, analyzed with ICC, Bland-Altman plots,
and Pearson/Spearman correlations.
