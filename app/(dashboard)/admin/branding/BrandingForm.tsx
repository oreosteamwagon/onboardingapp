'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

interface BrandingFormProps {
  orgName: string
  logoPath: string | null
  primaryColor: string
  accentColor: string
}

export default function BrandingForm({
  orgName: initialOrgName,
  logoPath: initialLogoPath,
  primaryColor: initialPrimary,
  accentColor: initialAccent,
}: BrandingFormProps) {
  const router = useRouter()
  const [orgName, setOrgName] = useState(initialOrgName)
  const [primaryColor, setPrimaryColor] = useState(initialPrimary)
  const [accentColor, setAccentColor] = useState(initialAccent)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  // Object URL for the locally selected file — shown as a preview before save
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null)
  // Tracks whether the DB has a saved logo; updated after a successful save
  const [savedLogoPath, setSavedLogoPath] = useState<string | null>(initialLogoPath)
  // Incremented after each successful save to cache-bust the logo img
  const [logoKey, setLogoKey] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    setLogoFile(f)
    if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl)
    setLogoPreviewUrl(f ? URL.createObjectURL(f) : null)
  }

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
      // Update saved logo state so the img src reflects the new logo
      if (data.logoPath) setSavedLogoPath(data.logoPath)
      // Cache-bust the logo endpoint so the browser fetches the new file
      setLogoKey((k) => k + 1)
      // Clean up the preview object URL and clear the file input
      if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl)
      setLogoPreviewUrl(null)
      setLogoFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      router.refresh()
    } catch {
      setError('Unexpected error saving branding.')
    } finally {
      setLoading(false)
    }
  }

  // Show the local preview while a file is selected; otherwise show the saved logo
  const displayLogoUrl = logoPreviewUrl ?? (savedLogoPath ? `/api/branding/logo?k=${logoKey}` : null)
  const isPendingPreview = !!logoPreviewUrl

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
        {displayLogoUrl && (
          <div className="mb-3">
            <img
              src={displayLogoUrl}
              alt="Logo preview"
              className="h-16 w-auto object-contain rounded border border-gray-200 p-1 bg-gray-50"
            />
            {isPendingPreview && (
              <p className="text-xs text-gray-400 mt-1">Preview — save to apply</p>
            )}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg"
          onChange={handleFileChange}
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
