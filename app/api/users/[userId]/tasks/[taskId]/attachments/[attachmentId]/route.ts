import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canManageAttachments } from '@/lib/permissions'
import { checkTaskMgmtRateLimit } from '@/lib/ratelimit'
import { logError } from '@/lib/logger'
import { validateCuid } from '@/lib/validation'
import { unlink } from 'fs/promises'
import { join } from 'path'
import type { Role } from '@prisma/client'

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? '/app/uploads'

interface RouteContext {
  params: { userId: string; taskId: string; attachmentId: string }
}

// DELETE /api/users/[userId]/tasks/[taskId]/attachments/[attachmentId]
// Remove an attachment from a user task assignment.
// Access: HR+ only.
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const role = session.user.role as Role
  if (!canManageAttachments(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    await checkTaskMgmtRateLimit(session.user.id)
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

  const attachmentIdError = validateCuid(params.attachmentId, 'attachmentId')
  if (attachmentIdError) {
    return NextResponse.json({ error: attachmentIdError }, { status: 400 })
  }

  const attachment = await prisma.taskAttachment.findUnique({
    where: { id: params.attachmentId },
    select: {
      id: true,
      storagePath: true,
      userTask: { select: { userId: true, taskId: true } },
    },
  })

  if (!attachment) {
    return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
  }

  // IDOR prevention: verify the attachment belongs to the user/task in the URL
  if (
    attachment.userTask.userId !== params.userId ||
    attachment.userTask.taskId !== params.taskId
  ) {
    return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
  }

  // Path traversal guard — storagePath must be a bare filename with no directory components
  if (
    attachment.storagePath.includes('/') ||
    attachment.storagePath.includes('\\') ||
    attachment.storagePath.includes('..')
  ) {
    logError({ message: 'Suspicious storagePath on attachment', action: 'attachment_delete', userId: session.user.id, meta: { attachmentId: attachment.id } })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  try {
    await prisma.taskAttachment.delete({ where: { id: params.attachmentId } })
  } catch (err: unknown) {
    const code = (err as { code?: string }).code
    if (code === 'P2025') {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
    }
    logError({ message: 'Attachment delete DB error', action: 'attachment_delete', userId: session.user.id, meta: { error: String(err) } })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  try {
    await unlink(join(UPLOAD_DIR, attachment.storagePath))
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      logError({ message: 'Attachment file unlink error', action: 'attachment_delete', userId: session.user.id, meta: { error: String(err) } })
    }
    // ENOENT is tolerated — DB row is authoritative
  }

  return new NextResponse(null, { status: 204 })
}
