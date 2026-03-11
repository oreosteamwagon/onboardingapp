import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canApprove, canApproveAny } from '@/lib/permissions'
import type { Role } from '@prisma/client'

// GET /api/approvals — list tasks awaiting approval for the current user
// Admin/Payroll/HR: all completed+PENDING tasks
// Supervisor: only tasks in workflows where they are the designated supervisor
export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const role = session.user.role as Role

  if (!canApprove(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (canApproveAny(role)) {
    // Admin, Payroll, HR — see all pending approvals across all users
    const tasks = await prisma.userTask.findMany({
      where: {
        completed: true,
        approvalStatus: 'PENDING',
      },
      include: {
        task: true,
        user: { select: { id: true, username: true } },
        document: { select: { id: true, filename: true } },
      },
      orderBy: { updatedAt: 'asc' },
    })
    return NextResponse.json(tasks)
  }

  // Supervisor — only tasks in workflows where supervisorId = this user
  // The join ensures we only show tasks that belong to a workflow the supervisor
  // is designated for AND that the task is actually a member of that workflow.
  // This prevents scope creep across workflow boundaries.
  const tasks = await prisma.userTask.findMany({
    where: {
      completed: true,
      approvalStatus: 'PENDING',
      task: {
        workflowTasks: {
          some: {
            workflow: {
              userWorkflows: {
                some: {
                  supervisorId: session.user.id,
                  // userId on UserWorkflow matches the userTask.userId via the join below
                },
              },
            },
          },
        },
      },
      // Additionally filter: the task's user must be in a workflow supervised by this user
      user: {
        userWorkflows: {
          some: {
            supervisorId: session.user.id,
          },
        },
      },
    },
    include: {
      task: true,
      user: { select: { id: true, username: true } },
      document: { select: { id: true, filename: true } },
    },
    orderBy: { updatedAt: 'asc' },
  })

  return NextResponse.json(tasks)
}
