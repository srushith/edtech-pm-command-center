-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "rowVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Cohort" ADD COLUMN     "rowVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Instructor" ADD COLUMN     "rowVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SME" ADD COLUMN     "rowVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Module" ADD COLUMN     "rowVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "rowVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "LearnerFeedback" ADD COLUMN     "rowVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Issue" ADD COLUMN     "rowVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "rowVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Launch" ADD COLUMN     "rowVersion" INTEGER NOT NULL DEFAULT 0;

