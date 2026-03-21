import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canManageDocumentCategories } from '@/lib/permissions'
import { checkCategoryMgmtRateLimit } from '@/lib/ratelimit'
import { verifyActiveSession } from '@/lib/session'
import type { Role } from '@prisma/client'

const VALID_ID_RE = /^[\w\-]{1,64}$/

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!canManageDocumentCategories(session.user.role as Role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!await verifyActiveSession(session.user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    await checkCategoryMgmtRateLimit(session.user.id)
  } catch {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { id } = params

  if (!id || !VALID_ID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid category id' }, { status: 400 })
  }

  const category = await prisma.documentCategory.findUnique({ where: { id } })
  if (!category) {
    return NextResponse.json({ error: 'Category not found' }, { status: 404 })
  }

  if (category.isBuiltIn) {
    return NextResponse.json(
      { error: 'Built-in categories cannot be deleted' },
      { status: 409 },
    )
  }

  const inUseCount = await prisma.document.count({ where: { category: category.slug } })
  if (inUseCount > 0) {
    return NextResponse.json(
      { error: `Category is in use by ${inUseCount} document(s)` },
      { status: 409 },
    )
  }

  await prisma.documentCategory.delete({ where: { id } })

  return new NextResponse(null, { status: 204 })
}
