-- CreateIndex
CREATE UNIQUE INDEX "TournamentTeam_tournamentId_claimedByUserId_key" ON "TournamentTeam"("tournamentId", "claimedByUserId");

