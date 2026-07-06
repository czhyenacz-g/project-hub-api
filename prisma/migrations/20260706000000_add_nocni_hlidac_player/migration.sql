-- CreateTable
CREATE TABLE "NocniHlidacPlayer" (
    "id" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "bestRun" INTEGER NOT NULL DEFAULT 0,
    "currentRun" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "NocniHlidacPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NocniHlidacPlayer_discordUserId_key" ON "NocniHlidacPlayer"("discordUserId");

-- CreateIndex
CREATE INDEX "NocniHlidacPlayer_discordUserId_idx" ON "NocniHlidacPlayer"("discordUserId");

-- CreateIndex
CREATE INDEX "NocniHlidacPlayer_bestRun_currentRun_idx" ON "NocniHlidacPlayer"("bestRun" DESC, "currentRun" DESC);
