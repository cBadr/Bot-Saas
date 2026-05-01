# 🐋 Orca — Project Handoff & Reference

**Last updated:** 2026-04-30 (post-Sprint 1: Safety Net)
**Owner:** Badr
**Path:** `c:\Users\Badr\OneDrive\Desktop\Trading\`
**Repo:** local only, branch `master`
**Admin login:** `admin@orca.local` / `ChangeMe123!`

> Read this file first when resuming work. It captures architecture, conventions,
> hard-won gotchas, and the full implementation history of the trading-engine
> rewrite (Apr 27–30, 2026) plus the Safety Net (tests + Sentry + CI + backups + runbook).

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

A **professional crypto trading SaaS** built on Binance Spot, with:

- **Pre-built strategies:** Grid Simple, DCA Simple, Grid v1 (legacy), DCA v1 (legacy), MA Cross + visual node-based custom strategies
- **Real-time bot execution** via Binance WebSocket API (~50ms fill latency)
- **Live monitoring suite** — TradingView chart with order overlays, integrity widget, P&L sparkline, cooldown countdown
- **Cycle-based P&L** — authoritative per-cycle accounting (NOT weighted-avg cost basis)
- **Paper trading** + Backtesting against real historical data
- **Multi-channel notifications:** in-app inbox + Telegram (with retry, custom rules, periodic status digests)
- **Risk management:** daily loss limit, max drawdown auto-stop, kill switch
- **Multi-tenant:** users, API keys, subscriptions
- **CoinPayments crypto subscriptions**
- **Admin panel** with user/plan/feature-flag management
- **Security:** 2FA TOTP, AES-256-GCM encrypted API keys at rest
- **All Binance orders are LIMIT or LIMIT_MAKER** — zero fees on FDUSD pairs

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
│   └── strategies/    # @orca/strategies — Grid/DCA/MA/Graph + Simple variants
├── scripts/           # PowerShell helpers (start-all, stop-all, fresh-build, backup-db)
├── .github/workflows/ # CI (ci.yml — Postgres service container, lint+test+build)
├── .env               # all secrets here
├── RUNNING.md         # user-facing run guide
├── DEPLOYMENT.md      # Windows Server production deploy guide
├── RUNBOOK.md         # 11 operational scenarios (NEW — Sprint 1)
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
- Constants: `FEE_FREE_QUOTE_ASSET = 'FDUSD'`, `ALLOWED_ORDER_TYPES = ['LIMIT', 'LIMIT_MAKER']`, `BOT_STATUSES`, etc.
- Binance type definitions

### `@orca/config`

**Purpose:** Single source of truth for env vars (Zod-validated).

- `env` — proxy that lazy-loads + validates `.env` on first access
- Loads `.env.local` then `.env` from cwd or 2 levels up

Required env vars:
- `DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET` (≥16 chars), `ENCRYPTION_SECRET` (≥16 chars)

Optional:
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_DEFAULT_CHAT_ID` — Telegram bot
- `PUBLIC_WEB_URL` — used to build deep-links in Telegram messages
- `COINPAYMENTS_*` — payments
- `BINANCE_*` rate limits

### `@orca/logger`

**Purpose:** Structured logging via Pino.

- `createLogger(category, ctx)` — categories: `APP`, `TRADE`, `API`, `BINANCE`, `AUDIT`, `BOT`, `STRATEGY`, `PAYMENT`, `AUTH`, `SYSTEM`
- Logs to stdout (pretty in dev) + daily-rotated file in `./logs/app.log.YYYY-MM-DD.N`
- Auto-redacts `password`, `token`, `apiKey`, `apiSecret`, `secret`, `authorization`, `cookie`

### `@orca/db`

**Purpose:** Prisma schema + client.

26 models. Key ones:
- `User` — `telegramChatId`, `fillFrequency` (`OFF`|`PER_CYCLE`|`PER_FILL`|`CUSTOM`), `notificationConfig` (Json), `lastStatusReportAt`
- `Session`, `PasswordResetToken` — auth
- `ExchangeApiKey` — Binance keys (AES-256-GCM encrypted)
- `Strategy` — built-in (`builtinKey`) or custom (`type=CUSTOM`, definition has `engine`)
- `Bot` — has `params`, `state` (strategy state), `paperTrading`, `dailyLossLimit`, `maxDrawdownPct`, **legacy** `realizedPnlQuote`/`unrealizedPnlQuote`/`totalTrades` (DO NOT use for new code; use `state.realizedPnlQuote`)
- `Order`, `Trade` — execution history
- `BotEvent` — high-level audit (GRID_INITIALIZED, BUY_FILLED, SELL_FILLED, DCA_*, GRID_INTEGRITY_*, etc.)
- `Plan`, `Subscription`, `Payment` — billing
- `NotificationPreference`, `NotificationLog` — channel × event matrix + audit log
- `AuditLog`, `SystemLog`, `BinanceApiCallLog` — observability
- `AppSetting`, `FeatureFlag` — admin-tunable
- `ExchangeSymbol` — cached Binance symbol filters

Migration commands (always from project root):
```bash
pnpm --filter @orca/db migrate --name <descriptive_name>
pnpm --filter @orca/db seed
pnpm --filter @orca/db studio
```

> ⚠️ **Migration tip:** kill ALL node processes before migrating, otherwise Windows file locking blocks Prisma from rewriting the engine binary. The `pg_advisory_unlock_all()` query helps clear stale locks too.

### `@orca/exchange`

**Purpose:** Binance connector layer.

