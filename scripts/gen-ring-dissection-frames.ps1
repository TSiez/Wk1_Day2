#requires -Version 5.1
<#
  Smart Ring Dissection - fully-automated flipbook pipeline.

  Phases:
    1. Generate two bookend stills via Kie.ai Nano Banana -
         ring-start.png  (assembled ring)
         ring-end.png    (exploded into 5 separated layers)
    2. Upload both stills to catbox.moe so Kie.ai's video model can
       fetch them as public URLs (Kie.ai video endpoints take image
       URLs, not local files).
    3. Submit a video job to Kie.ai with both as start/end keyframes,
       poll until ready, download as ring-transition.mp4.
    4. Slice the transition into 121 JPGs at assets\ring-frames\
       for the scroll-driven flipbook player.

  Usage:
    .\scripts\gen-ring-dissection-frames.ps1                # full pipeline
    .\scripts\gen-ring-dissection-frames.ps1 -Force         # regenerate everything
    .\scripts\gen-ring-dissection-frames.ps1 -FramesOnly    # ffmpeg only
    .\scripts\gen-ring-dissection-frames.ps1 -SkipVideo     # bookends only
    .\scripts\gen-ring-dissection-frames.ps1 -VideoModel "runway/gen-3-alpha-turbo"

  Requires:
    - KIE_API_KEY in D2\.env
    - ffmpeg on PATH (winget install Gyan.FFmpeg)
    - curl.exe on PATH (ships with Windows 10+)
#>

param(
  [switch]$Force,
  [switch]$FramesOnly,
  [switch]$SkipVideo,
  [switch]$UseVeo,                          # if set, generate via Kie.ai Veo API
                                            # instead of local ffmpeg xfade
  [ValidateSet("veo3_fast","veo3","veo3_lite")]
  [string]$VideoModel    = "veo3_fast",
  [ValidateSet(4,6,8)]
  [int]   $VideoDuration = 8                # Veo supports 4 / 6 / 8 only.
                                            # ffmpeg xfade ignores this and uses
                                            # the per-segment math instead.
)

$ErrorActionPreference = "Stop"

$ScriptRoot  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptRoot
$EnvPath     = Join-Path $ProjectRoot ".env"
$BookendsDir = Join-Path $ProjectRoot "assets\ring-dissection"
$FramesDir   = Join-Path $ProjectRoot "assets\ring-frames"
$VideoPath   = Join-Path $BookendsDir "ring-transition.mp4"
$StartPath   = Join-Path $BookendsDir "ring-start.png"
$EndPath     = Join-Path $BookendsDir "ring-end.png"

New-Item -ItemType Directory -Force -Path $BookendsDir, $FramesDir | Out-Null

# Refresh PATH so ffmpeg + curl are visible to non-interactive shells.
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
            [System.Environment]::GetEnvironmentVariable('Path','User')

# ============================================================
# Kie.ai API setup - needed for both bookend and video phases
# ============================================================

$base    = "https://api.kie.ai/api/v1/jobs"
$apiKey  = $null
$headers = $null

$supabaseUrl     = $null
$supabaseKey     = $null
$supabaseHeaders = $null

if (-not $FramesOnly) {
  if (-not (Test-Path $EnvPath)) { throw "Missing .env at $EnvPath" }
  $envText = Get-Content $EnvPath -Raw
  $apiKey  = ($envText | Select-String -Pattern 'KIE_API_KEY=([^\s]+)' -AllMatches).Matches[0].Groups[1].Value
  if (-not $apiKey) { throw "KIE_API_KEY not found in $EnvPath" }
  $headers = @{
    "Authorization" = "Bearer $apiKey"
    "Content-Type"  = "application/json"
  }

  # Supabase Storage is used to host the bookend stills so Kie.ai can fetch
  # them as URLs. Uses the user's own Supabase project, not an external host.
  $supabaseUrl = ($envText | Select-String -Pattern 'SUPABASE_URL=([^\s]+)'              -AllMatches).Matches[0].Groups[1].Value
  $supabaseKey = ($envText | Select-String -Pattern 'SUPABASE_SERVICE_ROLE_KEY=([^\s]+)' -AllMatches).Matches[0].Groups[1].Value
  if (-not $supabaseUrl) { throw "SUPABASE_URL not found in $EnvPath" }
  if (-not $supabaseKey) { throw "SUPABASE_SERVICE_ROLE_KEY not found in $EnvPath" }
  $supabaseHeaders = @{
    "Authorization" = "Bearer $supabaseKey"
    "apikey"        = $supabaseKey
  }
}

