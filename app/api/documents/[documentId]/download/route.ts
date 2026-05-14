import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canDownloadDocument, canDownloadTaskUpload, canUploadDocuments } from '@/lib/permissions'
import { checkDocumentDownloadRateLimit } from '@/lib/ratelimit'
import { logError } from '@/lib/logger'
import { validateCuid } from '@/lib/validation'
import { verifyActiveSession } from '@/lib/session'
import { createReadStream } from 'fs'
import { stat, readFile } from 'fs/promises'
import { createDecipheriv } from 'crypto'
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
  params: Promise<{ documentId: string }>
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

  const { documentId } = await params

  const idError = validateCuid(documentId, 'documentId')
  if (idError) {
    return NextResponse.json({ error: idError }, { status: 400 })
  }

  try {
    await checkDocumentDownloadRateLimit(session.user.id)
  } catch {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } })
  }

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { id: true, uploadedBy: true, filename: true, storagePath: true, url: true, isResource: true, encrypted: true, sharedWithAll: true },
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

  // Access rules (evaluated in order, first match wins):
  //   uploader          → always allowed
  //   sharedWithAll     → any authenticated user
  //   non-shared resource → PAYROLL+ only
  //   encrypted task upload → HR+ only
  //   other non-resource → SUPERVISOR+
  if (!isUploader) {
    if (document.sharedWithAll) {
      // shared with everyone — no further check needed
    } else if (document.isResource) {
      if (!canUploadDocuments(role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    } else {
      const allowed = document.encrypted
        ? canDownloadTaskUpload(role)
        : canDownloadDocument(role)
      if (!allowed) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }
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

  const ext = extname(document.storagePath as string).toLowerCase()
  const contentType = EXT_TO_MIME[ext] ?? 'application/octet-stream'
  const encodedFilename = encodeURIComponent(document.filename)

  const sharedHeaders = {
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename*=UTF-8''${encodedFilename}`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  }

  if (document.encrypted) {
    // GCM auth tag verification requires the full ciphertext — can't stream.
    // On-disk format: [12B IV][16B auth tag][ciphertext]
    let encryptedBuffer: Buffer
    try {
      encryptedBuffer = await readFile(filePath)
    } catch {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    const hexKey = process.env.FILE_ENCRYPTION_KEY
    if (!hexKey || hexKey.length !== 64) {
      logError({ message: 'FILE_ENCRYPTION_KEY missing or invalid', action: 'document_download', userId: session.user.id, meta: { documentId: document.id } })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
    const key = Buffer.from(hexKey, 'hex')
    const iv = encryptedBuffer.subarray(0, 12)
    const tag = encryptedBuffer.subarray(12, 28)
    const ciphertext = encryptedBuffer.subarray(28)

    let decrypted: Buffer
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(tag)
      decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    } catch {
      logError({ message: 'Decryption failed for document', action: 'document_download', userId: session.user.id, meta: { documentId: document.id } })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }

    return new NextResponse(new Uint8Array(decrypted), {
      status: 200,
      headers: { ...sharedHeaders, 'Content-Length': String(decrypted.length) },
    })
  }

  let fileSize: number
  try {
    const stats = await stat(filePath)
    fileSize = stats.size
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  const webStream = Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>

  return new NextResponse(webStream, {
    status: 200,
    headers: { ...sharedHeaders, 'Content-Length': String(fileSize) },
  })
}
