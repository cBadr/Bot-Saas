# 🆘 Orca — Operational Runbook

Step-by-step playbooks for the most likely failure modes. Each section is
self-contained — find your symptom, follow the steps, escalate only if you
get to the bottom and the problem persists.

---

## 1. 🔴 API / Engine / Web won't start

**Symptom:** `pnpm start:all` exits immediately, or service fails to bind to its port.

```powershell
# 1. Identify what's running
Get-Process node -ErrorAction SilentlyContinue | Format-Table Id, StartTime, CPU
Get-NetTCPConnection -LocalPort 3000,4000,4001 -State Listen -ErrorAction SilentlyContinue

# 2. Kill any stale node processes
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force

# 3. Verify infrastructure
Get-Service Memurai, postgresql-x64-18 | Format-Table Name, Status
# If either is "Stopped" → Start-Service Memurai (or postgresql-x64-18)

# 4. Confirm .env exists with required vars
Test-Path .env
Get-Content .env | Select-String -Pattern '^(DATABASE_URL|REDIS_URL|AUTH_SECRET|ENCRYPTION_SECRET)='

# 5. Rebuild cleanly
pnpm fresh:build

# 6. Start
pnpm start:all
```

If the issue persists, **check the per-service log file**:
- `logs/api.log` / `logs/api.err.log`
- `logs/engine.log` / `logs/engine.err.log`

---

## 2. 🛢️ Database connection / migration failures

### 2a. `Error: P1002` — postgres advisory lock timeout

**Symptom:** A previous Prisma migration died holding an advisory lock; subsequent migrations time out.

```powershell
# Kill node processes that might be holding the connection
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force

# Clear ALL advisory locks
$env:PGPASSWORD = 'YOUR_DB_PASSWORD'
psql -U postgres -h localhost -d orca -c "SELECT pg_advisory_unlock_all();"

# Re-check (should show no rows)
psql -U postgres -h localhost -d orca -c "SELECT pid, locktype, mode, granted FROM pg_locks WHERE locktype = 'advisory';"

# Now retry the migration
pnpm --filter @orca/db migrate --name <name>
```

### 2b. `EPERM: query_engine-windows.dll.node`

**Symptom:** Prisma cannot rewrite its engine binary because another node process is holding it.

```powershell
Get-Process node | Stop-Process -Force
# Wait a moment for Windows to release the file
Start-Sleep -Seconds 2
pnpm --filter @orca/db migrate --name <name>
```

---

## 3. 🤖 Bot is "RUNNING" but not placing orders

**Symptoms:**
- Bot status shows RUNNING
- No new orders on Binance
- No new BotEvent rows for the last 15+ minutes

```powershell
# 1. Check engine is still running
Get-Process node | Where-Object { $_.MainWindowTitle -like '*engine*' }

# 2. Check engine log for fatal errors
Get-Content logs\engine.log -Tail 100 | Select-String -Pattern 'ERROR|FATAL|HTTP 410|-2014|-2015'
```

**Common causes:**

| What you see in logs | Cause | Fix |
|---|---|---|
| `HTTP 410` on `/api/v3/userDataStream` | Outdated Binance endpoint | Already fixed via `WebSocketUserStream` — verify engine binary is up-to-date (`pnpm --filter @orca/engine build`) |
| `code: -2014` / `-2015` | Invalid API key | Re-create the key in Binance + update via `/exchange-keys` page |
| `-2010 insufficient balance` repeated | Real funds shortage | User issue — top up FDUSD |
| `-2010 would immediately match` repeated | Spread too tight | User should widen `gridSpread` |
| `Stale state — clearing` | Bot crashed mid-cycle | Reset state (see 3a) |

### 3a. Reset stuck bot state

```sql
-- Open psql:
-- $env:PGPASSWORD='Medoza120a'; psql -U postgres -h localhost -d orca

-- Inspect:
SELECT id, name, status,
       state->>'cyclesCompleted' AS cycles,
       state->>'realizedPnlQuote' AS realized,
       state IS NULL AS no_state
FROM "Bot" WHERE name = 'YOUR_BOT_NAME';

-- Reset (forces fresh init on next start):
UPDATE "Bot" SET status='STOPPED', state=NULL WHERE id='THE_ID';

-- Verify
SELECT status, state FROM "Bot" WHERE id='THE_ID';
```

Then start the bot again from the UI.

---

## 4. 📊 Wrong P&L numbers in Dashboard / Reports

**Symptoms:**
- Dashboard says +94.86 but bot detail page says +12.34 (or vice versa)
- Realized P&L doesn't match what you see on the bot page
- Numbers haven't updated since a deploy

