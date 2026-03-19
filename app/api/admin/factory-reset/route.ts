import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canManageUsers } from '@/lib/permissions'
import { checkFactoryResetRateLimit } from '@/lib/ratelimit'
import { logError, log } from '@/lib/logger'
import { unlink } from 'fs/promises'
import { join } from 'path'
import type { Role } from '@prisma/client'

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? '/app/uploads'

// The confirmation token the client must send to execute a reset.
// Having a required body token prevents accidental invocation (browser prefetch,
// replayed requests without a body, etc.) while keeping the endpoint simple.
const CONFIRM_TOKEN = 'FACTORY_RESET'

// POST /api/admin/factory-reset
// ADMIN only. Deletes all non-admin users, all tasks, workflows, and documents.
// The caller must send { confirm: "FACTORY_RESET" } in the request body.
// All DB deletions occur in a single transaction; physical files are removed
// after the transaction commits.
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!canManageUsers(session.user.role as Role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    await checkFactoryResetRateLimit(session.user.id)
  } catch {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    (body as Record<string, unknown>).confirm !== CONFIRM_TOKEN
  ) {
    return NextResponse.json(
      { error: 'Missing or invalid confirm token' },
      { status: 400 },
    )
  }

  // Collect storagePaths before deleting so we can clean up disk after commit.
  // This must be outside the transaction to avoid holding it open during I/O.
  const docs = await prisma.document.findMany({
    select: { storagePath: true },
  })
  const storagePaths = docs.map((d) => d.storagePath).filter((p): p is string => p !== null)

  try {
    await prisma.$transaction(async (tx) => {
      // Delete in FK dependency order: dependents first, then parents.
      // 1. TaskAttachment references UserTask and User
      await tx.taskAttachment.deleteMany({})
      // 2. UserTask references User, OnboardingTask, Document
      await tx.userTask.deleteMany({})
      // 3. CourseAttempt references User, Course, OnboardingTask
      await tx.courseAttempt.deleteMany({})
      // 4. UserWorkflow references User, Workflow
      await tx.userWorkflow.deleteMany({})
      // 5. WorkflowTask references Workflow, OnboardingTask
      await tx.workflowTask.deleteMany({})
      // 6. Document references User (UserTask FK already removed above)
      await tx.document.deleteMany({})
      // 7. OnboardingTask (userTasks, workflowTasks, courseAttempts cleared above)
      await tx.onboardingTask.deleteMany({})
      // 8. Course (cascade deletes CourseQuestion and CourseAnswer)
      await tx.course.deleteMany({})
      // 9. Workflow (workflowTasks and userWorkflows cleared above)
      await tx.workflow.deleteMany({})
      // 10. Custom document categories; built-ins are preserved and re-seeded on restart
      await tx.documentCategory.deleteMany({ where: { isBuiltIn: false } })
      // 11. Non-admin users (all referencing records cleared above)
      await tx.user.deleteMany({ where: { role: { not: 'ADMIN' } } })
      // 12. Application logs
      await tx.appLog.deleteMany({})
    })
  } catch (err) {
    logError({ message: 'Factory reset transaction failed', action: 'factory_reset', userId: session.user.id, meta: { error: String(err) } })
    return NextResponse.json({ error: 'Reset failed — no data was changed' }, { status: 500 })
  }

  // Transaction committed. Remove physical files; log failures but do not
  // surface them to the client — the DB is already clean.
  let filesDeleted = 0
  let fileErrors = 0
  for (const storagePath of storagePaths) {
    // Defense-in-depth: skip any path with separators (should never happen)
    if (storagePath.includes('/') || storagePath.includes('\\') || storagePath.includes('..')) {
      logError({ message: 'Skipped suspicious storagePath during factory reset', action: 'factory_reset', userId: session.user.id, meta: { storagePath } })
      fileErrors++
      continue
    }
    try {
      await unlink(join(UPLOAD_DIR, storagePath))
      filesDeleted++
    } catch (err) {
      logError({ message: 'Failed to delete file during factory reset', action: 'factory_reset', userId: session.user.id, meta: { storagePath, error: String(err) } })
      fileErrors++
    }
  }

  log({ message: 'environment reset by admin', action: 'factory_reset', userId: session.user.id, meta: { filesDeleted, fileErrors } })

  return NextResponse.json(
    {
      message: 'Factory reset complete',
      filesDeleted,
      fileErrors,
    },
    { status: 200 },
  )
}
