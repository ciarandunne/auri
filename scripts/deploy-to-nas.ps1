param(
  [string]$NasPath = "Z:\auri",
  [string]$HealthUrl = "http://192.168.5.55:8787/health",
  [switch]$Restart,
  [switch]$SkipHealthCheck
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$NasLeaf = Split-Path -Leaf $NasPath

if ([string]::IsNullOrWhiteSpace($NasPath) -or $NasLeaf -ne "auri") {
  throw "NasPath must point to the dedicated Auri deployment folder, e.g. Z:\auri. Current value: $NasPath"
}

if (-not (Test-Path $NasPath)) {
  throw "Cannot find NAS deployment folder: $NasPath. Mount the Synology share first."
}

$files = @(
  "Dockerfile",
  "docker-compose.yml",
  "package.json",
  "package-lock.json",
  "server.js",
  "README.md",
  "NEXT.md",
  "NAS_DEPLOYMENT.md",
  "M5DIAL_PLAN.md",
  "PROJECT_STATUS.md"
)

foreach ($file in $files) {
  $source = Join-Path $ProjectRoot $file
  if (Test-Path $source) {
    Copy-Item -LiteralPath $source -Destination (Join-Path $NasPath $file) -Force
  }
}

$scriptsTarget = Join-Path $NasPath "scripts"
New-Item -ItemType Directory -Force -Path $scriptsTarget | Out-Null
Get-ChildItem -LiteralPath (Join-Path $ProjectRoot "scripts") -File | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $scriptsTarget $_.Name) -Force
}

Write-Host "Auri files copied to $NasPath"

if (-not $Restart) {
  Write-Host ""
  Write-Host "Not restarted. To restart after reviewing files, run:"
  Write-Host "  .\scripts\deploy-to-nas.ps1 -Restart"
  Write-Host ""
  Write-Host "After the bind-mount compose update is applied once in Synology, future code deploys only need a restart."
  exit 0
}

Write-Host ""
Write-Host "Restart requested."
Write-Host "If Synology Container Manager is not already using the updated compose file, rebuild/recreate the project once."
Write-Host "After that, restart-only deploys are enough for server.js/docs/script changes."

if (-not $SkipHealthCheck) {
  Write-Host ""
  Write-Host "Waiting briefly before health check..."
  Start-Sleep -Seconds 5
  try {
    $health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 10
    Write-Host "Health check OK:"
    $health | ConvertTo-Json -Depth 4
  } catch {
    Write-Host "Health check failed or app is still restarting:"
    Write-Host $_.Exception.Message
  }
}
