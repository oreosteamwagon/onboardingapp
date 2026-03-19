'use client'

import { useState, useEffect } from 'react'

interface LogEntry {
  id: string
  level: 'ERROR' | 'ACCESS' | 'LOG'
  message: string
  userId: string | null
  action: string | null
  path: string | null
  statusCode: number | null
  meta: unknown
  createdAt: string
}

const LEVEL_BADGE: Record<LogEntry['level'], string> = {
  ERROR: 'bg-red-100 text-red-800',
  ACCESS: 'bg-blue-100 text-blue-800',
  LOG: 'bg-gray-100 text-gray-700',
}

export default function LogViewer() {
  // Applied filter state — drives the useEffect
  const [level, setLevel] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)

  // Input state — committed on Apply
  const [levelInput, setLevelInput] = useState('')
  const [fromInput, setFromInput] = useState('')
  const [toInput, setToInput] = useState('')

  const [logs, setLogs] = useState<LogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams()
    if (level) params.set('level', level)
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    params.set('page', String(page))
    params.set('limit', '50')

    setLoading(true)
    setError(null)

    fetch(`/api/admin/logs?${params.toString()}`)
      .then((res) => {
        if (!res.ok) return res.json().then((b) => Promise.reject(b.error ?? 'Request failed'))
        return res.json()
      })
      .then((data) => {
        setLogs(data.logs)
        setTotal(data.total)
        setTotalPages(Math.max(1, data.totalPages))
      })
      .catch((err) => setError(typeof err === 'string' ? err : 'Failed to load logs'))
      .finally(() => setLoading(false))
  }, [page, level, from, to])

  function handleApply() {
    setLevel(levelInput)
    setFrom(fromInput)
    setTo(toInput)
    setPage(1)
  }

  return (
    <div>
      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Level</label>
          <select
            value={levelInput}
            onChange={(e) => setLevelInput(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="">All</option>
            <option value="ERROR">ERROR</option>
            <option value="ACCESS">ACCESS</option>
            <option value="LOG">LOG</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
          <input
            type="date"
            value={fromInput}
            onChange={(e) => setFromInput(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
          <input
            type="date"
            value={toInput}
            onChange={(e) => setToInput(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          />
        </div>
        <button
          onClick={handleApply}
          className="px-3 py-1 bg-primary text-white text-sm rounded hover:opacity-90"
        >
          Apply
        </button>
      </div>

      {/* Status */}
      {loading && <p className="text-sm text-gray-500 mb-3">Loading...</p>}
      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
      {!loading && !error && (
        <p className="text-xs text-gray-500 mb-2">{total} result{total !== 1 ? 's' : ''}</p>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border border-gray-200 rounded">
          <thead className="bg-gray-50">
            <tr>
              {['Timestamp', 'Level', 'Message', 'User ID', 'Action', 'Path', 'Status'].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {logs.map((entry) => (
              <tr key={entry.id} className="hover:bg-gray-50">
                <td className="px-3 py-2 whitespace-nowrap text-gray-600 font-mono text-xs">
                  {new Date(entry.createdAt).toLocaleString()}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${LEVEL_BADGE[entry.level]}`}>
                    {entry.level}
                  </span>
                </td>
                <td className="px-3 py-2 max-w-xs truncate text-gray-900">{entry.message}</td>
                <td className="px-3 py-2 whitespace-nowrap font-mono text-xs text-gray-600">{entry.userId ?? '-'}</td>
                <td className="px-3 py-2 whitespace-nowrap text-gray-600">{entry.action ?? '-'}</td>
                <td className="px-3 py-2 whitespace-nowrap text-gray-600">{entry.path ?? '-'}</td>
                <td className="px-3 py-2 whitespace-nowrap text-gray-600">{entry.statusCode ?? '-'}</td>
              </tr>
            ))}
            {!loading && logs.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-gray-400 text-sm">
                  No log entries found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center gap-3 mt-4">
        <button
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1}
          className="px-3 py-1 text-sm border border-gray-300 rounded disabled:opacity-40 hover:bg-gray-50"
        >
          Prev
        </button>
        <span className="text-sm text-gray-600">Page {page} of {totalPages}</span>
        <button
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={page >= totalPages}
          className="px-3 py-1 text-sm border border-gray-300 rounded disabled:opacity-40 hover:bg-gray-50"
        >
          Next
        </button>
      </div>
    </div>
  )
}
