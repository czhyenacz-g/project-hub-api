-- AlterTable: add nullable onlineMatchId to OsmaMatchResult for linking to online match detail
ALTER TABLE "OsmaMatchResult" ADD COLUMN "onlineMatchId" TEXT;
