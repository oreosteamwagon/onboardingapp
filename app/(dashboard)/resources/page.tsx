import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { redirect } from 'next/navigation'
import { canUploadDocuments, canViewAllDocuments, canDeleteDocument } from '@/lib/permissions'
import type { Role } from '@prisma/client'
import ResourcesView from './ResourcesView'

export default async function ResourcesPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const role = session.user.role as Role
  const canUpload = canUploadDocuments(role)
  const canDelete = canDeleteDocument(role)

  const visibilityFilter = canViewAllDocuments(role)
    ? {}
    : { uploadedBy: session.user.id }

  const [documents, categories] = await Promise.all([
    prisma.document.findMany({
      where: visibilityFilter,
      orderBy: { uploadedAt: 'desc' },
      include: {
        uploader: { select: { username: true } },
      },
    }),
    prisma.documentCategory.findMany({
      orderBy: [{ isBuiltIn: 'desc' }, { name: 'asc' }],
      select: { id: true, slug: true, name: true },
    }),
  ])

  const resourceList = documents.map((d) => ({
    id: d.id,
    filename: d.filename,
    url: d.url ?? null,
    category: d.category,
    uploadedAt: d.uploadedAt.toISOString(),
    uploaderName: d.uploader.username,
    isResource: d.isResource,
  }))

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Resources</h1>
      <ResourcesView resources={resourceList} canUpload={canUpload} canDelete={canDelete} categories={categories} />
    </div>
  )
}
