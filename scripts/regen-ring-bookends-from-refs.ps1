#requires -Version 5.1
<#
  Regenerate ring-start.png and ring-end.png as image-to-image jobs,
  using Start.jpg and End.jpg in assets/ring-dissection/ as visual
  references for Kie.ai's Nano Banana model.

  Pipeline:
    1. Upload Start.jpg + End.jpg to Supabase Storage so Kie.ai
       can fetch them as public URLs.
    2. Submit Nano Banana jobs with image_urls input pointing at the
       uploaded refs, plus a prompt that preserves the reference
       geometry and only restyles the finish.
    3. Poll until each job succeeds, download to ring-start.png
       and/or ring-end.png (overwriting existing).

  Usage:
    .\scripts\regen-ring-bookends-from-refs.ps1                # regen both
    .\scripts\regen-ring-bookends-from-refs.ps1 -Only ring-end # regen only one

  After this completes, re-run gen-ring-dissection-frames.ps1 to
  rebuild the transition + frames from the new bookends.
#>

param(
  [ValidateSet("ring-start", "ring-end", "both")]
  [string]$Only = "both"
)

$ErrorActionPreference = "Stop"

$ProjectRoot = "c:\Users\acer\Desktop\Arca\D2"
$EnvPath     = Join-Path $ProjectRoot ".env"
$RefStartJpg = Join-Path $ProjectRoot "assets\ring-dissection\Start.jpg"
$RefEndJpg   = Join-Path $ProjectRoot "assets\ring-dissection\End.jpg"
$OutStart    = Join-Path $ProjectRoot "assets\ring-dissection\ring-start.png"
$OutEnd      = Join-Path $ProjectRoot "assets\ring-dissection\ring-end.png"

if (-not (Test-Path $RefStartJpg)) { throw "Missing reference: $RefStartJpg" }
if (-not (Test-Path $RefEndJpg))   { throw "Missing reference: $RefEndJpg" }

# Load env values
$envText     = Get-Content $EnvPath -Raw
$apiKey      = ($envText | Select-String -Pattern 'KIE_API_KEY=([^\s]+)'              -AllMatches).Matches[0].Groups[1].Value
$supabaseUrl = ($envText | Select-String -Pattern 'SUPABASE_URL=([^\s]+)'              -AllMatches).Matches[0].Groups[1].Value
$supabaseKey = ($envText | Select-String -Pattern 'SUPABASE_SERVICE_ROLE_KEY=([^\s]+)' -AllMatches).Matches[0].Groups[1].Value

if (-not $apiKey)      { throw "KIE_API_KEY not found in .env" }
if (-not $supabaseUrl) { throw "SUPABASE_URL not found in .env" }
if (-not $supabaseKey) { throw "SUPABASE_SERVICE_ROLE_KEY not found in .env" }

$kieBase    = "https://api.kie.ai/api/v1/jobs"
$kieHeaders = @{
  "Authorization" = "Bearer $apiKey"
  "Content-Type"  = "application/json"
}
$supaAuth = @{
  "Authorization" = "Bearer $supabaseKey"
  "apikey"        = $supabaseKey
}

# ----- Upload reference images to Supabase Storage -----
$bucket = "kie-keyframes"
$stamp  = [DateTimeOffset]::Now.ToUnixTimeSeconds()

function Upload-Ref {
  param([string]$Path, [string]$ObjectName)
  $headers = $supaAuth + @{
    "Content-Type" = "image/jpeg"
    "x-upsert"     = "true"
  }
  $uri = "$supabaseUrl/storage/v1/object/$bucket/$ObjectName"
  Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -InFile $Path -TimeoutSec 120 | Out-Null
  return "$supabaseUrl/storage/v1/object/public/$bucket/$ObjectName"
}

Write-Host "Uploading reference images to Supabase Storage..." -ForegroundColor Cyan
$startRefUrl = Upload-Ref -Path $RefStartJpg -ObjectName "ref-start-$stamp.jpg"
$endRefUrl   = Upload-Ref -Path $RefEndJpg   -ObjectName "ref-end-$stamp.jpg"
Write-Host "  start ref -> $startRefUrl" -ForegroundColor DarkGray
Write-Host "  end ref   -> $endRefUrl"   -ForegroundColor DarkGray

# ----- Submit Nano Banana image-to-image jobs -----
$style = "Editorial macro product photography for Tester Tech, a Berlin precision-instrument studio. Subject centered against a deep near-black warm void (#0a0908). Single warm key light from upper-right (3200K, color #c89e6a brass-gold). Faint cool cyan rim light from lower-left. Volumetric soft atmospheric haze. Shallow depth of field. Subtle film grain. Sharp focus on subject. Editorial horology / instrument-shop aesthetic. No text, no labels, no fingers, no hands, no human elements, no watermarks."

