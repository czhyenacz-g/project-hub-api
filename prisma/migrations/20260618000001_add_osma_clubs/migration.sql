-- CreateTable OsmaClub
CREATE TABLE "OsmaClub" (
    "id"             TEXT NOT NULL,
    "slug"           TEXT NOT NULL,
    "name"           TEXT NOT NULL,
    "shortName"      TEXT,
    "city"           TEXT,
    "location"       TEXT,
    "note"           TEXT,
    "colors"         TEXT,
    "motto"          TEXT NOT NULL,
    "description"    TEXT NOT NULL,
    "seasonComment"  TEXT,
    "banner"         TEXT,
    "logo"           TEXT,
    "primaryColor"   TEXT,
    "secondaryColor" TEXT,
    "isActive"       BOOLEAN NOT NULL DEFAULT true,
    "sortOrder"      INTEGER NOT NULL DEFAULT 0,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OsmaClub_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OsmaClub_slug_key" ON "OsmaClub"("slug");
CREATE INDEX "OsmaClub_sortOrder_idx" ON "OsmaClub"("sortOrder");
CREATE INDEX "OsmaClub_isActive_idx" ON "OsmaClub"("isActive");
