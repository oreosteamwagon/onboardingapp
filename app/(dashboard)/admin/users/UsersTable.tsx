'use client'

import { useState } from 'react'
import type { Role } from '@prisma/client'

const ROLES: Role[] = ['USER', 'PAYROLL', 'HR', 'SUPERVISOR', 'ADMIN']

interface User {
  id: string
  username: string
  email: string
  role: Role
  active: boolean
  createdAt: Date
}

interface UsersTableProps {
  users: User[]
}

export default function UsersTable({ users: initial }: UsersTableProps) {
  const [users, setUsers] = useState(initial)
  const [showCreate, setShowCreate] = useState(false)
  const [tempPassword, setTempPassword] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Create user form state
  const [newUsername, setNewUsername] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newRole, setNewRole] = useState<Role>('USER')

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: newUsername, email: newEmail, role: newRole }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to create user')
        return
      }
      setTempPassword(data.tempPassword)
      setUsers((prev) => [data.user, ...prev])
      setNewUsername('')
      setNewEmail('')
      setNewRole('USER')
      setShowCreate(false)
    } catch {
      setError('Unexpected error creating user.')
    }
  }

  async function handleToggleActive(userId: string, active: boolean) {
    setError(null)
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !active }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Failed to update user')
        return
      }
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, active: !active } : u)),
      )
    } catch {
      setError('Unexpected error updating user.')
    }
  }

  async function handleRoleChange(userId: string, role: Role) {
    setError(null)
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Failed to update role')
        return
      }
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role } : u)))
    } catch {
      setError('Unexpected error updating role.')
    }
  }

  return (
    <div>
      {error && (
        <div role="alert" className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {tempPassword && (
        <div role="alert" className="mb-4 rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
          <strong>User created.</strong> Temporary password (shown once):{' '}
          <code className="font-mono bg-green-100 px-1 rounded">{tempPassword}</code>
          <button
            onClick={() => setTempPassword(null)}
            className="ml-4 text-green-600 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="mb-4 flex justify-end">
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="rounded-md bg-primary text-white px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
        >
          {showCreate ? 'Cancel' : 'Create User'}
        </button>
      </div>

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="bg-white rounded-lg shadow p-6 mb-6 grid grid-cols-1 sm:grid-cols-3 gap-4"
        >
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Username
            </label>
            <input
              type="text"
              required
              maxLength={128}
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              type="email"
              required
              maxLength={256}
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Role
            </label>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as Role)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-3 flex justify-end">
            <button
              type="submit"
              className="rounded-md bg-primary text-white px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Create
            </button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto bg-white rounded-lg shadow">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {['Username', 'Email', 'Role', 'Status', 'Created', 'Actions'].map((h) => (
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
            {users.map((u) => (
              <tr key={u.id}>
                <td className="px-6 py-4 text-sm text-gray-900">{u.username}</td>
                <td className="px-6 py-4 text-sm text-gray-600">{u.email}</td>
                <td className="px-6 py-4 text-sm">
                  <select
                    value={u.role}
                    onChange={(e) => handleRoleChange(u.id, e.target.value as Role)}
                    className="rounded border border-gray-300 px-2 py-1 text-sm"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-6 py-4 text-sm">
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      u.active
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {u.active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-gray-500">
                  {new Date(u.createdAt).toLocaleDateString()}
                </td>
                <td className="px-6 py-4 text-sm">
                  <button
                    onClick={() => handleToggleActive(u.id, u.active)}
                    className="text-primary hover:underline"
                  >
                    {u.active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
