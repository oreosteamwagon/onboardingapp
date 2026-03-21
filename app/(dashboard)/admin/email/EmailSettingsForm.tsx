'use client'

import { useState } from 'react'

const SMTP_PORTS = [25, 465, 587, 2525] as const

interface InitialSettings {
  enabled: boolean
  provider: 'SMTP' | 'ENTRA'
  host: string
  port: number
  secure: boolean
  username: string
  passwordSet: boolean
  entraTenantId: string
  entraClientId: string
  entraClientSecretSet: boolean
  fromAddress: string
  fromName: string
}

interface Props {
  initial: InitialSettings
}

export default function EmailSettingsForm({ initial }: Props) {
  const [enabled, setEnabled] = useState(initial.enabled)
  const [provider, setProvider] = useState<'SMTP' | 'ENTRA'>(initial.provider)

  // SMTP fields
  const [host, setHost] = useState(initial.host)
  const [port, setPort] = useState(initial.port)
  const [secure, setSecure] = useState(initial.secure)
  const [username, setUsername] = useState(initial.username)
  const [password, setPassword] = useState('')
  const [passwordSet, setPasswordSet] = useState(initial.passwordSet)

  // Entra fields
  const [entraTenantId, setEntraTenantId] = useState(initial.entraTenantId)
  const [entraClientId, setEntraClientId] = useState(initial.entraClientId)
  const [entraClientSecret, setEntraClientSecret] = useState('')
  const [entraClientSecretSet, setEntraClientSecretSet] = useState(initial.entraClientSecretSet)

  // Shared fields
  const [fromAddress, setFromAddress] = useState(initial.fromAddress)
  const [fromName, setFromName] = useState(initial.fromName)

  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [testMessage, setTestMessage] = useState<{ ok: boolean; text: string } | null>(null)

  function handleProviderChange(next: 'SMTP' | 'ENTRA') {
    setProvider(next)
    if (next === 'ENTRA') setPassword('')
    if (next === 'SMTP') setEntraClientSecret('')
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)

    const body =
      provider === 'SMTP'
        ? { enabled, provider, host, port, secure, username, password, fromAddress, fromName }
        : { enabled, provider, entraTenantId, entraClientId, entraClientSecret, fromAddress, fromName }

    const res = await fetch('/api/admin/email-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    setSaving(false)

    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: string; errors?: string[] }
      setSaveError(data.errors?.join(', ') ?? data.error ?? 'Failed to save settings')
      return
    }

    const data = await res.json() as { passwordSet: boolean; entraClientSecretSet: boolean }
    setPasswordSet(data.passwordSet)
    setEntraClientSecretSet(data.entraClientSecretSet)
    setPassword('')
    setEntraClientSecret('')
    setSaveSuccess(true)
    setTimeout(() => setSaveSuccess(false), 4000)
  }

  async function handleTest() {
    setTesting(true)
    setTestMessage(null)

    const res = await fetch('/api/admin/email-settings/test', { method: 'POST' })
    const data = await res.json().catch(() => ({})) as { sent?: boolean; to?: string; error?: string }

    setTesting(false)

    if (res.ok && data.sent) {
      setTestMessage({ ok: true, text: `Test email sent to ${data.to}` })
    } else {
      setTestMessage({ ok: false, text: data.error ?? 'Test email failed' })
    }
    setTimeout(() => setTestMessage(null), 8000)
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <form onSubmit={handleSave} className="space-y-6">
        {/* Provider selector */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email Provider</label>
          <select
            value={provider}
            onChange={(e) => handleProviderChange(e.target.value as 'SMTP' | 'ENTRA')}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="SMTP">SMTP (standard)</option>
            <option value="ENTRA">Microsoft Entra ID (Graph API)</option>
          </select>
        </div>

        {/* Enable toggle */}
        <div className="flex items-center gap-3">
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600" />
          </label>
          <span className="text-sm font-medium text-gray-700">
            {enabled ? 'Email notifications enabled' : 'Email notifications disabled'}
          </span>
        </div>

        <div className={enabled ? '' : 'opacity-60 pointer-events-none'}>
          <div className="grid grid-cols-1 gap-5">
            {/* SMTP-specific fields */}
            {provider === 'SMTP' && (
              <>
                <div className="bg-blue-50 border border-blue-200 rounded-md p-4 text-sm text-blue-800">
                  <strong>Standard SMTP</strong> is supported. For <strong>Gmail</strong> you must enable an App
                  Password (Google Account &rarr; Security &rarr; App Passwords) and use port 587 with STARTTLS
                  (secure: off) or port 465 with SSL (secure: on). For <strong>Microsoft 365</strong> you must
                  enable SMTP AUTH for the mailbox and use smtp.office365.com on port 587 (secure: off, STARTTLS
                  negotiated automatically).
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">SMTP Host</label>
                  <input
                    type="text"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder="smtp.example.com"
                    maxLength={253}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="flex gap-4 items-end">
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Port</label>
                    <select
                      value={port}
                      onChange={(e) => setPort(Number(e.target.value))}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {SMTP_PORTS.map((p) => (
                        <option key={p} value={p}>
                          {p}
                          {p === 465 ? ' (SSL)' : p === 587 ? ' (STARTTLS)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="pb-2">
                    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={secure}
                        onChange={(e) => setSecure(e.target.checked)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      SSL/TLS (use for port 465)
                    </label>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="user@example.com"
                    autoComplete="off"
                    maxLength={256}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Password
                    {passwordSet && (
                      <span className="ml-2 text-xs text-gray-500 font-normal">
                        (leave blank to keep existing password)
                      </span>
                    )}
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={passwordSet ? '••••••••' : 'Enter password'}
                    autoComplete="new-password"
                    maxLength={1024}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </>
            )}

            {/* Entra-specific fields */}
            {provider === 'ENTRA' && (
              <>
                <div className="bg-blue-50 border border-blue-200 rounded-md p-4 text-sm text-blue-800 space-y-1">
                  <p>
                    <strong>Microsoft Entra ID</strong> sends mail via the Microsoft Graph API using
                    app-only permissions — no SMTP AUTH required.
                  </p>
                  <ul className="list-disc pl-5 space-y-0.5 mt-1">
                    <li>Create an app registration in Entra ID (no redirect URIs needed).</li>
                    <li>
                      Add the <strong>Mail.Send</strong> <em>application</em> permission under Microsoft
                      Graph and grant admin consent.
                    </li>
                    <li>Create a client secret under &ldquo;Certificates and secrets&rdquo;.</li>
                    <li>The From Address must be a licensed Exchange Online mailbox in the same tenant.</li>
                  </ul>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tenant ID</label>
                  <input
                    type="text"
                    value={entraTenantId}
                    onChange={(e) => setEntraTenantId(e.target.value)}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    maxLength={36}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Client ID</label>
                  <input
                    type="text"
                    value={entraClientId}
                    onChange={(e) => setEntraClientId(e.target.value)}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    maxLength={36}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Client Secret
                    {entraClientSecretSet && (
                      <span className="ml-2 text-xs text-gray-500 font-normal">
                        (leave blank to keep existing secret)
                      </span>
                    )}
                  </label>
                  <input
                    type="password"
                    value={entraClientSecret}
                    onChange={(e) => setEntraClientSecret(e.target.value)}
                    placeholder={entraClientSecretSet ? '••••••••' : 'Enter client secret'}
                    autoComplete="new-password"
                    maxLength={256}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </>
            )}

            {/* From Address — always shown */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">From Address</label>
              <input
                type="email"
                value={fromAddress}
                onChange={(e) => setFromAddress(e.target.value)}
                placeholder="noreply@example.com"
                maxLength={254}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* From Name — always shown */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">From Name</label>
              <input
                type="text"
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
                placeholder="OnboardingApp"
                maxLength={128}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Feedback messages */}
        {saveError && (
          <p className="text-sm text-red-600">{saveError}</p>
        )}
        {saveSuccess && (
          <p className="text-sm text-green-600">Settings saved successfully.</p>
        )}

        {/* Actions */}
        <div className="flex gap-3 items-center">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>

          <button
            type="button"
            onClick={handleTest}
            disabled={testing || !enabled}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {testing ? 'Sending...' : 'Send Test Email'}
          </button>
        </div>

        {testMessage && (
          <p className={`text-sm ${testMessage.ok ? 'text-green-600' : 'text-red-600'}`}>
            {testMessage.text}
          </p>
        )}
      </form>
    </div>
  )
}
