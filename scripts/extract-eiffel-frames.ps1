<#
  Eiffel Tower — Blueprint to Reality.

  Sources (in D2\Kie Api\):
    1.png   Standalone blueprint — white linework + engineering callouts on
            solid blue paper, portrait (880x1192).
    2.jpg   Dark editorial photograph — brass tower on black with dimension
            lines, portrait (756x1024).

  Steps:
    1) Fit each source into the 800x1080 canvas, preserving aspect with
       black padding (no cropping — both sources are already portrait).
    2) Synthesize a bloom frame from the blueprint by darkening the paper
       and crushing chroma so the white lines glow against near-black.
    3) Chain two 2.5s xfades through the bloom (blueprint -> bloom -> photo)
       so the transition flashes luminous at its midpoint, matching the
       Sagrada video's "lit from within" beat.
    4) Extract every frame as a JPG for the scroll-driven flipbook.

  Requires: ffmpeg on PATH. Falls back to cached bookend PNGs if the
  originals have moved.
#>

$ErrorActionPreference = 'Stop'

# Refresh PATH so ffmpeg (installed via winget) is visible to non-interactive shells.
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
            [System.Environment]::GetEnvironmentVariable('Path','User')

$root  = Split-Path -Parent $PSScriptRoot
$srcBlueprint = Join-Path $root 'Kie Api\1.png'   # standalone blueprint (start)
$srcPhoto     = Join-Path $root 'Kie Api\2.jpg'   # dark editorial photo (end)
$bookendsDir = Join-Path $root 'assets\eiffel'
$framesDir   = Join-Path $root 'assets\eiffel-frames'
$startPng = Join-Path $bookendsDir 'eiffel-start.png'
$endPng   = Join-Path $bookendsDir 'eiffel-end.png'
$bloomPng = Join-Path $bookendsDir 'eiffel-bloom.png'
$videoOut = Join-Path $bookendsDir 'eiffel-transition.mp4'
$framePat = Join-Path $framesDir   'frame_%03d.jpg'

New-Item -ItemType Directory -Force -Path $bookendsDir, $framesDir | Out-Null
Get-ChildItem $framesDir -Filter 'frame_*.jpg' -ErrorAction SilentlyContinue | Remove-Item -Force

# 1a) Start frame: fit 1.png into 800x1080, preserving aspect with black
#     padding. The new 1.png is a standalone blueprint (no side-by-side),
#     so no cropping needed.
if (Test-Path $srcBlueprint) {
  & ffmpeg -y -loglevel error -i $srcBlueprint `
    -vf 'scale=800:1080:flags=lanczos:force_original_aspect_ratio=decrease,pad=800:1080:(ow-iw)/2:(oh-ih)/2:black' `
    $startPng
  if ($LASTEXITCODE -ne 0) { throw "ffmpeg (start fit) exited $LASTEXITCODE" }
  Write-Host "Wrote $startPng (from 1.png)"
} elseif (Test-Path $startPng) {
  Write-Host "Using cached $startPng (1.png not present)"
} else {
  throw "Neither $srcBlueprint nor cached $startPng found"
}

# 1b) End frame: fit 2.jpg into 800x1080 if the original is on disk; otherwise
#     reuse the cached file.
if (Test-Path $srcPhoto) {
  & ffmpeg -y -loglevel error -i $srcPhoto `
    -vf 'scale=800:1080:flags=lanczos:force_original_aspect_ratio=decrease,pad=800:1080:(ow-iw)/2:(oh-ih)/2:black' `
    $endPng
  if ($LASTEXITCODE -ne 0) { throw "ffmpeg (end fit) exited $LASTEXITCODE" }
  Write-Host "Wrote $endPng (from 2.jpg)"
} elseif (Test-Path $endPng) {
  Write-Host "Using cached $endPng (2.jpg not present)"
} else {
  throw "Neither $srcPhoto nor cached $endPng found"
}

# 2a) Synthesise a bloom frame.
#
#     The Sagrada source video (made by Kie.ai) has a luminous "lit from
#     within" moment at t=2.5s — the structure glows white-hot before
#     settling into stone. A linear xfade between blueprint and photo can't
#     reproduce that because it just averages the two; with one bright source
#     (paper) and one dark source (black backdrop), the midpoint looks like a
#     muddy translucent overlay, not a bloom.
#
#     Instead we pre-render a third still — the end photo with heavy
#     brightness, contrast and gamma boost, plus a Gaussian glow layered back
#     on top via screen-blend. That gives a tower-shaped highlight on near-
#     black that reads as "incandescent" rather than "lit paper". We then
#     crossfade THROUGH this frame in the next step.
# Recipe (tuned to match Sagrada's white-cyan structural glow):
#   The new blueprint is already white linework on solid blue paper — half
#   the work is done. We just need to push the paper to near-black so the
#   white lines pop against a dark canvas, and shave the chroma so the
#   structure reads as luminance (not "a blueprint"). No inversion this
#   time — that would flip us back to dark-lines-on-light, the wrong
#   direction.
#
#   - eq           -> high contrast crushes the mid-blue paper to near-black
#                     while leaving the white lines pinned at 1.0; gamma<1
#                     darkens midtones further so the paper genuinely
#                     disappears; saturation halved so blue becomes near-grey
#   - colorbalance -> faint cyan tint in shadows + highlights, matching the
#                     "lit from within" beat in the Sagrada source video
& ffmpeg -y -loglevel error -i $startPng `
  -vf "eq=brightness=-0.05:contrast=2.10:saturation=0.30:gamma=0.70,colorbalance=rs=-0.06:bs=0.10:rh=-0.06:bh=0.12,format=rgb24" `
  -frames:v 1 $bloomPng
if ($LASTEXITCODE -ne 0) { throw "ffmpeg (bloom frame) exited $LASTEXITCODE" }
Write-Host "Wrote $bloomPng"

# 2b) Two-step crossfade: blueprint -> bloom -> photo, 2.5s each, total 5s.
#
#     - 0.0–2.5s : blueprint xfades to bloom  (paper dissolves into white-hot)
#     - 2.5s     : pure bloom held for one frame (peak luminance)
#     - 2.5–5.0s : bloom xfades to photo       (white-hot settles into iron)
& ffmpeg -y -loglevel error `
  -loop 1 -t 5 -i $startPng `
  -loop 1 -t 5 -i $bloomPng `
  -loop 1 -t 5 -i $endPng `
  -filter_complex "[0:v][1:v]xfade=transition=fade:duration=2.5:offset=0[ab];[ab][2:v]xfade=transition=fade:duration=2.5:offset=2.5[full];[full]trim=duration=5,setpts=PTS-STARTPTS,format=yuv420p[v]" `
  -map '[v]' -r 24 -c:v libx264 -pix_fmt yuv420p -crf 18 $videoOut
if ($LASTEXITCODE -ne 0) { throw "ffmpeg (two-step xfade) exited $LASTEXITCODE" }
Write-Host "Wrote $videoOut"

# 3) Split the transition video into JPG frames for the scroll player.
& ffmpeg -y -loglevel error -i $videoOut `
  -qscale:v 3 $framePat
if ($LASTEXITCODE -ne 0) { throw "ffmpeg (frame extract) exited $LASTEXITCODE" }

$count = (Get-ChildItem $framesDir -Filter '*.jpg').Count
Write-Host "Wrote $count frames to $framesDir"
