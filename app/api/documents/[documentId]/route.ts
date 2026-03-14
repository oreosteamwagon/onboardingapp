import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canDeleteDocument } from '@/lib/permissions'
import { checkDocumentDeleteRateLimit } from '@/lib/ratelimit'
import { validateCuid } from '@/lib/validation'
import { unlink } from 'fs/promises'
import { join } from 'path'
import type { Role } from '@prisma/client'

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? '/app/uploads'

interface RouteContext {
  params: { documentId: string }
}

// DELETE /api/documents/[documentId]
// Permanently removes the document record and its stored file.
// Access: ADMIN only.
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!canDeleteDocument(session.user.role as Role)) {
    return NextResponse.json({ error: 'Forbidden: admin role required' }, { status: 403 })
  }

  try {
    await checkDocumentDeleteRateLimit(session.user.id)
  } catch {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const idError = validateCuid(params.documentId, 'documentId')
  if (idError) {
    return NextResponse.json({ error: idError }, { status: 400 })
  }

  const document = await prisma.document.findUnique({
    where: { id: params.documentId },
    select: { id: true, storagePath: true, filename: true },
  })

  if (!document) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  // Defense-in-depth: storagePath must be a bare filename with no directory components.
  // Our upload code writes UUID-based names, so separators or dots-only sequences
  // should never appear. Reject anything suspicious to prevent path traversal via
  // a tampered DB record.
  if (
    document.storagePath.includes('/') ||
    document.storagePath.includes('\\') ||
    document.storagePath.includes('..')
  ) {
    console.error('Suspicious storagePath blocked during delete, documentId:', document.id)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  // Delete the file from disk first. If it is already gone (ENOENT), log and
  // continue — the DB record should still be cleaned up. Any other filesystem
  // error is unexpected; abort to avoid leaving an orphaned DB record.
  const filePath = join(UPLOAD_DIR, document.storagePath)
  try {
    await unlink(filePath)
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code !== 'ENOENT') {
      console.error('Failed to delete document file, documentId:', document.id, err)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
    console.warn('Document file already missing on disk, proceeding with DB delete, documentId:', document.id)
  }

  await prisma.document.delete({ where: { id: document.id } })

  console.info('Document deleted by admin, documentId:', document.id, 'filename:', document.filename, 'adminId:', session.user.id)

  return new NextResponse(null, { status: 204 })
}
