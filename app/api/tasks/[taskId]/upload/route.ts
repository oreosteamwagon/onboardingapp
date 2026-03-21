import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
// canCompleteUploadTask allows any authenticated user; access is governed by
// workflow membership, NOT by canUploadDocuments (which gates general document uploads to HR+).
import { canCompleteUploadTask } from '@/lib/permissions'
import { checkUploadRateLimit } from '@/lib/ratelimit'
import { saveUpload, UploadError } from '@/lib/upload'
import type { Role } from '@prisma/client'
import { notifyApprovalNeeded } from '@/lib/email'

interface RouteContext {
  params: { taskId: string }
}

// POST /api/tasks/[taskId]/upload
// Authenticated user uploads a file to complete an UPLOAD-type onboarding task.
// The task must be of type UPLOAD and assigned to the user's role.
// Completion is atomic: Document creation and UserTask update occur in one transaction.
export async function POST(req: NextRequest, { params }: RouteContext) {
  // 1. Authentication
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Authorization — any authenticated user may complete their own upload tasks
  if (!canCompleteUploadTask(session.user.role as Role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 3. Rate limiting (keyed by userId, not IP, since request is authenticated)
  try {
    await checkUploadRateLimit(session.user.id)
  } catch {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  // 4. Validate taskId path param before any DB or file work
  const { taskId } = params
  if (typeof taskId !== 'string' || taskId.length === 0) {
    return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })
  }

  // 5. Verify task exists and is UPLOAD type
  const task = await prisma.onboardingTask.findUnique({
    where: { id: taskId },
    select: { taskType: true },
  })

  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  if (task.taskType !== 'UPLOAD') {
    return NextResponse.json(
      { error: 'This task does not require a file upload' },
      { status: 409 },
    )
  }

  // 6. Object-level authorization: task must be in a workflow assigned to this user
  const membership = await prisma.workflowTask.findFirst({
    where: {
      taskId,
      workflow: {
        userWorkflows: {
          some: { userId: session.user.id },
        },
      },
    },
  })

  if (!membership) {
    return NextResponse.json({ error: 'Task not assigned to you' }, { status: 403 })
  }

  // 7. Parse and validate the uploaded file (magic-byte validation inside saveUpload)
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const fileEntry = formData.get('file')
  if (!(fileEntry instanceof File)) {
    return NextResponse.json({ error: 'file field is required' }, { status: 400 })
  }

  const buffer = Buffer.from(await fileEntry.arrayBuffer())

  let storagePath: string
  let filename: string
  try {
    const saved = await saveUpload(buffer, fileEntry.name)
    storagePath = saved.storagePath
    filename = saved.filename
  } catch (err) {
    if (err instanceof UploadError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode })
    }
    return NextResponse.json({ error: 'File upload failed' }, { status: 500 })
  }

  // 8. Atomically create the Document record and upsert the UserTask.
  //    If the UserTask already has a documentId (re-upload), the old Document record
  //    is intentionally left as an orphan for audit trail.
  try {
    const result = await prisma.$transaction(async (tx) => {
      const doc = await tx.document.create({
        data: {
          uploadedBy: session.user.id,
          filename,
          storagePath,
          category: 'task-upload',
        },
      })

      const userTask = await tx.userTask.upsert({
        where: { userId_taskId: { userId: session.user.id, taskId } },
        update: {
          completed: true,
          completedAt: new Date(),
          documentId: doc.id,
        },
        create: {
          userId: session.user.id,
          taskId,
          completed: true,
          completedAt: new Date(),
          documentId: doc.id,
        },
      })

      return { userTask, documentId: doc.id, documentFilename: doc.filename }
    })

    void notifyApprovalNeeded(session.user.id, taskId)

    return NextResponse.json(
      {
        id: result.userTask.id,
        completed: result.userTask.completed,
        completedAt: result.userTask.completedAt,
        documentId: result.documentId,
        documentFilename: result.documentFilename,
      },
      { status: 200 },
    )
  } catch {
    return NextResponse.json({ error: 'Failed to record task completion' }, { status: 500 })
  }
}
