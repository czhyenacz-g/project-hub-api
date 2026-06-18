-- Add homeUserId and awayUserId to OsmaOnlineMatch
ALTER TABLE "OsmaOnlineMatch" ADD COLUMN "homeUserId" TEXT;
ALTER TABLE "OsmaOnlineMatch" ADD COLUMN "awayUserId" TEXT;

ALTER TABLE "OsmaOnlineMatch"
ADD CONSTRAINT "OsmaOnlineMatch_homeUserId_fkey"
FOREIGN KEY ("homeUserId") REFERENCES "OsmaUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OsmaOnlineMatch"
ADD CONSTRAINT "OsmaOnlineMatch_awayUserId_fkey"
FOREIGN KEY ("awayUserId") REFERENCES "OsmaUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "OsmaOnlineMatch_homeUserId_idx" ON "OsmaOnlineMatch"("homeUserId");
CREATE INDEX "OsmaOnlineMatch_awayUserId_idx" ON "OsmaOnlineMatch"("awayUserId");
