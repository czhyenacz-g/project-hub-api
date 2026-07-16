-- CreateTable
CREATE TABLE "Object13PlayerProfile" (
    "id" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "profileVersion" INTEGER NOT NULL DEFAULT 1,
    "profileData" JSONB NOT NULL DEFAULT '{}',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Object13PlayerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Object13PlayerProfile_discordUserId_key" ON "Object13PlayerProfile"("discordUserId");

-- CreateIndex
CREATE INDEX "Object13PlayerProfile_discordUserId_idx" ON "Object13PlayerProfile"("discordUserId");

-- CreateIndex
CREATE INDEX "Object13PlayerProfile_updatedAt_idx" ON "Object13PlayerProfile"("updatedAt" DESC);
