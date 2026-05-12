
-- CreateEnum
CREATE TYPE "BotRunStatus" AS ENUM ('RUNNING', 'STOPPED', 'ERROR');

-- AlterTable
ALTER TABLE "Bot" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "currentRunId" TEXT,
ADD COLUMN     "lifetimeCycles" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lifetimeFees" DECIMAL(36,18) NOT NULL DEFAULT 0,
ADD COLUMN     "lifetimeRealized" DECIMAL(36,18) NOT NULL DEFAULT 0,
ADD COLUMN     "lifetimeVolume" DECIMAL(36,18) NOT NULL DEFAULT 0,
ADD COLUMN     "totalRuns" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "BotEvent" ADD COLUMN     "botRunId" TEXT;

-- AlterTable
ALTER TABLE "Trade" ADD COLUMN     "botRunId" TEXT;

-- CreateTable
CREATE TABLE "BotRun" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "runNumber" INTEGER NOT NULL,
    "paramsSnapshot" JSONB NOT NULL,
    "initialStartPrice" DECIMAL(36,18),
    "status" "BotRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" TIMESTAMP(3),
    "stopReason" TEXT,
    "realizedPnl" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "unrealizedAtStop" DECIMAL(36,18),
    "cyclesCompleted" INTEGER NOT NULL DEFAULT 0,
    "tradesCount" INTEGER NOT NULL DEFAULT 0,
    "volumeQuote" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "fees" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "maxDrawdownAbs" DECIMAL(36,18),
    "durationMs" BIGINT,
    "errorMessage" TEXT,

    CONSTRAINT "BotRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BotRun_botId_startedAt_idx" ON "BotRun"("botId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "BotRun_status_idx" ON "BotRun"("status");

-- CreateIndex
CREATE UNIQUE INDEX "BotRun_botId_runNumber_key" ON "BotRun"("botId", "runNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Bot_currentRunId_key" ON "Bot"("currentRunId");

-- CreateIndex
CREATE INDEX "Bot_archivedAt_idx" ON "Bot"("archivedAt");

-- CreateIndex
CREATE INDEX "BotEvent_botRunId_idx" ON "BotEvent"("botRunId");

-- CreateIndex
CREATE INDEX "Trade_botRunId_idx" ON "Trade"("botRunId");

-- AddForeignKey
ALTER TABLE "Bot" ADD CONSTRAINT "Bot_currentRunId_fkey" FOREIGN KEY ("currentRunId") REFERENCES "BotRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotRun" ADD CONSTRAINT "BotRun_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotEvent" ADD CONSTRAINT "BotEvent_botRunId_fkey" FOREIGN KEY ("botRunId") REFERENCES "BotRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_botRunId_fkey" FOREIGN KEY ("botRunId") REFERENCES "BotRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

