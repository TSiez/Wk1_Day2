<#
  Extract every frame of "La Sagrada Familia\3D Background.mp4" into
  assets\sagrada-frames as JPGs. The Sights.html page uses these for a
  scroll-driven flipbook (one frame swapped per scroll delta).

  Source is 960x960 at 24fps, 121 frames. We upscale to 1080² with Lanczos
  for crisp retina playback, and use qscale=3 (~visual q90) so the line-art
  stays clean.

  Requirements: ffmpeg on PATH. Install with: winget install Gyan.FFmpeg
#>

$ErrorActionPreference = 'Stop'

# Refresh PATH so ffmpeg (installed via winget) is visible to non-interactive shells.
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
            [System.Environment]::GetEnvironmentVariable('Path','User')

$root = Split-Path -Parent $PSScriptRoot
$src  = Join-Path $root 'La Sagrada Familia\3D Background.mp4'
$dir  = Join-Path $root 'assets\sagrada-frames'

if (-not (Test-Path $src)) { throw "Source video not found: $src" }
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Get-ChildItem $dir -Filter 'frame_*.jpg' -ErrorAction SilentlyContinue | Remove-Item -Force

$out = Join-Path $dir 'frame_%03d.jpg'
& ffmpeg -y -loglevel error -i $src -vf 'scale=1080:1080:flags=lanczos' -qscale:v 3 $out
if ($LASTEXITCODE -ne 0) { throw "ffmpeg exited $LASTEXITCODE" }

$count = (Get-ChildItem $dir -Filter '*.jpg').Count
Write-Host "Wrote $count frames to $dir"
