# 🐋 Orca — Project Handoff & Reference

**Last updated:** 2026-04-26
**Owner:** Badr (`admin@orca.local` / `ChangeMe123!`)
**Path:** `c:\Users\Badr\OneDrive\Desktop\Trading\`
**Repo:** local only, branch `master`

> Read this file first when resuming work. It contains everything needed to continue
> the project effectively — architecture, conventions, known gotchas, and roadmap.

---

## 📍 Quick Resume Commands

```powershell
cd c:\Users\Badr\OneDrive\Desktop\Trading
pnpm fresh:build      # rebuilds packages in correct order (~1-2 min)
pnpm start:all        # spawns 3 PowerShell windows: API + Engine + Web
# Open http://localhost:3000  →  admin@orca.local / ChangeMe123!
```

If anything seems off, see [Known Gotchas](#-known-gotchas--lessons-learned).

---

## 🎯 What Orca Is

A **professional crypto trading SaaS** built on Binance, with:
- Pre-built strategies (Grid, DCA, MA Cross) + a **visual node-based strategy builder**
- Real-time bot execution with Binance WebSocket API
- Paper trading + Backtesting against real historical data
- Multi-tenant: each user has bots, API keys, subscriptions
- CoinPayments crypto subscriptions
- Admin panel
- 2FA, encrypted API keys at rest, kill switch, risk management
- All Binance orders MUST be **LIMIT** (zero fees on FDUSD pairs)

---

## 🏗️ Stack & Architecture

### Monorepo (pnpm + Turborepo)

```
Trading/
├── apps/
│   ├── api/           # NestJS 11 REST + Socket.IO  (port 4000)
│   ├── engine/        # Bot execution worker        (port 4001)
│   └── web/           # Next.js 15 + React 19       (port 3000)
├── packages/
│   ├── config/        # @orca/config — env loader (Zod)
│   ├── shared/        # @orca/shared — types, constants, utils
│   ├── logger/        # @orca/logger — Pino
│   ├── db/            # @orca/db — Prisma 6
│   ├── exchange/      # @orca/exchange — Binance connector
│   └── strategies/    # @orca/strategies — Grid/DCA/MA/Graph
├── scripts/           # PowerShell helpers (start-all, stop-all, fresh-build)
├── .env               # all secrets here
├── RUNNING.md         # user-facing run guide
└── HANDOFF.md         # this file
```

### Critical Build Conventions

- **All packages compile to CommonJS** (`tsconfig.base.json`: `module: CommonJS`, `moduleResolution: Node`).
- **Each package has a `dist/`** that the apps consume via `main: ./dist/index.js`.
- **NestJS API** uses `target: ES2022` + `useDefineForClassFields: false` — **CRITICAL**, otherwise constructor parameter properties evaluate to `undefined` (silent DI failure).
- **`incremental: false`** in tsconfig — earlier `tsbuildinfo` caused phantom "0 errors but no output" builds.
- **Prisma client is rebuilt** as part of `fresh:build` because `db:generate` writes into `node_modules/.pnpm/...`.

### Service Topology

```
PostgreSQL :5432  ←──── Prisma ──── @orca/db ──── used by API + Engine + scripts
Redis (Memurai) :6379 ─── ioredis ─── used by API (rate-limit, queues, pub/sub) + Engine

Web :3000  ───── HTTP ────→  API :4000  ───── Pub/Sub ────→  Engine :4001
   │                              │                              │
   └────── Socket.IO (live updates) ─────────────────────────────┘
                                                                 │
                                                                 ↓
                                                Binance REST + WebSocket API
