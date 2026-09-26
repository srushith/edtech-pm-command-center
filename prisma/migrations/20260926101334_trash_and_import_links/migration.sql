-- AlterTable
ALTER TABLE "ChecklistItem" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "trashBatchId" TEXT;

-- AlterTable
ALTER TABLE "Cohort" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "trashBatchId" TEXT;

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "trashBatchId" TEXT;

-- AlterTable
ALTER TABLE "ImportRun" ADD COLUMN     "deleted" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Instructor" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "trashBatchId" TEXT;

-- AlterTable
ALTER TABLE "Issue" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "trashBatchId" TEXT;

-- AlterTable
ALTER TABLE "Launch" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "trashBatchId" TEXT;

-- AlterTable
ALTER TABLE "LearnerFeedback" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "trashBatchId" TEXT;

-- AlterTable
ALTER TABLE "Module" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "trashBatchId" TEXT;

-- AlterTable
ALTER TABLE "ModuleVersion" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "trashBatchId" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "trashBatchId" TEXT;

-- AlterTable
ALTER TABLE "SME" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "trashBatchId" TEXT;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "trashBatchId" TEXT;

-- CreateTable
CREATE TABLE "ImportLink" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "matchKey" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrashBatch" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "rootIds" JSONB NOT NULL,
    "contents" JSONB NOT NULL,
    "unlinks" JSONB NOT NULL,
    "deletedById" TEXT,
    "deletedByName" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrashBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportLink_workspaceId_idx" ON "ImportLink"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportLink_sourceId_matchKey_key" ON "ImportLink"("sourceId", "matchKey");

-- CreateIndex
CREATE UNIQUE INDEX "ImportLink_id_workspaceId_key" ON "ImportLink"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "TrashBatch_workspaceId_deletedAt_idx" ON "TrashBatch"("workspaceId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrashBatch_id_workspaceId_key" ON "TrashBatch"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "ChecklistItem_trashBatchId_idx" ON "ChecklistItem"("trashBatchId");

-- CreateIndex
CREATE INDEX "Cohort_trashBatchId_idx" ON "Cohort"("trashBatchId");

-- CreateIndex
CREATE INDEX "Course_trashBatchId_idx" ON "Course"("trashBatchId");

-- CreateIndex
CREATE INDEX "Instructor_trashBatchId_idx" ON "Instructor"("trashBatchId");

-- CreateIndex
CREATE INDEX "Issue_trashBatchId_idx" ON "Issue"("trashBatchId");

-- CreateIndex
CREATE INDEX "Launch_trashBatchId_idx" ON "Launch"("trashBatchId");

-- CreateIndex
CREATE INDEX "LearnerFeedback_trashBatchId_idx" ON "LearnerFeedback"("trashBatchId");

-- CreateIndex
CREATE INDEX "Module_trashBatchId_idx" ON "Module"("trashBatchId");

-- CreateIndex
CREATE INDEX "ModuleVersion_trashBatchId_idx" ON "ModuleVersion"("trashBatchId");

-- CreateIndex
CREATE INDEX "Project_trashBatchId_idx" ON "Project"("trashBatchId");

-- CreateIndex
CREATE INDEX "SME_trashBatchId_idx" ON "SME"("trashBatchId");

-- CreateIndex
CREATE INDEX "Session_trashBatchId_idx" ON "Session"("trashBatchId");

-- AddForeignKey
ALTER TABLE "ImportLink" ADD CONSTRAINT "ImportLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportLink" ADD CONSTRAINT "ImportLink_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ImportSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrashBatch" ADD CONSTRAINT "TrashBatch_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
