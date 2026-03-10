-- DropForeignKey
ALTER TABLE "UserTask" DROP CONSTRAINT "UserTask_documentId_fkey";

-- AlterTable
ALTER TABLE "OnboardingTask" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "UserTask" ADD CONSTRAINT "UserTask_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
