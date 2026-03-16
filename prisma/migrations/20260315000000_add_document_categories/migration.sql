CREATE TABLE "DocumentCategory" (
  "id"        TEXT NOT NULL,
  "slug"      TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DocumentCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DocumentCategory_slug_key"       ON "DocumentCategory"("slug");
CREATE UNIQUE INDEX "DocumentCategory_name_lower_key" ON "DocumentCategory"(lower("name"));
CREATE INDEX "DocumentCategory_slug_idx"              ON "DocumentCategory"("slug");
CREATE INDEX "DocumentCategory_name_idx"              ON "DocumentCategory"("name");

INSERT INTO "DocumentCategory" ("id","slug","name","isBuiltIn","createdAt") VALUES
  ('builtin-general',    'general',    'General',    true, NOW()),
  ('builtin-policy',     'policy',     'Policy',     true, NOW()),
  ('builtin-benefits',   'benefits',   'Benefits',   true, NOW()),
  ('builtin-onboarding', 'onboarding', 'Onboarding', true, NOW())
ON CONFLICT ("slug") DO NOTHING;
