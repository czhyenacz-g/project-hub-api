-- CreateTable
CREATE TABLE "Tournament" (
    "id" TEXT NOT NULL,
    "publicCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "playerCount" INTEGER NOT NULL,
    "format" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "winnerTeamId" TEXT,

    CONSTRAINT "Tournament_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentTeam" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "slotNumber" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "claimedByUserId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "seed" INTEGER,
    "finalRank" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentTeam_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tournament_publicCode_key" ON "Tournament"("publicCode");

-- CreateIndex
CREATE INDEX "Tournament_createdByUserId_idx" ON "Tournament"("createdByUserId");

-- CreateIndex
CREATE INDEX "TournamentTeam_tournamentId_idx" ON "TournamentTeam"("tournamentId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentTeam_tournamentId_slotNumber_key" ON "TournamentTeam"("tournamentId", "slotNumber");

-- AddForeignKey
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "OsmaUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentTeam" ADD CONSTRAINT "TournamentTeam_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentTeam" ADD CONSTRAINT "TournamentTeam_claimedByUserId_fkey" FOREIGN KEY ("claimedByUserId") REFERENCES "OsmaUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
