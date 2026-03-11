'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { TaskType } from '@prisma/client'

interface WorkflowTask {
  workflowTaskId: string
  taskId: string
  title: string
  taskType: TaskType
  order: number
}

interface Workflow {
  id: string
  name: string
  description: string | null
  enrolledCount: number
  tasks: WorkflowTask[]
}

interface AvailableTask {
  id: string
  title: string
  taskType: TaskType
  order: number
}

interface WorkflowManagerProps {
  workflows: Workflow[]
  availableTasks: AvailableTask[]
}

export default function WorkflowManager({ workflows: initial, availableTasks }: WorkflowManagerProps) {
  const router = useRouter()
  const [workflows, setWorkflows] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createDesc, setCreateDesc] = useState('')
  const [loading, setLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')

  function clearMessages() {
    setError(null)
    setSuccess(null)
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    clearMessages()
    setLoading(true)
    try {
      const res = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: createName, description: createDesc || null }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to create workflow')
        return
      }
      setWorkflows((prev) =>
        [...prev, { ...data, enrolledCount: 0, tasks: [] }].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      )
      setCreateName('')
      setCreateDesc('')
      setShowCreate(false)
      setSuccess('Workflow created.')
      router.refresh()
    } catch {
      setError('Unexpected error creating workflow.')
    } finally {
      setLoading(false)
    }
  }

  function openEdit(w: Workflow) {
    clearMessages()
    setEditingId(w.id)
    setEditName(w.name)
    setEditDesc(w.description ?? '')
  }

  async function handleEdit(e: React.FormEvent, workflowId: string) {
    e.preventDefault()
    clearMessages()
    setLoading(true)
    try {
      const res = await fetch(`/api/workflows/${workflowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName, description: editDesc || null }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to update workflow')
        return
      }
      setWorkflows((prev) =>
        prev
          .map((w) => (w.id === workflowId ? { ...w, name: data.name, description: data.description } : w))
          .sort((a, b) => a.name.localeCompare(b.name)),
      )
      setEditingId(null)
      setSuccess('Workflow updated.')
      router.refresh()
    } catch {
      setError('Unexpected error updating workflow.')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(workflowId: string, name: string) {
    if (!window.confirm(`Delete workflow "${name}"? This cannot be undone.`)) return
    clearMessages()
    setLoading(true)
    try {
      const res = await fetch(`/api/workflows/${workflowId}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to delete workflow')
        return
      }
      setWorkflows((prev) => prev.filter((w) => w.id !== workflowId))
      if (expandedId === workflowId) setExpandedId(null)
      setSuccess('Workflow deleted.')
      router.refresh()
    } catch {
      setError('Unexpected error deleting workflow.')
    } finally {
      setLoading(false)
    }
  }

  async function handleAddTask(workflowId: string, taskId: string) {
    clearMessages()
    setLoading(true)
    try {
      const res = await fetch(`/api/workflows/${workflowId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to add task')
        return
      }
      const added: WorkflowTask = {
        workflowTaskId: data.id,
        taskId: data.taskId,
        title: data.task.title,
        taskType: data.task.taskType,
        order: data.order,
      }
      setWorkflows((prev) =>
        prev.map((w) =>
          w.id === workflowId
            ? { ...w, tasks: [...w.tasks, added].sort((a, b) => a.order - b.order) }
            : w,
        ),
      )
      setSuccess('Task added to workflow.')
      router.refresh()
    } catch {
      setError('Unexpected error adding task.')
    } finally {
      setLoading(false)
    }
  }

  async function handleRemoveTask(workflowId: string, taskId: string, title: string) {
    if (!window.confirm(`Remove task "${title}" from this workflow?`)) return
    clearMessages()
    setLoading(true)
    try {
      const res = await fetch(`/api/workflows/${workflowId}/tasks`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to remove task')
        return
      }
      setWorkflows((prev) =>
        prev.map((w) =>
          w.id === workflowId ? { ...w, tasks: w.tasks.filter((t) => t.taskId !== taskId) } : w,
        ),
      )
      setSuccess('Task removed from workflow.')
      router.refresh()
    } catch {
      setError('Unexpected error removing task.')
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
          onClick={() => { clearMessages(); setShowCreate((v) => !v) }}
          className="rounded-md bg-primary text-white px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
        >
          {showCreate ? 'Cancel' : 'New Workflow'}
        </button>
      </div>

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="bg-white rounded-lg shadow px-6 py-5 mb-6 space-y-4"
        >
          <h3 className="text-sm font-semibold text-gray-800">Create Workflow</h3>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              maxLength={128}
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="e.g. Software Engineer Onboarding"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              maxLength={2000}
              rows={2}
              value={createDesc}
              onChange={(e) => setCreateDesc(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm resize-none"
            />
          </div>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-primary text-white px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      )}

      {workflows.length === 0 ? (
        <div className="text-gray-500 text-sm">No workflows defined yet.</div>
      ) : (
        <div className="space-y-4">
          {workflows.map((workflow) => {
            const isExpanded = expandedId === workflow.id
            const isEditing = editingId === workflow.id
            const assignedTaskIds = new Set(workflow.tasks.map((t) => t.taskId))
            const unassignedTasks = availableTasks.filter((t) => !assignedTaskIds.has(t.id))

            return (
              <div key={workflow.id} className="bg-white rounded-lg shadow">
                {isEditing ? (
                  <form
                    onSubmit={(e) => handleEdit(e, workflow.id)}
                    className="px-6 py-4 space-y-3"
                  >
                    <input
                      type="text"
                      required
                      maxLength={128}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                    <textarea
                      maxLength={2000}
                      rows={2}
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm resize-none"
                    />
                    <div className="flex gap-2 justify-end">
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={loading}
                        className="rounded-md bg-primary text-white px-3 py-1.5 text-sm font-medium hover:opacity-90 disabled:opacity-50"
                      >
                        {loading ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="px-6 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : workflow.id)}
                          className="text-left"
                        >
                          <span className="text-sm font-semibold text-gray-900 hover:text-primary transition-colors">
                            {workflow.name}
                          </span>
                        </button>
                        {workflow.description && (
                          <p className="text-sm text-gray-500 mt-0.5">{workflow.description}</p>
                        )}
                        <p className="text-xs text-gray-400 mt-1">
                          {workflow.tasks.length} task{workflow.tasks.length !== 1 ? 's' : ''} &middot;{' '}
                          {workflow.enrolledCount} user{workflow.enrolledCount !== 1 ? 's' : ''} enrolled
                        </p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : workflow.id)}
                          className="text-sm text-gray-500 hover:text-gray-700"
                        >
                          {isExpanded ? 'Collapse' : 'Manage Tasks'}
                        </button>
                        <button
                          onClick={() => openEdit(workflow)}
                          className="text-sm text-primary hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(workflow.id, workflow.name)}
                          disabled={loading || workflow.enrolledCount > 0}
                          title={
                            workflow.enrolledCount > 0
                              ? 'Unassign all users before deleting'
                              : 'Delete workflow'
                          }
                          className="text-sm text-red-600 hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {isExpanded && !isEditing && (
                  <div className="border-t border-gray-100 px-6 pb-4 pt-3">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                      Tasks in this workflow
                    </h4>

                    {workflow.tasks.length === 0 ? (
                      <p className="text-sm text-gray-400 mb-3">No tasks added yet.</p>
                    ) : (
                      <ul className="space-y-1.5 mb-3">
                        {workflow.tasks.map((wt) => (
                          <li
                            key={wt.workflowTaskId}
                            className="flex items-center justify-between gap-2 text-sm"
                          >
                            <div className="flex items-center gap-2">
                              <TaskTypeBadge type={wt.taskType} />
                              <span className="text-gray-800">{wt.title}</span>
                              <span className="text-xs text-gray-400">#{wt.order}</span>
                            </div>
                            <button
                              onClick={() => handleRemoveTask(workflow.id, wt.taskId, wt.title)}
                              disabled={loading}
                              className="text-xs text-red-500 hover:underline disabled:opacity-50 shrink-0"
                            >
                              Remove
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}

                    {unassignedTasks.length > 0 && (
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-gray-500 shrink-0">Add task:</label>
                        <select
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value) {
                              handleAddTask(workflow.id, e.target.value)
                              e.target.value = ''
                            }
                          }}
                          disabled={loading}
                          className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm disabled:opacity-50"
                        >
                          <option value="">Select a task...</option>
                          {unassignedTasks.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.title} ({t.taskType})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function TaskTypeBadge({ type }: { type: TaskType }) {
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
        type === 'UPLOAD' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'
      }`}
    >
      {type === 'UPLOAD' ? 'Upload' : 'Standard'}
    </span>
  )
}
