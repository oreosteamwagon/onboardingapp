-- Add Microsoft Entra ID (Azure AD) fields to EmailSetting
ALTER TABLE "EmailSetting" ADD COLUMN "provider"             TEXT NOT NULL DEFAULT 'SMTP';
ALTER TABLE "EmailSetting" ADD COLUMN "entraTenantId"        TEXT NOT NULL DEFAULT '';
ALTER TABLE "EmailSetting" ADD COLUMN "entraClientId"        TEXT NOT NULL DEFAULT '';
ALTER TABLE "EmailSetting" ADD COLUMN "entraClientSecretEnc" TEXT NOT NULL DEFAULT '';
