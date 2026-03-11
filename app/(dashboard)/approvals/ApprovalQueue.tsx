'use client'

import { useState } from 'react'
import type { TaskType } from '@prisma/client'

interface ApprovalItem {
  userTaskId: string
  userId: string
  username: string
  taskId: string
  taskTitle: string
  taskType: TaskType
  completedAt: string | null
  documentFilename: string | null
}

interface ApprovalQueueProps {
  items: ApprovalItem[]
}

type ActionState = 'idle' | 'loading' | 'done-approved' | 'done-rejected' | 'error'

export default function ApprovalQueue({ items: initial }: ApprovalQueueProps) {
  const [items, setItems] = useState(initial)
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  function setItemState(userTaskId: string, state: ActionState) {
    setActionStates((prev) => ({ ...prev, [userTaskId]: state }))
  }

  function setItemError(userTaskId: string, msg: string) {
    setErrors((prev) => ({ ...prev, [userTaskId]: msg }))
  }

  async function handleAction(userTaskId: string, action: 'APPROVED' | 'REJECTED') {
    setItemState(userTaskId, 'loading')
    setErrors((prev) => ({ ...prev, [userTaskId]: '' }))

    try {
      const res = await fetch(`/api/approvals/${userTaskId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })

      const data = await res.json()

      if (!res.ok) {
        setItemState(userTaskId, 'error')
        setItemError(userTaskId, data.error ?? 'Failed to process approval')
        return
      }

      setItemState(userTaskId, action === 'APPROVED' ? 'done-approved' : 'done-rejected')
      // Remove from list after a brief moment to show the result
      setTimeout(() => {
        setItems((prev) => prev.filter((i) => i.userTaskId !== userTaskId))
      }, 1500)
    } catch {
      setItemState(userTaskId, 'error')
      setItemError(userTaskId, 'Unexpected error. Please try again.')
    }
  }

  if (items.length === 0) {
    return (
      <div className="text-gray-500 text-sm bg-white rounded-lg shadow px-6 py-8 text-center">
        No tasks pending approval.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const state = actionStates[item.userTaskId] ?? 'idle'
        const err = errors[item.userTaskId]

        return (
          <div
            key={item.userTaskId}
            className={`bg-white rounded-lg shadow px-6 py-4 transition-opacity ${
              state === 'done-approved' || state === 'done-rejected' ? 'opacity-50' : ''
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="text-sm font-semibold text-gray-900">{item.taskTitle}</span>
                  <TaskTypeBadge type={item.taskType} />
                </div>
                <p className="text-sm text-gray-600">
                  User:{' '}
                  <a
                    href={`/onboarding/${item.userId}`}
                    className="text-primary hover:underline"
                  >
                    {item.username}
                  </a>
                </p>
                {item.completedAt && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    Completed {new Date(item.completedAt).toLocaleString()}
                  </p>
                )}
                {item.documentFilename && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    Document: {item.documentFilename}
                  </p>
                )}
                {err && (
                  <p className="text-xs text-red-600 mt-1" role="alert">
                    {err}
                  </p>
                )}
              </div>

              <div className="flex gap-2 shrink-0 items-center">
                {state === 'done-approved' && (
                  <span className="text-sm font-medium text-green-600">Approved</span>
                )}
                {state === 'done-rejected' && (
                  <span className="text-sm font-medium text-red-600">Rejected</span>
                )}
                {(state === 'idle' || state === 'loading' || state === 'error') && (
                  <>
                    <button
                      onClick={() => handleAction(item.userTaskId, 'REJECTED')}
                      disabled={state === 'loading'}
                      className="rounded-md border border-red-300 text-red-600 px-3 py-1.5 text-sm font-medium hover:bg-red-50 transition-colors disabled:opacity-50"
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => handleAction(item.userTaskId, 'APPROVED')}
                      disabled={state === 'loading'}
                      className="rounded-md bg-green-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-50"
                    >
                      {state === 'loading' ? 'Processing...' : 'Approve'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )
      })}
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