**Cause:** Most likely reading the legacy `Bot.realizedPnlQuote` column instead of the authoritative `state.realizedPnlQuote`. This is HANDOFF Gotcha #21.

```powershell
# 1. Hard refresh browser (Ctrl+Shift+R) to clear TanStack Query cache

# 2. Verify the API returns authoritative data
curl http://localhost:4000/api/v1/bots `
  -H "Authorization: Bearer YOUR_JWT" |
  ConvertFrom-Json |
  Select-Object -ExpandProperty data |
  Select-Object name, @{N='realized';E={$_.liveStats.realized}}, @{N='cycles';E={$_.liveStats.cyclesCompleted}}
```

Each bot's `liveStats.realized` should match what shows on its detail page. If they DON'T match, the API is computing from state correctly but the UI is reading the wrong field. Check the page's component code for `b.realizedPnlQuote` (legacy) and replace with `b.liveStats?.realized`.

---

## 5. 🔁 Bot creates duplicate orders

**Symptom:** After a fill, the bot places 2 (or more) counter orders at the same price. State shows extra `unmatched` entries.

**Cause:** Idempotency broken — the same FILLED event was processed multiple times (Gotcha #16).

```powershell
# 1. Check engine logs for repeated fill events
Get-Content logs\engine.log -Tail 200 | Select-String 'BUY_FILLED|SELL_FILLED' | Select-Object -Last 20

# 2. Check the strategy state's processedFills ring
$env:PGPASSWORD='Medoza120a'
psql -U postgres -h localhost -d orca -c "SELECT name, jsonb_array_length(state->'processedFills') AS dedup_count FROM \"Bot\" WHERE state IS NOT NULL;"
```

**Fix path:**
1. Stop the bot
2. Reset state (see 3a)
3. Start bot — the new `processedFills` ring should prevent the bug from recurring
4. If it recurs, file a bug report — the lock or dedup is broken

---

## 6. 🌐 Web shows "Network Error" or 502

**Symptom:** UI loads but every API request fails.

```powershell
# 1. Verify API is up
curl http://localhost:4000/api/v1/health
# Expected: { "ok": true, "data": { "api": "ok", ... } }

# 2. Check connection-status badge in topbar (shows API/DB/Redis/Binance status)

# 3. If API is down, restart it
Get-Process node | Where-Object { $_.MainWindowTitle -like '*api*' } | Stop-Process -Force
pnpm --filter @orca/api start
```

If running on Windows Server with Nginx (production): see `DEPLOYMENT.md` § "🩺 التشخيص".

---

## 7. 💾 Restore from backup

**Prerequisites:**
- Backup file at `C:\backups\orca\orca-YYYY-MM-DD_HHMM.backup` (created by `scripts/backup-db.ps1`)

```powershell
# STOP all services first to avoid race conditions
pnpm stop:all
Get-Process node | Stop-Process -Force

# Drop + recreate the orca database (DESTRUCTIVE)
$env:PGPASSWORD = 'YOUR_DB_PASSWORD'
psql -U postgres -h localhost -c "DROP DATABASE orca;"
psql -U postgres -h localhost -c "CREATE DATABASE orca;"

# Restore from the chosen backup
pg_restore -U postgres -h localhost -d orca -v `
  "C:\backups\orca\orca-2026-04-30_0300.backup"

# Verify a known table loaded
psql -U postgres -h localhost -d orca -c "SELECT count(*) FROM \"Bot\";"

# Re-run migrate deploy in case the backup is from an older schema
pnpm --filter @orca/db prisma migrate deploy

# Restart services
pnpm start:all
```

---

## 8. 🔔 Telegram notifications not arriving

**Symptoms:**
- Bot fills happen on Binance
- Bot detail page shows new BotEvents
- But Telegram is silent

```powershell
# 1. Check user has chat ID set
$env:PGPASSWORD='Medoza120a'
psql -U postgres -h localhost -d orca -c "SELECT email, \"telegramChatId\", \"fillFrequency\" FROM \"User\";"

# 2. Verify NotificationLog has recent entries
psql -U postgres -h localhost -d orca -c "SELECT \"createdAt\", channel, \"eventType\", success, error FROM \"NotificationLog\" ORDER BY \"createdAt\" DESC LIMIT 10;"

# 3. Check API log for dispatcher errors
Get-Content logs\api.log -Tail 100 | Select-String 'NotificationDispatcher|telegram|Telegram'

# 4. Test telegram directly via API endpoint
# (login first, copy JWT from devtools)
curl -X POST http://localhost:4000/api/v1/users/me/telegram/test -H "Authorization: Bearer YOUR_JWT"
```

