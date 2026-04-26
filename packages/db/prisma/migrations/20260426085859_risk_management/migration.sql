-- AlterTable
ALTER TABLE "Bot" ADD COLUMN     "dailyLossLimit" DECIMAL(36,18),
ADD COLUMN     "maxDrawdownPct" DECIMAL(10,6);
