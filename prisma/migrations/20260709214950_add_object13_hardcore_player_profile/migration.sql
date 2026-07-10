-- CreateTable
CREATE TABLE "Object13HardcorePlayerProfile" (
    "id" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "hardcoreHasDefeatedMonster" BOOLEAN NOT NULL DEFAULT false,
    "hardcoreDoubleBarrelUnlocked" BOOLEAN NOT NULL DEFAULT false,
    "hardcoreMonsterDefeatsCount" INTEGER NOT NULL DEFAULT 0,
    "hardcoreBestNight" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Object13HardcorePlayerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Object13HardcorePlayerProfile_discordUserId_key" ON "Object13HardcorePlayerProfile"("discordUserId");

-- CreateIndex
CREATE INDEX "Object13HardcorePlayerProfile_discordUserId_idx" ON "Object13HardcorePlayerProfile"("discordUserId");

-- CreateIndex
CREATE INDEX "Object13HardcorePlayerProfile_hardcoreBestNight_idx" ON "Object13HardcorePlayerProfile"("hardcoreBestNight" DESC);
