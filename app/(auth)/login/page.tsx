import { Suspense } from 'react'
import LoginForm from './LoginForm'

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