- `BinanceClient` — REST client (signed + public + api-key-only requests)
- `binanceTimeSync` — global singleton, polls Binance server time every 60s, all signed requests use `Date.now() + offset`
- `BinanceRateLimiter` — Redis-backed sliding window (1100/min, 45 orders/10s, 160k/day)
- **`batchPlaceOrders(orders[], opts)`** — parallel HTTP w/ concurrency cap. Spot has NO native batch endpoint (only Futures); this is the best we can do.
- **`batchCancelOrders(symbol, clientOrderIds[], opts)`** — parallel cancel by clientOrderId. Deliberately does NOT use `DELETE /openOrders` (that would kill OTHER bots' orders).
- `WebSocketUserStream` — real-time user data via WS API (replaces deprecated REST `/api/v3/userDataStream`)
- `MarketStream` — public market data WS
- `extractFilters(symbolInfo)`, `validateOrder(filters, price, qty)`

### `@orca/strategies`

**Purpose:** Strategy implementations.

Built-in strategies (`builtinKey`):

| Key | Status | Description |
|-----|--------|-------------|
| `grid_v1` | **Legacy** | Original grid trading. Kept for back-compat. |
| **`grid_simple`** | **Recommended** | x2-style symmetric ladder. LIMIT_MAKER, mutex-protected, integrity loop, batch placement. **See [Strategies Deep Dive](#-strategies-deep-dive).** |
| `dca_v1` | **Legacy/deprecated** | Old DCA with time/price gates. Marked deprecated in seed. |
| **`dca_simple`** | **Recommended** | x2-style ladder DCA with single dynamic TP/BB, multipliers, cooldown, inactivity-recenter. |
| `ma_cross_v1` | Active | MA Crossover (golden/death cross) |
| `graph_v1` | Active | Custom node-based strategies (interprets visual builder graph) |

Each strategy implements `Strategy<TParams>` from `base.ts`:
```ts
{ key, validateParams, init, onOrderUpdate, onTick, stop }
```

`StrategyContext` (passed to strategy methods):
- `botId`, `symbol`, `filters`, `client: BinanceClient`, `logger`
- `saveState(state)`, `loadState<T>()`
- `emit(type, message, data)` — persists to BotEvent + publishes via Redis Pub/Sub (consumed by RealtimeGateway + NotificationDispatcher)
- `cancelMyOrders()` — cancels ONLY orders this bot placed (uses `batchCancelOrders` for parallelism)

Indicators (`graph/indicators.ts`): `RollingSMA`, `RollingRSI` (Wilder's), `RisingEdge` (debounce).

---

## 🧠 Strategies Deep Dive

### Grid Simple (`grid_simple`)

**Inspired by:** the proven x2 grid model at `C:\Users\Badr\OneDrive\Desktop\x2\x2-Backup\x2\src\strategies\grid.js`.

**Inputs (5):**
```ts
gridLevels       — number per side (1-200). Total = 2 × N orders.
gridSpread       — $ between adjacent levels.
orderSize        — quote $ per order.
durationMinutes  — auto-stop after N min (0 = forever).
customStartPrice — optional override; else live ticker at launch.
```

**Behavior:**
1. On `init()`, captures `initialStartPrice` ONCE (locked).
2. Places `2 × gridLevels` `LIMIT_MAKER` orders in parallel (chunks=25):
   - BUYs at `start − i*spread`
   - SELLs at `start + i*spread`
3. On BUY fill → places counter SELL at `price + spread`. Push to `unmatched`.
4. On SELL fill → places counter BUY at `price − spread`. Match against unmatched BUY at `price − spread` for realized PnL.
5. **Integrity loop every 60s** — verifies all expected orders are open on Binance, retries failures at the SAME spec price (never mutates levels).

**State shape:**
```ts
{
  initialStartPrice, orders, unmatched[],
  realizedPnlQuote, cyclesCompleted,        // ← authoritative P&L
  startedAtMs, nextReconcileAtMs, autoStopped,
  processedFills[],                          // ← idempotency dedup ring (last 1000)
}
```

**Critical patterns:**
- `withBotLock(botId, fn)` — per-bot async mutex serializes ALL state mutations.
- `processedFills` — bounded FIFO of clientOrderIds prevents duplicate counter-orders from WS+OrderPoller+Reconcile delivering the same event.
- Symmetric cycle matching: BUY-first AND SELL-first cycles both yield `(sell − buy) × qty` P&L.

### DCA Simple (`dca_simple`)

**Inspired by:** x2's `dcaBuy.js` + `dcaSell.js`, with our integrity / mutex / multiplier additions.

**Inputs (12):**
```ts
direction              — BUY (accumulate) | SELL (distribute)
gridLevels             — ladder length (1-200)
gridSpread             — $ between rungs (base, multiplied)
orderSize              — quote $ per rung (base, multiplied)
takeProfit             — $ above (BUY) / below (SELL) avg cost for counter
priceMultiplierMode    — flat | percent | dollar
priceMultiplier        — growth value (% or $)
sizeMultiplierMode     — flat | percent | dollar
sizeMultiplier         — growth value (% or $)
cooldownMinutes        — after each cycle close (0 = rebuild immediately)
recenterAfterMinutes   — abort cycle if no fills in N min (0 = disabled)
durationMinutes        — auto-stop (0 = forever)
customStartPrice       — optional override
```

**Multipliers (`_rungSpec(i)`):**
- **Flat:** `gap_i = i × baseSpread` — constant ladder
- **Percent:** `gap_k = baseSpread × (1 + p/100)^(k-1)`, `offset_i = Σ gap_k` (geometric)
- **Dollar:** `gap_k = baseSpread + d × (k-1)`, `offset_i = i×baseSpread + d×i×(i-1)/2` (arithmetic)
- Same applies to `sizeQuote` per rung.

**Behavior:**
1. `init()` captures `initialStartPrice`, builds ladder around it.
2. **Opening fill** (BUY in BUY-mode, SELL in SELL-mode): updates `heldBase`, `openCostBasis`, `avgPrice`. Re-arms the SINGLE counter via cancel-and-replace at `avg ± takeProfit` (LIMIT_MAKER → LIMIT GTC fallback if it would cross).
3. **Closing fill** (counter): realizes `(sellPrice − avgCost) × qty`. Increments `cyclesCompleted`. Cancels remaining ladder.
4. **Cooldown:** if `cooldownMinutes > 0`, sets `cooldownUntilMs` and idles. `onTick` rebuilds when timer expires.
5. **Recenter:** if `recenterAfterMinutes > 0` AND `fillsThisCycle === 0` AND timer elapsed → cancel ladder, run cooldown, rebuild around current price. **Critical:** once any fill happens, timer is disabled — cycle runs to natural completion.

**State extras** (vs grid_simple):
```ts
ladder[]              — opening leg orders
counter | null        — single TP/BB order
heldBase, openCostBasis, avgPrice, fillsThisCycle
cycleStartedAtMs      — for inactivity timer (NOT bumped on fills)
cooldownUntilMs       — 0 if not cooling down
```

### Common to both Simple strategies

- `LIMIT_MAKER` orders for zero fees (post-only).
- `placeOrder()` retry logic:
  - **Transient** (NETWORK / RATE_LIMIT / TIMESTAMP) → exp backoff up to 3×
  - **Auth** (`-2014/-2015/-1022`) → fatal, throw
  - **Other** (insufficient balance, post-only rejected, MIN_NOTIONAL) → mark category-specific status, retry on next integrity loop with SAME price.
- Error classification (14 categories) in `event-types.ts:classifyError`.
- 60-second integrity loop — converges to "every level open" automatically.

---

## 💰 P&L Model — Authoritative Spec

> **Memory file:** `C:\Users\Badr\.claude\projects\c--Users-Badr-OneDrive-Desktop-Trading\memory\pnl_definitions.md`

User defined the project-wide P&L semantics on 2026-04-27. Apply EVERYWHERE.

### 1. Realized P&L
**Formula:** `Σ over closed cycles of (sellPrice − buyPrice) × qty`

For Grid Simple this equals `gridSpread × qty` per cycle.
For DCA Simple this is `(counterPrice − avgCost) × qty` (sign-flipped for SELL-mode).

**Storage:** strategy state's `realizedPnlQuote` field — updated atomically inside `_handleFill` / `_handleCounterFill`.

### 2. Unrealized P&L (floating)
**Formula:** `(currentPrice − initialStartPrice) × signedHeld`

- `signedHeld = +heldBase` (BUY-mode) or `−heldBase` (SELL-mode) — Grid Simple uses `Σ unmatched.qty` with side sign.
- Reference is the bot's **launch** price, NOT per-lot weighted-avg cost. User explicitly chose this simpler model.

### 3. Total Profits
**Formula:** `Realized + Unrealized`

### Where this is calculated
- **`bots.service.ts:list()`** enriches each bot with `liveStats: { realized, unrealized, total, cyclesCompleted, totalInvestment, totalVolumeQuote, ... }`.
- **`bots.service.ts:live()`** (per-bot) returns the same plus `breakEvenPrice = avgPrice` (DCA only).
- **Reports** (`reports.service.ts`) reads per-cycle PnL from `BotEvent.data.cyclePnl` for series + per-bot wins/losses.

### What NOT to use
❌ `Bot.realizedPnlQuote` / `Bot.unrealizedPnlQuote` / `Bot.totalTrades` — these are LEGACY columns updated by `bot-stats.ts:updateBotStats()` using weighted-avg cost basis. They're kept for back-compat with old strategies but are NOT cycle-aware. New code reads `state.realizedPnlQuote`.

---

## 🔔 Notifications Pipeline

```
Strategy emits → ctx.emit(type, msg, data)
       │
       ↓
   BotEvent (DB row)  +  Redis Pub/Sub on ENGINE_EVENT_CHANNEL ("orca:engine:evt")
                                   │
              ┌────────────────────┴────────────────────┐
              ↓                                         ↓
       RealtimeGateway                         NotificationDispatcher
       (Socket.IO → UI rooms)                  (consumes same channel)
                                                         │
                                                         │  mapBotEvent(type, ctx) ← event-types.ts
                                                         ↓
                                              NotificationsService.notify()
                                                  │           │
                                              Telegram     IN_APP inbox (NotificationLog row)
```

### Trigger sources

Most events emit from strategies via `ctx.emit()`. **Risk events (`RISK_DAILY_LOSS`, `RISK_MAX_DRAWDOWN`) ALSO go through `ctx.emit()`** as of 2026-04-30 — `bot-runner.ts:tick()` builds ctx early and uses it for risk checks so they reach the dispatcher.

### Mapped events (`event-types.ts`)

| BotEvent.type | NotificationEvent | Notes |
|---------------|-------------------|-------|
| `BUY_FILLED` / `SELL_FILLED` (cycleClosed=true) | `CYCLE_COMPLETED` | always sent |
| `BUY_FILLED` / `SELL_FILLED` (opening) | `ORDER_FILLED` | gated by user.fillFrequency |
| `DCA_BUY_FILLED` / `DCA_SELL_FILLED` | same as above | |
| `FATAL_API_ERROR` | `BOT_ERROR` | always |
| `RISK_DAILY_LOSS` | `STOP_LOSS_HIT` | always |
| `RISK_MAX_DRAWDOWN` | `BOT_ERROR` | always |
| `TAKE_PROFIT_HIT` | `TAKE_PROFIT_HIT` | always |
| `STOP_LOSS_HIT` / `TRAILING_STOP_HIT` | `STOP_LOSS_HIT` | always |

### Fill frequency modes (per-user)

- `OFF` — never notify on individual fills
- `PER_CYCLE` (default) — only on cycle close
- `PER_FILL` — every ladder rung fill (verbose)
- `CUSTOM` — applies `notificationConfig` rules:
  - `notifyOnBuyFills` / `notifyOnSellFills` — side filter
  - `minFillNotional` — skip fills with quote value < threshold
  - `minCyclePnl` — skip cycle closes with |PnL| < threshold

### Periodic Status Reports (`StatusReportService`)

- Tick every 60s, find users with `notificationConfig.statusReportIntervalMinutes > 0`
- For each due user: build Markdown report from `BotsService.list()` enriched data
- Filter via `notificationConfig.statusReportBots` = `'ALL'` | `string[]`
- Send via `notifications.notify(userId, 'STATUS_REPORT', message)`
- Update `User.lastStatusReportAt` on success
- Manual trigger: `POST /status-report/send-now`

### Per-user Telegram setup

- `User.telegramChatId` — set via `PATCH /users/me` (UI in `/settings/notifications`)
- `POST /users/me/telegram/test` — sends test message
- Settings UI shows live test button + chat ID input + frequency selector

---

## 🧪 Testing, CI & Observability (Sprint 1 — Safety Net)

Added 2026-04-30. Foundational reliability layer before commercial features.

### Vitest setup

- **Vitest 4.1.5** workspace at root: `vitest.workspace.ts`
- Per-package configs: `packages/strategies/vitest.config.ts`, `apps/api/vitest.config.ts`
- Run all: `pnpm test` (or `pnpm --filter <pkg> test`)
- Test files excluded from `tsc` builds via `tsconfig.json` `exclude: ["src/**/*.test.ts", "src/__test__/**"]`

### Current coverage (39 tests passing)

| Suite | File | Tests |
|-------|------|-------|
| Grid Simple | `packages/strategies/src/grid_simple/strategy.test.ts` | 10 (placement, cycle matching, processedFills FIFO, idempotency, state migration) |
| DCA Simple | `packages/strategies/src/dca_simple/strategy.test.ts` | 12 (ladder direction, multipliers flat/percent/dollar, counter placement, cooldown gating, recenter inactivity guard) |
| Event mapping | `apps/api/src/modules/notifications/event-types.test.ts` | 17 (cycle close, opening leg gating, CUSTOM rules, side filters, minFillNotional, RISK_*, unknown events) |

### Mock utilities

- `packages/strategies/src/__test__/test-utils.ts` — `createMockCtx()` factory:
  - In-memory state (`saveState`/`loadState`)
  - Mock Binance client recording `placeOrder`/`cancelOrder` calls
  - Helpers: `setTickerPrice`, `setOpenOrders`, `setNextPlaceError`, `lastEmit`, `countEmits`

### Sentry integration

5 config files, all gated on env DSN being set (no-ops otherwise):

- `apps/api/src/sentry.ts` — `@sentry/nestjs`
- `apps/engine/src/sentry.ts` — `@sentry/node`
- `apps/web/sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts` — `@sentry/nextjs`

API and Engine import `./sentry` as the FIRST import in `main.ts` (before NestFactory) so instrumentation is hooked early.

Env vars (all optional):
- `SENTRY_DSN_API`, `SENTRY_DSN_ENGINE`, `SENTRY_DSN_WEB`
- `SENTRY_TRACES_SAMPLE_RATE` (default 0)
- `SENTRY_ENVIRONMENT` (default `development`)

### GitHub Actions CI

`.github/workflows/ci.yml` — two jobs:
1. **`lint-test-build`** — Postgres 17 service container, runs `pnpm install`, type-check, build, test
2. **`syntax-check`** — fast-fail strategy tests only

Concurrency control cancels in-flight runs on the same branch. Env placeholders satisfy `@orca/config` Zod validation in CI.

### Database backups

`scripts/backup-db.ps1` — pg_dump custom format with auto-prune.
- Auto-detects pg_dump from PostgreSQL install dirs (18/17/16/15)
- Configurable: `ORCA_PG_USER/HOST/DB/PASSWORD/PORT`, `ORCA_BACKUP_DIR`, `ORCA_BACKUP_KEEP` (default 14 days)
- Run manually or via Windows Task Scheduler

### Operational runbook

`RUNBOOK.md` — 11 scenarios with copy-paste commands:
1. App won't start  2. Migration failures (advisory locks)  3. Bot stuck RUNNING
4. Wrong P&L  5. Duplicate orders  6. Network/502 errors  7. Restore from backup
8. Telegram not arriving  9. Status reports  10. Emergency stop  11. Run tests

---

---

## 🚀 App Reference

### `apps/api` (NestJS, port 4000, prefix `/api/v1`)

Modules:
- **Auth** — register, login (with optional 2FA code), refresh, logout, forgot/reset-password
- **Users** — profile, change password, 2FA, **`telegramChatId`/`fillFrequency`/`notificationConfig`** updates, **`POST /users/me/telegram/test`**
- **ExchangeKeys** — CRUD + test + per-asset balance lookup
- **Strategies** — list/get/create/update/delete custom strategies
- **Bots** — full CRUD, start/stop, events, orders, recompute-stats, **`GET /bots/:id/live`** (live monitoring snapshot), kill switch, update risk
- **Plans, Subscriptions, Payments** — billing (CoinPayments)
- **Admin** — stats, users, plans, settings, feature flags, audit log
- **Audit** — global audit logger
- **Notifications** — preferences, in-app inbox, Telegram client, **`NotificationDispatcher`** (Redis Pub/Sub consumer)
- **Reports** — overview, P&L series (cycle-based), per-bot, per-symbol, best/worst-day
- **Backtest** — dispatches to `runGrid` or `runGraph`
- **Realtime** — Socket.IO gateway, JWT-authed, bot-room subscriptions
- **Health** — `/health` aggregates DB/Redis/Binance status
- **BinanceSync** — bootstraps `binanceTimeSync` on app start
- **Wallet** — manual trading on `/wallet` page
- **StatusReport** — periodic status digest scheduler (`POST /status-report/send-now`)

Critical decisions:
- **No global ValidationPipe** — uses per-route `@Body(new ZodValidationPipe(Schema)) dto: T`
- **`bodyParser: false`** + custom `app.use(json(...))` for IPN HMAC verification
- **Response shape:** `{ ok: true, data }` or `{ ok: false, error: { code, message, details } }`
- **CORS** allows `http://localhost:3000` by default (`API_CORS_ORIGIN`)
- **Throttler** global: 200 req/min per IP

### `apps/engine` (Node, port 4001)

Components:
- **`main.ts`** — bootstraps Time Sync, Redis pub/sub, RunnerManager, exposes `/health`
- **`RunnerManager`** — manages active `BotRunner` instances, `resumeAll()` on boot
- **`BotRunner`** — per-bot lifecycle:
  1. Load bot + apiKey + strategy from DB
  2. Decrypt apiKey/apiSecret with `ENCRYPTION_SECRET`
  3. Paper trading → `PaperBinanceClient`; else real `BinanceClient` + `WebSocketUserStream`
  4. Also starts `OrderPoller` (30s safety net)
  5. Calls `strategy.init(ctx, params)`
  6. Periodic 5s tick → `strategy.onTick(ctx, params, lastPrice)` + risk checks (NOW via `ctx.emit()`)
  7. On fill → `strategy.onOrderUpdate(ctx, params, event)` + persists Order/Trade + updates aggregate stats
- **`PaperBinanceClient`** — full Binance API simulator, fills LIMIT orders against live ticker
- **`WebSocketUserStream`** — real-time fills via Binance WS API
- **`OrderPoller`** — fetches `getOpenOrders` + `getOrder`, persists missing rows, detects status transitions
- **`CommandListener`** — Redis subscribe to `orca:engine:cmd` for START/STOP/EMERGENCY_STOP_USER
- **`buildStrategyContext`** — wires strategies to DB + Redis pub/sub
- **`bot-stats.ts`** — `updateBotStats(botId)` recomputes aggregates from Trade history (LEGACY weighted-avg, kept for old strategies)

Risk management (in `BotRunner.tick()`):
- Checks `dailyLossLimit` against today's realized losses
- Checks `maxDrawdownPct` from peak P&L
- Breaches → emits `RISK_DAILY_LOSS` / `RISK_MAX_DRAWDOWN` via `ctx.emit()` → flows to NotificationDispatcher → Telegram

### `apps/web` (Next.js 15 App Router, port 3000)

Routes:
- **Public:** `/`, `/login`, `/register`, `/forgot-password`, `/reset-password`, `/pricing`
- **Authenticated `(dashboard)/`:**
  - `/dashboard` — **rewritten 2026-04-30**: 4 KPI tiles (Total/Realized/Floating/Volume) + 4 secondary (Bots/Cycles/Volume/Capital with ROI) + Top Performers + Needs Attention + Account snapshot
  - `/bots` — list with rich rows (params, cycles, P&L per bot)
  - `/bots/new` — strategy-aware forms (grid_simple has 5 inputs, dca_simple has 12)
  - **`/bots/[id]`** — comprehensive monitoring page (see below)
  - `/exchange-keys` — CRUD + test
  - `/strategies` — list + link to builder
  - `/strategies/builder` — visual node editor
  - `/backtest` — run backtest, equity curve
  - **`/reports`** — **rewritten 2026-04-30**: 4 large KPI tiles + 4 secondary metrics + Cumulative line chart + Daily P&L bars (color per bar) + Cycles per day + Best/Worst day + per-symbol + sortable per-bot table
  - `/billing` — subscription + plans + history
  - `/wallet` — manual trading
  - `/settings` — profile (+ link to notifications)
  - **`/settings/notifications`** — Telegram setup card (chatId + Test button) + Fill frequency (4 options + Custom panel) + **Periodic status reports card** (frequency picker + bot selector) + per-event channel matrix
- **Admin `(dashboard)/admin/`:** overview, users, plans, settings, flags, audit

Bot detail page (`/bots/[id]`) layout (4 sections):
1. **Header** — name, status, paper badge, symbol, strategy, direction, uptime, action buttons
2. **4 KPI Tiles** — Total Profits (large, accent border) / Realized P&L / Floating P&L / Total Volume
3. **LiveTradingChart** (full width) — TradingView Lightweight Charts v5, 1m/5m/15m/1h timeframe selector, candle data via WS, orders overlaid as `addPriceLine` (auto-fit y-range to ladder)
4. **3 Cards row:** `BotConfigCard` (params readout) / `PositionStateCard` (anchor, market, Δ, open BUY/SELL, held inventory, break-even) / `PerformanceCard` (cycles, capital, ROI, est. profit if all rungs fill)
5. **2 Cards row:** `IntegrityWidget` (with cooldown countdown banner) / `PnLSparkline` (3 stats + cumulative line)
6. **Events + Orders** lists

Key components (added 2026-04-27 to 2026-04-30):
- `live-trading-chart.tsx` — TradingView candles + price lines for orders
- `integrity-widget.tsx` — X/N levels open + breakdown chips + cooldown countdown
- `pnl-sparkline.tsx` — Total/Realized/Floating + sparkline
- `bot-config-card.tsx` — strategy-aware param display
- `position-state-card.tsx` — anchor/market/Δ/inventory/break-even
- `performance-card.tsx` — cycles, ROI, projection
- `bot-info-card.tsx` — older, may be deprecated in favor of position-state-card

State management:
- **TanStack Query** (cache + auto-refetch). Most endpoints use `refetchInterval: 30_000` for live monitoring.
- **Socket.IO client** in `lib/realtime.ts` — `useBotRealtime(id)` and `useUserBotsRealtime()` invalidate React Query cache on `bot:event`

API client (`lib/api.ts`):
- Axios with JWT auto-attach + auto-refresh on 401
- `apiCall(fn)` extracts `error.response.data.error.message`

---

## 🐛 Known Gotchas & Lessons Learned

> These were painful to find. **Read before debugging similar issues.**

### 1. NestJS Constructor DI silently failing (the worst bug)
**Symptom:** `this.someService` is `undefined` in controller methods.
**Cause:** TS `target: ES2023` + `useDefineForClassFields: true` overwrites constructor-assigned fields.
**Fix:** `target: ES2022` + `useDefineForClassFields: false` in API/Engine tsconfig.

### 2. `@UsePipes(new ZodValidationPipe(Schema))` validates ALL parameters
**Cause:** `@UsePipes` at method level applies to every `@Param`, `@Query`, `@Body`, `@CurrentUser`.
**Fix:** Use `@Body(new ZodValidationPipe(Schema)) dto: T` — scopes pipe to body only.

### 3. Stale node processes on Windows
**Fix:** Always use PowerShell: `Get-Process node | Stop-Process -Force`. The `start-all.ps1` script does this automatically.

### 4. `tsbuildinfo` lying about builds
**Cause:** TypeScript incremental cache thinks output is up-to-date even when manually deleted.
**Fix:** `incremental: false` in `tsconfig.base.json`.

### 5. Binance deprecated `POST /api/v3/userDataStream` → HTTP 410
**Fix:** `WebSocketUserStream` connects to `wss://ws-api.binance.com:443/ws-api/v3` (JSON-RPC), opens stream at `wss://stream.binance.com:9443/ws/<listenKey>`, pings every 30 min.
**Backup:** `OrderPoller` runs every 30s.

### 6. Body parsing fails when raw-body verification + default Nest body parser conflict
**Fix:** `bodyParser: false` in NestFactory.create + manual `app.use(json({ verify: rawBodyVerify }))`.

### 7. Cancel-all on stop nuked OTHER bots' orders on the same symbol
**Fix:** Added `ctx.cancelMyOrders()` to `StrategyContext` — uses `batchCancelOrders` over tracked clientOrderIds.

### 8. Grid `state` resume blocked re-placing orders
**Fix:** `stop()` now `saveState(null)`; `init()` reconciles vs Binance open orders.

### 9. Bot stats (totalTrades, realizedPnlQuote) stayed 0
**Fix:** `updateBotStats(botId)` using weighted-avg cost basis — for legacy strategies. **New strategies use `state.realizedPnlQuote` directly (NOT this column).**

### 10. Prisma migration locks during dev
**Fix:** Kill all node processes BEFORE `prisma migrate`/`generate`. Also: `psql -c "SELECT pg_advisory_unlock_all();"` clears stuck advisory locks.

### 11. `dotenv-cli` for Prisma scripts
**Fix:** All db scripts wrapped: `dotenv -e ../../.env -- prisma ...`.

### 12. Reset-password page prerender error
**Fix:** Wrapped form in `<Suspense fallback={...}>`.

### 13. Backtest service can import indicators from package internals
**Note:** Indicators exported from `@orca/strategies` index.

### 14. `next.config.js` workspace root warning
**Fix:** `outputFileTracingRoot: path.join(__dirname, '../..')`.

### 15. Spot has NO native batch order endpoints (only Futures does)
**Cause:** Binance Spot API supports `POST /api/v3/order` (single) only — no `/batchOrders` like `/fapi/v1/batchOrders`.
**Workaround:** `BinanceClient.batchPlaceOrders` / `batchCancelOrders` use parallel HTTP with `concurrency=20` cap. Achieves ~600-900ms for 60 orders vs ~3+ sec sequential.
**Do NOT use** `DELETE /api/v3/openOrders?symbol=X` — that nukes ALL orders including manual trades + other bots'.

### 16. Duplicate fill events from 3 sources
**Symptom:** Counter orders placed multiple times for the same fill; ladder levels drift.
**Cause:** Same FILLED event arrives via WebSocket user stream + OrderPoller (every 30s) + Reconcile loop (every 60s). Each triggers `onOrderUpdate`.
**Fix:** `processedFills: string[]` (FIFO bounded 1000) in strategy state. Mark clientOrderId BEFORE placing counter; subsequent duplicates become no-ops.

### 17. State race between concurrent fills
**Symptom:** Counter orders lost, levels drift, double-counter placed.
**Cause:** `loadState()` → mutate → `saveState()` had no lock. Two events near-simultaneous would each load same snapshot, mutate independently, second save overwrites first.
**Fix:** Per-bot async mutex: `withBotLock(botId, fn)` chains promises by botId. ALL state mutations go through it (init, onOrderUpdate, onTick reconcile path).

### 18. LIMIT_MAKER post-only rejection looks like INSUFFICIENT_BALANCE
**Symptom:** Orders near current price get marked `ignored_balance`, never retry successfully even when funds free up.
**Cause:** Both errors return code `-2010`. Must distinguish by message:
- `"insufficient balance"` → real funds shortage
- `"would immediately match"` / `"post-only"` → price too close to market
**Fix:** `classifyError()` checks message text, not just code. Post-only rejects mark `post_only_rejected` status; reconcile retries when market drifts.

### 19. Reconcile re-saves stale state, overwrites onOrderUpdate's saves
**Symptom:** During reconcile, missed-fill processing was lost.
**Cause:** Reconcile loaded state, called `onOrderUpdate(synthetic)` which loaded+saved its own state, then reconcile's outer `saveState(state)` at function end clobbered everything with the original snapshot.
**Fix:** Extracted `_handleFill(state, event)` as pure mutation. Reconcile and onFill both operate on the SAME state object loaded once and saved once at end.

### 20. Lightweight Charts v5 API breaking change
**Symptom:** `chart.addCandlestickSeries(opts)` fails — method doesn't exist on v5.
**Fix:** v5 uses `chart.addSeries(CandlestickSeries, opts)` with `import { CandlestickSeries } from 'lightweight-charts'`. Same for `LineSeries`, `HistogramSeries`, etc.

### 21. Reading `Bot.realizedPnlQuote` (legacy column) on Dashboard / Reports
**Symptom:** P&L numbers don't match what the bot detail page shows.
**Cause:** `Bot.realizedPnlQuote` is updated by `bot-stats.ts:updateBotStats` using weighted-avg cost basis (legacy). New cycle-based strategies write `state.realizedPnlQuote` directly.
**Fix:** Always read via `BotsService.list()` enrichment which sources from `state` + computes unrealized live. Dashboard, Reports, list page all updated 2026-04-30.

### 22. `recenterAfterMinutes` triggering on active cycles
**Symptom:** DCA cycle aborted mid-progress despite already filling some rungs.
**Cause:** Initial implementation reset `lastActivityAtMs` on every fill — a slow cycle would still recenter.
**Fix:** Renamed to `cycleStartedAtMs` (set ONLY on cycle start). Added `fillsThisCycle === 0` guard. Once any fill happens, the timer is dead for that cycle — runs to natural completion.

---

## 🎓 Conventions & Patterns

### Adding a new built-in strategy
1. Create `packages/strategies/src/<name>/strategy.ts` implementing `Strategy<TParams>`
2. Export from `packages/strategies/src/index.ts` and register in registry
3. Add to seed in `packages/db/prisma/seed.ts` with `builtinKey`, `paramsSchema`, `definition.engine`
4. If strategy emits new BotEvent types, add to `apps/api/src/modules/notifications/event-types.ts:BOT_EVENT_MAPPINGS` to wire notifications
5. If strategy needs new state fields surfaced in UI, extend `bots.service.ts:list()` and `live()` enrichment + `queries.ts` types
6. Run `pnpm --filter @orca/db seed`
7. Add form rendering in `apps/web/src/app/(dashboard)/bots/new/page.tsx`

### Adding a new API endpoint
1. NestJS controller: `@Body(new ZodValidationPipe(MyDto)) dto: MyDto` — never `@UsePipes`
2. Service method returns plain data — `ResponseInterceptor` wraps it
3. Errors: throw `OrcaError(code, message, statusCode, details)` or use Nest exceptions
4. For money math, use `Decimal` from `@orca/shared` — never raw JS numbers

### Adding a new Web query/mutation
- Add hook to `lib/queries.ts` (existing) or `queries-v2.ts` / `queries-v3.ts`
- Use `useMutation` with `onSuccess` invalidating relevant `queryKey`
- For live-monitoring queries, set `refetchInterval: 30_000` (or 5s for super-live)

### Adding a new node type to Strategy Builder
1. Add to `GraphNodeSchema.kind` enum in `packages/strategies/src/graph/strategy.ts`
2. Implement evaluation in the `evalNode` switch
3. If action: add execution in `executeAction`
4. Add to `NODE_PALETTE` in builder page

### Using ctx.emit() correctly
- Strategy emits become BotEvent rows + Pub/Sub messages.
- Pub/Sub messages flow to RealtimeGateway (UI updates) AND NotificationDispatcher (Telegram/in-app).
- If a new event type should trigger notifications, add a mapping in `event-types.ts:BOT_EVENT_MAPPINGS`.
- Risk events from `bot-runner.ts:tick()` MUST go through `ctx.emit()` (not direct Prisma) to reach the dispatcher.

### Per-bot state mutations
- All strategy state mutations go through `withBotLock(botId, fn)`.
- `processedFills` is the dedup ring — push BEFORE placing counters.
- Reconcile uses `_handleFill(state, event)` (pure mutation), not nested `onOrderUpdate` calls.

---

## 📚 Where Each Concept Lives

| Concept | Files |
|---------|-------|
| **Time sync with Binance** | `packages/exchange/src/binance/time-sync.ts` |
| **Rate limiting** | `packages/exchange/src/binance/rate-limiter.ts` |
| **Real-time WS user data** | `packages/exchange/src/binance/ws-user-stream.ts` |
| **Batch order helpers** | `packages/exchange/src/binance/client.ts:batchPlaceOrders / batchCancelOrders` |
| **Order polling fallback** | `apps/engine/src/runners/order-poller.ts` |
| **Paper trading sim** | `apps/engine/src/runners/paper-client.ts` |
| **Bot lifecycle** | `apps/engine/src/runners/bot-runner.ts` |
| **Stats computation (LEGACY weighted-avg)** | `apps/engine/src/runners/bot-stats.ts` |
| **Strategy interface** | `packages/strategies/src/base.ts` |
| **Indicators** | `packages/strategies/src/graph/indicators.ts` |
| **Grid Simple strategy** | `packages/strategies/src/grid_simple/{params,strategy}.ts` |
| **DCA Simple strategy** | `packages/strategies/src/dca_simple/{params,strategy}.ts` |
| **Per-bot mutex (`withBotLock`)** | inline in each Simple strategy file |
| **Error classification** | `apps/api/src/modules/notifications/event-types.ts` AND inline in strategies |
| **Encryption (AES-GCM)** | `packages/shared/src/utils/crypto.ts` |
| **Decimal precision** | `packages/shared/src/utils/decimal.ts` |
| **Live order preview SVG (form)** | `apps/web/src/components/bot-preview.tsx` |
| **Live trading chart (TradingView)** | `apps/web/src/components/live-trading-chart.tsx` |
| **Integrity widget** | `apps/web/src/components/integrity-widget.tsx` |
| **PnL sparkline** | `apps/web/src/components/pnl-sparkline.tsx` |
| **Bot config card** | `apps/web/src/components/bot-config-card.tsx` |
| **Position state card** | `apps/web/src/components/position-state-card.tsx` |
| **Performance card** | `apps/web/src/components/performance-card.tsx` |
| **Visual strategy builder** | `apps/web/src/app/(dashboard)/strategies/builder/page.tsx` |
| **Bots list enrichment** | `apps/api/src/modules/bots/bots.service.ts:list()` |
| **Bot live snapshot** | `apps/api/src/modules/bots/bots.service.ts:live()` |
| **Reports (cycle-based)** | `apps/api/src/modules/reports/reports.service.ts` |
| **Notification routing** | `apps/api/src/modules/notifications/notification-dispatcher.service.ts` |
| **Notification event mapping** | `apps/api/src/modules/notifications/event-types.ts` |
| **Telegram client** | `apps/api/src/modules/notifications/telegram.service.ts` |
| **Periodic status reports** | `apps/api/src/modules/status-report/status-report.service.ts` |
| **Wallet (manual trading)** | `apps/api/src/modules/wallet/`, `apps/web/src/app/(dashboard)/wallet/page.tsx` |
| **CoinPayments client** | `apps/api/src/modules/payments/coinpayments.client.ts` |
| **Connection-status component** | `apps/web/src/components/connection-status.tsx` |
| **Onboarding wizard** | `apps/web/src/components/onboarding-wizard.tsx` |
| **Mobile drawer** | `apps/web/src/components/mobile-sidebar.tsx` |
| **2FA logic** | `apps/api/src/modules/users/users.service.ts` (uses `otplib`) |
| **Risk auto-stop** | `apps/engine/src/runners/bot-runner.ts:tick()` (now via ctx.emit) |
| **Kill Switch** | `apps/api/src/modules/bots/bots.service.ts:emergencyStopAll()` |
| **P&L definitions memory** | `C:\Users\Badr\.claude\projects\c--Users-Badr-OneDrive-Desktop-Trading\memory\pnl_definitions.md` |
| **Deployment guide** | `DEPLOYMENT.md` |
| **Strategy mock test ctx** | `packages/strategies/src/__test__/test-utils.ts` |
| **Strategy unit tests** | `packages/strategies/src/{grid_simple,dca_simple}/strategy.test.ts` |
| **Notification mapping tests** | `apps/api/src/modules/notifications/event-types.test.ts` |
| **Vitest workspace** | `vitest.workspace.ts` (root), `packages/strategies/vitest.config.ts`, `apps/api/vitest.config.ts` |
| **Sentry config (API)** | `apps/api/src/sentry.ts` |
| **Sentry config (Engine)** | `apps/engine/src/sentry.ts` |
| **Sentry config (Web)** | `apps/web/sentry.{client,server,edge}.config.ts` |
| **CI workflow** | `.github/workflows/ci.yml` |
| **DB backup script** | `scripts/backup-db.ps1` |
| **Operational runbook** | `RUNBOOK.md` |

---

## 🚦 Phases Completed

- ✅ **Phase 1** — Monorepo + packages
- ✅ **Phase 2** — NestJS API (Auth/Users/Keys/Strategies/Bots/Health)
- ✅ **Phase 3** — Engine + Web Dashboard
- ✅ **Phase 4** — Plans + Subscriptions + CoinPayments + Admin + Audit
- ✅ **Phase 5** — Reports + Backtest (Grid + Graph) + Strategy Builder
- ✅ **Phase 6** — Paper Trading + WebSocket gateway + 2FA TOTP + AES-256-GCM
- ✅ **Phase 7** — Forgot/Reset password + In-app notifications + Mobile drawer + Onboarding wizard
- ✅ **Phase 8** — DCA + MA Cross + Risk Management + Grid `orderSizeMultiplier` + cancel-only-own-orders fix
- ✅ **Real-time WS** — `WebSocketUserStream` replacing deprecated REST endpoint
- ✅ **Wallet Module** — manual trading
- ✅ **Phase 8.5** (2026-04-27) — **Grid Simple v2** (x2 ladder, mutex, idempotency, integrity loop, batch place/cancel, error classification)
- ✅ **Phase 8.6** (2026-04-28) — **DCA Simple** (x2 ladder DCA, multipliers, cooldown, inactivity recenter)
- ✅ **Phase 8.7** (2026-04-28 to 04-30) — **Live Monitoring Suite** (TradingView chart, IntegrityWidget, PnLSparkline, BotConfigCard, PositionStateCard, PerformanceCard)
- ✅ **Phase 8.8** (2026-04-29) — **P&L Model Overhaul** (cycle-based realized/unrealized/total spec, memory file, list/live API enrichment)
- ✅ **Phase 9** (2026-04-30) — **Notifications Pipeline** (NotificationDispatcher, event mapping, Telegram chat ID UX, fill frequency modes including CUSTOM, Periodic Status Reports with bot selector)
- ✅ **Phase 9.5** (2026-04-30) — **Dashboard + Reports rewrite** (4 KPI tiles, Top Performers, Needs Attention, Cumulative P&L line, Daily P&L bars with per-bar color, sortable per-bot table, per-symbol breakdown, best/worst day)
- ✅ **DEPLOYMENT.md** — Windows Server production deploy guide (Nginx + win-acme + NSSM)
- ✅ **Sprint 1 — Safety Net** (2026-04-30) — Vitest 4.1.5 workspace + 39 tests across `grid_simple`/`dca_simple`/`event-types`, Sentry on API/Engine/Web (5 config files), GitHub Actions CI with Postgres 17 service container, `scripts/backup-db.ps1` (pg_dump + auto-prune 14d), `RUNBOOK.md` with 11 operational scenarios

## 📋 Phases Remaining

### Phase 10 — Notification channels expansion (~3-4 days)
- Email via Resend or SMTP (templates, daily P&L summary)
- Discord webhooks
- Push notifications (PWA service worker)

### Phase 11 — Multi-Exchange (~5-8 days)
- Bybit, OKX, KuCoin connectors
- Refactor `BinanceClient` interface → generic `ExchangeClient`
- Exchange selector in API key form
- Cross-exchange backtest

### Phase 12 — Marketplace (~7-10 days)
- Publish strategy publicly (visibility=PUBLIC)
- Marketplace browse page
- Copy trading (subscribers mirror creator's signals)
- Revenue split (commission to creator)
- Leaderboard + ratings

### Phase 13 — Production Hardening (~3-5 days remaining)
- PM2 cluster mode
- ~~Sentry error tracking~~ ✅ done in Sprint 1
- Datadog/Grafana metrics
- Per-user rate limiting
- IP allowlist for admin
- GDPR data export/delete
- Privacy + ToS pages
- ~~Unit tests (strategies)~~ ✅ done in Sprint 1 (39 tests; can still add indicators + services + integration coverage)
- Integration tests (bot lifecycle)
- E2E (Playwright)
- ~~GitHub Actions CI/CD~~ ✅ done in Sprint 1
- ~~Automated DB backups~~ ✅ done in Sprint 1 (Windows pg_dump script; Linux/cloud version still TBD)

### Optional polish (low priority)
- WebSocket API (`wss://ws-api.binance.com/ws-api/v3`) for placing orders → ~1-3ms vs ~50-150ms HTTP. Adds complexity (signing, correlation, reconnection).
- Digest mode for ORDER_FILLED notifications (every 5/15/60 min summary instead of per-fill)
- Per-bot notification overrides (mute specific bots)
- Live grid integrity gauge animations

---

## 📝 Notes for Future Me (LLM Context)

### Auto mode preference
User often turns auto mode on. When it's on:
- Execute immediately, no plan files
- Make reasonable assumptions for routine choices
- Don't ask permission for code changes
- DO ask before destructive ops (DB drops, force pushes)

When auto mode is OFF:
- Ask clarifying questions before making non-trivial choices
- Use AskUserQuestion for architecture decisions

### Communication style
- User speaks Arabic primarily; respond in Arabic.
- Code/identifiers in English.
- Be concise — user wants results, not lengthy planning.
- When the user reports a UI/data issue, suspect:
  1. **Reading the LEGACY column** (`Bot.realizedPnlQuote`) instead of `liveStats.realized` from list/live API
  2. Stale TanStack Query cache (hard refresh fixes 90%)
  3. API process running old build (rebuild + restart)

### When the user says "اكمل" / "continue"
Continue the previously discussed work or roadmap. Default to the next logical step.

### When the user reports a bug
1. **First diagnose** — query DB, check logs, check process state. Don't guess.
2. The issue is **almost always** one of:
   - Stale node process (kill all via PowerShell, restart)
   - Build artifact missing (run `pnpm fresh:build`)
   - Reading legacy column instead of authoritative state (Gotcha #21)
   - Stuck Prisma advisory lock after a failed migration (Gotcha #10)
3. After fixing, **always rebuild + smoke test** before declaring success.

### When making schema changes
```powershell
# 1. Edit packages/db/prisma/schema.prisma
# 2. Kill all node processes:
Get-Process node | Stop-Process -Force
# 3. (if migration was previously stuck) clear advisory locks:
PGPASSWORD=Medoza120a psql -U postgres -h localhost -d orca -c "SELECT pg_advisory_unlock_all();"
# 4. Migrate:
pnpm --filter @orca/db migrate --name <descriptive_name>
# 5. Rebuild:
pnpm --filter @orca/db build
pnpm --filter @orca/api build
pnpm --filter @orca/engine build
```

### Build order matters
`fresh-build.ps1` builds packages in this order:
1. `@orca/shared` → 2. `@orca/config` → 3. `@orca/logger` → 4. `@orca/db`
5. `@orca/exchange` → 6. `@orca/strategies` → 7. `@orca/api` → 8. `@orca/engine` → 9. `@orca/web`

Don't trust Turbo's parallel builds for first-time builds — it can race `db` vs `api`.

### Default test environment
- **Admin:** `admin@orca.local` / `ChangeMe123!` (role: SUPER_ADMIN)
- The user has a real Binance API key saved as `Real-Main` with FDUSD balance (~3885 FDUSD)
- `BTCFDUSD` is the preferred test pair (zero fees)

### Port allocation
- 3000 → Web (Next.js)
- 4000 → API (NestJS)
- 4001 → Engine
- 5432 → PostgreSQL
- 6379 → Redis (Memurai on Windows)

### Current major design decisions
- **All orders are LIMIT or LIMIT_MAKER** — enforced in `BinanceClient.placeOrder` if `enforceLimitOnly: true`
- **Simple strategies use `LIMIT_MAKER`** (post-only, zero fees on FDUSD)
- **FDUSD pairs preferred** — zero fees on Binance
- **Decimal.js for money math** — never use raw JS numbers for prices/quantities
- **Cycle-based P&L is authoritative** — `state.realizedPnlQuote`, NOT `Bot.realizedPnlQuote` column
- **`withBotLock` for state mutations** — required to prevent races
- **No Docker** — user explicitly opted out
- **No global ValidationPipe** — Zod everywhere via `@Body(new ZodValidationPipe(...))`
- **Spot has NO batch endpoints** — use parallel HTTP via `batchPlaceOrders` / `batchCancelOrders`

### TradingView Lightweight Charts version
- Currently on **v5** — API uses `chart.addSeries(CandlestickSeries, opts)` not the v4 `chart.addCandlestickSeries(opts)`.
- Imports must include `import { CandlestickSeries } from 'lightweight-charts'`.

### When extending notifications
- New BotEvent type → add mapping in `event-types.ts:BOT_EVENT_MAPPINGS`
- New NotificationEvent → extend the type union in `notifications.service.ts` AND `ALL_NOTIFICATION_EVENTS` array AND web UI events list at `apps/web/src/app/(dashboard)/settings/notifications/page.tsx:EVENTS`
- Verify `User.fillFrequency` and `User.notificationConfig` are respected for fill events

### Useful commands cheatsheet
```bash
# Quick DB inspection
PGPASSWORD=Medoza120a psql -U postgres -h localhost -d orca -c "SELECT name, status FROM \"Bot\" ORDER BY \"createdAt\" DESC LIMIT 5;"

# Check authoritative P&L from state
PGPASSWORD=Medoza120a psql -U postgres -h localhost -d orca -c "SELECT name, state->>'realizedPnlQuote' AS realized, state->>'cyclesCompleted' AS cycles FROM \"Bot\" WHERE state IS NOT NULL;"

# Check integrity events recent
PGPASSWORD=Medoza120a psql -U postgres -h localhost -d orca -c "SELECT type, message, \"createdAt\" FROM \"BotEvent\" WHERE type LIKE 'GRID_INTEGRITY%' OR type LIKE 'DCA_INTEGRITY%' ORDER BY \"createdAt\" DESC LIMIT 10;"

# Quick bot reset (clear stuck state)
PGPASSWORD=Medoza120a psql -U postgres -h localhost -d orca -c "UPDATE \"Bot\" SET status='STOPPED', state=NULL WHERE name='X';"

# Clear stuck advisory locks (after failed migration)
PGPASSWORD=Medoza120a psql -U postgres -h localhost -d orca -c "SELECT pg_advisory_unlock_all();"

# Watch engine log
Get-Content -Path .\logs\engine.log -Tail 50 -Wait

# Check what's running
Get-Process node | Format-Table Id, StartTime
Get-NetTCPConnection -LocalPort 4000 -State Listen
```

---

## 🔐 Secrets / .env Reference

The `.env` file contains:

```ini
NODE_ENV=development
DATABASE_URL="postgresql://postgres:Medoza120a@localhost:5432/orca?schema=public"
REDIS_URL="redis://127.0.0.1:6379"
AUTH_SECRET="dev-secret-change-in-production-please-use-a-long-random-string-here"
ENCRYPTION_SECRET="dev-encryption-secret-change-in-production-32chars-min-required"

# Telegram (optional)
TELEGRAM_BOT_TOKEN=7834802700:...   # user's real Telegram bot
TELEGRAM_DEFAULT_CHAT_ID=1223468133 # only used if user hasn't set their own chatId
PUBLIC_WEB_URL=                     # empty in dev; set to https://yourdomain.com in prod for Telegram deep-links

# Admin defaults
ADMIN_DEFAULT_EMAIL=admin@orca.local
ADMIN_DEFAULT_PASSWORD=ChangeMe123!

# Sentry (optional — all 3 are no-ops if DSN unset)
SENTRY_DSN_API=
SENTRY_DSN_ENGINE=
SENTRY_DSN_WEB=
SENTRY_TRACES_SAMPLE_RATE=0
SENTRY_ENVIRONMENT=development

# Backup script (optional — defaults exist)
ORCA_PG_USER=postgres
ORCA_PG_PASSWORD=
ORCA_PG_HOST=localhost
ORCA_PG_DB=orca
ORCA_BACKUP_DIR=./backups
ORCA_BACKUP_KEEP=14
```

**Production checklist before deploy:**
- [ ] Generate strong `AUTH_SECRET` and `ENCRYPTION_SECRET` (≥32 chars, true random)
- [ ] Set `NODE_ENV=production`
- [ ] Set `LOG_PRETTY=false`
- [ ] Configure `PUBLIC_WEB_URL` so Telegram messages have working deep-links
- [ ] Configure `COINPAYMENTS_*` for real payments
- [ ] Configure `API_CORS_ORIGIN` to production domain
- [ ] `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL` MUST point to public domain (baked into web bundle at build time)
- [ ] Set `SENTRY_DSN_API`, `SENTRY_DSN_ENGINE`, `SENTRY_DSN_WEB` + `SENTRY_ENVIRONMENT=production`
- [ ] Schedule `scripts/backup-db.ps1` via Task Scheduler (daily) and verify backup files in `ORCA_BACKUP_DIR`
- [ ] Use a secrets manager (AWS Secrets Manager, Vault) — don't ship `.env`
- [ ] Re-encrypt all existing API keys with new `ENCRYPTION_SECRET` (write a migration)
- [ ] Follow `DEPLOYMENT.md` for Nginx + SSL + Windows Services setup

---

## 🚀 Real-time Architecture Detail

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
└─────────────┬───────────────┘
              │  onEvent(executionReport)
              ↓
┌─────────────────────────────┐
│  BotRunner.handleUserData   │
│  • Persist Order/Trade       │
│  • updateBotStats() [LEGACY] │
│  • strategy.onOrderUpdate() │
│    └─ withBotLock()          │
│       └─ _handleFill() →     │
│          state mutation +    │
│          ctx.emit() events   │
└─────────────┬───────────────┘
              │  ctx.emit() →
              ↓
┌─────────────────────────────┐
│  Redis Pub/Sub              │
│  channel: orca:engine:evt   │
└─────┬───────────────────┬───┘
      │                   │
      ↓                   ↓
┌──────────────────┐  ┌─────────────────────────┐
│ RealtimeGateway  │  │ NotificationDispatcher  │
│ Socket.IO emit   │  │ mapBotEvent() →         │
│ • bot:<botId>    │  │ NotificationsService    │
│ • user:<userId>  │  │ → Telegram + IN_APP     │
└────┬─────────────┘  └─────────────────────────┘
     │
     ↓
┌─────────────────────────────┐
│  Web: useBotRealtime hook   │
│  • Invalidate React Query   │
│  • UI refreshes immediately │
└─────────────────────────────┘
```

End-to-end latency: **~100-200ms** from Binance fill to UI update. Telegram message arrives within ~500ms of fill.

---

## 🎬 Resume Workflow Template

When picking the project back up:

1. **Open** `c:\Users\Badr\OneDrive\Desktop\Trading\` in VS Code
2. **Read** the latest sections of this `HANDOFF.md` (Phases Completed + Known Gotchas)
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
7. **Pick next phase** from [Phases Remaining](#-phases-remaining), OR
   address whatever new feature/bug the user mentions

---

## 📞 If Something Is Broken

> **First stop: `RUNBOOK.md`** — 11 detailed scenarios with copy-paste recovery commands. The list below is the quick triage.

In order of likelihood:

1. **Stale node process** → `Get-Process node | Stop-Process -Force` then restart
2. **Missing build artifacts** → `pnpm fresh:build`
3. **Wrong P&L numbers in UI** → check if it's reading `Bot.realizedPnlQuote` (legacy) instead of `liveStats.realized` (Gotcha #21)
4. **Bot creates duplicate orders** → check `processedFills` is being respected; verify `withBotLock` is wrapping the mutation
5. **Grid levels drift over time** → state race; ensure `_handleFill` is the only mutation path inside the lock
6. **Telegram not arriving** → check `User.telegramChatId` set; check NotificationDispatcher logs; check `event-types.ts` has a mapping for the BotEvent type
7. **Bot stuck "RUNNING" but inactive** → reset state: `UPDATE "Bot" SET state=NULL WHERE id='...'`
8. **Web shows "Network Error"** → check API is on :4000 + check connection-status badge in topbar
9. **DB migration won't run** → kill node processes; clear advisory locks (`SELECT pg_advisory_unlock_all()`)
10. **Strategy not placing orders** → check engine log; check API key `status=ACTIVE`; check post-only rejections (Gotcha #18)
11. **TradingView chart shows blank** → check Lightweight Charts v5 API usage (`addSeries(CandlestickSeries, opts)` not `addCandlestickSeries(opts)`)

---

## 🔗 Related Documentation

- **`RUNNING.md`** — user-facing local dev guide
- **`DEPLOYMENT.md`** — Windows Server production deployment (Nginx, SSL, NSSM)
- **`RUNBOOK.md`** — 11 operational scenarios with copy-paste recovery commands
- **`memory/pnl_definitions.md`** — canonical P&L formulas (in Claude memory dir)

---

**END OF HANDOFF**

> To future me: **trust this document** — it captures hard-won knowledge from 4 days
> of intense rewrites (2026-04-27 to 2026-04-30). Update the [Known Gotchas](#-known-gotchas--lessons-learned)
> section any time you discover something non-obvious. Update [Phases Completed](#-phases-completed)
> after shipping anything substantial.
