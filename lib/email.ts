import nodemailer from 'nodemailer'
import { prisma } from '@/lib/db'
import { decryptSmtpPassword, decryptEntraClientSecret } from '@/lib/encrypt'
import { logError } from '@/lib/logger'

// ---------------------------------------------------------------------------
// Internal types — discriminated union by provider
// ---------------------------------------------------------------------------

interface SmtpSettings {
  provider: 'SMTP'
  host: string
  port: number
  secure: boolean
  username: string
  passwordEnc: string
  fromAddress: string
  fromName: string
}

interface EntraSettings {
  provider: 'ENTRA'
  tenantId: string
  clientId: string
  clientSecretEnc: string
  fromAddress: string
  fromName: string
}

type LoadedSettings = SmtpSettings | EntraSettings

interface UserRef {
  email: string
  firstName?: string | null
  lastName?: string | null
  username: string
}

// ---------------------------------------------------------------------------
// Entra ID token cache (module-level, server-side only)
// ---------------------------------------------------------------------------
//
// Security note (MED-07): this live Microsoft Graph access token is held in
// process memory for up to ~55 minutes (token lifetime minus the 60-second
// refresh buffer in getEntraAccessToken). A process memory dump or heap
// inspection attack could expose the token, which grants the ability to send
// email as the configured sender for its remaining lifetime.
//
// This is accepted risk for the current single-instance deployment given the
// short window and the difficulty of heap inspection in practice. Before
// moving to a multi-instance deployment, move this cache to Redis with an
// appropriate TTL so the token is not replicated across processes.
let entraTokenCache: { accessToken: string; expiresAt: number } | null = null

export function invalidateEntraTokenCache(): void {
  entraTokenCache = null
}

async function getEntraAccessToken(settings: EntraSettings): Promise<string> {
  if (entraTokenCache && entraTokenCache.expiresAt > Date.now() + 60_000) {
    return entraTokenCache.accessToken
  }

  let clientSecret: string
  try {
    clientSecret = decryptEntraClientSecret(settings.clientSecretEnc)
  } catch {
    logError({ message: 'Failed to decrypt Entra client secret', action: 'email_send' })
    throw new Error('Failed to decrypt Entra client secret')
  }

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: settings.clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
  })

  const res = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(settings.tenantId)}/oauth2/v2.0/token`,
    { method: 'POST', body: params },
  )

  if (!res.ok) {
    logError({
      message: 'Entra token request failed',
      action: 'email_send',
      statusCode: res.status,
    })
    throw new Error(`Entra token request failed with status ${res.status}`)
  }

  const json = await res.json() as { access_token: string; expires_in: number }
  entraTokenCache = {
    accessToken: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  }
  return entraTokenCache.accessToken
}

// ---------------------------------------------------------------------------
// Transport helpers
// ---------------------------------------------------------------------------

async function loadSettings(): Promise<LoadedSettings | null> {
  const setting = await prisma.emailSetting.findFirst()
  if (!setting || !setting.enabled) return null
  if (!setting.fromAddress) return null

  if (setting.provider === 'ENTRA') {
    if (!setting.entraTenantId || !setting.entraClientId || !setting.entraClientSecretEnc) return null
    return {
      provider: 'ENTRA',
      tenantId: setting.entraTenantId,
      clientId: setting.entraClientId,
      clientSecretEnc: setting.entraClientSecretEnc,
      fromAddress: setting.fromAddress,
      fromName: setting.fromName,
    }
  }

  // Default: SMTP
  if (!setting.host) return null
  return {
    provider: 'SMTP',
    host: setting.host,
    port: setting.port,
    secure: setting.secure,
    username: setting.username,
    passwordEnc: setting.passwordEnc,
    fromAddress: setting.fromAddress,
    fromName: setting.fromName,
  }
}

async function sendViaGraph(settings: EntraSettings, to: string, subject: string, html: string): Promise<void> {
  const accessToken = await getEntraAccessToken(settings)

  const body = {
    message: {
      subject,
      body: { contentType: 'HTML', content: html },
      toRecipients: [{ emailAddress: { address: to } }],
      from: { emailAddress: { address: settings.fromAddress, name: settings.fromName } },
    },
    saveToSentItems: false,
  }

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(settings.fromAddress)}/sendMail`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  )

  if (res.status !== 202) {
    logError({
      message: 'Graph API sendMail failed',
      action: 'email_send',
      statusCode: res.status,
    })
    throw new Error(`Graph API sendMail failed with status ${res.status}`)
  }
}

