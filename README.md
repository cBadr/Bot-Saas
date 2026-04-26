# Orca

Professional Crypto Trading SaaS Platform — Binance-powered automated trading bots with a visual strategy builder.

## Stack

- **Monorepo**: pnpm Workspaces + Turborepo
- **Backend**: NestJS 11 + TypeScript 5.7 + Node.js 22 LTS
- **Frontend**: Next.js 15 + React 19 + TailwindCSS 4 + shadcn/ui
- **Database**: PostgreSQL 17 + Prisma 6
- **Cache/Queue**: Redis 7 + BullMQ
- **Auth**: Better-Auth
- **Logging**: Pino + Sentry
- **Process Manager**: PM2

## Project Structure

```
orca/
├── apps/
│   ├── api/         # NestJS REST + WebSocket API
│   ├── engine/      # Bot execution worker
│   └── web/         # Next.js dashboard (user + admin)
├── packages/
│   ├── shared/      # Shared types, DTOs, constants
│   ├── config/      # Environment configuration
│   ├── logger/      # Smart logging system
│   ├── db/          # Prisma schema + client
│   ├── exchange/    # Binance connector + abstractions
│   └── strategies/  # Built-in strategies (Grid, etc.)
└── ecosystem.config.cjs   # PM2 config
```

## Prerequisites

- Node.js >= 22
- pnpm >= 10
- PostgreSQL >= 17
- Redis >= 7

## Setup

```bash
# Install dependencies
pnpm install

# Copy env
cp .env.example .env

# Setup database
pnpm db:generate
pnpm db:migrate

# Run dev (all apps in parallel)
pnpm dev
```

## Important Notes

- **All Binance orders are LIMIT orders** (zero fees with FDUSD pairs).
- **Server time is synced with Binance** every 60s.
- **Bots are isolated** per worker process to prevent cross-user impact.
- **Smart logging** captures app, trade, API, Binance, and audit events.
