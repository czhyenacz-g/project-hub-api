-- CreateTable
CREATE TABLE "OsmaUser" (
    "id" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "globalName" TEXT,
    "avatar" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OsmaUser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OsmaUser_discordId_key" ON "OsmaUser"("discordId");

-- CreateIndex
CREATE INDEX "OsmaUser_discordId_idx" ON "OsmaUser"("discordId");