async function sendMail(to: string, subject: string, html: string): Promise<void> {
  const settings = await loadSettings()
  if (!settings) return

  if (settings.provider === 'ENTRA') {
    await sendViaGraph(settings, to, subject, html)
    return
  }

  let password = ''
  if (settings.passwordEnc) {
    try {
      password = decryptSmtpPassword(settings.passwordEnc)
    } catch {
      logError({ message: 'Failed to decrypt SMTP password', action: 'email_send' })
      return
    }
  }

  const transport = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: settings.username ? { user: settings.username, pass: password } : undefined,
  })

  await transport.sendMail({
    from: `"${settings.fromName}" <${settings.fromAddress}>`,
    to,
    subject,
    html,
  })
}

function dispatchEmail(to: string, subject: string, html: string): void {
  sendMail(to, subject, html).catch((err: unknown) => {
    logError({
      message: 'Email send failed',
      action: 'email_send',
      meta: { error: String(err), to },
    })
  })
}

// ---------------------------------------------------------------------------
// Template helpers
// ---------------------------------------------------------------------------

function displayName(u: { firstName?: string | null; lastName?: string | null; username: string }): string {
  if (u.firstName && u.lastName) return `${u.firstName} ${u.lastName}`
  if (u.firstName) return u.firstName
  return u.username
}

function emailHtml(heading: string, bodyLines: string[]): string {
  const rows = bodyLines
    .map((line) => `<tr><td style="padding:4px 0;color:#374151;font-size:15px;">${line}</td></tr>`)
    .join('\n')
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${heading}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0"
             style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:560px;width:100%;">
        <tr>
          <td style="background:#2563eb;padding:20px 32px;">
            <h1 style="margin:0;font-size:20px;color:#ffffff;">${heading}</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              ${rows}
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;">
            <p style="margin:0;font-size:12px;color:#9ca3af;">
              This is an automated message. Please do not reply to this email.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// Notification: user account created (welcome + temp password + supervisor alert)
// ---------------------------------------------------------------------------

export async function notifyUserCreated(userId: string, tempPassword: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      firstName: true,
      lastName: true,
      username: true,
      supervisor: {
        select: { email: true, firstName: true, lastName: true, username: true },
      },
    },
  })
  if (!user) return

  const greeting = user.firstName ? `Hi ${user.firstName},` : 'Hello,'

  dispatchEmail(
    user.email,
    'Welcome — your account is ready',
    emailHtml('Welcome to OnboardingApp', [
      greeting,
      'Your account has been created. Please log in and change your password as soon as possible.',
      '&nbsp;',
      `<strong>Username:</strong> ${user.username}`,
      `<strong>Temporary password:</strong> <code style="background:#f3f4f6;padding:2px 6px;border-radius:4px;">${tempPassword}</code>`,
      '&nbsp;',
      'You will be guided through your onboarding tasks after you log in.',
    ]),
  )

  if (user.supervisor) {
    const sup = user.supervisor
    const supGreeting = sup.firstName ? `Hi ${sup.firstName},` : 'Hello,'
    dispatchEmail(
      sup.email,
      `New user assigned to you: ${displayName(user)}`,
      emailHtml('New User Assigned', [
        supGreeting,
        `A new user has been created with you listed as their supervisor.`,
        '&nbsp;',
        `<strong>Name:</strong> ${displayName(user)}`,
        `<strong>Username:</strong> ${user.username}`,
        '&nbsp;',
        'They will need to complete their onboarding tasks. You may be asked to approve some of their work.',
      ]),
    )
  }
}

// ---------------------------------------------------------------------------
// Notification: workflow assigned to user
// ---------------------------------------------------------------------------

