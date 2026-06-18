-- Add homeClubPoints and awayClubPoints to OsmaOnlineMatch
ALTER TABLE "OsmaOnlineMatch" ADD COLUMN "homeClubPoints" INTEGER;
ALTER TABLE "OsmaOnlineMatch" ADD COLUMN "awayClubPoints" INTEGER;
