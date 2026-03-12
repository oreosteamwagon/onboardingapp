'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { UserProgress } from '@/app/api/team-tasks/route'

type AssignmentOptions = {
  workflows: { id: string; name: string }[]
  users: { id: string; username: string }[]
  supervisors: { id: string; username: string }[]
}

interface TeamTasksViewProps {
  teamData: UserProgress[]
  assignmentOptions: AssignmentOptions | null
}

export default function TeamTasksView({ teamData, assignmentOptions }: TeamTasksViewProps) {
  const router = useRouter()

  const [showAssignForm, setShowAssignForm] = useState(false)
  const [assignUserId, setAssignUserId] = useState('')
  const [assignWorkflowId, setAssignWorkflowId] = useState('')
  const [assignSupervisorId, setAssignSupervisorId] = useState('')
  const [assignError, setAssignError] = useState<string | null>(null)
  const [assignLoading, setAssignLoading] = useState(false)
  const [assignSuccess, setAssignSuccess] = useState<string | null>(null)

  function resetForm() {
    setAssignUserId('')
    setAssignWorkflowId('')
    setAssignSupervisorId('')
    setAssignError(null)
  }

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault()
    setAssignError(null)
    setAssignSuccess(null)

    if (!assignUserId || !assignWorkflowId) {
      setAssignError('User and workflow are required.')
      return
    }

    setAssignLoading(true)
    try {
      const body: Record<string, string> = { workflowId: assignWorkflowId }
      if (assignSupervisorId) body.supervisorId = assignSupervisorId

      const res = await fetch(`/api/users/${encodeURIComponent(assignUserId)}/workflows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setAssignError(data.error ?? 'Failed to assign workflow.')
        return
      }
      setAssignSuccess('Workflow assigned successfully.')
      resetForm()
      setShowAssignForm(false)
      router.refresh()
    } catch {
      setAssignError('Unexpected error. Please try again.')
    } finally {
      setAssignLoading(false)
    }
  }

  return (
    <div>
      {/* Workflow assignment panel — HR+ only */}
      {assignmentOptions && (
        <div className="mb-6">
          <div className="flex items-center gap-4 mb-3">
            <button
              onClick={() => {
                setShowAssignForm((v) => !v)
                setAssignError(null)
                setAssignSuccess(null)
              }}
              className="rounded-md bg-primary text-white px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
            >
              {showAssignForm ? 'Cancel' : 'Assign Workflow'}
            </button>
            {assignSuccess && !showAssignForm && (
              <span role="status" className="text-sm text-green-700">
                {assignSuccess}
              </span>
            )}
          </div>

          {showAssignForm && (
            <form
              onSubmit={handleAssign}
              className="bg-white rounded-lg shadow p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
            >
              {assignError && (
                <div
                  role="alert"
                  className="sm:col-span-2 lg:col-span-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
                >
                  {assignError}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  User
                </label>
                <select
                  required
                  value={assignUserId}
                  onChange={(e) => setAssignUserId(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">Select user...</option>
                  {assignmentOptions.users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.username}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Workflow
                </label>
                <select
                  required
                  value={assignWorkflowId}
                  onChange={(e) => setAssignWorkflowId(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">Select workflow...</option>
                  {assignmentOptions.workflows.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Supervisor{' '}
                  <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <select
                  value={assignSupervisorId}
                  onChange={(e) => setAssignSupervisorId(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">None</option>
                  {assignmentOptions.supervisors.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.username}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={assignLoading}
                  className="w-full rounded-md bg-primary text-white px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {assignLoading ? 'Assigning...' : 'Assign'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* User progress list */}
      {teamData.length === 0 ? (
        <div className="bg-white rounded-lg shadow px-6 py-10 text-center text-sm text-gray-500">
          No users have been assigned to a workflow yet.
          {assignmentOptions && (
            <p className="mt-2 text-gray-400">
              Use the &ldquo;Assign Workflow&rdquo; button above to get started.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {teamData.map((user) => (
            <div key={user.userId} className="bg-white rounded-lg shadow overflow-hidden">
              {/* User header */}
              <div className="px-6 py-4 flex items-center justify-between border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <span className="font-medium text-gray-900">{user.username}</span>
                  <span className="text-xs text-gray-400">
                    {user.workflows.length}{' '}
                    {user.workflows.length === 1 ? 'workflow' : 'workflows'}
                  </span>
                </div>
                <Link
                  href={`/onboarding/${user.userId}`}
                  className="text-sm text-primary hover:underline"
                >
                  View checklist
                </Link>
              </div>

              {/* Per-workflow progress rows */}
              <div className="divide-y divide-gray-50">
                {user.workflows.map((wf) => (
                  <div key={wf.userWorkflowId} className="px-6 py-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-700">
                        {wf.workflowName}
                      </span>
                      <div className="flex items-center gap-3">
                        {wf.pendingApprovalCount > 0 && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                            {wf.pendingApprovalCount} pending approval
                          </span>
                        )}
                        {wf.completionPct === 100 && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            Complete
                          </span>
                        )}
                        <span className="text-xs text-gray-500">
                          {wf.completedTasks}/{wf.totalTasks} tasks
                        </span>
                        <span className="text-xs font-semibold text-gray-900 w-10 text-right">
                          {wf.completionPct}%
                        </span>
                      </div>
                    </div>
                    <div
                      className="w-full bg-gray-100 rounded-full h-2"
                      aria-hidden="true"
                    >
                      <div
                        className={`h-2 rounded-full transition-all ${
                          wf.completionPct === 100 ? 'bg-green-500' : 'bg-primary'
                        }`}
                        style={{ width: `${wf.completionPct}%` }}
                        role="progressbar"
                        aria-valuenow={wf.completionPct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${wf.workflowName}: ${wf.completionPct}% complete`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
