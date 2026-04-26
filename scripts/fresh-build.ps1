# Orca - Clean build of everything in correct dependency order
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

Write-Host "Killing node processes..." -ForegroundColor Yellow
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 3

Write-Host "Cleaning dist + .next + .turbo + tsbuildinfo..." -ForegroundColor Yellow
Get-ChildItem -Recurse -Force -Directory -Include 'dist', '.next', '.turbo' -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch 'node_modules' } |
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Get-ChildItem -Recurse -Force -File -Filter '*.tsbuildinfo' -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch 'node_modules' } |
  Remove-Item -Force -ErrorAction SilentlyContinue

Write-Host "Generating Prisma client..." -ForegroundColor Yellow
pnpm -w run db:generate

# Explicit dependency order: shared/config first, then logger/db, then exchange,
# then strategies, then apps. This is more reliable than depending on Turbo's
# parallel execution for a clean build.
$packages = @(
    "@orca/shared",
    "@orca/config",
    "@orca/logger",
    "@orca/db",
    "@orca/exchange",
    "@orca/strategies",
    "@orca/api",
    "@orca/engine",
    "@orca/web"
)

foreach ($pkg in $packages) {
    Write-Host "Building $pkg..." -ForegroundColor Cyan
    pnpm --filter $pkg build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Build failed for $pkg" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "Verifying build artifacts..." -ForegroundColor Yellow
$artifacts = @(
    "apps\api\dist\main.js",
    "apps\engine\dist\main.js",
    "apps\web\.next\BUILD_ID"
)
$ok = $true
foreach ($a in $artifacts) {
    if (Test-Path (Join-Path $root $a)) {
        Write-Host "  $a : OK" -ForegroundColor Green
    } else {
        Write-Host "  $a : MISSING" -ForegroundColor Red
        $ok = $false
    }
}

if ($ok) {
    Write-Host ""
    Write-Host "Build complete." -ForegroundColor Green
    Write-Host "Run: pnpm start:all" -ForegroundColor Cyan
} else {
    Write-Host ""
    Write-Host "Build incomplete. See errors above." -ForegroundColor Red
    exit 1
}
