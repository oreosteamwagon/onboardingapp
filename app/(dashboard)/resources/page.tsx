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
  const canViewTaskUploads = canViewAllDocuments(role)

  const visibilityFilter = canViewAllDocuments(role)
    ? {}
    : { uploadedBy: session.user.id }

  const [documents, categories, taskUploadDocs] = await Promise.all([
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
    canViewTaskUploads
      ? prisma.document.findMany({
          where: { encrypted: true },
          orderBy: { uploadedAt: 'desc' },
          include: {
            uploader: {
              select: { username: true, firstName: true, lastName: true },
            },
          },
        })
      : Promise.resolve([]),
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

  // Group task uploads by uploader for the privileged section
  const groupMap = new Map<string, { uploaderName: string; files: Array<{ id: string; filename: string; uploadedAt: string }> }>()
  for (const doc of taskUploadDocs) {
    const displayName =
      doc.uploader.firstName && doc.uploader.lastName
        ? `${doc.uploader.firstName} ${doc.uploader.lastName} (${doc.uploader.username})`
        : doc.uploader.username
    if (!groupMap.has(doc.uploadedBy)) {
      groupMap.set(doc.uploadedBy, { uploaderName: displayName, files: [] })
    }
    groupMap.get(doc.uploadedBy)!.files.push({
      id: doc.id,
      filename: doc.filename,
      uploadedAt: doc.uploadedAt.toISOString(),
    })
  }
  const taskUploadGroups = Array.from(groupMap.values())

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Resources</h1>
      <ResourcesView
        resources={resourceList}
        canUpload={canUpload}
        canDelete={canDelete}
        categories={categories}
        taskUploadGroups={taskUploadGroups}
        canViewTaskUploads={canViewTaskUploads}
      />
    </div>
  )
}
