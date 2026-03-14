import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canManageAttachments } from '@/lib/permissions'
import { checkAttachmentUploadRateLimit } from '@/lib/ratelimit'
import { validateCuid } from '@/lib/validation'
import { saveUpload, UploadError } from '@/lib/upload'
import type { Role } from '@prisma/client'

interface RouteContext {
  params: { userId: string; taskId: string }
}

// POST /api/users/[userId]/tasks/[taskId]/attachments
// Upload a file attachment to a specific user task assignment.
// Access: HR+ only.
export async function POST(req: NextRequest, { params }: RouteContext) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const role = session.user.role as Role
  if (!canManageAttachments(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    await checkAttachmentUploadRateLimit(session.user.id)
  } catch {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const userIdError = validateCuid(params.userId, 'userId')
  if (userIdError) {
    return NextResponse.json({ error: userIdError }, { status: 400 })
  }

  const taskIdError = validateCuid(params.taskId, 'taskId')
  if (taskIdError) {
    return NextResponse.json({ error: taskIdError }, { status: 400 })
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { id: true, active: true },
  })

  if (!targetUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  if (!targetUser.active) {
    return NextResponse.json({ error: 'User is inactive' }, { status: 409 })
  }

  const userTask = await prisma.userTask.findUnique({
    where: { userId_taskId: { userId: params.userId, taskId: params.taskId } },
    select: { id: true },
  })

  if (!userTask) {
    return NextResponse.json(
      { error: 'Task is not assigned to this user' },
      { status: 404 },
    )
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const fileField = formData.get('file')
  if (!(fileField instanceof File)) {
    return NextResponse.json({ error: 'file field is required' }, { status: 400 })
  }

  let storagePath: string
  let filename: string
  try {
    const buffer = Buffer.from(await fileField.arrayBuffer())
    const result = await saveUpload(buffer, fileField.name)
    storagePath = result.storagePath
    filename = result.filename
  } catch (err) {
    if (err instanceof UploadError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode })
    }
    console.error('Attachment upload error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  try {
    const attachment = await prisma.$transaction(async (tx) => {
      return tx.taskAttachment.create({
        data: {
          userTaskId: userTask.id,
          uploadedById: session.user.id,
          filename,
          storagePath,
        },
        select: { id: true, filename: true, uploadedAt: true },
      })
    })

    return NextResponse.json(
      {
        id: attachment.id,
        filename: attachment.filename,
        uploadedAt: attachment.uploadedAt.toISOString(),
      },
      { status: 201 },
    )
  } catch (err) {
    console.error('Attachment DB create error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
