'use client'

import { useState } from 'react'

interface AppSettingsFormProps {
  initialAutoOffboard: boolean
}

export default function AppSettingsForm({ initialAutoOffboard }: AppSettingsFormProps) {
  const [autoOffboard, setAutoOffboard] = useState(initialAutoOffboard)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const res = await fetch('/api/admin/app-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoOffboardEnabled: autoOffboard }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Failed to save settings')
      }
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-8">
      <section className="bg-white border border-gray-200 rounded-lg p-6 max-w-2xl">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Onboarding Completion</h2>
        <p className="text-sm text-gray-500 mb-6">
          Configure what happens when a user completes all onboarding tasks and every task is
          approved.
        </p>

        <label className="flex items-start gap-3 cursor-pointer">
          <div className="mt-0.5">
            <input
              type="checkbox"
              checked={autoOffboard}
              onChange={(e) => {
                setAutoOffboard(e.target.checked)
                setSaved(false)
              }}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
          </div>
          <div>
            <span className="block text-sm font-medium text-gray-900">
              Automatically offboard users on completion
            </span>
            <span className="block text-sm text-gray-500 mt-0.5">
              When all tasks are complete and approved, the user&apos;s account and all their
              uploaded files will be permanently deleted. A thank-you email is sent to the user,
              and a completion notification is sent to their supervisor(s) and all active HR and
              Payroll staff. If disabled, an admin must trigger offboarding manually from the
              user&apos;s checklist.
            </span>
          </div>
        </label>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        {saved && !error && (
          <p className="mt-4 text-sm text-green-600">Settings saved.</p>
        )}

        <div className="mt-6">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-md hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </section>
    </div>
  )
}
