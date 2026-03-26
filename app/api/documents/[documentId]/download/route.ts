import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canDownloadDocument } from '@/lib/permissions'
import { checkDocumentDownloadRateLimit } from '@/lib/ratelimit'
import { logError } from '@/lib/logger'
import { validateCuid } from '@/lib/validation'
import { verifyActiveSession } from '@/lib/session'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { Readable } from 'stream'
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
  params: { documentId: string }
}

// GET /api/documents/[documentId]/download
// Streams the stored file to the authenticated requester.
// Access: the uploader (any role), or SUPERVISOR+ (approvers).
export async function GET(_req: NextRequest, { params }: RouteContext) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!await verifyActiveSession(session.user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const idError = validateCuid(params.documentId, 'documentId')
  if (idError) {
    return NextResponse.json({ error: idError }, { status: 400 })
  }

  try {
    await checkDocumentDownloadRateLimit(session.user.id)
  } catch {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const document = await prisma.document.findUnique({
    where: { id: params.documentId },
    select: { id: true, uploadedBy: true, filename: true, storagePath: true, url: true, isResource: true },
  })

  if (!document) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  // Web links are not downloadable files — redirect to the URL directly.
  // Validate the scheme first: only https: is permitted to prevent javascript:
  // or data: URLs stored in the database from being followed by authenticated users.
  if (document.url) {
    let parsed: URL
    try {
      parsed = new URL(document.url)
    } catch {
      return NextResponse.json({ error: 'Invalid document URL' }, { status: 400 })
    }
    if (parsed.protocol !== 'https:') {
      return NextResponse.json({ error: 'Invalid document URL' }, { status: 400 })
    }
    return NextResponse.redirect(document.url, { status: 302 })
  }

  const isUploader = session.user.id === document.uploadedBy
  const role = session.user.role as Role

  // Resources are downloadable by any authenticated user
  if (!document.isResource && !isUploader && !canDownloadDocument(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // storagePath is a UUID+ext written by our own code. Validate it contains no
  // path separators as a defense-in-depth measure against DB tampering.
  if (
    !document.storagePath ||
    document.storagePath.includes('/') ||
    document.storagePath.includes('\\') ||
    document.storagePath.includes('..')
  ) {
    logError({ message: 'Suspicious storagePath in document', action: 'document_download', userId: session.user.id, meta: { documentId: document.id } })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  const filePath = join(UPLOAD_DIR, document.storagePath as string)

  let fileSize: number
  try {
    const stats = await stat(filePath)
    fileSize = stats.size
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  const ext = extname(document.storagePath as string).toLowerCase()
  const contentType = EXT_TO_MIME[ext] ?? 'application/octet-stream'

  // RFC 5987 encoded filename for Content-Disposition
  const encodedFilename = encodeURIComponent(document.filename)

  const webStream = Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodedFilename}`,
      'Content-Length': String(fileSize),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
