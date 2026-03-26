import { NextRequest, NextResponse } from 'next/server'
import { unlink } from 'fs/promises'
import { join } from 'path'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canManageBranding } from '@/lib/permissions'
import { saveUpload, UploadError } from '@/lib/upload'
import { logError } from '@/lib/logger'
import { verifyActiveSession } from '@/lib/session'
import { validateHexColor } from '@/lib/validation'
import type { Role } from '@prisma/client'

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? '/app/uploads'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!canManageBranding(session.user.role as Role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!await verifyActiveSession(session.user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const orgName = formData.get('orgName')
  const primaryColor = formData.get('primaryColor')
  const accentColor = formData.get('accentColor')
  const logoFile = formData.get('logo')

  if (typeof orgName !== 'string' || orgName.trim().length === 0 || orgName.length > 128) {
    return NextResponse.json({ error: 'orgName is required (max 128 chars)' }, { status: 400 })
  }

  const primaryColorErr = validateHexColor(primaryColor, 'primaryColor')
  if (primaryColorErr) {
    return NextResponse.json({ error: primaryColorErr }, { status: 400 })
  }

  const accentColorErr = validateHexColor(accentColor, 'accentColor')
  if (accentColorErr) {
    return NextResponse.json({ error: accentColorErr }, { status: 400 })
  }

  let logoPath: string | undefined

  if (logoFile instanceof File && logoFile.size > 0) {
    // Limit logo to 5 MB
    if (logoFile.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'Logo must be 5 MB or smaller' }, { status: 413 })
    }

    const buffer = Buffer.from(await logoFile.arrayBuffer())

    try {
      const result = await saveUpload(buffer, logoFile.name)
      logoPath = result.storagePath
    } catch (err) {
      if (err instanceof UploadError) {
        return NextResponse.json({ error: err.message }, { status: err.statusCode })
      }
      logError({ message: 'Logo upload error', action: 'branding_update', userId: session.user.id, meta: { error: String(err) } })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }

  const data: {
    orgName: string
    primaryColor: string
    accentColor: string
    logoPath?: string
  } = {
    orgName: orgName.trim(),
    primaryColor,
    accentColor,
  }

  // Read the existing logoPath before the upsert so we can delete it afterward
  // if it is being replaced. Do this only when a new logo is being uploaded.
  let oldLogoPath: string | null = null
  if (logoPath) {
    const existing = await prisma.brandingSetting.findFirst({ select: { logoPath: true } })
    oldLogoPath = existing?.logoPath ?? null
  }

  if (logoPath) {
    data.logoPath = logoPath
  }

  const branding = await prisma.brandingSetting.upsert({
    where: { id: 'default' },
    update: data,
    create: { id: 'default', ...data },
  })

  // Delete the superseded logo file after a successful upsert.
  // Skip if the path looks suspicious (defense-in-depth; same guard as logo serve route).
  if (oldLogoPath && oldLogoPath !== logoPath) {
    if (
      !oldLogoPath.includes('/') &&
      !oldLogoPath.includes('\\') &&
      !oldLogoPath.includes('..')
    ) {
      await unlink(join(UPLOAD_DIR, oldLogoPath)).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== 'ENOENT') {
          logError({ message: 'Failed to delete superseded logo file', action: 'branding_update', userId: session.user.id, meta: { error: String(err) } })
        }
      })
    }
  }

  return NextResponse.json(branding)
}