```

---

## 📦 Package Reference

### `@orca/shared`
**Purpose:** Shared types, constants, utility functions used by all packages.

Key exports:
- `Decimal` (from `decimal.js`, configured for 30-digit precision)
- `roundToTickSize(price, tickSize)`, `roundToStepSize(qty, stepSize)`
- `encryptSecret(plain, key)`, `decryptSecret(enc, key)` — AES-256-GCM
- `OrcaError`, `BinanceApiError`, `RateLimitError`, `InvalidOrderError`
- Constants: `FEE_FREE_QUOTE_ASSET = 'FDUSD'`, `ALLOWED_ORDER_TYPES`, `BOT_STATUSES`, etc.
- `BinanceAccountInfo`, `BinanceOrderResponse`, `PlaceOrderParams` types

### `@orca/config`
**Purpose:** Single source of truth for env vars (Zod-validated).

- `env` — proxy that lazy-loads + validates `.env` on first access
- Loads `.env.local` then `.env` from cwd or 2 levels up

Required env vars:
- `DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET` (≥16 chars)
- `ENCRYPTION_SECRET` (≥16 chars, used to encrypt API keys at rest)
- Optional: `TELEGRAM_BOT_TOKEN`, `COINPAYMENTS_*`, `BINANCE_*` rate limits

### `@orca/logger`
**Purpose:** Structured logging via Pino.

- `createLogger(category, ctx)` — categories: `APP`, `TRADE`, `API`, `BINANCE`, `AUDIT`, `BOT`, `STRATEGY`, `PAYMENT`, `AUTH`, `SYSTEM`
- Logs to stdout (pretty in dev) + daily-rotated file in `./logs/app.log.YYYY-MM-DD.N`
- Auto-redacts `password`, `token`, `apiKey`, `apiSecret`, `secret`, `authorization`, `cookie`

### `@orca/db`
**Purpose:** Prisma schema + client.

24 models, key ones:
- `User`, `Session`, `PasswordResetToken` — auth
- `ExchangeApiKey` — Binance keys (encrypted with AES-256-GCM)
- `Strategy` — built-in (`builtinKey`) or custom (`type=CUSTOM`, definition has `engine`)
- `Bot` — has `params`, `state` (strategy state), `paperTrading`, `dailyLossLimit`, `maxDrawdownPct`, aggregate stats
- `Order`, `Trade` — execution history
- `BotEvent` — high-level audit (GRID_INITIALIZED, ORDER_PLACED, BUY_FILLED, ...)
- `Plan`, `Subscription`, `Payment` — billing
- `NotificationPreference`, `NotificationLog` — in-app + telegram inbox
- `AuditLog`, `SystemLog`, `BinanceApiCallLog` — observability
- `AppSetting`, `FeatureFlag` — admin-tunable
- `ExchangeSymbol` — cached Binance symbol filters

Migration commands (always from project root):
```bash
pnpm -w run db:migrate              # creates + applies migration
pnpm -w run db:seed                 # adds default plans, strategies, admin
pnpm -w run db:studio               # browser UI to inspect data
```

> ⚠️ Migration tip: kill ALL node processes before migrating, otherwise Windows file locking blocks Prisma from rewriting the engine binary.

### `@orca/exchange`
**Purpose:** Binance connector layer.

- `BinanceClient` — REST API client (signed + public + api-key-only requests)
- `binanceTimeSync` — global singleton, polls Binance server time every 60s, all signed requests use `Date.now() + offset`
- `BinanceRateLimiter` — Redis-backed sliding window (1100/min, 45 orders/10s, 160k/day)
- `WebSocketUserStream` — **real-time** user data via WS API (replaces deprecated REST `/api/v3/userDataStream`)
- `UserDataStream` — DEPRECATED (kept as legacy reference, returns HTTP 410 from Binance)
- `MarketStream` — public market data WS
- `extractFilters(symbolInfo)` — pulls tickSize/stepSize/minNotional/etc.
- `validateOrder(filters, price, qty)` — pre-flight check before placing

### `@orca/strategies`
**Purpose:** Strategy implementations.

Built-in strategies (`builtinKey`):
- **`grid_v1`** — Grid trading, arithmetic/geometric spacing, `orderSizeMultiplier` for martingale-style sizing
- **`dca_v1`** — DCA with `direction: BUY|SELL`, time and/or price gates (independent or both)
- **`ma_cross_v1`** — MA Crossover (golden/death cross)
- **`graph_v1`** — Custom node-based strategies (interprets the visual builder graph)

Each strategy implements `Strategy<TParams>` from `base.ts`:
```ts
{ key, validateParams, init, onOrderUpdate, onTick, stop }
```

`StrategyContext` (passed to strategy methods):
- `botId`, `symbol`, `filters`
- `client: BinanceClient`
- `logger: OrcaLogger`
- `saveState(state)`, `loadState<T>()`
- `emit(type, message, data)` — persists to BotEvent + publishes via Redis Pub/Sub
- `cancelMyOrders()` — **only** cancels orders this bot placed (uses DB tracking)

Indicators (`graph/indicators.ts`): `RollingSMA`, `RollingRSI` (Wilder's), `RisingEdge` (debounce).

---

## 🚀 App Reference

### `apps/api` (NestJS, port 4000, prefix `/api/v1`)

Modules:
- **Auth** — register, login (with optional 2FA code), refresh, logout, forgot-password, reset-password
- **Users** — profile, change password, 2FA setup/verify/disable
- **ExchangeKeys** — CRUD + test + per-asset balance lookup
- **Strategies** — list/get/create/update/delete custom strategies
- **Bots** — full CRUD, start/stop, events, orders, recompute-stats, **emergency-stop (kill switch)**, update risk
- **Plans** — public plan listing
- **Subscriptions** — current sub, history, cancel auto-renew
- **Payments** — CoinPayments checkout + IPN webhook (HMAC-SHA512 verified)
- **Admin** — stats, users (role/status), plans CRUD, settings, feature flags, audit log
- **Audit** — global service for admin actions
- **Notifications** — preferences + in-app inbox + Telegram client
- **Reports** — overview, daily P&L series, per-bot performance + win rate + drawdown
- **Backtest** — dispatches to `runGrid` or `runGraph` based on strategy type
- **Realtime** — Socket.IO gateway, JWT-authed, bot-room subscriptions
- **Health** — `/health` aggregates DB/Redis/Binance status
- **BinanceSync** — bootstraps `binanceTimeSync` on app start

Critical decisions:
- **No global ValidationPipe** — uses per-route `@Body(new ZodValidationPipe(Schema)) dto: T` pattern (NOT `@UsePipes` which incorrectly applies to ALL parameters)
- **`bodyParser: false`** in NestFactory + custom `app.use(json(...))` to capture raw body for IPN HMAC verification
- **Response shape**: `{ ok: true, data }` or `{ ok: false, error: { code, message, details } }`
- **CORS** allows `http://localhost:3000` by default (`API_CORS_ORIGIN`)
- **Throttler** global: 200 req/min per IP

