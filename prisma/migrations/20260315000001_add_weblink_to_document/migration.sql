ALTER TABLE "Document" ALTER COLUMN "storagePath" DROP NOT NULL;
ALTER TABLE "Document" ADD COLUMN "url" TEXT;
ALTER TABLE "Document" ADD CONSTRAINT "Document_storagePath_or_url_check"
  CHECK ("storagePath" IS NOT NULL OR "url" IS NOT NULL);
