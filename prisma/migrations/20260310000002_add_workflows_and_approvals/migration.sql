-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable OnboardingTask: remove role-based assignment (replaced by workflows)
ALTER TABLE "OnboardingTask" DROP COLUMN "assignedRole";

-- AlterTable UserTask: add approval tracking
ALTER TABLE "UserTask"
    ADD COLUMN "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    ADD COLUMN "approvedAt"     TIMESTAMP(3),
    ADD COLUMN "approvedById"   TEXT;

CREATE INDEX "UserTask_approvedById_idx" ON "UserTask"("approvedById");

ALTER TABLE "UserTask"
    ADD CONSTRAINT "UserTask_approvedById_fkey"
    FOREIGN KEY ("approvedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable Workflow
CREATE TABLE "Workflow" (
    "id"          TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "description" TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Workflow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Workflow_name_key" ON "Workflow"("name");

-- CreateTable WorkflowTask
CREATE TABLE "WorkflowTask" (
    "id"         TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "taskId"     TEXT NOT NULL,
    "order"      INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WorkflowTask_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkflowTask_workflowId_taskId_key" ON "WorkflowTask"("workflowId", "taskId");
CREATE INDEX "WorkflowTask_workflowId_idx" ON "WorkflowTask"("workflowId");
CREATE INDEX "WorkflowTask_taskId_idx" ON "WorkflowTask"("taskId");

ALTER TABLE "WorkflowTask"
    ADD CONSTRAINT "WorkflowTask_workflowId_fkey"
    FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkflowTask"
    ADD CONSTRAINT "WorkflowTask_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "OnboardingTask"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable UserWorkflow
CREATE TABLE "UserWorkflow" (
    "id"           TEXT NOT NULL,
    "userId"       TEXT NOT NULL,
    "workflowId"   TEXT NOT NULL,
    "supervisorId" TEXT,
    "assignedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedById" TEXT NOT NULL,

    CONSTRAINT "UserWorkflow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserWorkflow_userId_workflowId_key" ON "UserWorkflow"("userId", "workflowId");
CREATE INDEX "UserWorkflow_userId_idx" ON "UserWorkflow"("userId");
CREATE INDEX "UserWorkflow_workflowId_idx" ON "UserWorkflow"("workflowId");
CREATE INDEX "UserWorkflow_supervisorId_idx" ON "UserWorkflow"("supervisorId");

ALTER TABLE "UserWorkflow"
    ADD CONSTRAINT "UserWorkflow_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "UserWorkflow"
    ADD CONSTRAINT "UserWorkflow_workflowId_fkey"
    FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "UserWorkflow"
    ADD CONSTRAINT "UserWorkflow_supervisorId_fkey"
    FOREIGN KEY ("supervisorId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "UserWorkflow"
    ADD CONSTRAINT "UserWorkflow_assignedById_fkey"
    FOREIGN KEY ("assignedById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
