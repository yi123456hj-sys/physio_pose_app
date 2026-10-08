# start_tunnel.ps1 - serve physio_pose_app to phones over an HTTPS tunnel.
# Camera access on phones requires HTTPS, which a Cloudflare quick tunnel provides.
# Requirements: python and cloudflared (winget install Cloudflare.cloudflared).
# Usage:  powershell -ExecutionPolicy Bypass -File .\start_tunnel.ps1
# A QR code opens automatically; scan it with the phone, then Ctrl+C here to stop.

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# 1. Local static server on :8000 (left running if one is already up).
if (-not (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue)) {
  Write-Host 'Starting local server on http://localhost:8000 ...'
  Start-Process python -ArgumentList '-m', 'http.server', '8000' -WindowStyle Hidden
  Start-Sleep -Seconds 2
}

# 2. cloudflared quick tunnel (a new random URL is issued on every start).
# A freshly-installed cloudflared may not be on this shell's PATH yet.
$cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cloudflared -and (Test-Path "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe")) {
  $cloudflared = "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe"
}
if (-not $cloudflared) {
  Write-Host 'cloudflared not found. Install it with: winget install Cloudflare.cloudflared'
  exit 1
}
Write-Host 'Starting HTTPS tunnel, this can take a few seconds ...'
$log = Join-Path $env:TEMP 'physio_cloudflared.log'
$err = Join-Path $env:TEMP 'physio_cloudflared.err.log'
Remove-Item $log, $err -ErrorAction SilentlyContinue
$cf = Start-Process $cloudflared -ArgumentList 'tunnel', '--url', 'http://localhost:8000', '--no-autoupdate' -RedirectStandardOutput $log -RedirectStandardError $err -WindowStyle Hidden -PassThru

# 3. Wait for the public URL to appear in the logs.
$url = $null
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 1
  $found = Get-Content $log, $err -ErrorAction SilentlyContinue |
    Select-String -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
  if ($found) { $url = $found.Matches[0].Value; break }
}
if (-not $url) {
  Write-Host 'Tunnel failed to start. Log output:'
  Get-Content $log, $err -ErrorAction SilentlyContinue
  Stop-Process -Id $cf.Id -Force -ErrorAction SilentlyContinue
  exit 1
}

# 4. QR code so phones can just scan the URL.
$qr = Join-Path $PSScriptRoot 'tunnel_qr.png'
try {
  python -m pip install --quiet qrcode pillow
  python -c "import qrcode; qrcode.make(r'$url').save(r'$qr')"
  Start-Process $qr
  Write-Host 'A QR code image should have opened; scan it with the phone camera.'
} catch {
  Write-Host 'Could not generate the QR code; type the URL into the phone manually.'
}

Write-Host ''
Write-Host '================================================'
Write-Host "  Phone URL: $url"
Write-Host '  New URL on every start; phones need internet.'
Write-Host '  Press Ctrl+C to stop the tunnel.'
Write-Host '================================================'

# Stay alive until Ctrl+C; the finally block kills cloudflared.
try { Wait-Process -Id $cf.Id } finally { Stop-Process -Id $cf.Id -Force -ErrorAction SilentlyContinue }
