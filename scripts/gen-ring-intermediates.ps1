#requires -Version 5.1
<#
  Generate 3 intermediate keyframes between ring-start.png and ring-end.png
  so the scroll flipbook traces a real progressive explosion instead of one
  long transparency ghost.

  Submits Nano Banana jobs with BOTH bookends as image_urls references,
  prompting for the ring at 30%, 50%, 70% separation. Each intermediate
  inherits the shared visual treatment so they read as the same shot.

  Outputs to assets/ring-dissection/:
    ring-mid30.png
    ring-mid50.png
    ring-mid70.png

  After this, re-run gen-ring-dissection-frames.ps1 — its Phase 2 detects
  intermediates and chains xfades through all 5 keyframes.
#>

$ErrorActionPreference = "Stop"

$ProjectRoot = "c:\Users\acer\Desktop\Arca\D2"
$EnvPath     = Join-Path $ProjectRoot ".env"
$StartPng    = Join-Path $ProjectRoot "assets\ring-dissection\ring-start.png"
$EndPng      = Join-Path $ProjectRoot "assets\ring-dissection\ring-end.png"
$OutMid30    = Join-Path $ProjectRoot "assets\ring-dissection\ring-mid30.png"
$OutMid50    = Join-Path $ProjectRoot "assets\ring-dissection\ring-mid50.png"
$OutMid70    = Join-Path $ProjectRoot "assets\ring-dissection\ring-mid70.png"

if (-not (Test-Path $StartPng)) { throw "Missing $StartPng" }
if (-not (Test-Path $EndPng))   { throw "Missing $EndPng" }

# Load env
$envText     = Get-Content $EnvPath -Raw
$apiKey      = ($envText | Select-String -Pattern 'KIE_API_KEY=([^\s]+)'              -AllMatches).Matches[0].Groups[1].Value
$supabaseUrl = ($envText | Select-String -Pattern 'SUPABASE_URL=([^\s]+)'              -AllMatches).Matches[0].Groups[1].Value
$supabaseKey = ($envText | Select-String -Pattern 'SUPABASE_SERVICE_ROLE_KEY=([^\s]+)' -AllMatches).Matches[0].Groups[1].Value

$kieBase    = "https://api.kie.ai/api/v1/jobs"
$kieHeaders = @{ "Authorization" = "Bearer $apiKey"; "Content-Type" = "application/json" }
$supaAuth   = @{ "Authorization" = "Bearer $supabaseKey"; "apikey" = $supabaseKey }

$bucket = "kie-keyframes"
$stamp  = [DateTimeOffset]::Now.ToUnixTimeSeconds()

function Upload-Png {
  param([string]$Path, [string]$ObjectName)
  $headers = $supaAuth + @{ "Content-Type" = "image/png"; "x-upsert" = "true" }
  Invoke-RestMethod -Method Post -Uri "$supabaseUrl/storage/v1/object/$bucket/$ObjectName" -Headers $headers -InFile $Path -TimeoutSec 120 | Out-Null
  return "$supabaseUrl/storage/v1/object/public/$bucket/$ObjectName"
}

Write-Host "Uploading bookends as references..." -ForegroundColor Cyan
$startUrl = Upload-Png -Path $StartPng -ObjectName "kf-start-$stamp.png"
$endUrl   = Upload-Png -Path $EndPng   -ObjectName "kf-end-$stamp.png"
Write-Host "  start -> $startUrl" -ForegroundColor DarkGray
Write-Host "  end   -> $endUrl"   -ForegroundColor DarkGray

# Shared treatment - identical for all intermediates so they read as one shot.
$shared = "Editorial macro product photography. Subject against a near-black warm void (#0a0908). Single warm key light from upper-right at 45 degrees (3200K, brass-gold). Faint cool cyan rim light from lower-left. Volumetric soft atmospheric haze. Shallow depth of field. Subtle film grain. Brushed grade-5 titanium materials. Identical lighting setup, identical materials, identical color grading to the two reference images. Sharp focus. No text, no labels, no human elements."

$jobs = @(
  @{
    slug    = "ring-mid30"
    outPath = $OutMid30
    prompt  = "Generate an intermediate frame BETWEEN these two reference images, treating them as the first and last frame of a continuous exploded-view animation. This frame should show the ring at approximately 30% separation - the outer shell has begun to lift, the components are just starting to separate vertically, but the assembly is still mostly compact. PRESERVE EXACTLY the camera angle, perspective, and framing of both references. Each component is in motion along the same axis as the second reference, but only 30% of the way along its trajectory. $shared"
  }
  @{
    slug    = "ring-mid50"
    outPath = $OutMid50
    prompt  = "Generate an intermediate frame BETWEEN these two reference images, treating them as the first and last frame of a continuous exploded-view animation. This frame should show the ring at approximately 50% separation - all five components are clearly separated and floating apart in suspension, but they are halfway between the assembled and fully-exploded positions. PRESERVE EXACTLY the camera angle, perspective, and framing of both references. Each component is exactly halfway along its trajectory. $shared"
  }
  @{
    slug    = "ring-mid70"
    outPath = $OutMid70
    prompt  = "Generate an intermediate frame BETWEEN these two reference images, treating them as the first and last frame of a continuous exploded-view animation. This frame should show the ring at approximately 70% separation - the components are nearly at their final exploded positions but still in motion, with slightly less spacing between layers than the second reference. PRESERVE EXACTLY the camera angle, perspective, and framing of both references. $shared"
  }
)

Write-Host ""
Write-Host "Submitting 3 Nano Banana jobs with both bookends as image refs..." -ForegroundColor Cyan

foreach ($job in $jobs) {
  $body = @{
    model = "google/nano-banana"
    input = @{
      prompt        = $job.prompt
      image_urls    = @($startUrl, $endUrl)
      output_format = "png"
      image_size    = "1:1"
    }
  } | ConvertTo-Json -Depth 6 -Compress

  $resp = Invoke-RestMethod -Method Post -Uri "$kieBase/createTask" -Headers $kieHeaders -Body $body -TimeoutSec 60
  if ($resp.code -ne 200) { throw "createTask error ($($job.slug)): $($resp.msg)" }
  $job.taskId = $resp.data.taskId
  Write-Host "[$($job.slug)] submitted -> $($job.taskId)" -ForegroundColor Yellow
}

# Poll
$pending = @($jobs)
$elapsed = 0

Write-Host ""
Write-Host "Polling..." -ForegroundColor Cyan

while ($pending.Count -gt 0 -and $elapsed -lt 480) {
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
Write-Host "Intermediates generated. Re-run gen-ring-dissection-frames.ps1 to rebuild." -ForegroundColor Cyan