export async function notifyWorkflowAssigned(userId: string, workflowId: string): Promise<void> {
  const assignment = await prisma.userWorkflow.findUnique({
    where: { userId_workflowId: { userId, workflowId } },
    select: {
      user: { select: { email: true, firstName: true, username: true } },
      workflow: { select: { name: true } },
      supervisor: { select: { email: true, firstName: true, lastName: true, username: true } },
    },
  })
  if (!assignment) return

  const { user, workflow, supervisor } = assignment
  const greeting = user.firstName ? `Hi ${user.firstName},` : 'Hello,'

  dispatchEmail(
    user.email,
    `New workflow assigned: ${workflow.name}`,
    emailHtml('New Workflow Assigned', [
      greeting,
      `A new onboarding workflow has been assigned to you: <strong>${workflow.name}</strong>`,
      '&nbsp;',
      'Log in to view your tasks and begin working through them.',
    ]),
  )

  if (supervisor) {
    const supGreeting = supervisor.firstName ? `Hi ${supervisor.firstName},` : 'Hello,'
    dispatchEmail(
      supervisor.email,
      `Workflow assigned to your supervisee`,
      emailHtml('Workflow Assignment', [
        supGreeting,
        `The workflow <strong>${workflow.name}</strong> has been assigned to a user under your supervision.`,
        '&nbsp;',
        `<strong>User:</strong> ${displayName(user)}`,
        '&nbsp;',
        'You may receive approval requests as they complete tasks in this workflow.',
      ]),
    )
  }
}

// ---------------------------------------------------------------------------
// Notification: task added to a workflow (notify all enrolled users)
// ---------------------------------------------------------------------------

export async function notifyTaskAddedToWorkflow(workflowId: string, taskId: string): Promise<void> {
  const [workflowTasks, enrolledUsers] = await Promise.all([
    prisma.onboardingTask.findUnique({
      where: { id: taskId },
      select: { title: true },
    }),
    prisma.userWorkflow.findMany({
      where: { workflowId },
      select: {
        user: { select: { email: true, firstName: true, username: true } },
        workflow: { select: { name: true } },
      },
    }),
  ])

  if (!workflowTasks || enrolledUsers.length === 0) return

  const taskTitle = workflowTasks.title
  const workflowName = enrolledUsers[0].workflow.name

  for (const { user } of enrolledUsers) {
    const greeting = user.firstName ? `Hi ${user.firstName},` : 'Hello,'
    dispatchEmail(
      user.email,
      `New task added to your workflow: ${taskTitle}`,
      emailHtml('New Task Added', [
        greeting,
        `A new task has been added to your workflow <strong>${workflowName}</strong>:`,
        '&nbsp;',
        `<strong>${taskTitle}</strong>`,
        '&nbsp;',
        'Log in to view and complete this task.',
      ]),
    )
  }
}

// ---------------------------------------------------------------------------
// Notification: task submitted for approval
// ---------------------------------------------------------------------------

export async function notifyApprovalNeeded(userId: string, taskId: string): Promise<void> {
  const [taskUser, task, workflowSupervisors, approvers] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, username: true },
    }),
    prisma.onboardingTask.findUnique({
      where: { id: taskId },
      select: { title: true, taskType: true },
    }),
    // Find supervisors from workflows that contain this task and are assigned to this user
    prisma.userWorkflow.findMany({
      where: {
        userId,
        supervisorId: { not: null },
        workflow: { tasks: { some: { taskId } } },
      },
      select: {
        supervisor: { select: { id: true, email: true, firstName: true, lastName: true, username: true } },
      },
    }),
    prisma.user.findMany({
      where: { active: true, role: { in: ['PAYROLL', 'HR', 'ADMIN'] } },
      select: { email: true, firstName: true, lastName: true, username: true },
    }),
  ])

  if (!taskUser || !task) return
  if (task.taskType === 'LEARNING') return // learning tasks are auto-approved

  const userName = displayName(taskUser)
  const taskTitle = task.title

  // Notify workflow supervisors
  const notifiedIds = new Set<string>()
  for (const { supervisor } of workflowSupervisors) {
    if (!supervisor || notifiedIds.has(supervisor.id)) continue
    notifiedIds.add(supervisor.id)
    const supGreeting = supervisor.firstName ? `Hi ${supervisor.firstName},` : 'Hello,'
    dispatchEmail(
      supervisor.email,
      `Task pending your approval: ${taskTitle}`,
      emailHtml('Approval Required', [
        supGreeting,
        `A task requires your approval.`,
        '&nbsp;',
        `<strong>User:</strong> ${userName}`,
        `<strong>Task:</strong> ${taskTitle}`,
        '&nbsp;',
        'Log in to review and approve or reject this task.',
      ]),
    )
  }

  // Notify PAYROLL / HR / ADMIN
  for (const approver of approvers) {
    const greeting = approver.firstName ? `Hi ${approver.firstName},` : 'Hello,'
    dispatchEmail(
      approver.email,
      `Task pending approval: ${taskTitle}`,
      emailHtml('Approval Required', [
        greeting,
        `A task is pending approval in the system.`,
        '&nbsp;',
        `<strong>User:</strong> ${userName}`,
        `<strong>Task:</strong> ${taskTitle}`,
        '&nbsp;',
        'Log in to the approval queue to review this task.',
      ]),
    )
  }
}