# ============================================================
# Phase 1 - bookend stills via Kie.ai Nano Banana
# ============================================================

if (-not $FramesOnly) {

  $style = "Editorial macro product photography for Tester Tech, a Berlin precision-instrument studio. Subject centered against a deep near-black warm void (#0a0908), single warm key light from upper-right (3200K, color #c89e6a brass-gold), faint cool cyan rim light from lower-left, volumetric soft atmospheric haze, shallow depth of field, subtle film grain, sharp focus on subject. Editorial horology / instrument-shop aesthetic. No text, no labels, no fingers, no hands, no human elements, no watermarks, no UI overlays."

  $bookends = @(
    @{
      slug   = "ring-start"
      aspect = "1:1"
      prompt = "$style A fully assembled premium minimalist smart ring centered in frame. Brushed grade-5 titanium outer shell, polished mirror inner band catching the warm key light, sapphire-smooth exterior with no decorative engraving. Viewed from a slight three-quarter angle showing the curved profile. The ring floats centered against the warm-black void, casting a soft shadow directly below. Macro shot, ultra-sharp focus on the ring."
    }
    @{
      slug   = "ring-end"
      aspect = "1:1"
      prompt = "$style The same smart ring, identical camera angle and lighting, but exploded vertically into five separated layers. From top to bottom: brushed grade-5 titanium outer shell, polished inner band, a miniature green PCB with gold traces and a tiny black SoC chip, a curved silicon-anode battery cell, and six inward-facing green/red/infrared photodiode sensors arranged in a small ring formation. Each layer floats 6 to 8 millimeters apart, suspended in the warm-black void. Same warm brass-gold key light from upper-right, same cool cyan rim light. Macro shot. Editorial precision-instrument exploded-view diagram."
    }
  )

  Write-Host ""
  Write-Host "Phase 1 - Bookend stills (Kie.ai / Nano Banana)" -ForegroundColor Cyan
  Write-Host "Output: $BookendsDir"
  Write-Host ""

  foreach ($job in $bookends) {
    $outPath = Join-Path $BookendsDir ("$($job.slug).png")
    if ((Test-Path $outPath) -and (-not $Force)) {
      $job.status  = "skipped"
      $job.outPath = $outPath
      Write-Host "[$($job.slug)] skip (exists; -Force to regenerate)" -ForegroundColor DarkGray
      continue
    }

    $body = @{
      model = "google/nano-banana"
      input = @{
        prompt        = $job.prompt
        output_format = "png"
        image_size    = $job.aspect
      }
    } | ConvertTo-Json -Depth 6 -Compress

    try {
      $resp = Invoke-RestMethod -Method Post -Uri "$base/createTask" -Headers $headers -Body $body -TimeoutSec 60
      if ($resp.code -ne 200) { throw "createTask error: $($resp.msg)" }
      $job.taskId  = $resp.data.taskId
      $job.outPath = $outPath
      $job.status  = "submitted"
      Write-Host "[$($job.slug)] submitted -> $($job.taskId)" -ForegroundColor Yellow
    }
    catch {
      $job.status = "submit-failed"
      $job.error  = $_.Exception.Message
      Write-Host "[$($job.slug)] submit FAILED: $($_.Exception.Message)" -ForegroundColor Red
    }
  }

  $pending = @($bookends | Where-Object { $_.status -eq "submitted" })
  $elapsed = 0; $maxWait = 480; $interval = 6

  if ($pending.Count -gt 0) {
    Write-Host "Polling $($pending.Count) bookend tasks..." -ForegroundColor Cyan
  }

  while ($pending.Count -gt 0 -and $elapsed -lt $maxWait) {
    Start-Sleep -Seconds $interval
    $elapsed += $interval
    $stillPending = @()
    foreach ($job in $pending) {
      try {
        $info  = Invoke-RestMethod -Method Get -Uri "$base/recordInfo?taskId=$($job.taskId)" -Headers $headers -TimeoutSec 30
        $state = $info.data.state
        if ($state -eq "success") {
          $parsed = $info.data.resultJson | ConvertFrom-Json
          $url    = $parsed.resultUrls[0]
          if (-not $url) { throw "no resultUrls" }
          Write-Host "[$($job.slug)] success, downloading..." -ForegroundColor Green
          Invoke-WebRequest -Uri $url -OutFile $job.outPath -TimeoutSec 120
          $job.status = "done"
        }
        elseif ($state -eq "fail") {
          Write-Host "[$($job.slug)] FAILED: $($info.data.failMsg)" -ForegroundColor Red
          $job.status = "failed"
        }
        else {
          $stillPending += $job
        }
      }
      catch {
        Write-Host "[$($job.slug)] poll error: $($_.Exception.Message)" -ForegroundColor Red
        $stillPending += $job
      }
    }
    $pending = $stillPending
    if ($pending.Count -gt 0) {
      Write-Host "  ... still waiting on $($pending.Count) at ${elapsed}s" -ForegroundColor DarkGray
    }
  }

  $failedBookends = @($bookends | Where-Object { $_.status -in @("failed","submit-failed") })
  if ($failedBookends.Count -gt 0) {
    throw "Bookend generation failed - cannot proceed to video."
  }
}

