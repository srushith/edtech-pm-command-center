-- CreateEnum
CREATE TYPE "AIProviderKind" AS ENUM ('OPENAI', 'GEMINI', 'ANTHROPIC');

-- CreateTable
CREATE TABLE "WorkspaceAISettings" (
    "workspaceId" TEXT NOT NULL,
    "provider" "AIProviderKind" NOT NULL DEFAULT 'OPENAI',
    "model" TEXT NOT NULL,
    "encryptedKey" TEXT,
    "keyLast4" TEXT,
    "monthlyRequestLimit" INTEGER,
    "lastTestedAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "lastTestMessage" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceAISettings_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateTable
CREATE TABLE "AIUsageEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIUsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AIUsageEvent_workspaceId_createdAt_idx" ON "AIUsageEvent"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "WorkspaceAISettings" ADD CONSTRAINT "WorkspaceAISettings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceAISettings" ADD CONSTRAINT "WorkspaceAISettings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIUsageEvent" ADD CONSTRAINT "AIUsageEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
