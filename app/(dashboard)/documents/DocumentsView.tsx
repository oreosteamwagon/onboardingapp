'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Doc {
  id: string
  filename: string
  category: string
  uploadedAt: string
  uploaderName: string
  isResource: boolean
}

interface DocumentsViewProps {
  documents: Doc[]
  canUpload: boolean
  canDelete: boolean
}

export default function DocumentsView({
  documents: initial,
  canUpload,
  canDelete,
}: DocumentsViewProps) {
  const router = useRouter()
  const [documents, setDocuments] = useState(initial)
  const [file, setFile] = useState<File | null>(null)
  const [category, setCategory] = useState('general')
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  // documentId currently showing inline delete confirmation
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault()
    if (!file) return
    setError(null)
    setUploading(true)

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('category', category)

      const res = await fetch('/api/documents', {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Upload failed')
        return
      }

      setDocuments((prev) => [data, ...prev])
      setFile(null)
      router.refresh()
    } catch {
      setError('Unexpected error during upload.')
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(documentId: string) {
    setError(null)
    setDeleting(true)

    try {
      const res = await fetch(`/api/documents/${documentId}`, { method: 'DELETE' })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Delete failed')
        return
      }

      setDocuments((prev) => prev.filter((d) => d.id !== documentId))
    } catch {
      setError('Unexpected error during delete.')
    } finally {
      setDeleting(false)
      setConfirmDeleteId(null)
    }
  }

  const tableHeaders = canDelete
    ? ['Filename', 'Category', 'Uploaded By', 'Date', '']
    : ['Filename', 'Category', 'Uploaded By', 'Date']

  return (
    <div>
      {error && (
        <div role="alert" className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {canUpload && (
        <form
          onSubmit={handleUpload}
          className="bg-white rounded-lg shadow px-6 py-5 mb-6 flex flex-wrap items-end gap-4"
        >
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              File (PDF, DOCX, PNG, JPG — max 25 MB)
            </label>
            <input
              type="file"
              accept=".pdf,.docx,.png,.jpg,.jpeg"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
              className="block text-sm text-gray-600 file:mr-3 file:rounded file:border-0 file:bg-gray-100 file:px-3 file:py-1 file:text-sm file:font-medium hover:file:bg-gray-200"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="general">General</option>
              <option value="policy">Policy</option>
              <option value="benefits">Benefits</option>
              <option value="onboarding">Onboarding</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={uploading || !file}
            className="rounded-md bg-primary text-white px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </form>
      )}

      {documents.length === 0 ? (
        <p className="text-gray-500 text-sm">No documents uploaded yet.</p>
      ) : (
        <div className="overflow-x-auto bg-white rounded-lg shadow">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {tableHeaders.map((h) => (
                  <th
                    key={h}
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {documents.map((d) => (
                <tr key={d.id}>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    <span>{d.filename}</span>
                    {d.isResource && (
                      <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        Resource
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600 capitalize">
                    {d.category}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">{d.uploaderName}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {new Date(d.uploadedAt).toLocaleDateString()}
                  </td>
                  {canDelete && (
                    <td className="px-6 py-4 text-sm text-right whitespace-nowrap">
                      {confirmDeleteId === d.id ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="text-gray-700">Delete permanently?</span>
                          <button
                            onClick={() => handleDelete(d.id)}
                            disabled={deleting}
                            className="rounded px-2 py-1 text-xs font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                          >
                            {deleting ? 'Deleting...' : 'Yes, delete'}
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            disabled={deleting}
                            className="rounded px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(d.id)}
                          className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 border border-red-200"
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
