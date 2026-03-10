'use client'

import { useState } from 'react'

interface Task {
  id: string
  title: string
  description: string | null
  order: number
  completed: boolean
  completedAt: string | null
  userTaskId: string | null
}

interface ChecklistViewProps {
  tasks: Task[]
  userId: string
  isOwnPage: boolean
  canManage: boolean
  viewerRole: string
}

export default function ChecklistView({
  tasks: initial,
  userId,
  isOwnPage,
}: ChecklistViewProps) {
  const [tasks, setTasks] = useState(initial)
  const [error, setError] = useState<string | null>(null)

  async function handleToggle(taskId: string, currentlyCompleted: boolean) {
    if (!isOwnPage) return
    setError(null)

    try {
      const res = await fetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          taskId,
          completed: !currentlyCompleted,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to update task')
        return
      }

      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                completed: data.completed,
                completedAt: data.completedAt ?? null,
                userTaskId: data.id,
              }
            : t,
        ),
      )
    } catch {
      setError('Unexpected error updating task.')
    }
  }

  if (tasks.length === 0) {
    return (
      <div className="text-gray-500 text-sm">
        No onboarding tasks assigned for this role yet.
      </div>
    )
  }

  return (
    <div>
      {error && (
        <div role="alert" className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <ul className="space-y-3">
        {tasks.map((task) => (
          <li
            key={task.id}
            className={`bg-white rounded-lg shadow px-6 py-4 flex items-start gap-4 ${
              task.completed ? 'opacity-60' : ''
            }`}
          >
            <input
              type="checkbox"
              checked={task.completed}
              onChange={() => handleToggle(task.id, task.completed)}
              disabled={!isOwnPage}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer disabled:cursor-default"
              aria-label={`Mark "${task.title}" as ${task.completed ? 'incomplete' : 'complete'}`}
            />
            <div className="flex-1 min-w-0">
              <p
                className={`text-sm font-medium ${
                  task.completed ? 'line-through text-gray-400' : 'text-gray-900'
                }`}
              >
                {task.title}
              </p>
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
        ))}
      </ul>
    </div>
  )
}