### `apps/engine` (Node, port 4001)

Components:
- **`main.ts`** — bootstraps Time Sync, Redis pub/sub, RunnerManager, exposes `/health`
- **`RunnerManager`** — manages active `BotRunner` instances, capacity limit (10/worker default), `resumeAll()` on boot
- **`BotRunner`** — per-bot lifecycle:
  1. Loads bot + apiKey + strategy from DB
  2. **Decrypts** apiKey/apiSecret with `ENCRYPTION_SECRET`
  3. If paper trading → uses `PaperBinanceClient` (in-memory simulator)
  4. Else → real `BinanceClient` + opens **WebSocket user stream** (real-time fills)
  5. Also starts **OrderPoller** (30s interval) as safety net
  6. Calls `strategy.init(ctx, params)`
  7. Periodic tick every 5s → `strategy.onTick(ctx, params, lastPrice)` + risk checks
  8. On Binance fill → `strategy.onOrderUpdate(ctx, params, event)` + persists Order/Trade + updates aggregate stats
- **`PaperBinanceClient`** — full Binance API simulator with paper balances, fills LIMIT orders against live ticker
- **`WebSocketUserStream`** (in `@orca/exchange`) — real-time fills via Binance WS API
- **`OrderPoller`** — fetches `getOpenOrders` + `getOrder`, persists missing rows, detects status transitions
- **`CommandListener`** — subscribes to Redis `orca:engine:cmd` for START/STOP/EMERGENCY_STOP_USER
- **`StrategyContext` builder** — wires strategies to DB + Redis pub/sub
- **`bot-stats.ts`** — `updateBotStats(botId)` recomputes aggregates from Trade history (weighted avg cost)

Risk management (in BotRunner.tick):
- Checks `dailyLossLimit` against today's realized losses
- Checks `maxDrawdownPct` from peak P&L
- If breached → auto-stops bot + emits `RISK_DAILY_LOSS` / `RISK_MAX_DRAWDOWN` events

### `apps/web` (Next.js 15 App Router, port 3000)

