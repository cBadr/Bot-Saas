-- AlterTable
ALTER TABLE "User" ADD COLUMN     "discordWebhookUrl" TEXT,
ADD COLUMN     "pushSubscriptions" JSONB NOT NULL DEFAULT '[]';
