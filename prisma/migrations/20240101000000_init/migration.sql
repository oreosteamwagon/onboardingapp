-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'PAYROLL', 'HR', 'SUPERVISOR', 'ADMIN');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandingSetting" (
    "id" TEXT NOT NULL,
    "orgName" TEXT NOT NULL DEFAULT 'My Organization',
    "logoPath" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#2563eb',
    "accentColor" TEXT NOT NULL DEFAULT '#7c3aed',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandingSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingTask" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assignedRole" "Role"[],
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "UserTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_username_idx" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "UserTask_userId_taskId_key" ON "UserTask"("userId", "taskId");

-- CreateIndex
CREATE INDEX "UserTask_userId_idx" ON "UserTask"("userId");

-- CreateIndex
CREATE INDEX "UserTask_taskId_idx" ON "UserTask"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "Document_storagePath_key" ON "Document"("storagePath");

-- CreateIndex
CREATE INDEX "Document_uploadedBy_idx" ON "Document"("uploadedBy");

-- AddForeignKey
ALTER TABLE "UserTask" ADD CONSTRAINT "UserTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTask" ADD CONSTRAINT "UserTask_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "OnboardingTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