# Shared treatment block - identical text for both jobs so Nano Banana
# applies the same lighting, materials, color grading, and atmosphere.
# This is what makes the two outputs read as paired frames of one shot.
$shared = "Treat the output as one still frame from a single continuous editorial product video, paired with its counterpart at the other end of the same shot - identical lighting setup, identical materials, identical color grading, identical depth of field. Editorial macro product photography. Subject against a near-black warm void (#0a0908). Single warm key light from upper-right at 45 degrees (3200K, color #c89e6a brass-gold). Faint cool cyan rim light from lower-left. Volumetric soft atmospheric haze. Shallow depth of field. Subtle film grain. Brushed grade-5 titanium materials throughout, with polished mirror inner surfaces and faint brass accents. Sharp focus on subject. Editorial horology / instrument-shop aesthetic. No text, no labels, no fingers, no hands, no watermarks."

# NOTE: refs are swapped on purpose -
#   ring-start  draws its geometry from End.jpg
#   ring-end    draws its geometry from Start.jpg
$jobs = @(
  @{
    slug    = "ring-start"
    refUrl  = $endRefUrl       # swapped: ring-start uses End.jpg as visual ref
    outPath = $OutStart
    prompt  = "Re-render this exact image with photoreal precision-instrument finishing. PRESERVE EXACTLY the camera angle, perspective, framing, ring orientation, silhouette, and composition of the input image - do not rotate, do not reframe, do not change the pose, do not move the subject. ONLY change the surface finish, lighting, and atmosphere. $shared"
  }
  @{
    slug    = "ring-end"
    refUrl  = $startRefUrl     # swapped: ring-end uses Start.jpg as visual ref
    outPath = $OutEnd
    prompt  = "Re-render this exact image with photoreal precision-instrument finishing. PRESERVE EXACTLY the camera angle, perspective, framing, and the precise position and orientation of every element shown in the input image - do not rotate, do not reposition any layer, do not change the spacing or arrangement. ONLY change the surface finish, lighting, and atmosphere. $shared"
  }
)

# Filter if -Only specified
if ($Only -ne "both") {
  $jobs = $jobs | Where-Object { $_.slug -eq $Only }
  Write-Host "Filter: regenerating only $Only" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "Submitting Nano Banana image-to-image jobs..." -ForegroundColor Cyan

foreach ($job in $jobs) {
  $body = @{
    model = "google/nano-banana"
    input = @{
      prompt        = $job.prompt
      image_urls    = @($job.refUrl)
      output_format = "png"
      image_size    = "1:1"
    }
  } | ConvertTo-Json -Depth 6 -Compress

  $resp = Invoke-RestMethod -Method Post -Uri "$kieBase/createTask" -Headers $kieHeaders -Body $body -TimeoutSec 60
  if ($resp.code -ne 200) { throw "createTask error ($($job.slug)): $($resp.msg)" }
  $job.taskId = $resp.data.taskId
  Write-Host "[$($job.slug)] submitted -> $($job.taskId)" -ForegroundColor Yellow
}

# ----- Poll until both complete -----
$pending = @($jobs)
$elapsed = 0
$maxWait = 480

Write-Host ""
Write-Host "Polling..." -ForegroundColor Cyan

while ($pending.Count -gt 0 -and $elapsed -lt $maxWait) {
  Start-Sleep -Seconds 6
  $elapsed += 6
  $stillPending = @()

  foreach ($job in $pending) {
    try {
      $info  = Invoke-RestMethod -Method Get -Uri "$kieBase/recordInfo?taskId=$($job.taskId)" -Headers $kieHeaders -TimeoutSec 30
      $state = $info.data.state
      if ($state -eq "success") {
        $parsed = $info.data.resultJson | ConvertFrom-Json
        $url    = $parsed.resultUrls[0]
        if (-not $url) { throw "no resultUrls" }
        Invoke-WebRequest -Uri $url -OutFile $job.outPath -TimeoutSec 120
        Write-Host "[$($job.slug)] DONE -> $($job.outPath)" -ForegroundColor Green
      }
      elseif ($state -eq "fail") {
        Write-Host "[$($job.slug)] FAILED: $($info.data.failMsg)" -ForegroundColor Red
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

Write-Host ""
Write-Host "Bookends regenerated from references." -ForegroundColor Cyan
Write-Host "Next step: rebuild the transition + frames with:" -ForegroundColor DarkGray
Write-Host "  & .\scripts\gen-ring-dissection-frames.ps1 -Force -FramesOnly" -ForegroundColor DarkGray
Write-Host "(use -Force on the script, but keep -FramesOnly so it skips Phase 1 and just rebuilds video + frames from the new bookends)" -ForegroundColor DarkGray
