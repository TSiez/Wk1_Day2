#requires -Version 5.1
<#
  Generates Tester Tech product/lifestyle images via Kie.ai Nano Banana.
  Reads KIE_API_KEY from D2/.env.
  Submits all createTask jobs in parallel, then polls each until success,
  then downloads the resulting PNG to D2/assets/testertech/<slug>.png.
#>

param(
  [string]$Only = "",   # optional comma-separated slugs to regenerate only those
  [switch]$Force        # re-generate even if file exists
)

$ErrorActionPreference = "Stop"

$ScriptRoot  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptRoot
$EnvPath     = Join-Path $ProjectRoot ".env"
$OutDir      = Join-Path $ProjectRoot "assets\testertech"

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }

# --- Load API key from .env ---
if (-not (Test-Path $EnvPath)) { throw "Missing .env at $EnvPath" }
$envText = Get-Content $EnvPath -Raw
$apiKey = ($envText | Select-String -Pattern 'KIE_API_KEY=([^\s]+)' -AllMatches).Matches[0].Groups[1].Value
if (-not $apiKey) { throw "KIE_API_KEY not found in $EnvPath" }

$base = "https://api.kie.ai/api/v1/jobs"
$headers = @{
  "Authorization" = "Bearer $apiKey"
  "Content-Type"  = "application/json"
}

# --- Shared style preamble for product shots ---
$style = "Editorial product photography for Tester Tech, a Berlin design studio. Floating subject centered against a dark warm-black void (#0a0908), volumetric soft warm rim light from upper right (brass gold #c89e6a) and faint cool blue ambient fill from lower left, sharp focus, shallow depth of field, soft floor shadow directly below. Minimalist precision-instrument luxury aesthetic, Teenage Engineering meets Vacheron Constantin. No text, no logos, no people, no watermarks."

$lifestyle = "Editorial lifestyle photograph for Tester Tech, a Berlin design studio. Cinematic muted palette of warm-black, brass-gold and cool blue. No text, no logos, no watermarks, no faces."

# --- Image definitions ---
$jobs = @(
  @{
    slug   = "watch-pro"
    aspect = "1:1"
    prompt = "$style A premium minimalist smartwatch product shot. Round brushed-titanium case approximately 42mm, milled from a single billet, sapphire crystal face glowing softly with a warm amber complication display showing the time 10:24 in an italic serif font; a small brass-gold crown on the right side; matte black recycled-rubber strap curving gently. Three-quarter angle, slightly above the watch."
  }
  @{
    slug   = "lens-01"
    aspect = "1:1"
    prompt = "$style A pair of premium minimalist AR smart glasses, photochromic titanium frame in dark gunmetal, slightly tinted curved lenses with a faint subtle amber HUD glow visible on the inner surface; ultra-thin temples; resting at a slight three-quarter angle, slightly open. Photoreal product shot."
  }
  @{
    slug   = "echo-field"
    aspect = "1:1"
    prompt = "$style A premium minimalist cylindrical ambient smart speaker, dome-topped, warm matte fabric mesh body in dark charcoal with a glowing brass-gold ring of light at the top edge; small chamfered metal base; subtle vertical mesh texture. Bauhaus meets Bang and Olufsen."
  }
  @{
    slug   = "loop-ring"
    aspect = "1:1"
    prompt = "$style A premium minimalist smart ring made of polished titanium with a subtle brass-gold inner band visible; seen from a slight three-quarter angle showing the curved profile; one tiny cool-blue sensor LED on the inner surface; sapphire-smooth exterior. Editorial luxury jewelry feel."
  }
  @{
    slug   = "bud-mono"
    aspect = "1:1"
    prompt = "$style A pair of premium minimalist wireless earbuds standing upright in their open ivory pebble-shaped charging case; two glossy black stems with rounded heads emerging upward from the case; matte ivory case with a brushed metal hinge detail. Editorial Apple-meets-Sony aesthetic."
  }
  @{
    slug   = "halo-lamp"
    aspect = "1:1"
    prompt = "$style A premium minimalist smart bulb table lamp, frosted glass globe glowing warmly amber from within; short brushed brass-gold cylindrical base; floating slightly above the dark surface with a halo of warm light. Editorial Foscarini-meets-Muji aesthetic."
  }
  @{
    slug   = "hub-display"
    aspect = "1:1"
    prompt = "$style A premium minimalist 10-inch ambient smart display, free-standing landscape orientation, slim brushed aluminum bezel; dark glossy screen showing a soft amber-blue gradient with abstract softly-glowing UI shapes (no readable text); matte aluminum back stand. Three-quarter angle."
  }
  @{
    slug   = "bolt-lock"
    aspect = "1:1"
    prompt = "$style A premium minimalist smart door lock, vertical rectangular dark anodized aluminum body with rounded corners; large circular brass-gold knob at the center with subtle radial brushing; a thin brass status indicator slot below the knob glowing softly. Editorial luxury hardware."
  }
  @{
    slug   = "mesh-puck"
    aspect = "1:1"
    prompt = "$style A premium minimalist circular smart sensor puck, hockey-puck shape in dark anodized aluminum, a glowing thin cool-blue LED ring around the upper edge; matte top surface with subtle concentric brushed texture. Small precision instrument feel."
  }
  @{
    slug   = "scene-morning"
    aspect = "4:3"
    prompt = "$lifestyle A Berlin loft bedroom at dawn 06:47. Warm amber sunrise glow through tall industrial windows on the right; the silhouette of a dark minimalist smartwatch resting on a walnut wood nightstand in the foreground; a small brass-gold halo table lamp beside it glowing warmly; faint linen-textured duvet in the background out of focus; cinematic moody warm-black-and-amber palette."
  }
  @{
    slug   = "scene-focus"
    aspect = "4:3"
    prompt = "$lifestyle A Berlin home office desk at 10:24. Soft cool-blue daylight from a side window; a minimalist 10-inch smart display on a brass-gold stand showing a softly-glowing amber abstract dashboard (no readable text); a pair of dark titanium AR smart glasses folded beside it; an open notebook and brushed titanium pen; cinematic muted palette."
  }
  @{
    slug   = "scene-evening"
    aspect = "4:3"
    prompt = "$lifestyle A Berlin living room at 21:08. Warm dim amber lighting; a brass-gold glowing smart lamp on a low oak side table casting a soft halo onto a wool sofa; a dome-topped charcoal smart speaker beside it with a faint brass ring of light at its top; deep moody warm-black-and-amber atmosphere; out-of-focus vinyl record player in the far background."
  }
)

