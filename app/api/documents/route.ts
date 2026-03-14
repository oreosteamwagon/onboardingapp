import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canUploadDocuments, canViewAllDocuments } from '@/lib/permissions'
import { saveUpload, UploadError } from '@/lib/upload'
import type { Role } from '@prisma/client'

const VALID_CATEGORIES = ['general', 'policy', 'benefits', 'onboarding']

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

  const categoryStr = typeof category === 'string' ? category : 'general'
  if (!VALID_CATEGORIES.includes(categoryStr)) {
    return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
  }

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
    console.error('Upload error:', err)
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

  return NextResponse.json(
    {
      id: doc.id,
      filename: doc.filename,
      category: doc.category,
      uploadedAt: doc.uploadedAt.toISOString(),
      uploaderName: doc.uploader.username,
      isResource: doc.isResource,
    },
    { status: 201 },
  )
}
