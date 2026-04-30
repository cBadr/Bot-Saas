-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notificationConfig" JSONB NOT NULL DEFAULT '{}';
