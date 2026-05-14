import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import LoginForm from './LoginForm'

// Force dynamic rendering so the root layout re-runs getBranding() on every
// request and the live org name and logo are served from the database.
export const dynamic = 'force-dynamic'

interface LoginPageProps {
  searchParams: Promise<Record<string, string>>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams
  const raw = params.callbackUrl ?? ''

  // Reject external, protocol-relative, and non-path callbackUrls before the
  // page renders. This prevents javascript: and https://evil.com from ever
  // appearing in the page HTML, form action, or __NEXT_DATA__.
  if (raw && !(raw.startsWith('/') && !raw.startsWith('//'))) {
    redirect('/login')
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md">
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  )
}