**Common causes:**

| What you see | Fix |
|---|---|
| `telegramChatId IS NULL` | User must set chat ID in `/settings/notifications` |
| `success=false, error="chat not found"` | Wrong chat ID OR user hasn't started a DM with the bot yet |
| `success=false, error="bot was blocked"` | User blocked the Orca bot — they must `/start` it again |
| No NotificationLog rows for recent events | NotificationDispatcher not subscribed to Pub/Sub. Check `NotificationDispatcher init OK` in API startup log |
| All success=true but user reports no message | Frequency-gated. Check `fillFrequency` and event type vs user prefs |

---

## 9. 📅 Periodic status reports not firing

**Symptoms:**
- User configured `statusReportIntervalMinutes` > 0 but no reports arrive

```sql
-- Check user config
SELECT email,
       "lastStatusReportAt",
       "notificationConfig"->>'statusReportIntervalMinutes' AS interval_min,
       "notificationConfig"->>'statusReportBots' AS selected_bots
FROM "User";
```

**Common causes:**
- `lastStatusReportAt` was just updated (not due yet) — wait one full interval
- StatusReportService not running — check API startup log for `StatusReportService Started`
- All user's bots filtered out → service skips silently. Verify selection includes at least one bot

**Force-trigger** to confirm wiring:
```bash
curl -X POST http://localhost:4000/api/v1/status-report/send-now \
  -H "Authorization: Bearer YOUR_JWT"
```
Response should be `{ ok: true, botsIncluded: N }`.

---

## 10. 🚨 Emergency: Stop ALL bots immediately

If something is going terribly wrong (mass losses, runaway logic, etc.):

**Option A — UI Kill Switch (fastest):**
- Go to `/bots` page → click **🛑 Kill Switch (N)** button (top right)
- All running bots stop, all open orders cancelled

**Option B — API:**
```powershell
curl -X POST http://localhost:4000/api/v1/bots/emergency-stop `
  -H "Authorization: Bearer YOUR_JWT"
```

**Option C — Direct DB (last resort, no order cancellation):**
```sql
UPDATE "Bot" SET status='STOPPED', "stoppedAt"=NOW() WHERE status IN ('RUNNING', 'STARTING');
```

Then manually cancel any leftover orders on Binance via the wallet page or the Binance website directly.

---

## 11. 🧪 Run the test suite

After any code changes affecting strategies / notifications:

```powershell
# Run all package tests
pnpm test

# Run only strategy tests (faster)
pnpm --filter @orca/strategies test

# Watch mode for development
pnpm --filter @orca/strategies test:watch

# Type-check everything
pnpm type-check
```

CI also runs these on every push (see `.github/workflows/ci.yml`).

---

## Appendix: Useful one-liners

```powershell
# Latest 20 BotEvents across all bots
$env:PGPASSWORD='Medoza120a'
psql -U postgres -h localhost -d orca -c "SELECT \"createdAt\", type, message FROM \"BotEvent\" ORDER BY \"createdAt\" DESC LIMIT 20;"

# Today's realized P&L per bot (from authoritative state)
psql -U postgres -h localhost -d orca -c "SELECT name, state->>'realizedPnlQuote' AS realized, state->>'cyclesCompleted' AS cycles FROM \"Bot\" WHERE state IS NOT NULL ORDER BY (state->>'realizedPnlQuote')::numeric DESC;"

# Recent integrity events
psql -U postgres -h localhost -d orca -c "SELECT \"createdAt\", type, message FROM \"BotEvent\" WHERE type LIKE '%INTEGRITY%' ORDER BY \"createdAt\" DESC LIMIT 20;"

# Open orders count per bot (DB tracking)
psql -U postgres -h localhost -d orca -c "SELECT b.name, COUNT(o.id) FROM \"Bot\" b LEFT JOIN \"Order\" o ON o.\"botId\"=b.id AND o.status IN ('NEW','PARTIALLY_FILLED') GROUP BY b.name ORDER BY 2 DESC;"

# Watch engine log live
Get-Content logs\engine.log -Tail 50 -Wait

# Free disk + memory
Get-PSDrive C | Select-Object Used, Free
Get-CimInstance Win32_OperatingSystem | Select-Object @{N='FreeGB';E={[math]::Round($_.FreePhysicalMemory/1MB,2)}}
```

---

**END OF RUNBOOK** — escalate to source-code investigation only after the relevant playbook section has been exhausted.
