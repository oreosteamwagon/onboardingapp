import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { redirect } from 'next/navigation'
import { canManageDocumentCategories } from '@/lib/permissions'
import type { Role } from '@prisma/client'
import DocumentCategoryManager from './DocumentCategoryManager'

export default async function DocumentCategoriesPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  if (!canManageDocumentCategories(session.user.role as Role)) {
    return (
      <div className="text-red-600 font-medium">
        Access denied. Admin role required.
      </div>
    )
  }

  const categories = await prisma.documentCategory.findMany({
    orderBy: [{ isBuiltIn: 'desc' }, { name: 'asc' }],
    select: { id: true, slug: true, name: true, isBuiltIn: true },
  })

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">
        Document Categories
      </h1>
      <DocumentCategoryManager categories={categories} />
    </div>
  )
}
