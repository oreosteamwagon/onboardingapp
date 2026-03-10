-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('STANDARD', 'UPLOAD');

-- AlterTable: add taskType and updatedAt to OnboardingTask
ALTER TABLE "OnboardingTask"
    ADD COLUMN "taskType" "TaskType" NOT NULL DEFAULT 'STANDARD',
    ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable: add documentId to UserTask
ALTER TABLE "UserTask"
    ADD COLUMN "documentId" TEXT;

-- CreateIndex: unique constraint on UserTask.documentId (one document per task completion)
CREATE UNIQUE INDEX "UserTask_documentId_key" ON "UserTask"("documentId");

-- AddForeignKey: UserTask -> Document
ALTER TABLE "UserTask"
    ADD CONSTRAINT "UserTask_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "Document"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
