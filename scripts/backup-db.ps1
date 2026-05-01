# Orca — Daily PostgreSQL Backup
#
# Usage (interactive):
#   .\scripts\backup-db.ps1
#
# Usage (Scheduled Task — see DEPLOYMENT.md "💾 النسخ الاحتياطي"):
#   powershell.exe -ExecutionPolicy Bypass -File "C:\path\to\Trading\scripts\backup-db.ps1"
#
# Environment variables (override defaults):
#   ORCA_PG_USER       (default: postgres)
#   ORCA_PG_HOST       (default: localhost)
#   ORCA_PG_DB         (default: orca)
#   ORCA_PG_PASSWORD   (REQUIRED — not stored in this script)
#   ORCA_BACKUP_DIR    (default: C:\backups\orca)
#   ORCA_BACKUP_KEEP   (default: 14 days; older backups are pruned)

$ErrorActionPreference = 'Stop'

# ─── Config ───
$pgUser     = $env:ORCA_PG_USER     ?? 'postgres'
$pgHost     = $env:ORCA_PG_HOST     ?? 'localhost'
$pgDb       = $env:ORCA_PG_DB       ?? 'orca'
$pgPassword = $env:ORCA_PG_PASSWORD ?? $env:PGPASSWORD
$backupDir  = $env:ORCA_BACKUP_DIR  ?? 'C:\backups\orca'
$keepDays   = [int]($env:ORCA_BACKUP_KEEP ?? 14)

if (-not $pgPassword) {
    Write-Error 'Set $env:ORCA_PG_PASSWORD or $env:PGPASSWORD before running.'
    exit 1
}

# Locate pg_dump.exe (try common Windows install paths).
$pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue
if (-not $pgDump) {
    foreach ($v in 18, 17, 16, 15) {
        $candidate = "C:\Program Files\PostgreSQL\$v\bin\pg_dump.exe"
        if (Test-Path $candidate) { $pgDump = $candidate; break }
    }
}
if (-not $pgDump) {
    Write-Error 'pg_dump not found in PATH or default install locations.'
    exit 1
}
$pgDumpPath = if ($pgDump.Source) { $pgDump.Source } else { $pgDump }

# Ensure backup dir exists.
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

# ─── Run backup ───
$timestamp = Get-Date -Format 'yyyy-MM-dd_HHmm'
$outFile   = Join-Path $backupDir "orca-$timestamp.backup"
$logFile   = Join-Path $backupDir "backup.log"

Write-Host "→ Backing up $pgDb to $outFile"

$env:PGPASSWORD = $pgPassword
& $pgDumpPath -U $pgUser -h $pgHost -d $pgDb -F c -b -v -f $outFile 2>&1 |
    Tee-Object -Append -FilePath $logFile

if ($LASTEXITCODE -ne 0) {
    Write-Error "pg_dump failed (exit $LASTEXITCODE) — see $logFile"
    exit $LASTEXITCODE
}

$sizeMB = [math]::Round((Get-Item $outFile).Length / 1MB, 2)
Write-Host "✓ Backup complete: $outFile ($sizeMB MB)"

# ─── Prune old backups ───
$cutoff = (Get-Date).AddDays(-$keepDays)
$pruned = Get-ChildItem $backupDir -Filter 'orca-*.backup' |
    Where-Object { $_.LastWriteTime -lt $cutoff }
if ($pruned) {
    $pruned | Remove-Item
    Write-Host "→ Pruned $($pruned.Count) backup(s) older than $keepDays days."
}

Write-Host ('=' * 60)
