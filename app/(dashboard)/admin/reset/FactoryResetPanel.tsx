'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Step = 'idle' | 'confirm' | 'loading' | 'done' | 'error'

export default function FactoryResetPanel() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('idle')
  const [confirmInput, setConfirmInput] = useState('')
  const [result, setResult] = useState<{ filesDeleted: number; fileErrors: number } | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const REQUIRED_INPUT = 'RESET'
  const inputMatches = confirmInput === REQUIRED_INPUT

  async function handleReset() {
    if (!inputMatches) return
    setStep('loading')
    setErrorMsg(null)

    try {
      const res = await fetch('/api/admin/factory-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'FACTORY_RESET' }),
      })

      const data = await res.json()

      if (!res.ok) {
        setErrorMsg(data.error ?? 'Factory reset failed')
        setStep('error')
        return
      }

      setResult({ filesDeleted: data.filesDeleted, fileErrors: data.fileErrors })
      setStep('done')
      // Refresh server data so any SSR pages reflect the cleared state
      router.refresh()
    } catch {
      setErrorMsg('Unexpected error. Please try again.')
      setStep('error')
    }
  }

  function handleCancel() {
    setStep('idle')
    setConfirmInput('')
    setErrorMsg(null)
  }

  if (step === 'done') {
    return (
      <div
        role="alert"
        className="rounded-lg border border-green-200 bg-green-50 px-6 py-5"
      >
        <p className="font-semibold text-green-800 mb-1">Reset complete.</p>
        <p className="text-sm text-green-700">
          All non-admin users, tasks, workflows, and documents have been removed.
        </p>
        {result && result.fileErrors > 0 && (
          <p className="text-xs text-amber-700 mt-2">
            Note: {result.fileErrors} uploaded file(s) could not be deleted from disk.
            The database records were removed successfully.
          </p>
        )}
        <button
          onClick={() => { setStep('idle'); setResult(null) }}
          className="mt-4 text-sm text-green-700 underline"
        >
          Dismiss
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-6 py-5 space-y-4">
      <div>
        <p className="font-semibold text-red-800 text-sm mb-1">
          Danger zone — this action is irreversible
        </p>
        <ul className="text-sm text-red-700 list-disc list-inside space-y-0.5">
          <li>All non-admin user accounts will be deleted</li>
          <li>All onboarding tasks will be deleted</li>
          <li>All workflows and assignments will be deleted</li>
          <li>All uploaded documents will be deleted</li>
          <li>Admin accounts and branding settings are preserved</li>
        </ul>
      </div>

      {step === 'idle' && (
        <button
          onClick={() => setStep('confirm')}
          className="rounded-md bg-red-600 text-white px-4 py-2 text-sm font-medium hover:bg-red-700 transition-colors"
        >
          Factory Reset
        </button>
      )}

      {(step === 'confirm' || step === 'error') && (
        <div className="space-y-3">
          {errorMsg && (
            <p role="alert" className="text-sm text-red-800 font-medium">
              {errorMsg}
            </p>
          )}
          <div>
            <label htmlFor="confirm-input" className="block text-sm text-red-700 mb-1">
              Type <strong>{REQUIRED_INPUT}</strong> to confirm
            </label>
            <input
              id="confirm-input"
              type="text"
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              autoComplete="off"
              className="rounded-md border border-red-300 px-3 py-2 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-red-400"
              placeholder={REQUIRED_INPUT}
            />
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleReset}
              disabled={!inputMatches}
              className="rounded-md bg-red-600 text-white px-4 py-2 text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Confirm reset
            </button>
            <button
              onClick={handleCancel}
              className="rounded-md border border-red-300 text-red-700 px-4 py-2 text-sm font-medium hover:bg-red-100 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === 'loading' && (
        <p className="text-sm text-red-700 animate-pulse">Resetting...</p>
      )}
    </div>
  )
}
