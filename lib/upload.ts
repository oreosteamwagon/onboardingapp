import { randomUUID, createCipheriv, randomBytes } from 'crypto'
import { join, extname } from 'path'
import { mkdir, writeFile } from 'fs/promises'
import { fileTypeFromBuffer } from 'file-type'

const IV_BYTES = 12

function getFileEncryptionKey(): Buffer {
  const hex = process.env.FILE_ENCRYPTION_KEY
  if (!hex || hex.length !== 64) {
    throw new Error(
      'FILE_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). ' +
      'Generate with: node -e "process.stdout.write(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    )
  }
  const key = Buffer.from(hex, 'hex')
  if (key.length !== 32) throw new Error('FILE_ENCRYPTION_KEY produced an invalid key length')
  return key
}

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

// Encrypts and saves the upload. On-disk format: [12B IV][16B auth tag][ciphertext]
// Set document.encrypted = true when persisting the resulting storagePath.
export async function saveEncryptedUpload(
  buffer: Buffer,
  originalName: string,
): Promise<{ storagePath: string; filename: string }> {
  if (buffer.length > MAX_SIZE_BYTES) {
    throw new UploadError('File exceeds maximum size of 25 MB', 413)
  }

  const type = await fileTypeFromBuffer(buffer)
  if (!type || !ALLOWED_MIME_TYPES[type.mime]) {
    throw new UploadError('File type not allowed. Accepted: PDF, DOCX, PNG, JPG', 415)
  }

  const key = getFileEncryptionKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()])
  const tag = cipher.getAuthTag()

  // Prepend IV and auth tag so the download route can reconstruct them without extra DB fields
  const encryptedBuffer = Buffer.concat([iv, tag, ciphertext])

  const safeExt = ALLOWED_MIME_TYPES[type.mime]
  const storageFilename = `${randomUUID()}${safeExt}`
  const storagePath = join(UPLOAD_DIR, storageFilename)

  await mkdir(UPLOAD_DIR, { recursive: true })
  await writeFile(storagePath, encryptedBuffer, { mode: 0o640 })

  const filename = originalName.replace(/[^a-zA-Z0-9._\- ]/g, '_').slice(0, 255)

  return { storagePath: storageFilename, filename }
}