Routes:
- **Public:** `/`, `/login`, `/register`, `/forgot-password`, `/reset-password`, `/pricing`
- **Authenticated `(dashboard)/`:**
  - `/dashboard` — stats + onboarding wizard
  - `/bots` — list + Kill Switch button + Recompute Stats
  - `/bots/new` — strategy-aware form + **live preview SVG** + balance auto-fill
  - `/bots/:id` — detail + events + orders + recompute
  - `/exchange-keys` — CRUD + test
  - `/strategies` — list + link to builder
  - `/strategies/builder` — visual node editor (drag/drop, sockets, save & launch)
  - `/backtest` — run backtest, choose any strategy, equity curve
  - `/reports` — P&L + volume charts
  - `/billing` — subscription + plans + history
  - `/settings` — profile (+ link to notifications)
  - `/settings/notifications` — channels × events grid
- **Admin `(dashboard)/admin/`:** overview, users, plans, settings, flags, audit

Key components:
- `components/sidebar.tsx` — desktop sidebar with role-based admin section
- `components/mobile-sidebar.tsx` — drawer for <md screens
- `components/topbar.tsx` — connection-status badge + notifications bell + theme toggle + logout
- `components/connection-status.tsx` — real-time API/DB/Redis/Binance health
- `components/notifications-bell.tsx` — inbox dropdown with unread count
- `components/onboarding-wizard.tsx` — 3-step checklist on dashboard
- `components/bot-preview.tsx` — **SVG canvas** showing dotted price lines, sized by quote amount, with live market price
- `components/status-badge.tsx` — bot status colored badge
- `components/providers.tsx` — TanStack Query + ThemeProvider + Sonner toaster

State management:
- **TanStack Query** (cache + auto-refetch)
- **Zustand** included but unused so far
- **Socket.IO client** in `lib/realtime.ts` — `useBotRealtime(id)` and `useUserBotsRealtime()` invalidate React Query cache on `bot:event`

API client (`lib/api.ts`):
- Axios instance with JWT auto-attach + auto-refresh on 401
- `apiCall(fn)` helper that extracts `error.response.data.error.message` (otherwise users see useless "Network Error")
- `pingApi()` for the connection-status component

---

## 🐛 Known Gotchas & Lessons Learned

> These were painful to find. **Read before debugging similar issues.**

### 1. NestJS Constructor DI silently failing (the worst bug)
**Symptom:** `this.someService` is `undefined` in controller methods even though Nest reports modules initialized.
**Cause:** TypeScript `target: ES2023` + default `useDefineForClassFields: true` emits constructor parameter properties as **class fields that overwrite `this.x = undefined` AFTER the constructor assignment**.
**Fix:** `target: ES2022` + `useDefineForClassFields: false` in API/Engine tsconfig.

### 2. `@UsePipes(new ZodValidationPipe(Schema))` validates ALL parameters
**Symptom:** Body endpoints intermittently fail with "Required" for every field.
**Cause:** `@UsePipes` at method level applies to every `@Param`, `@Query`, `@Body`, `@CurrentUser`. When Nest invokes the pipe with the user object, Zod sees `{sub, email, role}` → throws.
**Fix:** Use `@Body(new ZodValidationPipe(Schema)) dto: T` — scopes pipe to body only.

### 3. Stale node processes on Windows
**Symptom:** Old code keeps responding even after rebuild.
**Cause:** `pkill -f node` in bash on Windows doesn't actually kill all processes.
**Fix:** Always use PowerShell: `Get-Process node | Stop-Process -Force`. The `start-all.ps1` script does this automatically.

### 4. `tsbuildinfo` lying about builds
**Symptom:** TS reports "Found 0 errors" but `dist/` is empty.
**Cause:** TypeScript incremental cache thinks output is up-to-date even when manually deleted.
**Fix:** `incremental: false` in `tsconfig.base.json`. `fresh-build.ps1` also wipes `*.tsbuildinfo` files.

### 5. Binance deprecated `POST /api/v3/userDataStream` → HTTP 410
**Cause:** Binance moved user data streams to the WebSocket API (around mid-2024).
**Fix:** Built `WebSocketUserStream` in `packages/exchange/src/binance/ws-user-stream.ts`:
- Connects to `wss://ws-api.binance.com:443/ws-api/v3` (JSON-RPC style)
- Calls `userDataStream.start` with `apiKey` param
- Opens stream WS at `wss://stream.binance.com:9443/ws/<listenKey>`
- Pings every 30 min via `userDataStream.ping`
**Backup:** `OrderPoller` runs every 30s as safety net.