# Filter if -Only specified
if ($Only) {
  $wanted = $Only.Split(',') | ForEach-Object { $_.Trim() }
  $jobs = $jobs | Where-Object { $wanted -contains $_.slug }
}

Write-Host ""
Write-Host "Tester Tech image generator (Kie.ai / Nano Banana)" -ForegroundColor Cyan
Write-Host "Output dir: $OutDir"
Write-Host "Jobs: $($jobs.Count)"
Write-Host ""

# --- Submit createTask for each job ---
foreach ($job in $jobs) {
  $outPath = Join-Path $OutDir ("$($job.slug).png")
  if ((Test-Path $outPath) -and (-not $Force)) {
    $job.status   = "skipped"
    $job.outPath  = $outPath
    Write-Host "[$($job.slug)] skip (exists)" -ForegroundColor DarkGray
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
    if ($resp.code -ne 200) {
      throw "createTask error: $($resp.msg)"
    }
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

# --- Poll until all submitted jobs reach success or fail ---
$pending = @($jobs | Where-Object { $_.status -eq "submitted" })
$maxWaitSec = 480
$pollInterval = 6
$elapsed = 0

Write-Host ""
Write-Host "Polling $($pending.Count) tasks (interval ${pollInterval}s, max ${maxWaitSec}s)..." -ForegroundColor Cyan

while ($pending.Count -gt 0 -and $elapsed -lt $maxWaitSec) {
  Start-Sleep -Seconds $pollInterval
  $elapsed += $pollInterval
  $stillPending = @()

  foreach ($job in $pending) {
    try {
      $info = Invoke-RestMethod -Method Get -Uri "$base/recordInfo?taskId=$($job.taskId)" -Headers $headers -TimeoutSec 30
      $state = $info.data.state
      if ($state -eq "success") {
        $parsed = $info.data.resultJson | ConvertFrom-Json
        $url = $parsed.resultUrls[0]
        if (-not $url) { throw "no resultUrls" }
        Write-Host "[$($job.slug)] success, downloading..." -ForegroundColor Green
        Invoke-WebRequest -Uri $url -OutFile $job.outPath -TimeoutSec 120
        $job.status = "done"
      }
      elseif ($state -eq "fail") {
        Write-Host "[$($job.slug)] task FAILED: $($info.data.failMsg)" -ForegroundColor Red
        $job.status = "failed"
        $job.error  = $info.data.failMsg
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

# --- Summary ---
Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
foreach ($job in $jobs) {
  $color = switch ($job.status) {
    "done"          { "Green" }
    "skipped"       { "DarkGray" }
    "failed"        { "Red" }
    "submit-failed" { "Red" }
    default         { "Yellow" }
  }
  $extra = if ($job.error) { " ($($job.error))" } else { "" }
  Write-Host ("  {0,-16} {1}{2}" -f $job.slug, $job.status, $extra) -ForegroundColor $color
}

$doneCount = ($jobs | Where-Object { $_.status -in @("done","skipped") }).Count
Write-Host ""
Write-Host "$doneCount / $($jobs.Count) images available in $OutDir"
