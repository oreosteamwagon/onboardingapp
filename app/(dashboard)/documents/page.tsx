import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { redirect } from 'next/navigation'
import { canUploadDocuments } from '@/lib/permissions'
import type { Role } from '@prisma/client'
import DocumentsView from './DocumentsView'

export default async function DocumentsPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const canUpload = canUploadDocuments(session.user.role as Role)

  const documents = await prisma.document.findMany({
    orderBy: { uploadedAt: 'desc' },
    include: {
      uploader: { select: { username: true } },
    },
  })

  const docList = documents.map((d) => ({
    id: d.id,
    filename: d.filename,
    category: d.category,
    uploadedAt: d.uploadedAt.toISOString(),
    uploaderName: d.uploader.username,
  }))

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Documents</h1>
      <DocumentsView documents={docList} canUpload={canUpload} />
    </div>
  )
}