### 6. Body parsing fails when raw-body verification + default Nest body parser conflict
**Symptom:** `req.body` is empty in Express middleware.
**Cause:** `app.use(json())` registered after `NestFactory.create()` runs AFTER the default parser, but the default parser already consumed the stream.
**Fix:** `bodyParser: false` in NestFactory.create + manual `app.use(json({ verify: rawBodyVerify }))`.

### 7. Cancel-all on stop nuked OTHER bots' orders on the same symbol
**Symptom:** Stopping bot A also cancels orders placed by bot B (same symbol, same API key).
**Cause:** Strategies called `client.cancelAllOrders(symbol)`.
**Fix:** Added `ctx.cancelMyOrders()` to `StrategyContext` — queries `prisma.order` filtered by `botId`, calls `cancelOrder` per row.

### 8. Grid `state` resume blocked re-placing orders
**Symptom:** Stop a grid bot, restart it → no new orders placed.
**Cause:** `init()` returned early on existing state, but `stop()` had cancelled all the orders on Binance — state was stale.
**Fix (twofold):**
- `stop()` now `saveState(null)` to clear state
- `init()` reconciles: queries Binance open orders; if state expects orders but Binance has none → re-places them. Emits `GRID_RECONCILED`.

### 9. Bot stats (totalTrades, realizedPnlQuote) stayed 0
**Cause:** `BotRunner.handleUserDataEvent` only persists Order/Trade, never updates Bot aggregate fields.
**Fix:** `updateBotStats(botId)` helper using **weighted-average cost basis**:
- BUY: `newAvg = (held*avg + qty*price) / (held+qty)`
- SELL: `pnl = (sellPrice - avgCost) * qty`
- Called after every Trade upsert. Also exposed via `POST /bots/:id/recompute-stats` and `POST /bots/recompute-stats` (all bots).

### 10. Prisma migration locks during dev
**Symptom:** `EPERM: operation not permitted, rename query_engine-windows.dll.node`.
**Fix:** Kill all node processes BEFORE running `prisma migrate` or `prisma generate`.

### 11. `dotenv-cli` for Prisma scripts
**Cause:** Prisma CLI looks for `.env` in `prisma/` dir, not project root.
**Fix:** All db scripts in `packages/db/package.json` are wrapped: `dotenv -e ../../.env -- prisma ...`.

### 12. Reset-password page prerender error
**Cause:** `useSearchParams()` requires Suspense boundary in Next 15.
**Fix:** Wrapped form in `<Suspense fallback={...}>` in `(auth)/reset-password/page.tsx`.

### 13. Backtest service can import indicators from package internals
**Note:** Indicators are exported from `@orca/strategies` index now (`RollingRSI`, `RollingSMA`, `RisingEdge`).

### 14. `next.config.js` workspace root warning
**Fix:** Added `outputFileTracingRoot: path.join(__dirname, '../..')` to silence Next when multiple lockfiles exist.

---

## 🎓 Conventions & Patterns

### Adding a new built-in strategy
1. Create `packages/strategies/src/<name>/strategy.ts` implementing `Strategy<TParams>`
2. Export from `packages/strategies/src/index.ts` and register in the registry
3. Add to seed in `packages/db/prisma/seed.ts` with `builtinKey`, `paramsSchema`, `definition.engine`
4. If it's a CUSTOM type, may need form rendering in `apps/web/src/app/(dashboard)/bots/new/page.tsx`
5. Run `pnpm -w run db:seed` to register in DB

### Adding a new API endpoint
1. In NestJS controller: `@Body(new ZodValidationPipe(MyDto)) dto: MyDto` — never `@UsePipes`
2. Service method returns plain data (not wrapped) — `ResponseInterceptor` wraps it
3. Errors: throw `OrcaError(code, message, statusCode, details)` or use Nest exceptions (BadRequest/NotFound/Forbidden)
4. For files outside `Decimal` operations, use `Number()` carefully; for money, use `Decimal` from `@orca/shared`

### Adding a new Web query/mutation
- Add hook to `lib/queries.ts` (existing) or `queries-v2.ts` / `queries-v3.ts` (organized by phase)
- Use TanStack Query's `useMutation` with `onSuccess` invalidating relevant `queryKey`
- Errors auto-surface via `apiCall` helper

### Adding a new node type to Strategy Builder
1. Add to `GraphNodeSchema.kind` enum in `packages/strategies/src/graph/strategy.ts`
2. Implement evaluation in the `evalNode` switch
3. If it's an action: add execution in `executeAction`
4. Add to `NODE_PALETTE` in `apps/web/src/app/(dashboard)/strategies/builder/page.tsx`

