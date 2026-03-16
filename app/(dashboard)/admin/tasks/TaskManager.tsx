'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { TaskType } from '@prisma/client'

const TASK_TYPES: { value: TaskType; label: string; hint: string }[] = [
  { value: 'STANDARD', label: 'Standard', hint: 'User confirms with a checkbox' },
  { value: 'UPLOAD', label: 'File Upload', hint: 'User must upload a document' },
]

interface ResourceDoc {
  id: string
  filename: string
  url: string | null
}

interface Task {
  id: string
  title: string
  description: string | null
  taskType: TaskType
  order: number
  resourceDocumentId: string | null
  resourceDocument: ResourceDoc | null  // ResourceDoc already includes url
}

interface TaskManagerProps {
  tasks: Task[]
  viewerIsAdmin: boolean
  resources: ResourceDoc[]
}

const emptyForm = {
  title: '',
  description: '',
  taskType: 'STANDARD' as TaskType,
  order: 0,
  resourceDocumentId: null as string | null,
}

export default function TaskManager({ tasks: initial, viewerIsAdmin, resources }: TaskManagerProps) {
  const router = useRouter()
  const [tasks, setTasks] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [editForm, setEditForm] = useState<typeof emptyForm & { id: string } | null>(null)
  const [loading, setLoading] = useState(false)

  function clearMessages() {
    setError(null)
    setSuccess(null)
  }

  function openCreate() {
    clearMessages()
    setEditingId(null)
    setEditForm(null)
    setForm(emptyForm)
    setShowCreate(true)
  }

  function openEdit(task: Task) {
    clearMessages()
    setShowCreate(false)
    setEditingId(task.id)
    setEditForm({
      id: task.id,
      title: task.title,
      description: task.description ?? '',
      taskType: task.taskType,
      order: task.order,
      resourceDocumentId: task.resourceDocumentId,
    })
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    clearMessages()
    setLoading(true)
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title,
          description: form.description || null,
          taskType: form.taskType,
          order: form.order,
          resourceDocumentId: form.resourceDocumentId || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to create task')
        return
      }
      setTasks((prev) => [...prev, data].sort((a, b) => a.order - b.order))
      setForm(emptyForm)
      setShowCreate(false)
      setSuccess('Task created.')
      router.refresh()
    } catch {
      setError('Unexpected error creating task.')
    } finally {
      setLoading(false)
    }
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editForm) return
    clearMessages()
    setLoading(true)
    try {
      const res = await fetch(`/api/tasks/${editForm.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editForm.title,
          description: editForm.description || null,
          taskType: editForm.taskType,
          order: editForm.order,
          resourceDocumentId: editForm.resourceDocumentId || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to update task')
        return
      }
      setTasks((prev) =>
        prev
          .map((t) => (t.id === editForm.id ? data : t))
          .sort((a, b) => a.order - b.order),
      )
      setEditingId(null)
      setEditForm(null)
      setSuccess('Task updated.')
      router.refresh()
    } catch {
      setError('Unexpected error updating task.')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(taskId: string, title: string) {
    if (!viewerIsAdmin) return
    if (!window.confirm(`Delete task "${title}"? This cannot be undone.`)) return
    clearMessages()
    setLoading(true)
    try {
      const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to delete task')
        return
      }
      setTasks((prev) => prev.filter((t) => t.id !== taskId))
      setSuccess('Task deleted.')
    } catch {
      setError('Unexpected error deleting task.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      {error && (
        <div
          role="alert"
          className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}
      {success && (
        <div
          role="status"
          className="mb-4 rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800"
        >
          {success}
        </div>
      )}

      <div className="mb-4 flex justify-end">
        <button
          onClick={openCreate}
          className="rounded-md bg-primary text-white px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
        >
          {showCreate ? 'Cancel' : 'New Task'}
        </button>
      </div>

      {showCreate && (
        <TaskForm
          form={form}
          setForm={setForm}
          onSubmit={handleCreate}
          onCancel={() => setShowCreate(false)}
          loading={loading}
          submitLabel="Create Task"
          resources={resources}
        />
      )}

      {tasks.length === 0 ? (
        <div className="text-gray-500 text-sm">No tasks defined yet.</div>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) =>
            editingId === task.id && editForm ? (
              <div key={task.id} className="bg-white rounded-lg shadow px-6 py-4">
                <TaskForm
                  form={editForm}
                  setForm={(updater) =>
                    setEditForm((prev) => (prev ? { ...updater(prev), id: prev.id } : prev))
                  }
                  onSubmit={handleEdit}
                  onCancel={() => { setEditingId(null); setEditForm(null) }}
                  loading={loading}
                  submitLabel="Save Changes"
                  resources={resources}
                />
              </div>
            ) : (
              <div
                key={task.id}
                className="bg-white rounded-lg shadow px-6 py-4 flex items-start justify-between gap-4"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-gray-900">{task.title}</span>
                    <TaskTypeBadge type={task.taskType} />
                    <span className="text-xs text-gray-400">order: {task.order}</span>
                  </div>
                  {task.description && (
                    <p className="text-sm text-gray-500">{task.description}</p>
                  )}
                  {task.resourceDocument && (
                    <p className="text-xs mt-1">
                      <span className="text-gray-400">Resource: </span>
                      {task.resourceDocument.url ? (
                        <a
                          href={task.resourceDocument.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-600 hover:underline"
                        >
                          {task.resourceDocument.filename}
                        </a>
                      ) : (
                        <a
                          href={`/api/documents/${task.resourceDocument.id}/download`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-600 hover:underline"
                        >
                          {task.resourceDocument.filename}
                        </a>
                      )}
                    </p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => openEdit(task)}
                    className="text-sm text-primary hover:underline"
                  >
                    Edit
                  </button>
                  {viewerIsAdmin && (
                    <button
                      onClick={() => handleDelete(task.id, task.title)}
                      disabled={loading}
                      className="text-sm text-red-600 hover:underline disabled:opacity-50"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  )
}

// ---- sub-components ----

function TaskTypeBadge({ type }: { type: TaskType }) {
  const styles =
    type === 'UPLOAD'
      ? 'bg-purple-100 text-purple-800'
      : 'bg-gray-100 text-gray-700'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${styles}`}>
      {type === 'UPLOAD' ? 'File Upload' : 'Standard'}
    </span>
  )
}

