-- Add isResource flag to Document
ALTER TABLE "Document" ADD COLUMN "isResource" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: all existing tab-uploaded documents (not task-upload evidence) become Resources
UPDATE "Document" SET "isResource" = true WHERE category != 'task-upload';

-- Add resource FK to OnboardingTask
ALTER TABLE "OnboardingTask" ADD COLUMN "resourceDocumentId" TEXT;
ALTER TABLE "OnboardingTask"
  ADD CONSTRAINT "OnboardingTask_resourceDocumentId_fkey"
  FOREIGN KEY ("resourceDocumentId") REFERENCES "Document"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
