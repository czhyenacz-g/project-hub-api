-- CreateTable
CREATE TABLE "OsmaMatchResult" (
    "id" TEXT NOT NULL,
    "homeTeamSlug" TEXT NOT NULL,
    "homeTeamName" TEXT NOT NULL,
    "awayTeamSlug" TEXT NOT NULL,
    "awayTeamName" TEXT NOT NULL,
    "homeScore" INTEGER NOT NULL,
    "awayScore" INTEGER NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'singleplayer',
    "durationSeconds" INTEGER NOT NULL,
    "matchComment" TEXT NOT NULL,
    "playedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OsmaMatchResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OsmaOnlineMatch" (
    "id" TEXT NOT NULL,
    "gameCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'finished',
    "homeTeamSlug" TEXT NOT NULL,
    "homeTeamName" TEXT NOT NULL,
    "awayTeamSlug" TEXT NOT NULL,
    "awayTeamName" TEXT NOT NULL,
    "homeScore" INTEGER NOT NULL,
    "awayScore" INTEGER NOT NULL,
    "winnerSide" TEXT,
    "lobbyCreatedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "finishReason" TEXT NOT NULL DEFAULT 'full_time',
    "publicResultId" TEXT,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OsmaOnlineMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OsmaOnlineMatchEvent" (
    "id" TEXT NOT NULL,
    "onlineMatchId" TEXT NOT NULL,
    "gameCode" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "matchSecond" INTEGER,
    "teamSide" TEXT,
    "teamName" TEXT,
    "actorLabel" TEXT,
    "homeScoreAfter" INTEGER,
    "awayScoreAfter" INTEGER,
    "message" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OsmaOnlineMatchEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OsmaMatchResult_playedAt_idx" ON "OsmaMatchResult"("playedAt" DESC);

-- CreateIndex
CREATE INDEX "OsmaMatchResult_createdAt_idx" ON "OsmaMatchResult"("createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "OsmaOnlineMatch_gameCode_key" ON "OsmaOnlineMatch"("gameCode");

-- CreateIndex
CREATE INDEX "OsmaOnlineMatch_savedAt_idx" ON "OsmaOnlineMatch"("savedAt" DESC);

-- CreateIndex
CREATE INDEX "OsmaOnlineMatch_gameCode_idx" ON "OsmaOnlineMatch"("gameCode");

-- CreateIndex
CREATE INDEX "OsmaOnlineMatchEvent_onlineMatchId_idx" ON "OsmaOnlineMatchEvent"("onlineMatchId");

-- CreateIndex
CREATE INDEX "OsmaOnlineMatchEvent_gameCode_idx" ON "OsmaOnlineMatchEvent"("gameCode");

-- AddForeignKey
ALTER TABLE "OsmaOnlineMatchEvent" ADD CONSTRAINT "OsmaOnlineMatchEvent_onlineMatchId_fkey" FOREIGN KEY ("onlineMatchId") REFERENCES "OsmaOnlineMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