---

## 🚦 Phases Completed

- ✅ **Phase 1** — Monorepo + packages
- ✅ **Phase 2** — NestJS API (Auth/Users/Keys/Strategies/Bots/Health)
- ✅ **Phase 3** — Engine + Web Dashboard
- ✅ **Phase 4** — Plans + Subscriptions + CoinPayments + Admin + Audit
- ✅ **Phase 5** — Reports + Backtest (Grid + Graph) + Strategy Builder + custom execution
- ✅ **Phase 6** — Paper Trading + WebSocket gateway + 2FA TOTP + AES-256-GCM encryption
- ✅ **Phase 7** — Forgot/Reset password + In-app notifications + Notification preferences + Mobile drawer + Onboarding wizard
- ✅ **Phase 8** — DCA + MA Cross + Risk Management (daily loss + drawdown + Kill Switch) + new node types (or, not) + Grid `orderSizeMultiplier` + DCA direction + DCA flexible gates + balance default + live preview + cancel-only-own-orders fix
- ✅ **Real-time WS** — `WebSocketUserStream` replacing deprecated `userDataStream` REST endpoint
- ✅ **Wallet Module** — `/wallet` page: portfolio view (FDUSD value per asset + total), open orders strip, manual trade modal with BUY/SELL toggle, market-or-limit order type, %-shortcuts (25/50/75/100), order summary with notional check, cancel any open order. API: `WalletService` + `/wallet/:apiKeyId/{overview, symbol/:s, trade, open-orders, trades/:s, trade/:s/:id (DELETE)}`

## 📋 Phases Remaining

### Phase 9 — Multi-Exchange (~5-8 days)
- Bybit, OKX, KuCoin connectors
- Refactor `BinanceClient` interface → generic `ExchangeClient`
- Exchange selector in API key form
- Cross-exchange backtest

### Phase 10 — Notifications (~3-4 days)
- Email via Resend or SMTP (templates, daily P&L summary)
- Discord webhooks
- Push notifications (PWA service worker)
- Telegram /test from settings

