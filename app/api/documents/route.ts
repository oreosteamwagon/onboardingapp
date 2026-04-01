import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canUploadDocuments, canViewAllDocuments } from '@/lib/permissions'
import { saveUpload, UploadError } from '@/lib/upload'
import { checkUploadRateLimit } from '@/lib/ratelimit'
import { verifyActiveSession } from '@/lib/session'
import { logError, log } from '@/lib/logger'
import { validateTitle, validateWebLinkUrl } from '@/lib/validation'
import type { Role } from '@prisma/client'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!await verifyActiveSession(session.user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const type = new URL(req.url).searchParams.get('type')
  const role = session.user.role as Role

  let whereClause: Record<string, unknown>
  if (type === 'resource') {
    // Any authenticated user may list resource documents
    whereClause = { isResource: true }
  } else {
    whereClause = canViewAllDocuments(role)
      ? {}
      : { uploadedBy: session.user.id }
  }

  const documents = await prisma.document.findMany({
    where: whereClause,
    orderBy: { uploadedAt: 'desc' },
    include: {
      uploader: { select: { username: true } },
    },
  })

  return NextResponse.json(
    documents.map((d) => ({
      id: d.id,
      filename: d.filename,
      url: d.url ?? null,
      category: d.category,
      uploadedAt: d.uploadedAt.toISOString(),
      uploaderName: d.uploader.username,
      isResource: d.isResource,
    })),
  )
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!canUploadDocuments(session.user.role as Role)) {
    return NextResponse.json(
      { error: 'Forbidden: PAYROLL role or above required to upload documents' },
      { status: 403 },
    )
  }

  if (!await verifyActiveSession(session.user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    await checkUploadRateLimit(session.user.id)
  } catch {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } })
  }

  const contentType = req.headers.get('content-type') ?? ''

  // Web link branch
  if (contentType.includes('application/json')) {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const { title, url, category } = body as Record<string, unknown>

    const titleError = validateTitle(title)
    if (titleError) return NextResponse.json({ error: titleError }, { status: 400 })

    const urlError = validateWebLinkUrl(url)
    if (urlError) return NextResponse.json({ error: urlError }, { status: 400 })

    const categoryStr = typeof category === 'string' ? category.trim() : ''
    if (!categoryStr) return NextResponse.json({ error: 'category is required' }, { status: 400 })
    const categoryRecord = await prisma.documentCategory.findUnique({
      where: { slug: categoryStr },
      select: { id: true },
    })
    if (!categoryRecord) return NextResponse.json({ error: 'Invalid category' }, { status: 400 })

    const doc = await prisma.document.create({
      data: {
        uploadedBy: session.user.id,
        filename: (title as string).trim(),
        url: (url as string).trim(),
        storagePath: null,
        category: categoryStr,
        isResource: true,
      },
      include: {
        uploader: { select: { username: true } },
      },
    })

    log({ message: 'web link created', action: 'document_create', userId: session.user.id, statusCode: 201, meta: { documentId: doc.id, category: doc.category } })
    return NextResponse.json(
      {
        id: doc.id,
        filename: doc.filename,
        url: doc.url,
        category: doc.category,
        uploadedAt: doc.uploadedAt.toISOString(),
        uploaderName: doc.uploader.username,
        isResource: doc.isResource,
      },
      { status: 201 },
    )
  }

  // File upload branch
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file')
  const category = formData.get('category')

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  const categoryStr = typeof category === 'string' ? category.trim() : ''
  if (!categoryStr) return NextResponse.json({ error: 'category is required' }, { status: 400 })
  const categoryRecord = await prisma.documentCategory.findUnique({
    where: { slug: categoryStr },
    select: { id: true },
  })
  if (!categoryRecord) return NextResponse.json({ error: 'Invalid category' }, { status: 400 })

  const buffer = Buffer.from(await file.arrayBuffer())

  let storagePath: string
  let filename: string

  try {
    const result = await saveUpload(buffer, file.name)
    storagePath = result.storagePath
    filename = result.filename
  } catch (err) {
    if (err instanceof UploadError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode })
    }
    logError({ message: 'Document upload error', action: 'document_upload', userId: session.user.id, meta: { error: String(err) } })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  const doc = await prisma.document.create({
    data: {
      uploadedBy: session.user.id,
      filename,
      storagePath,
      category: categoryStr,
      isResource: true,
    },
    include: {
      uploader: { select: { username: true } },
    },
  })

  log({ message: 'document uploaded', action: 'document_create', userId: session.user.id, statusCode: 201, meta: { documentId: doc.id, category: doc.category } })
  return NextResponse.json(
    {
      id: doc.id,
      filename: doc.filename,
      url: null,
      category: doc.category,
      uploadedAt: doc.uploadedAt.toISOString(),
      uploaderName: doc.uploader.username,
      isResource: doc.isResource,
    },
    { status: 201 },
  )
}
