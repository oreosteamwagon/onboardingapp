-- Add LEARNING to TaskType enum
ALTER TYPE "TaskType" ADD VALUE 'LEARNING';

-- Course
CREATE TABLE "Course" (
  "id"           TEXT NOT NULL,
  "title"        TEXT NOT NULL,
  "description"  TEXT,
  "contentHtml"  TEXT NOT NULL,
  "passingScore" INTEGER NOT NULL,
  "createdById"  TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Course_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Course_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "Course_createdById_idx" ON "Course"("createdById");

-- CourseQuestion
CREATE TABLE "CourseQuestion" (
  "id"       TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "text"     TEXT NOT NULL,
  "order"    INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "CourseQuestion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CourseQuestion_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CourseQuestion_courseId_idx" ON "CourseQuestion"("courseId");

-- CourseAnswer
CREATE TABLE "CourseAnswer" (
  "id"         TEXT NOT NULL,
  "questionId" TEXT NOT NULL,
  "text"       TEXT NOT NULL,
  "isCorrect"  BOOLEAN NOT NULL DEFAULT FALSE,
  "order"      INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "CourseAnswer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CourseAnswer_questionId_fkey"
    FOREIGN KEY ("questionId") REFERENCES "CourseQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CourseAnswer_questionId_idx" ON "CourseAnswer"("questionId");

-- CourseAttempt
CREATE TABLE "CourseAttempt" (
  "id"            TEXT NOT NULL,
  "userId"        TEXT NOT NULL,
  "courseId"      TEXT NOT NULL,
  "taskId"        TEXT NOT NULL,
  "score"         INTEGER NOT NULL,
  "passed"        BOOLEAN NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "completedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CourseAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CourseAttempt_userId_fkey"
    FOREIGN KEY ("userId")   REFERENCES "User"("id")           ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CourseAttempt_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "Course"("id")         ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CourseAttempt_taskId_fkey"
    FOREIGN KEY ("taskId")   REFERENCES "OnboardingTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "CourseAttempt_userId_idx"         ON "CourseAttempt"("userId");
CREATE INDEX "CourseAttempt_courseId_idx"        ON "CourseAttempt"("courseId");
CREATE INDEX "CourseAttempt_taskId_idx"          ON "CourseAttempt"("taskId");
CREATE INDEX "CourseAttempt_userId_courseId_idx" ON "CourseAttempt"("userId", "courseId");

-- OnboardingTask -- add courseId
ALTER TABLE "OnboardingTask"
  ADD COLUMN "courseId" TEXT,
  ADD CONSTRAINT "OnboardingTask_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "OnboardingTask_courseId_idx" ON "OnboardingTask"("courseId");
