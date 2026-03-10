'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface BrandingFormProps {
  orgName: string
  logoPath: string | null
  primaryColor: string
  accentColor: string
}

export default function BrandingForm({
  orgName: initialOrgName,
  primaryColor: initialPrimary,
  accentColor: initialAccent,
}: BrandingFormProps) {
  const router = useRouter()
  const [orgName, setOrgName] = useState(initialOrgName)
  const [primaryColor, setPrimaryColor] = useState(initialPrimary)
  const [accentColor, setAccentColor] = useState(initialAccent)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    setLoading(true)

    try {
      const formData = new FormData()
      formData.append('orgName', orgName)
      formData.append('primaryColor', primaryColor)
      formData.append('accentColor', accentColor)
      if (logoFile) {
        formData.append('logo', logoFile)
      }

      const res = await fetch('/api/branding', {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to save branding')
        return
      }

      setSuccess(true)
      router.refresh()
    } catch {
      setError('Unexpected error saving branding.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow px-8 py-6 max-w-lg">
      {error && (
        <div role="alert" className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div role="status" className="mb-4 rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
          Branding saved successfully.
        </div>
      )}

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Organization Name
        </label>
        <input
          type="text"
          required
          maxLength={128}
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Primary Color
        </label>
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={primaryColor}
            onChange={(e) => setPrimaryColor(e.target.value)}
            className="h-10 w-16 rounded border border-gray-300 cursor-pointer"
          />
          <span className="text-sm text-gray-600 font-mono">{primaryColor}</span>
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Accent Color
        </label>
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={accentColor}
            onChange={(e) => setAccentColor(e.target.value)}
            className="h-10 w-16 rounded border border-gray-300 cursor-pointer"
          />
          <span className="text-sm text-gray-600 font-mono">{accentColor}</span>
        </div>
      </div>

      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Logo (PNG/JPG, max 5 MB)
        </label>
        <input
          type="file"
          accept="image/png,image/jpeg"
          onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
          className="block text-sm text-gray-600 file:mr-3 file:rounded file:border-0 file:bg-gray-100 file:px-3 file:py-1 file:text-sm file:font-medium hover:file:bg-gray-200"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-md bg-primary text-white py-2 px-4 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {loading ? 'Saving...' : 'Save Branding'}
      </button>
    </form>
  )
}
