'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Category {
  id: string
  slug: string
  name: string
  isBuiltIn: boolean
}

interface DocumentCategoryManagerProps {
  categories: Category[]
}

export default function DocumentCategoryManager({
  categories: initial,
}: DocumentCategoryManagerProps) {
  const router = useRouter()
  const [categories, setCategories] = useState(initial)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setCreating(true)

    try {
      const res = await fetch('/api/admin/document-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to create category')
        return
      }

      setCategories((prev) => [...prev, data].sort((a, b) => {
        if (a.isBuiltIn !== b.isBuiltIn) return a.isBuiltIn ? -1 : 1
        return a.name.localeCompare(b.name)
      }))
      setName('')
      setSuccess(`Category "${data.name}" created.`)
      router.refresh()
    } catch {
      setError('Unexpected error creating category.')
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(id: string) {
    setError(null)
    setSuccess(null)
    setDeletingId(id)

    try {
      const res = await fetch(`/api/admin/document-categories/${id}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Failed to delete category')
        return
      }

      setCategories((prev) => prev.filter((c) => c.id !== id))
      router.refresh()
    } catch {
      setError('Unexpected error deleting category.')
    } finally {
      setDeletingId(null)
      setConfirmDeleteId(null)
    }
  }

  return (
    <div>
      {error && (
        <div role="alert" className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div role="status" className="mb-4 rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
          {success}
        </div>
      )}

      <form
        onSubmit={handleCreate}
        className="bg-white rounded-lg shadow px-6 py-5 mb-6 flex flex-wrap items-end gap-4"
      >
        <div className="flex-1 min-w-48">
          <label htmlFor="cat-name" className="block text-sm font-medium text-gray-700 mb-1">
            New category name
          </label>
          <input
            id="cat-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={64}
            required
            placeholder="e.g. IT Onboarding"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <button
          type="submit"
          disabled={creating || !name.trim()}
          className="rounded-md bg-primary text-white px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {creating ? 'Adding...' : 'Add Category'}
        </button>
      </form>

      {categories.length === 0 ? (
        <p className="text-gray-500 text-sm">No categories found.</p>
      ) : (
        <div className="overflow-x-auto bg-white rounded-lg shadow">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Slug</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {categories.map((cat) => (
                <tr key={cat.id}>
                  <td className="px-6 py-4 text-sm text-gray-900">{cat.name}</td>
                  <td className="px-6 py-4 text-sm text-gray-500 font-mono">{cat.slug}</td>
                  <td className="px-6 py-4 text-sm">
                    {cat.isBuiltIn ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        Built-in
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                        Custom
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-right whitespace-nowrap">
                    {!cat.isBuiltIn && (
                      confirmDeleteId === cat.id ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="text-gray-700">Delete permanently?</span>
                          <button
                            onClick={() => handleDelete(cat.id)}
                            disabled={deletingId === cat.id}
                            className="rounded px-2 py-1 text-xs font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                          >
                            {deletingId === cat.id ? 'Deleting...' : 'Yes, delete'}
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            disabled={deletingId === cat.id}
                            className="rounded px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(cat.id)}
                          className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 border border-red-200"
                        >
                          Delete
                        </button>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
