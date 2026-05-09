CREATE TABLE "AppSetting" (
  "id" TEXT NOT NULL,
  "autoOffboardEnabled" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("id")
);
