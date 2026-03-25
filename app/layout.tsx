import type { Metadata } from 'next'
import './globals.css'
import { BrandingProvider } from '@/components/BrandingProvider'
import { prisma } from '@/lib/db'

export const metadata: Metadata = {
  title: 'Onboarding App',
  description: 'Employee onboarding portal',
}

async function getBranding() {
  try {
    const branding = await prisma.brandingSetting.findFirst()
    return branding
  } catch {
    return null
  }
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const branding = await getBranding()

  // CSS custom properties are applied as an inline style on <html> so they
  // survive router.refresh() without a nonce. A <style nonce="..."> element
  // would be re-inserted with a new per-request nonce on each refresh, which
  // the browser blocks because the page's CSP nonce is fixed at initial load.
  const cssVars = {
    '--color-primary': sanitizeColor(branding?.primaryColor ?? '#2563eb'),
    '--color-accent': sanitizeColor(branding?.accentColor ?? '#7c3aed'),
  } as React.CSSProperties

  return (
    <html lang="en" style={cssVars}>
      <head />
      <body>
        <BrandingProvider
          orgName={branding?.orgName ?? 'My Organization'}
          logoPath={branding?.logoPath ?? null}
          primaryColor={branding?.primaryColor ?? '#2563eb'}
          accentColor={branding?.accentColor ?? '#7c3aed'}
        >
          {children}
        </BrandingProvider>
      </body>
    </html>
  )
}

// Allowlist: only valid hex colors pass through
function sanitizeColor(value: string): string {
  if (/^#[0-9a-fA-F]{3,8}$/.test(value)) return value
  return '#2563eb'
}
