'use client'

import Link from 'next/link'
import { useBranding } from '@/components/BrandingProvider'

export default function Footer() {
  const { orgName } = useBranding()
  const year = new Date().getFullYear()

  return (
    <footer className="border-t border-gray-200 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-2">
        <p className="text-sm text-gray-500">
          &copy; {year} {orgName}. All rights reserved.
        </p>
        <Link
          href="/privacy"
          className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          Privacy Policy
        </Link>
      </div>
    </footer>
  )
}
