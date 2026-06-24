param(
  [string]$OutputPath = "$env:USERPROFILE\Desktop\auri-nas"
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$AppDataDb = Join-Path $env:LOCALAPPDATA "Auri\auri.db"
$DataSource = Join-Path $ProjectRoot "data"
$DataTarget = Join-Path $OutputPath "data"
$OutputLeaf = Split-Path -Leaf $OutputPath

if ([string]::IsNullOrWhiteSpace($OutputPath) -or $OutputLeaf -notmatch "auri") {
  throw "OutputPath must point to a dedicated folder with 'auri' in the folder name. Current value: $OutputPath"
}

if ((Test-Path $OutputPath) -and (Resolve-Path $OutputPath).Path -eq (Resolve-Path $ProjectRoot).Path) {
  throw "Refusing to replace the project folder. Choose a separate output folder."
}

if (-not (Test-Path $AppDataDb)) {
  throw "Could not find the current Auri database at $AppDataDb"
}

if (-not (Test-Path (Join-Path $ProjectRoot ".env"))) {
  throw "Could not find .env in $ProjectRoot"
}

if (Test-Path $OutputPath) {
  Remove-Item -LiteralPath $OutputPath -Recurse -Force
}

New-Item -ItemType Directory -Path $OutputPath | Out-Null
New-Item -ItemType Directory -Path $DataTarget | Out-Null

$files = @(
  "Dockerfile",
  "docker-compose.yml",
  "package.json",
  "package-lock.json",
  "server.js",
  ".env",
  ".env.example",
  "README.md",
  "NEXT.md",
  "NAS_DEPLOYMENT.md",
  "M5DIAL_PLAN.md",
  "PROJECT_STATUS.md"
)

foreach ($file in $files) {
  Copy-Item -LiteralPath (Join-Path $ProjectRoot $file) -Destination (Join-Path $OutputPath $file)
}

Copy-Item -LiteralPath $AppDataDb -Destination (Join-Path $DataTarget "auri.db")

if (Test-Path $DataSource) {
  foreach ($item in Get-ChildItem -LiteralPath $DataSource -Force) {
    if ($item.Name -eq ".gitkeep") {
      continue
    }

    Copy-Item -LiteralPath $item.FullName -Destination $DataTarget -Recurse -Force
  }
}

$ScriptsTarget = Join-Path $OutputPath "scripts"
New-Item -ItemType Directory -Path $ScriptsTarget | Out-Null
Get-ChildItem -LiteralPath (Join-Path $ProjectRoot "scripts") -File | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $ScriptsTarget $_.Name)
}

Write-Host "Auri NAS deployment folder prepared:"
Write-Host $OutputPath
Write-Host ""
Write-Host "Copy this folder to your Synology NAS, for example:"
Write-Host "/volume1/docker/auri"