if ($SkipVideo) {
  Write-Host ""
  Write-Host "Skipping video generation (-SkipVideo). Bookends are in $BookendsDir" -ForegroundColor DarkGray
  return
}

# ============================================================
# Phase 2 - build the transition video. Two modes:
#   -UseVeo: call Kie.ai's Veo API at /api/v1/veo/generate with the
#            two bookends as first+last keyframes. Real AI motion
#            interpolation. Costs API credits.
#   default: chain ffmpeg xfades through whatever keyframes exist
#            (5 if intermediates were generated, otherwise just 2).
#            Free, but a dissolve rather than physical motion.
# ============================================================

if ((-not (Test-Path $VideoPath) -or $Force) -and -not $FramesOnly) {

  if (-not (Test-Path $StartPath)) { throw "Missing $StartPath. Run without -FramesOnly first." }
  if (-not (Test-Path $EndPath))   { throw "Missing $EndPath. Run without -FramesOnly first." }

  if ($UseVeo) {
    # ----- Veo path: real AI video via /api/v1/veo/generate -----
    Write-Host ""
    Write-Host "Phase 2 - Generating transition via Kie.ai Veo ($VideoModel, ${VideoDuration}s)" -ForegroundColor Cyan
    Write-Host "Uploading bookends to Supabase Storage..."

    $bucket = "kie-keyframes"
    try {
      $createBody = @{ id = $bucket; name = $bucket; public = $true } | ConvertTo-Json -Compress
      Invoke-RestMethod -Method Post -Uri "$supabaseUrl/storage/v1/bucket" `
        -Headers ($supabaseHeaders + @{ "Content-Type" = "application/json" }) `
        -Body $createBody -TimeoutSec 30 | Out-Null
      Write-Host "  bucket created: $bucket" -ForegroundColor DarkGray
    } catch {
      Write-Host "  bucket exists: $bucket" -ForegroundColor DarkGray
    }

    function Upload-VeoRef {
      param([string]$Path, [string]$ObjectName)
      $h = $supabaseHeaders + @{ "Content-Type" = "image/png"; "x-upsert" = "true" }
      Invoke-RestMethod -Method Post -Uri "$supabaseUrl/storage/v1/object/$bucket/$ObjectName" -Headers $h -InFile $Path -TimeoutSec 120 | Out-Null
      return "$supabaseUrl/storage/v1/object/public/$bucket/$ObjectName"
    }

    $stamp    = [DateTimeOffset]::Now.ToUnixTimeSeconds()
    $startUrl = Upload-VeoRef -Path $StartPath -ObjectName "veo-start-$stamp.png"
    $endUrl   = Upload-VeoRef -Path $EndPath   -ObjectName "veo-end-$stamp.png"
    Write-Host "  start -> $startUrl" -ForegroundColor DarkGray
    Write-Host "  end   -> $endUrl"   -ForegroundColor DarkGray

    $veoPrompt = "Cinematic exploded-view of a smart titanium ring slowly rotating against a near-black studio backdrop. Single warm key light at 45 degrees with a faint brass rim. The ring's components separate vertically in slow, deliberate motion along a shared axis - brushed grade-5 titanium outer shell on top, polished inner band beneath it, a miniature PCB with gold traces and a tiny SoC chip, a curved silicon-anode battery cell, and an inward-facing sensor stack of six green / red / infrared photodiodes. Each component drifts apart by 4 to 6mm, suspends mid-air for a held beat. Soft volumetric atmosphere. Faint film grain. Shallow depth of field. Studio macro photography. Editorial horology aesthetic. No text, no labels."

    $veoBody = @{
      prompt          = $veoPrompt
      imageUrls       = @($startUrl, $endUrl)
      model           = $VideoModel
      generationType  = "FIRST_AND_LAST_FRAMES_2_VIDEO"
      aspect_ratio    = "16:9"
      duration        = $VideoDuration
    } | ConvertTo-Json -Depth 6 -Compress

    Write-Host "Submitting Veo job..."
    $resp = Invoke-RestMethod -Method Post -Uri "https://api.kie.ai/api/v1/veo/generate" -Headers $headers -Body $veoBody -TimeoutSec 60
    if ($resp.code -ne 200) { throw "Veo generate error: $($resp.msg)" }
    $veoTaskId = $resp.data.taskId
    Write-Host "  task: $veoTaskId" -ForegroundColor Yellow

    # Poll /api/v1/veo/record-info - response uses successFlag (0 pending, 1 ok, 2/3 fail)
    # and resultUrls (JSON-stringified array of URLs).
    $videoUrl    = $null
    $veoElapsed  = 0
    $veoMaxWait  = 900
    $veoInterval = 15

    while ($veoElapsed -lt $veoMaxWait) {
      Start-Sleep -Seconds $veoInterval
      $veoElapsed += $veoInterval
      try {
        $info = Invoke-RestMethod -Method Get -Uri "https://api.kie.ai/api/v1/veo/record-info?taskId=$veoTaskId" -Headers $headers -TimeoutSec 30
        $flag = $info.data.successFlag
        if ($flag -eq 1) {
          # Real response shape: resultUrls is a real array nested at
          # data.response.resultUrls (NOT a JSON string at data.resultUrls
          # as the docs suggest). Handle both for safety.
          $urls = $null
          if ($info.data.response -and $info.data.response.resultUrls) {
            $urls = $info.data.response.resultUrls
          } elseif ($info.data.resultUrls) {
            $raw = $info.data.resultUrls
            if ($raw -is [string]) { $urls = $raw | ConvertFrom-Json } else { $urls = $raw }
          }
          if (-not $urls -or $urls.Count -eq 0) { throw "Veo reported success but no resultUrls in response" }
          $videoUrl = $urls[0]
          Write-Host "  Veo ready, downloading..." -ForegroundColor Green
          break
        }
        elseif ($flag -in @(2,3)) {
          throw "Veo job failed (flag=$flag): $($info.data.errorMessage)"
        }
        else {
          Write-Host "  ... still rendering at ${veoElapsed}s (flag=$flag)" -ForegroundColor DarkGray
        }
      }
      catch {
        if ($_.Exception.Message -match 'Veo job failed|reported success but no resultUrls') { throw }
        Write-Host "  poll error: $($_.Exception.Message)" -ForegroundColor Red
      }
    }

    if (-not $videoUrl) { throw "Veo did not complete within ${veoMaxWait}s" }
    Invoke-WebRequest -Uri $videoUrl -OutFile $VideoPath -TimeoutSec 300
    Write-Host "  saved: $VideoPath" -ForegroundColor Green
  }
  else {
    # ----- Offline path: ffmpeg xfade through whatever keyframes exist -----
    $Mid30Path = Join-Path $BookendsDir "ring-mid30.png"
    $Mid50Path = Join-Path $BookendsDir "ring-mid50.png"
    $Mid70Path = Join-Path $BookendsDir "ring-mid70.png"
    $hasIntermediates = (Test-Path $Mid30Path) -and (Test-Path $Mid50Path) -and (Test-Path $Mid70Path)

    $scale = "scale=1920:1080:flags=lanczos:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p"

    if ($hasIntermediates) {
      Write-Host ""
      Write-Host "Phase 2 - Chaining xfades through 5 keyframes (offline)" -ForegroundColor Cyan
      Write-Host "  start  -> mid30 -> mid50 -> mid70 -> end" -ForegroundColor DarkGray

      $seg = [math]::Round($VideoDuration / 4, 4)
      $o2  = $seg
      $o3  = [math]::Round($seg * 2, 4)
      $o4  = [math]::Round($seg * 3, 4)

      $videoFilter = "[0:v]${scale}[s];[1:v]${scale}[m30];[2:v]${scale}[m50];[3:v]${scale}[m70];[4:v]${scale}[e];[s][m30]xfade=transition=fade:duration=${seg}:offset=0[x1];[x1][m50]xfade=transition=fade:duration=${seg}:offset=${o2}[x2];[x2][m70]xfade=transition=fade:duration=${seg}:offset=${o3}[x3];[x3][e]xfade=transition=fade:duration=${seg}:offset=${o4}[v]"

      & ffmpeg -y -loglevel error `
        -loop 1 -t $VideoDuration -i $StartPath `
        -loop 1 -t $VideoDuration -i $Mid30Path `
        -loop 1 -t $VideoDuration -i $Mid50Path `
        -loop 1 -t $VideoDuration -i $Mid70Path `
        -loop 1 -t $VideoDuration -i $EndPath `
        -filter_complex $videoFilter `
        -map '[v]' -r 24 -c:v libx264 -pix_fmt yuv420p -crf 18 $VideoPath
    }
    else {
      Write-Host ""
      Write-Host "Phase 2 - Simple 2-keyframe xfade (no intermediates)" -ForegroundColor Cyan
      Write-Host "  Tip: run gen-ring-intermediates.ps1 first, or pass -UseVeo." -ForegroundColor DarkGray

      $videoFilter = "[0:v]${scale}[s];[1:v]${scale}[e];[s][e]xfade=transition=fade:duration=${VideoDuration}:offset=0[v]"

      & ffmpeg -y -loglevel error `
        -loop 1 -t $VideoDuration -i $StartPath `
        -loop 1 -t $VideoDuration -i $EndPath `
        -filter_complex $videoFilter `
        -map '[v]' -r 24 -c:v libx264 -pix_fmt yuv420p -crf 18 $VideoPath
    }

    if ($LASTEXITCODE -ne 0) { throw "ffmpeg xfade exited $LASTEXITCODE" }
    Write-Host "  built: $VideoPath" -ForegroundColor Green
  }
}

# ============================================================
# Phase 3 - slice the transition into JPG frames
# ============================================================

Write-Host ""
if (-not (Test-Path $VideoPath)) {
  throw "Transition video missing at $VideoPath - nothing to slice."
}

Write-Host "Phase 3 - Slicing $VideoPath into JPG frames..." -ForegroundColor Cyan
Get-ChildItem $FramesDir -Filter 'frame_*.jpg' -ErrorAction SilentlyContinue | Remove-Item -Force

$framePattern = Join-Path $FramesDir 'frame_%03d.jpg'
& ffmpeg -y -loglevel error -i $VideoPath -vf 'scale=1080:1080:flags=lanczos' -qscale:v 3 $framePattern
if ($LASTEXITCODE -ne 0) { throw "ffmpeg exited $LASTEXITCODE" }

$count = (Get-ChildItem $FramesDir -Filter '*.jpg').Count
Write-Host ""
Write-Host "Done. $count frames in $FramesDir" -ForegroundColor Green
Write-Host "Ready to wire into a scroll section - same pattern as sagrada-frames in Sights.html." -ForegroundColor DarkGray
