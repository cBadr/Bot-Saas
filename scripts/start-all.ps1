# Orca - Start all services in separate PowerShell windows
# Usage: pwsh ./scripts/start-all.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent

Write-Host ""
Write-Host "  Orca Trading Platform - Starting all services..." -ForegroundColor Cyan
Write-Host ""

# 1. Sanity checks
Write-Host "[1/4] Checking infrastructure..." -ForegroundColor Yellow

$redisCli = "C:\Program Files\Memurai\memurai-cli.exe"
if (-not (Test-Path $redisCli)) { $redisCli = "C:\Program Files\Memurai Developer\memurai-cli.exe" }
if (Test-Path $redisCli) {
    $pong = & $redisCli PING 2>$null
    if ($pong -eq "PONG") { Write-Host "  Redis (Memurai) : OK" -ForegroundColor Green }
    else { Write-Host "  Redis (Memurai) : NOT RESPONDING" -ForegroundColor Red; exit 1 }
} else { Write-Host "  Memurai CLI not found" -ForegroundColor Yellow }

$pgService = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($pgService -and $pgService.Status -eq "Running") {
    Write-Host "  PostgreSQL      : OK ($($pgService.Name))" -ForegroundColor Green
} else {
    Write-Host "  PostgreSQL      : NOT RUNNING (start it manually)" -ForegroundColor Red
    exit 1
}

# 2. Kill stale processes (CRITICAL — stale processes serve old code on the same ports)
Write-Host "[2/4] Killing ALL stale node processes..." -ForegroundColor Yellow
$staleCount = (Get-Process node -ErrorAction SilentlyContinue).Count
if ($staleCount -gt 0) {
    Write-Host "  Found $staleCount stale node processes. Killing..." -ForegroundColor Yellow
    Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 3
    $remaining = (Get-Process node -ErrorAction SilentlyContinue).Count
    if ($remaining -gt 0) {
        Write-Host "  Retrying for $remaining stubborn processes..." -ForegroundColor Yellow
        Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
        Start-Sleep -Seconds 2
    }
}
Write-Host "  All node processes terminated" -ForegroundColor Green

# 3. Verify build artifacts
Write-Host "[3/4] Checking builds..." -ForegroundColor Yellow
$missing = @()
$artifacts = @(
    "apps\api\dist\main.js",
    "apps\engine\dist\main.js",
    "apps\web\.next"
)
foreach ($a in $artifacts) {
    $full = Join-Path $root $a
    if (-not (Test-Path $full)) { $missing += $a }
}
if ($missing.Count -gt 0) {
    Write-Host "  Missing builds: $($missing -join ', ')" -ForegroundColor Red
    Write-Host "  Auto-building now (this takes ~1-2 minutes)..." -ForegroundColor Yellow
    & (Join-Path $PSScriptRoot 'fresh-build.ps1')
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  Build failed. Aborting." -ForegroundColor Red
        exit 1
    }
}
Write-Host "  All build artifacts present" -ForegroundColor Green

# 4. Launch services in new windows
Write-Host "[4/4] Launching services..." -ForegroundColor Yellow

$services = @(
    @{ name = "Orca API";    cmd = "pnpm --filter @orca/api start"    },
    @{ name = "Orca Engine"; cmd = "pnpm --filter @orca/engine start" },
    @{ name = "Orca Web";    cmd = "pnpm --filter @orca/web start"    }
)

foreach ($s in $services) {
    Write-Host "  Starting $($s.name)..." -ForegroundColor Cyan
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root'; Write-Host '=== $($s.name) ===' -ForegroundColor Cyan; $($s.cmd)"
    Start-Sleep -Milliseconds 800
}

Write-Host ""
Write-Host "  Waiting ~15s for services to boot..." -ForegroundColor Yellow
Start-Sleep -Seconds 15

Write-Host ""
Write-Host "  Verifying services are responding..." -ForegroundColor Yellow
$endpoints = @(
    @{ name = "API";    url = "https://orcax.click/api/v1/health" },
    @{ name = "Engine"; url = "http://localhost:4001/health" },
    @{ name = "Web";    url = "https://orcax.click/" }
)
foreach ($e in $endpoints) {
    try {
        $r = Invoke-WebRequest -Uri $e.url -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
        if ($r.StatusCode -eq 200) {
            Write-Host "    $($e.name.PadRight(8)) : OK ($($e.url))" -ForegroundColor Green
        } else {
            Write-Host "    $($e.name.PadRight(8)) : HTTP $($r.StatusCode)" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "    $($e.name.PadRight(8)) : NOT RESPONDING ($($e.url))" -ForegroundColor Red
        Write-Host "      Check the $($e.name) window for errors" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "  Open https://orcax.click" -ForegroundColor Cyan
Write-Host "  Default admin: admin@orca.local / ChangeMe123!" -ForegroundColor Cyan
Write-Host ""
