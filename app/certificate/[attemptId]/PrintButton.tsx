'use client'

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="no-print rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
    >
      Print Certificate
    </button>
  )
}
