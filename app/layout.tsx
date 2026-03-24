import type { Metadata } from 'next'
import './globals.css'
import { BrandingProvider } from '@/components/BrandingProvider'
import { prisma } from '@/lib/db'
import { headers } from 'next/headers'

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
  const nonce = headers().get('x-nonce') ?? ''

  return (
    <html lang="en">
      <head>
        <style
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `:root { --color-primary: ${sanitizeColor(branding?.primaryColor ?? '#2563eb')}; --color-accent: ${sanitizeColor(branding?.accentColor ?? '#7c3aed')}; }`,
          }}
        />
      </head>
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
