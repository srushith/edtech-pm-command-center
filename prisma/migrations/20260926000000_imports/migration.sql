-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('CSV', 'SHEET');

-- CreateTable
CREATE TABLE "ImportSource" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "kind" "ImportKind" NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "spreadsheetId" TEXT,
    "sheetId" INTEGER,
    "sheetTitle" TEXT,
    "headerSignature" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "ImportSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceId" TEXT,
    "entityType" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "created" INTEGER NOT NULL,
    "updated" INTEGER NOT NULL,
    "unchanged" INTEGER NOT NULL,
    "skipped" INTEGER NOT NULL,
    "errors" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportSource_workspaceId_idx" ON "ImportSource"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportSource_workspaceId_entityType_sourceKey_key" ON "ImportSource"("workspaceId", "entityType", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "ImportSource_id_workspaceId_key" ON "ImportSource"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "ImportRun_workspaceId_createdAt_idx" ON "ImportRun"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ImportRun_id_workspaceId_key" ON "ImportRun"("id", "workspaceId");

-- AddForeignKey
ALTER TABLE "ImportSource" ADD CONSTRAINT "ImportSource_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportSource" ADD CONSTRAINT "ImportSource_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRun" ADD CONSTRAINT "ImportRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRun" ADD CONSTRAINT "ImportRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ImportSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
