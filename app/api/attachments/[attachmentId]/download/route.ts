import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canDownloadAttachment } from '@/lib/permissions'
import { checkAttachmentDownloadRateLimit } from '@/lib/ratelimit'
import { logError } from '@/lib/logger'
import { validateCuid } from '@/lib/validation'
import { verifyActiveSession } from '@/lib/session'
import { readFile } from 'fs/promises'
import { join, extname } from 'path'
import type { Role } from '@prisma/client'

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? '/app/uploads'

const EXT_TO_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
}

interface RouteContext {
  params: { attachmentId: string }
}

// GET /api/attachments/[attachmentId]/download
// Download a task attachment.
// Access: the assigned user (any role), or SUPERVISOR+ for approval review.
export async function GET(_req: NextRequest, { params }: RouteContext) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!await verifyActiveSession(session.user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const idError = validateCuid(params.attachmentId, 'attachmentId')
  if (idError) {
    return NextResponse.json({ error: idError }, { status: 400 })
  }

  try {
    await checkAttachmentDownloadRateLimit(session.user.id)
  } catch {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const attachment = await prisma.taskAttachment.findUnique({
    where: { id: params.attachmentId },
    select: {
      filename: true,
      storagePath: true,
      userTask: { select: { userId: true } },
    },
  })

  if (!attachment) {
    return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
  }

  const role = session.user.role as Role
  const isAssignedUser = session.user.id === attachment.userTask.userId

  if (!isAssignedUser && !canDownloadAttachment(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Path traversal guard — storagePath must be a bare filename with no directory components
  if (
    attachment.storagePath.includes('/') ||
    attachment.storagePath.includes('\\') ||
    attachment.storagePath.includes('..')
  ) {
    logError({ message: 'Suspicious storagePath on attachment', action: 'attachment_download', userId: session.user.id, meta: { attachmentId: params.attachmentId } })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  const filePath = join(UPLOAD_DIR, attachment.storagePath)
  let buffer: Buffer
  try {
    buffer = await readFile(filePath)
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }
    logError({ message: 'Attachment file read error', action: 'attachment_download', userId: session.user.id, meta: { attachmentId: params.attachmentId, error: String(err) } })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  const ext = extname(attachment.storagePath).toLowerCase()
  const contentType = EXT_TO_MIME[ext] ?? 'application/octet-stream'
  const encodedFilename = encodeURIComponent(attachment.filename)

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodedFilename}`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