interface TaskFormProps {
  form: typeof emptyForm
  setForm: (updater: (prev: typeof emptyForm) => typeof emptyForm) => void
  onSubmit: (e: React.FormEvent) => void
  onCancel: () => void
  loading: boolean
  submitLabel: string
  resources: ResourceDoc[]
}

function TaskForm({
  form,
  setForm,
  onSubmit,
  onCancel,
  loading,
  submitLabel,
  resources,
}: TaskFormProps) {
  return (
    <form
      onSubmit={onSubmit}
      className="bg-white rounded-lg shadow px-6 py-5 mb-4 space-y-4"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Title <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            required
            maxLength={256}
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Description
          </label>
          <textarea
            maxLength={2000}
            rows={3}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm resize-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Task Type <span className="text-red-500">*</span>
          </label>
          <div className="space-y-2">
            {TASK_TYPES.map(({ value, label, hint }) => (
              <label key={value} className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="taskType"
                  value={value}
                  checked={form.taskType === value}
                  onChange={() => setForm((f) => ({ ...f, taskType: value }))}
                  className="mt-0.5"
                />
                <span className="text-sm">
                  <span className="font-medium text-gray-900">{label}</span>
                  <span className="text-gray-500 ml-1">— {hint}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Order</label>
          <input
            type="number"
            min={0}
            max={9999}
            value={form.order}
            onChange={(e) =>
              setForm((f) => ({ ...f, order: Math.max(0, parseInt(e.target.value, 10) || 0) }))
            }
            className="w-32 rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Linked Resource (optional)
          </label>
          <select
            value={form.resourceDocumentId ?? ''}
            onChange={(e) =>
              setForm((f) => ({ ...f, resourceDocumentId: e.target.value || null }))
            }
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">— None —</option>
            {resources.map((r) => (
              <option key={r.id} value={r.id}>{r.url ? `[Link] ${r.filename}` : r.filename}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-primary text-white px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {loading ? 'Saving...' : submitLabel}
        </button>
      </div>
    </form>
  )
}