// ---------------------------------------------------------------------------
// Notification: workflow completion check (after any task is approved)
// ---------------------------------------------------------------------------

export async function checkAndNotifyWorkflowCompletion(userId: string, taskId: string): Promise<void> {
  // Find workflows that contain this task and are assigned to this user
  const userWorkflows = await prisma.userWorkflow.findMany({
    where: {
      userId,
      workflow: { tasks: { some: { taskId } } },
    },
    select: {
      workflowId: true,
      workflow: {
        select: {
          name: true,
          tasks: { select: { taskId: true } },
        },
      },
      user: { select: { firstName: true, lastName: true, username: true } },
    },
  })

  if (userWorkflows.length === 0) return

  // For each workflow, check if all tasks are APPROVED for this user
  for (const uw of userWorkflows) {
    const workflowTaskIds = uw.workflow.tasks.map((t) => t.taskId)

    const approvedCount = await prisma.userTask.count({
      where: {
        userId,
        taskId: { in: workflowTaskIds },
        approvalStatus: 'APPROVED',
      },
    })

    if (approvedCount !== workflowTaskIds.length) continue

    // Workflow is complete — notify all active PAYROLL / HR / ADMIN
    const notifyUsers = await prisma.user.findMany({
      where: { active: true, role: { in: ['PAYROLL', 'HR', 'ADMIN'] } },
      select: { email: true, firstName: true, lastName: true, username: true },
    })

    const userName = displayName(uw.user)
    const workflowName = uw.workflow.name

    for (const notifyUser of notifyUsers) {
      const greeting = notifyUser.firstName ? `Hi ${notifyUser.firstName},` : 'Hello,'
      dispatchEmail(
        notifyUser.email,
        `Workflow complete: ${userName} — ${workflowName}`,
        emailHtml('Workflow Complete', [
          greeting,
          `A user has completed all tasks in a workflow.`,
          '&nbsp;',
          `<strong>User:</strong> ${userName}`,
          `<strong>Workflow:</strong> ${workflowName}`,
          '&nbsp;',
          'All tasks have been completed and approved.',
        ]),
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Overdue task processing (called by cron endpoint)
// ---------------------------------------------------------------------------

const OVERDUE_DAYS = 7
const BATCH_LIMIT = 100

export interface OverdueResult {
  processed: number
  notified: number
}

export async function processOverdueTasks(): Promise<OverdueResult> {
  const threshold = new Date(Date.now() - OVERDUE_DAYS * 24 * 60 * 60 * 1000)

  const overdueTasks = await prisma.userTask.findMany({
    where: {
      completed: false,
      createdAt: { lt: threshold },
      overdueNotifiedAt: null,
      user: { active: true },
    },
    select: {
      id: true,
      userId: true,
      taskId: true,
      createdAt: true,
      user: { select: { email: true, firstName: true, lastName: true, username: true } },
      task: { select: { title: true } },
    },
    take: BATCH_LIMIT,
    orderBy: { createdAt: 'asc' },
  })

  if (overdueTasks.length === 0) return { processed: 0, notified: 0 }

  // Fetch PAYROLL / HR / ADMIN users once for the whole batch
  const payrollUsers = await prisma.user.findMany({
    where: { active: true, role: { in: ['PAYROLL', 'HR', 'ADMIN'] } },
    select: { email: true, firstName: true, lastName: true, username: true },
  })

  let notified = 0

  for (const ut of overdueTasks) {
    const daysOverdue = Math.floor((Date.now() - ut.createdAt.getTime()) / (24 * 60 * 60 * 1000))
    const userName = displayName(ut.user)
    const taskTitle = ut.task.title

    // Notify the user
    const userGreeting = ut.user.firstName ? `Hi ${ut.user.firstName},` : 'Hello,'
    dispatchEmail(
      ut.user.email,
      `Reminder: task overdue — ${taskTitle}`,
      emailHtml('Task Overdue Reminder', [
        userGreeting,
        `A task assigned to you has not been completed and is now overdue by ${daysOverdue} day${daysOverdue !== 1 ? 's' : ''}.`,
        '&nbsp;',
        `<strong>Task:</strong> ${taskTitle}`,
        '&nbsp;',
        'Please log in and complete this task as soon as possible.',
      ]),
    )

    // Notify the workflow supervisor(s) for this task
    const supervisorLinks = await prisma.userWorkflow.findMany({
      where: {
        userId: ut.userId,
        supervisorId: { not: null },
        workflow: { tasks: { some: { taskId: ut.taskId } } },
      },
      select: {
        supervisor: { select: { email: true, firstName: true, lastName: true, username: true } },
      },
    })

    const notifiedSupIds = new Set<string>()
    for (const { supervisor } of supervisorLinks) {
      if (!supervisor || notifiedSupIds.has(supervisor.email)) continue
      notifiedSupIds.add(supervisor.email)
      const supGreeting = supervisor.firstName ? `Hi ${supervisor.firstName},` : 'Hello,'
      dispatchEmail(
        supervisor.email,
        `Task overdue: ${userName} — ${taskTitle}`,
        emailHtml('User Task Overdue', [
          supGreeting,
          `One of the users under your supervision has not completed a task.`,
          '&nbsp;',
          `<strong>User:</strong> ${userName}`,
          `<strong>Task:</strong> ${taskTitle}`,
          `<strong>Overdue by:</strong> ${daysOverdue} day${daysOverdue !== 1 ? 's' : ''}`,
          '&nbsp;',
          'Log in to check their onboarding progress.',
        ]),
      )
    }

    // Notify PAYROLL / HR / ADMIN
    for (const payUser of payrollUsers) {
      const greeting = payUser.firstName ? `Hi ${payUser.firstName},` : 'Hello,'
      dispatchEmail(
        payUser.email,
        `Task overdue: ${userName} — ${taskTitle}`,
        emailHtml('User Task Overdue', [
          greeting,
          `A user has not completed an assigned task.`,
          '&nbsp;',
          `<strong>User:</strong> ${userName}`,
          `<strong>Task:</strong> ${taskTitle}`,
          `<strong>Overdue by:</strong> ${daysOverdue} day${daysOverdue !== 1 ? 's' : ''}`,
          '&nbsp;',
          'Log in to view the onboarding status of your team.',
        ]),
      )
    }

    notified++
  }

  // Mark all processed tasks as notified in a single update
  const processedIds = overdueTasks.map((t) => t.id)
  await prisma.userTask.updateMany({
    where: { id: { in: processedIds } },
    data: { overdueNotifiedAt: new Date() },
  })

  return { processed: overdueTasks.length, notified }
}

// ---------------------------------------------------------------------------
// Test email (used by admin settings test endpoint)
// ---------------------------------------------------------------------------

export async function sendTestEmail(toAddress: string): Promise<void> {
  await sendMail(
    toAddress,
    'OnboardingApp — email configuration test',
    emailHtml('Email Configuration Test', [
      'This is a test email sent from OnboardingApp.',
      '&nbsp;',
      'If you received this message, your email configuration is working correctly.',
    ]),
  )
}
