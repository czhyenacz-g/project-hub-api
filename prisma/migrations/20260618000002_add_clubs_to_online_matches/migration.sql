-- Add homeClubId and awayClubId to OsmaOnlineMatch
ALTER TABLE "OsmaOnlineMatch" ADD COLUMN "homeClubId" TEXT;
ALTER TABLE "OsmaOnlineMatch" ADD COLUMN "awayClubId" TEXT;

ALTER TABLE "OsmaOnlineMatch"
ADD CONSTRAINT "OsmaOnlineMatch_homeClubId_fkey"
FOREIGN KEY ("homeClubId") REFERENCES "OsmaClub"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OsmaOnlineMatch"
ADD CONSTRAINT "OsmaOnlineMatch_awayClubId_fkey"
FOREIGN KEY ("awayClubId") REFERENCES "OsmaClub"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "OsmaOnlineMatch_homeClubId_idx" ON "OsmaOnlineMatch"("homeClubId");
CREATE INDEX "OsmaOnlineMatch_awayClubId_idx" ON "OsmaOnlineMatch"("awayClubId");
