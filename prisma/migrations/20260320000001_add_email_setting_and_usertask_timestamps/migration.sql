-- CreateTable: EmailSetting singleton for SMTP configuration
CREATE TABLE "EmailSetting" (
    "id"          TEXT NOT NULL,
    "enabled"     BOOLEAN NOT NULL DEFAULT false,
    "host"        TEXT NOT NULL DEFAULT '',
    "port"        INTEGER NOT NULL DEFAULT 587,
    "secure"      BOOLEAN NOT NULL DEFAULT false,
    "username"    TEXT NOT NULL DEFAULT '',
    "passwordEnc" TEXT NOT NULL DEFAULT '',
    "fromAddress" TEXT NOT NULL DEFAULT '',
    "fromName"    TEXT NOT NULL DEFAULT '',
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailSetting_pkey" PRIMARY KEY ("id")
);

-- AlterTable: add createdAt and overdueNotifiedAt to UserTask
ALTER TABLE "UserTask" ADD COLUMN "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "UserTask" ADD COLUMN "overdueNotifiedAt"  TIMESTAMP(3);

-- CreateIndex for UserTask.createdAt
CREATE INDEX "UserTask_createdAt_idx" ON "UserTask"("createdAt");
