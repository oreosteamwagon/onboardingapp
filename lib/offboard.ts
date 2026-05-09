import { unlink } from 'fs/promises'
import { join } from 'path'
import { prisma } from '@/lib/db'
import { notifyOnboardingComplete } from '@/lib/email'
import { logError, log } from '@/lib/logger'

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? '/app/uploads'

export async function isUserFullyApproved(userId: string): Promise<boolean> {
  const userWorkflows = await prisma.userWorkflow.findMany({
    where: { userId },
    select: { workflow: { select: { tasks: { select: { taskId: true } } } } },
  })

  if (userWorkflows.length === 0) return false

  const allTaskIds = Array.from(
    new Set(userWorkflows.flatMap((uw) => uw.workflow.tasks.map((t) => t.taskId))),
  )

  if (allTaskIds.length === 0) return false

  const approvedCount = await prisma.userTask.count({
    where: { userId, taskId: { in: allTaskIds }, approvalStatus: 'APPROVED' },
  })

  return approvedCount === allTaskIds.length
}

export async function offboardUser(userId: string, triggeredById: string): Promise<void> {
  // 1. Fetch user info before deletion
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      username: true,
      supervisorId: true,
    },
  })

  if (!user) return

  const userName = user.firstName
    ? [user.firstName, user.lastName].filter(Boolean).join(' ')
    : user.username

  // 2. Collect supervisor emails (User.supervisor + workflow supervisors)
  const supervisorEmailSet = new Set<string>()

  if (user.supervisorId) {
    const sv = await prisma.user.findUnique({
      where: { id: user.supervisorId },
      select: { email: true },
    })
    if (sv?.email) supervisorEmailSet.add(sv.email)
  }

  const workflowSupervisors = await prisma.userWorkflow.findMany({
    where: { userId, supervisorId: { not: null } },
    select: { supervisor: { select: { email: true } } },
  })
  for (const uw of workflowSupervisors) {
    if (uw.supervisor?.email) supervisorEmailSet.add(uw.supervisor.email)
  }

  // 3. Collect HR/PAYROLL/ADMIN staff to notify
  const staffUsers = await prisma.user.findMany({
    where: { active: true, role: { in: ['HR', 'PAYROLL', 'ADMIN'] } },
    select: { email: true, firstName: true },
  })

  // Remove supervisor emails from staff list to avoid duplicates
  const staffToNotify = staffUsers.filter((s) => !supervisorEmailSet.has(s.email))

  // 4. Collect file paths before deletion
  const documents = await prisma.document.findMany({
    where: { uploadedBy: userId, storagePath: { not: null } },
    select: { storagePath: true },
  })

  const userTaskIds = await prisma.userTask
    .findMany({ where: { userId }, select: { id: true } })
    .then((rows) => rows.map((r) => r.id))

  const attachments = userTaskIds.length
    ? await prisma.taskAttachment.findMany({
        where: { userTaskId: { in: userTaskIds } },
        select: { storagePath: true },
      })
    : []

  const filesToDelete = [
    ...documents.map((d) => d.storagePath as string),
    ...attachments.map((a) => a.storagePath),
  ]

  // 5. Send emails before deletion so we still have the user's address
  await notifyOnboardingComplete({
    userName,
    userEmail: user.email,
    supervisorEmails: Array.from(supervisorEmailSet),
    staffUsers: staffToNotify,
  })

  // 6. Delete all user data in dependency order
  await prisma.$transaction(async (tx) => {
    if (userTaskIds.length) {
      await tx.taskAttachment.deleteMany({ where: { userTaskId: { in: userTaskIds } } })
    }
    await tx.userTask.deleteMany({ where: { userId } })
    await tx.document.deleteMany({ where: { uploadedBy: userId } })
    await tx.courseAttempt.deleteMany({ where: { userId } })
    await tx.userWorkflow.deleteMany({ where: { userId } })
    await tx.user.delete({ where: { id: userId } })
  })

  log({
    message: 'user offboarded',
    action: 'offboard',
    userId: triggeredById,
    statusCode: 200,
    meta: { offboardedUserId: userId, fileCount: filesToDelete.length },
  })

  // 7. Delete files from disk after DB commit (orphaned files acceptable, DB integrity is not)
  for (const storagePath of filesToDelete) {
    try {
      await unlink(join(UPLOAD_DIR, storagePath))
    } catch (err) {
      logError({
        message: 'Failed to delete file during offboard',
        action: 'offboard',
        userId: triggeredById,
        meta: { storagePath, error: String(err) },
      })
    }
  }
}

export async function checkAndOffboardUser(userId: string): Promise<void> {
  let setting = await prisma.appSetting.findFirst()
  if (!setting) {
    setting = await prisma.appSetting.create({ data: { id: 'global' } })
  }
  if (!setting.autoOffboardEnabled) return

  const fullyApproved = await isUserFullyApproved(userId)
  if (!fullyApproved) return

  // Confirm the user is still a USER role (not a staff account)
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (!user || user.role !== 'USER') return

  await offboardUser(userId, 'system')
}
