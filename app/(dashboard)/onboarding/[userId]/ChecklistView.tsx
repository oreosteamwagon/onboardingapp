'use client'

import { useRef, useState } from 'react'
import type { TaskType, ApprovalStatus } from '@prisma/client'

interface TaskItem {
  id: string
  title: string
  description: string | null
  taskType: TaskType
  order: number
  completed: boolean
  completedAt: string | null
  userTaskId: string | null
  documentFilename: string | null
  approvalStatus: ApprovalStatus
  approvedAt: string | null
  approvedByUsername: string | null
}

interface WorkflowGroup {
  id: string
  workflowId: string
  workflowName: string
  workflowDescription: string | null
  supervisor: { id: string; username: string } | null
  tasks: TaskItem[]
}

interface ChecklistViewProps {
  workflows: WorkflowGroup[]
  userId: string
  isOwnPage: boolean
}

export default function ChecklistView({ workflows, userId, isOwnPage }: ChecklistViewProps) {
  const [groups, setGroups] = useState(workflows)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState<string | null>(null)
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  function updateTask(taskId: string, patch: Partial<TaskItem>) {
    setGroups((prev) =>
      prev.map((g) => ({
        ...g,
        tasks: g.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
      })),
    )
  }

  async function handleToggle(taskId: string, currentlyCompleted: boolean) {
    if (!isOwnPage) return
    setError(null)

    try {
      const res = await fetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, taskId, completed: !currentlyCompleted }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to update task')
        return
      }

      updateTask(taskId, {
        completed: data.completed,
        completedAt: data.completedAt ?? null,
        userTaskId: data.id,
        approvalStatus: data.approvalStatus,
        approvedAt: data.approvedAt ?? null,
        approvedByUsername: null,
      })
    } catch {
      setError('Unexpected error updating task.')
    }
  }

  async function handleFileUpload(taskId: string, file: File) {
    if (!isOwnPage) return
    setError(null)
    setUploading(taskId)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch(`/api/tasks/${taskId}/upload`, {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Upload failed')
        return
      }

      updateTask(taskId, {
        completed: data.completed,
        completedAt: data.completedAt ?? null,
        documentFilename: data.documentFilename ?? null,
        approvalStatus: data.approvalStatus ?? 'PENDING',
      })

      const input = fileInputRefs.current[taskId]
      if (input) input.value = ''
    } catch {
      setError('Unexpected error uploading file.')
    } finally {
      setUploading(null)
    }
  }

  return (
    <div className="space-y-8">
      {error && (
        <div
          role="alert"
          className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {groups.map((group) => (
        <section key={group.id}>
          <div className="mb-3">
            <h2 className="text-lg font-semibold text-gray-800">{group.workflowName}</h2>
            {group.workflowDescription && (
              <p className="text-sm text-gray-500">{group.workflowDescription}</p>
            )}
            {group.supervisor && (
              <p className="text-xs text-gray-400 mt-0.5">
                Supervisor: {group.supervisor.username}
              </p>
            )}
          </div>

          {group.tasks.length === 0 ? (
            <p className="text-sm text-gray-400">No tasks in this workflow.</p>
          ) : (
            <ul className="space-y-3">
              {group.tasks.map((task) =>
                task.taskType === 'UPLOAD' ? (
                  <UploadTaskItem
                    key={task.id}
                    task={task}
                    isOwnPage={isOwnPage}
                    isUploading={uploading === task.id}
                    onFileChange={(file) => handleFileUpload(task.id, file)}
                    inputRef={(el) => { fileInputRefs.current[task.id] = el }}
                  />
                ) : (
                  <StandardTaskItem
                    key={task.id}
                    task={task}
                    isOwnPage={isOwnPage}
                    onToggle={() => handleToggle(task.id, task.completed)}
                  />
                ),
              )}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}

// ---- Approval badge ----

function ApprovalBadge({ status, approvedByUsername, approvedAt }: {
  status: ApprovalStatus
  approvedByUsername: string | null
  approvedAt: string | null
}) {
  if (status === 'APPROVED') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
        Approved
        {approvedByUsername && <span className="font-normal opacity-75">by {approvedByUsername}</span>}
        {approvedAt && (
          <span className="font-normal opacity-75">
            {' '}&mdash; {new Date(approvedAt).toLocaleDateString()}
          </span>
        )}
      </span>
    )
  }
  if (status === 'REJECTED') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
        Rejected
      </span>
    )
  }
  // PENDING — only show badge if task is completed (awaiting review)
  return null
}

// ---- STANDARD task item ----

function StandardTaskItem({
  task,
  isOwnPage,
  onToggle,
}: {
  task: TaskItem
  isOwnPage: boolean
  onToggle: () => void
}) {
  return (
    <li
      className={`bg-white rounded-lg shadow px-6 py-4 flex items-start gap-4 ${
        task.completed && task.approvalStatus === 'APPROVED' ? 'opacity-60' : ''
      }`}
    >
      <input
        type="checkbox"
        checked={task.completed}
        onChange={onToggle}
        disabled={!isOwnPage || task.approvalStatus === 'APPROVED'}
        className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer disabled:cursor-default"
        aria-label={`Mark "${task.title}" as ${task.completed ? 'incomplete' : 'complete'}`}
      />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-0.5">
          <p
            className={`text-sm font-medium ${
              task.completed ? 'line-through text-gray-400' : 'text-gray-900'
            }`}
          >
            {task.title}
          </p>
          {task.completed && (
            <>
              {task.approvalStatus === 'PENDING' && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                  Pending review
                </span>
              )}
              <ApprovalBadge
                status={task.approvalStatus}
                approvedByUsername={task.approvedByUsername}
                approvedAt={task.approvedAt}
              />
            </>
          )}
        </div>
        {task.description && (
          <p className="text-sm text-gray-500 mt-0.5">{task.description}</p>
        )}
        {task.completed && task.completedAt && (
          <p className="text-xs text-gray-400 mt-1">
            Completed {new Date(task.completedAt).toLocaleString()}
          </p>
        )}
      </div>
    </li>
  )
}

// ---- UPLOAD task item ----

function UploadTaskItem({
  task,
  isOwnPage,
  isUploading,
  onFileChange,
  inputRef,
}: {
  task: TaskItem
  isOwnPage: boolean
  isUploading: boolean
  onFileChange: (file: File) => void
  inputRef: (el: HTMLInputElement | null) => void
}) {
  const approved = task.approvalStatus === 'APPROVED'

  return (
    <li
      className={`bg-white rounded-lg shadow px-6 py-4 flex items-start gap-4 ${
        approved ? 'opacity-70' : ''
      }`}
    >
      {/* Status indicator */}
      <div className="mt-1 h-4 w-4 shrink-0 flex items-center justify-center">
        {task.completed ? (
          <svg
            className="h-4 w-4 text-green-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg
            className="h-4 w-4 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
            />
          </svg>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-0.5">
          <p
            className={`text-sm font-medium ${
              task.completed ? 'text-gray-400' : 'text-gray-900'
            }`}
          >
            {task.title}
          </p>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
            File required
          </span>
          {task.completed && task.approvalStatus === 'PENDING' && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
              Pending review
            </span>
          )}
          {task.completed && (
            <ApprovalBadge
              status={task.approvalStatus}
              approvedByUsername={task.approvedByUsername}
              approvedAt={task.approvedAt}
            />
          )}
        </div>

        {task.description && (
          <p className="text-sm text-gray-500 mt-0.5">{task.description}</p>
        )}

        {task.completed ? (
          <div className="mt-1 text-xs text-gray-400">
            <span className="text-green-600 font-medium">Submitted</span>
            {task.documentFilename && <span> &mdash; {task.documentFilename}</span>}
            {task.completedAt && (
              <span> &mdash; {new Date(task.completedAt).toLocaleString()}</span>
            )}
          </div>
        ) : isOwnPage ? (
          <div className="mt-2">
            <label className="block text-xs text-gray-500 mb-1">
              Upload document (PDF, DOCX, PNG, JPG — max 25 MB)
            </label>
            <input
              type="file"
              accept=".pdf,.docx,.png,.jpg,.jpeg"
              ref={inputRef}
              disabled={isUploading}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) onFileChange(file)
              }}
              className="block text-sm text-gray-600 file:mr-3 file:rounded file:border-0 file:bg-gray-100 file:px-3 file:py-1 file:text-sm file:font-medium hover:file:bg-gray-200 disabled:opacity-50"
              aria-label={`Upload file for task "${task.title}"`}
            />
            {isUploading && (
              <p className="text-xs text-gray-400 mt-1">Uploading...</p>
            )}
          </div>
        ) : (
          <p className="text-xs text-gray-400 mt-1">Awaiting file upload</p>
        )}
      </div>
    </li>
  )
}
