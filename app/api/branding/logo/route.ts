import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { checkLogoRateLimit } from '@/lib/ratelimit'
import { getClientIp } from '@/lib/ip'
import { logError } from '@/lib/logger'
import { readFile } from 'fs/promises'
import { join, extname } from 'path'

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? '/app/uploads'

// Allowlist: only image types that saveUpload can produce for logos
const EXT_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
}

// GET /api/branding/logo
// Public endpoint — no authentication required (rendered on the login page
// before any session exists). Returns the organisation logo as a binary image.
// Rate-limited by IP to prevent resource exhaustion.
export async function GET(req: NextRequest) {
  // getClientIp only reads X-Forwarded-For when TRUST_PROXY is set, preventing
  // IP spoofing when the app is accessed directly without a reverse proxy.
  const ip = getClientIp(req.headers)

  try {
    await checkLogoRateLimit(ip)
  } catch {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const branding = await prisma.brandingSetting.findFirst({
    select: { logoPath: true },
  })

  if (!branding?.logoPath) {
    return NextResponse.json({ error: 'No logo configured' }, { status: 404 })
  }

  const storagePath = branding.logoPath

  // Defense-in-depth: storagePath is a UUID+ext written by our own code but
  // validate it contains no path separators in case of DB tampering.
  if (
    storagePath.includes('/') ||
    storagePath.includes('\\') ||
    storagePath.includes('..')
  ) {
    logError({ message: 'Suspicious logoPath detected in branding settings', action: 'logo_serve' })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  const ext = extname(storagePath).toLowerCase()
  const contentType = EXT_TO_MIME[ext]
  if (!contentType) {
    // Extension is not in the image allowlist — should never happen if
    // saveUpload is always used, but fail closed if it does.
    logError({ message: 'Non-image extension in branding logoPath', action: 'logo_serve', meta: { ext } })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  const filePath = join(UPLOAD_DIR, storagePath)
  let buffer: Buffer
  try {
    buffer = await readFile(filePath)
  } catch {
    return NextResponse.json({ error: 'Logo file not found' }, { status: 404 })
  }

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(buffer.length),
      // Public branding asset — safe to cache in browser and CDN.
      // Short TTL so logo changes propagate within an hour.
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
