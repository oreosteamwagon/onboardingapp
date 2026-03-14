import { Suspense } from 'react'
import LoginForm from './LoginForm'

// Force dynamic rendering so the root layout re-runs getBranding() on every
// request and the live org name and logo are served from the database.
export const dynamic = 'force-dynamic'

export default function LoginPage() {
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
