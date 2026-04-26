# Orca - Stop all services
Write-Host "Stopping all Orca services..." -ForegroundColor Yellow
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1
$count = (Get-Process node -ErrorAction SilentlyContinue).Count
if ($count -eq 0) { Write-Host "All node processes stopped." -ForegroundColor Green }
else { Write-Host "$count node processes still running." -ForegroundColor Red }
