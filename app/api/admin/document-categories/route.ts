import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canManageDocumentCategories } from '@/lib/permissions'
import { checkCategoryMgmtRateLimit } from '@/lib/ratelimit'
import { logError, log } from '@/lib/logger'
import { validateCategoryName, categoryNameToSlug } from '@/lib/validation'
import type { Role } from '@prisma/client'
import { Prisma } from '@prisma/client'

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!canManageDocumentCategories(session.user.role as Role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const categories = await prisma.documentCategory.findMany({
    orderBy: [{ isBuiltIn: 'desc' }, { name: 'asc' }],
    select: { id: true, slug: true, name: true, isBuiltIn: true },
  })

  return NextResponse.json(categories)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!canManageDocumentCategories(session.user.role as Role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    await checkCategoryMgmtRateLimit(session.user.id)
  } catch {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { name } = body as Record<string, unknown>

  const nameError = validateCategoryName(name)
  if (nameError) {
    return NextResponse.json({ error: nameError }, { status: 400 })
  }

  const slug = categoryNameToSlug(name as string)

  try {
    const category = await prisma.documentCategory.create({
      data: { slug, name: (name as string).trim(), isBuiltIn: false },
      select: { id: true, slug: true, name: true, isBuiltIn: true },
    })
    log({ message: 'document category created', action: 'category_create', userId: session.user.id, statusCode: 201, meta: { categoryId: category.id, slug: category.slug } })
    return NextResponse.json(category, { status: 201 })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'A category with that name already exists' }, { status: 409 })
    }
    logError({ message: 'Failed to create document category', action: 'category_create', userId: session.user.id, meta: { error: String(err) } })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