### Phase 11 — Marketplace (~7-10 days)
- Publish strategy publicly (visibility=PUBLIC)
- Marketplace browse page
- Copy trading (subscribers mirror creator's signals)
- Revenue split (commission to creator)
- Leaderboard + ratings

### Phase 12 — Production Hardening (~5-7 days)
- Nginx reverse proxy + Let's Encrypt SSL
- PM2 cluster mode
- Sentry error tracking
- Datadog/Grafana metrics
- Per-user rate limiting
- IP allowlist for admin
- GDPR data export/delete
- Privacy + ToS pages
- Unit tests (strategies, indicators, services)
- Integration tests (bot lifecycle)
- E2E (Playwright)
- GitHub Actions CI/CD
- Automated DB backups

---

## 📝 Notes for Future Me (LLM Context)

### Auto mode is enabled
User wants minimal questions, prefers action. When unsure on routine choices, just pick a reasonable default and proceed.

### Communication style
- User speaks Arabic primarily; respond in Arabic.
- Code/identifiers in English.
- Be concise — user wants results, not lengthy planning.

### When the user says "اكمل" / "continue"
They mean continue the previously discussed work or roadmap. Default to the next logical step.

### When the user reports a bug
1. **First diagnose** — query DB, check logs, check process state. Don't guess.
2. The issue is **almost always** one of:
   - Stale node process (kill all via PowerShell, restart)
   - Build artifact missing (run `pnpm fresh:build`)
   - Body parsing / DI issue (see Gotchas #1, #2, #6)
3. After fixing, **always rebuild + smoke test** before declaring success.

### When making schema changes
Workflow:
```bash
# 1. Edit packages/db/prisma/schema.prisma
# 2. Kill all node processes (PowerShell):
Get-Process node | Stop-Process -Force
# 3. Migrate:
pnpm -w run db:migrate          # then enter migration name
# 4. Rebuild:
pnpm --filter @orca/db build
pnpm --filter @orca/api build
pnpm --filter @orca/engine build
```

### Default test user
- **Admin:** `admin@orca.local` / `ChangeMe123!` (role: SUPER_ADMIN)
- The user has a real Binance API key saved as `Real-Main` with FDUSD balance (~3885 FDUSD)
- `BTCFDUSD` is the preferred test pair (zero fees)

### Build order matters
`fresh-build.ps1` builds packages in this order:
1. `@orca/shared`
2. `@orca/config`
3. `@orca/logger`
4. `@orca/db`
5. `@orca/exchange`
6. `@orca/strategies`
7. `@orca/api`
8. `@orca/engine`
9. `@orca/web`

Don't trust Turbo's parallel builds for first-time builds — it can race `db` vs `api`.

### Port allocation
- 3000 → Web (Next.js)
- 4000 → API (NestJS)
- 4001 → Engine
- 5432 → PostgreSQL
- 6379 → Redis (Memurai on Windows)

### Current major design decisions
- **All orders are LIMIT** — enforced in `BinanceClient.placeOrder` if `enforceLimitOnly: true`
- **FDUSD pairs preferred** — zero fees on Binance
- **Decimal.js for money math** — never use raw JS numbers for prices/quantities
- **No Docker** — user explicitly opted out
- **No global ValidationPipe** — Zod everywhere via `@Body(new ZodValidationPipe(...))`

### Useful commands cheatsheet
```bash
# Quick DB inspection
PGPASSWORD=Medoza120a psql -U postgres -h localhost -d orca -c "SELECT name, status FROM \"Bot\" ORDER BY \"createdAt\" DESC LIMIT 5;"

# Quick bot reset (clear stuck state)
PGPASSWORD=Medoza120a psql -U postgres -h localhost -d orca -c "UPDATE \"Bot\" SET status='STOPPED', state=NULL WHERE name='X';"

# Watch engine log
tr -cd '[:print:]\n' < /tmp/engine.log | grep -iE "real-time|order_placed|fill" | tail -20

# Check what's running
Get-Process node | Format-Table Id, StartTime
Get-NetTCPConnection -LocalPort 4000 -State Listen
```

---

## 🔐 Secrets / .env Reference

The `.env` file contains these (real values omitted):

```
NODE_ENV=development
DATABASE_URL="postgresql://postgres:Medoza120a@localhost:5432/orca?schema=public"
REDIS_URL="redis://127.0.0.1:6379"
AUTH_SECRET="dev-secret-change-in-production-please-use-a-long-random-string-here"
ENCRYPTION_SECRET="dev-encryption-secret-change-in-production-32chars-min-required"
TELEGRAM_BOT_TOKEN=7834802700:...   ← user's real Telegram bot
TELEGRAM_DEFAULT_CHAT_ID=1223468133
ADMIN_DEFAULT_EMAIL=admin@orca.local
ADMIN_DEFAULT_PASSWORD=ChangeMe123!
```

**Production checklist before deploy:**
- [ ] Generate strong `AUTH_SECRET` and `ENCRYPTION_SECRET` (≥32 chars, true random)
- [ ] Set `NODE_ENV=production`
- [ ] Set `LOG_PRETTY=false`
- [ ] Configure `COINPAYMENTS_*` for real payments
- [ ] Set up real SMTP/Email service (Phase 10)
- [ ] Configure `API_CORS_ORIGIN` to production domain
- [ ] Use a secrets manager (AWS Secrets Manager, Vault) — don't ship `.env`
- [ ] Re-encrypt all existing API keys with new `ENCRYPTION_SECRET` (write a migration)

---

## 🚀 Real-time Architecture Detail

The current real-time pipeline:

```
┌─────────────────────────────┐
│  Binance Spot Account       │
│  • Order matched/filled     │
└─────────────┬───────────────┘
              │
              │  executionReport (~50ms latency)
              ↓
┌─────────────────────────────┐
│  Binance WebSocket Stream   │
│  wss://stream.binance.com   │
│  /ws/<listenKey>            │
└─────────────┬───────────────┘
              │
              │  WebSocket message
              ↓
┌─────────────────────────────┐
│  Engine: WebSocketUserStream│
│  packages/exchange/.../ws-* │
└─────────────┬───────────────┘
              │
              │  onEvent(executionReport)
              ↓
┌─────────────────────────────┐
│  BotRunner.handleUserData   │
│  • Persist Order/Trade       │
│  • updateBotStats()         │
│  • strategy.onOrderUpdate() │
└─────────────┬───────────────┘
              │
              │  ctx.emit() →
              ↓
┌─────────────────────────────┐
│  Redis Pub/Sub              │
│  channel: orca:engine:evt   │
└─────────────┬───────────────┘
              │
              ↓
┌─────────────────────────────┐
│  API: RealtimeGateway       │
│  Socket.IO emit to:         │
│  • bot:<botId> room          │
│  • user:<userId> room        │
└─────────────┬───────────────┘
              │
              ↓
┌─────────────────────────────┐
│  Web: useBotRealtime hook   │
│  • Invalidate React Query   │
│  • UI refreshes immediately │
└─────────────────────────────┘
```

End-to-end latency: **~100-200ms** from Binance fill to UI update.

---

## 📚 Where Each Concept Lives

| Concept | Files |
|---------|-------|
| **Time sync with Binance** | `packages/exchange/src/binance/time-sync.ts` |
| **Rate limiting** | `packages/exchange/src/binance/rate-limiter.ts` |
| **Real-time WS user data** | `packages/exchange/src/binance/ws-user-stream.ts` |
| **Wallet (manual trading)** | `apps/api/src/modules/wallet/`, `apps/web/src/app/(dashboard)/wallet/page.tsx`, `apps/web/src/components/trade-modal.tsx` |
| **Order polling fallback** | `apps/engine/src/runners/order-poller.ts` |
| **Paper trading sim** | `apps/engine/src/runners/paper-client.ts` |
| **Bot lifecycle** | `apps/engine/src/runners/bot-runner.ts` |
| **Stats computation** | `apps/engine/src/runners/bot-stats.ts` + `apps/api/src/modules/bots/bots.service.ts:recompute()` |
| **Strategy interface** | `packages/strategies/src/base.ts` |
| **Indicators** | `packages/strategies/src/graph/indicators.ts` |
| **Encryption (AES-GCM)** | `packages/shared/src/utils/crypto.ts` |
| **Live order preview SVG** | `apps/web/src/components/bot-preview.tsx` |
| **Visual strategy builder** | `apps/web/src/app/(dashboard)/strategies/builder/page.tsx` |
| **CoinPayments client** | `apps/api/src/modules/payments/coinpayments.client.ts` |
| **Telegram client** | `apps/api/src/modules/notifications/telegram.service.ts` |
| **Connection-status component** | `apps/web/src/components/connection-status.tsx` |
| **Onboarding wizard** | `apps/web/src/components/onboarding-wizard.tsx` |
| **Mobile drawer** | `apps/web/src/components/mobile-sidebar.tsx` |
| **2FA logic** | `apps/api/src/modules/users/users.service.ts` (uses `otplib`) |
| **Risk auto-stop** | `apps/engine/src/runners/bot-runner.ts:tick()` |
| **Kill Switch** | `apps/api/src/modules/bots/bots.service.ts:emergencyStopAll()` |

---

## 🎬 Resume Workflow Template

When picking the project back up:

1. **Open** `c:\Users\Badr\OneDrive\Desktop\Trading\` in VS Code
2. **Read** the latest section of this `HANDOFF.md` for any updates I added
3. **Check infrastructure**:
   ```powershell
   Get-Service Memurai, postgresql-x64-18 | Format-Table Name, Status
   ```
4. **Build & start**:
   ```powershell
   pnpm fresh:build
   pnpm start:all
   ```
5. **Verify** all 3 services respond at their health endpoints
6. **Open browser** http://localhost:3000 and login
7. **Pick next phase** from the [Phases Remaining](#-phases-remaining) section, OR
   address whatever new feature/bug the user mentions

---

## 📞 If Something Is Broken

In order of likelihood:

1. **Stale node process** → `Get-Process node | Stop-Process -Force` then restart
2. **Missing build artifacts** → `pnpm fresh:build`
3. **Binance API errors** → check the API key in DB has `status=ACTIVE` and not expired
4. **Bot stuck "RUNNING" but inactive** → reset state: `UPDATE "Bot" SET state=NULL WHERE id='...'`
5. **Web shows "Network Error"** → check API is on :4000 + check connection-status badge in topbar
6. **DB migration won't run** → kill all node processes (file lock on Prisma engine)
7. **Strategy not placing orders** → check engine log for HTTP 410 (need WS user stream) or balance/notional errors

---

**END OF HANDOFF**

To future me: **trust this document** — it captures hard-won knowledge.
Update the [Known Gotchas](#-known-gotchas--lessons-learned) section any time you discover something non-obvious.
