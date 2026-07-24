-- AlterTable
ALTER TABLE "NocniHlidacPlayer" ADD COLUMN     "lastPlayedAt" TIMESTAMP(3),
ADD COLUMN     "lastActivityAt" TIMESTAMP(3),
ADD COLUMN     "lastClient" VARCHAR(32),
ADD COLUMN     "lastBuildVersion" VARCHAR(64);

-- CreateIndex
CREATE INDEX "NocniHlidacPlayer_lastActivityAt_idx" ON "NocniHlidacPlayer"("lastActivityAt" DESC);

-- CreateTable
CREATE TABLE "NocniHlidacPlayerActivityEvent" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "nightNumber" INTEGER,
    "gameMode" TEXT,
    "client" VARCHAR(32),
    "buildVersion" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NocniHlidacPlayerActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NocniHlidacPlayerActivityEvent_playerId_idx" ON "NocniHlidacPlayerActivityEvent"("playerId");

-- CreateIndex
CREATE INDEX "NocniHlidacPlayerActivityEvent_createdAt_idx" ON "NocniHlidacPlayerActivityEvent"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "NocniHlidacPlayerActivityEvent_playerId_createdAt_idx" ON "NocniHlidacPlayerActivityEvent"("playerId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "NocniHlidacPlayerActivityEvent" ADD CONSTRAINT "NocniHlidacPlayerActivityEvent_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "NocniHlidacPlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
