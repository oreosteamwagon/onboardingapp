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
  firstName: string | null
  lastName: string | null
  preferredFirstName: string | null
  preferredLastName: string | null
  department: string | null
  positionCode: string | null
}

interface UsersTableProps {
  users: User[]
}

interface ProfileForm {
  firstName: string
  lastName: string
  preferredFirstName: string
  preferredLastName: string
  department: string
  positionCode: string
}

export default function UsersTable({ users: initial }: UsersTableProps) {
  const [users, setUsers] = useState(initial)
  const [showCreate, setShowCreate] = useState(false)
  const [tempPassword, setTempPassword] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Password reset state
  const [resetUserId, setResetUserId] = useState<string | null>(null)
  const [resetTempPassword, setResetTempPassword] = useState<string | null>(null)
  const [resetError, setResetError] = useState<string | null>(null)
  const [resetLoading, setResetLoading] = useState(false)

  // Edit profile state
  const [editProfileUserId, setEditProfileUserId] = useState<string | null>(null)
  const [profileForm, setProfileForm] = useState<ProfileForm>({
    firstName: '',
    lastName: '',
    preferredFirstName: '',
    preferredLastName: '',
    department: '',
    positionCode: '',
  })
  const [profileErrors, setProfileErrors] = useState<string[]>([])
  const [profileSaving, setProfileSaving] = useState(false)

  // Create user form state
  const [newUsername, setNewUsername] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newRole, setNewRole] = useState<Role>('USER')
  const [newFirstName, setNewFirstName] = useState('')
  const [newLastName, setNewLastName] = useState('')
  const [newPreferredFirstName, setNewPreferredFirstName] = useState('')
  const [newPreferredLastName, setNewPreferredLastName] = useState('')
  const [newDepartment, setNewDepartment] = useState('')
  const [newPositionCode, setNewPositionCode] = useState('')

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: newUsername,
          email: newEmail,
          role: newRole,
          firstName: newFirstName,
          lastName: newLastName,
          preferredFirstName: newPreferredFirstName || null,
          preferredLastName: newPreferredLastName || null,
          department: newDepartment,
          positionCode: newPositionCode,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(
          Array.isArray(data.errors)
            ? data.errors.join('; ')
            : (data.error ?? 'Failed to create user'),
        )
        return
      }
      setTempPassword(data.tempPassword)
      setUsers((prev) => [data.user, ...prev])
      setNewUsername('')
      setNewEmail('')
      setNewRole('USER')
      setNewFirstName('')
      setNewLastName('')
      setNewPreferredFirstName('')
      setNewPreferredLastName('')
      setNewDepartment('')
      setNewPositionCode('')
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

  async function handleResetPassword(userId: string) {
    setResetError(null)
    setResetTempPassword(null)
    setResetLoading(true)
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(userId)}/reset-password`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) {
        setResetError(data.error ?? 'Failed to reset password')
        setResetUserId(null)
        return
      }
      setResetTempPassword(data.tempPassword)
      setResetUserId(null)
    } catch {
      setResetError('Unexpected error resetting password.')
      setResetUserId(null)
    } finally {
      setResetLoading(false)
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

  function openEditProfile(u: User) {
    setProfileErrors([])
    setProfileForm({
      firstName: u.firstName ?? '',
      lastName: u.lastName ?? '',
      preferredFirstName: u.preferredFirstName ?? '',
      preferredLastName: u.preferredLastName ?? '',
      department: u.department ?? '',
      positionCode: u.positionCode ?? '',
    })
    setEditProfileUserId(u.id)
  }

  async function handleSaveProfile(e: React.FormEvent, userId: string) {
    e.preventDefault()
    setProfileErrors([])
    setProfileSaving(true)
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: profileForm.firstName,
          lastName: profileForm.lastName,
          preferredFirstName: profileForm.preferredFirstName || null,
          preferredLastName: profileForm.preferredLastName || null,
          department: profileForm.department,
          positionCode: profileForm.positionCode,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setProfileErrors(
          Array.isArray(data.errors)
            ? data.errors
            : [data.error ?? 'Failed to save profile'],
        )
        return
      }
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, ...data } : u)))
      setEditProfileUserId(null)
    } catch {
      setProfileErrors(['Unexpected error saving profile.'])
    } finally {
      setProfileSaving(false)
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

      {resetTempPassword && (
        <div role="alert" className="mb-4 rounded-md bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
          <strong>Password reset.</strong> New temporary password (shown once):{' '}
          <code className="font-mono bg-blue-100 px-1 rounded">{resetTempPassword}</code>
          <button
            onClick={() => setResetTempPassword(null)}
            className="ml-4 text-blue-600 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {resetError && (
        <div role="alert" className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {resetError}
          <button
            onClick={() => setResetError(null)}
            className="ml-4 text-red-600 underline"
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
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              First Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              maxLength={100}
              value={newFirstName}
              onChange={(e) => setNewFirstName(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Last Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              maxLength={100}
              value={newLastName}
              onChange={(e) => setNewLastName(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Department <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              maxLength={100}
              value={newDepartment}
              onChange={(e) => setNewDepartment(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Position Code <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              maxLength={50}
              value={newPositionCode}
              onChange={(e) => setNewPositionCode(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Preferred First Name
            </label>
            <input
              type="text"
              maxLength={100}
              value={newPreferredFirstName}
              onChange={(e) => setNewPreferredFirstName(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Preferred Last Name
            </label>
            <input
              type="text"
              maxLength={100}
              value={newPreferredLastName}
              onChange={(e) => setNewPreferredLastName(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
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
              {['Name / Username', 'Email', 'Role', 'Status', 'Created', 'Actions'].map((h) => (
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
              <>
                <tr key={u.id}>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    {u.firstName && u.lastName ? (
                      <div>
                        <span className="font-medium">{u.firstName} {u.lastName}</span>
                        <div className="text-xs text-gray-500">{u.username}</div>
                      </div>
                    ) : (
                      <div>
                        <span>{u.username}</span>
                        <div className="text-xs text-gray-400">Name not set</div>
                      </div>
                    )}
                  </td>
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
                    <div className="flex items-center gap-4">
                      <button
                        onClick={() => handleToggleActive(u.id, u.active)}
                        className="text-primary hover:underline"
                      >
                        {u.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                      {u.active && resetUserId !== u.id && (
                        <button
                          onClick={() => { setResetUserId(u.id); setResetError(null) }}
                          className="text-amber-600 hover:underline"
                        >
                          Reset Password
                        </button>
                      )}
                      {u.active && resetUserId === u.id && (
                        <span className="inline-flex items-center gap-2 text-amber-700">
                          <span>Confirm reset?</span>
                          <button
                            onClick={() => handleResetPassword(u.id)}
                            disabled={resetLoading}
                            className="font-medium underline disabled:opacity-50"
                          >
                            {resetLoading ? 'Resetting...' : 'Yes'}
                          </button>
                          <button
                            onClick={() => setResetUserId(null)}
                            className="underline text-gray-500"
                          >
                            Cancel
                          </button>
                        </span>
                      )}
                      <button
                        onClick={() =>
                          editProfileUserId === u.id
                            ? setEditProfileUserId(null)
                            : openEditProfile(u)
                        }
                        className="text-indigo-600 hover:underline"
                      >
                        {editProfileUserId === u.id ? 'Close' : 'Edit Profile'}
                      </button>
                    </div>
                  </td>
                </tr>
                {editProfileUserId === u.id && (
                  <tr key={`${u.id}-profile`}>
                    <td colSpan={6} className="px-6 py-4 bg-gray-50">
                      <form
                        onSubmit={(e) => handleSaveProfile(e, u.id)}
                        className="grid grid-cols-1 sm:grid-cols-3 gap-4"
                      >
                        <div className="sm:col-span-3 text-sm font-medium text-gray-700 mb-1">
                          Edit Profile for {u.username}
                        </div>
                        {profileErrors.length > 0 && (
                          <div
                            role="alert"
                            className="sm:col-span-3 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
                          >
                            {profileErrors.join('; ')}
                          </div>
                        )}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            First Name <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            required
                            maxLength={100}
                            value={profileForm.firstName}
                            onChange={(e) =>
                              setProfileForm((f) => ({ ...f, firstName: e.target.value }))
                            }
                            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Last Name <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            required
                            maxLength={100}
                            value={profileForm.lastName}
                            onChange={(e) =>
                              setProfileForm((f) => ({ ...f, lastName: e.target.value }))
                            }
                            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Department <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            required
                            maxLength={100}
                            value={profileForm.department}
                            onChange={(e) =>
                              setProfileForm((f) => ({ ...f, department: e.target.value }))
                            }
                            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Position Code <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            required
                            maxLength={50}
                            value={profileForm.positionCode}
                            onChange={(e) =>
                              setProfileForm((f) => ({ ...f, positionCode: e.target.value }))
                            }
                            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Preferred First Name
                          </label>
                          <input
                            type="text"
                            maxLength={100}
                            value={profileForm.preferredFirstName}
                            onChange={(e) =>
                              setProfileForm((f) => ({ ...f, preferredFirstName: e.target.value }))
                            }
                            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Preferred Last Name
                          </label>
                          <input
                            type="text"
                            maxLength={100}
                            value={profileForm.preferredLastName}
                            onChange={(e) =>
                              setProfileForm((f) => ({ ...f, preferredLastName: e.target.value }))
                            }
                            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                          />
                        </div>
                        <div className="sm:col-span-3 flex justify-end gap-3">
                          <button
                            type="button"
                            onClick={() => setEditProfileUserId(null)}
                            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={profileSaving}
                            className="rounded-md bg-primary text-white px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                          >
                            {profileSaving ? 'Saving...' : 'Save Profile'}
                          </button>
                        </div>
                      </form>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
