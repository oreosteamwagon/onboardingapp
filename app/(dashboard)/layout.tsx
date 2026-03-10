import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import NavBar from '@/components/ui/NavBar'
import type { Role } from '@prisma/client'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()

  if (!session?.user) {
    redirect('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar user={{ ...session.user, role: session.user.role as Role }} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  )
}
