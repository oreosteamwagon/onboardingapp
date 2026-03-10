import { randomUUID } from 'crypto'
import { join, extname } from 'path'
import { mkdir, writeFile } from 'fs/promises'
import { fileTypeFromBuffer } from 'file-type'

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? '/app/uploads'
const MAX_SIZE_BYTES = 25 * 1024 * 1024 // 25 MB

const ALLOWED_MIME_TYPES: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'image/png': '.png',
  'image/jpeg': '.jpg',
}

export class UploadError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message)
    this.name = 'UploadError'
  }
}

export async function saveUpload(
  buffer: Buffer,
  originalName: string,
): Promise<{ storagePath: string; filename: string }> {
  if (buffer.length > MAX_SIZE_BYTES) {
    throw new UploadError('File exceeds maximum size of 25 MB', 413)
  }

  // Validate by magic bytes, not extension
  const type = await fileTypeFromBuffer(buffer)

  if (!type || !ALLOWED_MIME_TYPES[type.mime]) {
    throw new UploadError(
      'File type not allowed. Accepted: PDF, DOCX, PNG, JPG',
      415,
    )
  }

  const safeExt = ALLOWED_MIME_TYPES[type.mime]
  const storageFilename = `${randomUUID()}${safeExt}`
  const storagePath = join(UPLOAD_DIR, storageFilename)

  await mkdir(UPLOAD_DIR, { recursive: true })
  await writeFile(storagePath, buffer, { mode: 0o640 })

  // Strip path components from the original name
  const filename = originalName.replace(/[^a-zA-Z0-9._\- ]/g, '_').slice(0, 255)

  return { storagePath: storageFilename, filename }
}
