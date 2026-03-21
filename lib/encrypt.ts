import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12   // 96-bit IV — GCM recommended minimum
const TAG_BYTES = 16  // 128-bit authentication tag

function getEncryptionKey(): Buffer {
  const hex = process.env.EMAIL_ENCRYPTION_KEY
  if (!hex || hex.length !== 64) {
    throw new Error(
      'EMAIL_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). ' +
      'Generate with: node -e "process.stdout.write(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    )
  }
  const key = Buffer.from(hex, 'hex')
  if (key.length !== 32) {
    throw new Error('EMAIL_ENCRYPTION_KEY produced an invalid key length')
  }
  return key
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns a colon-delimited string: ivHex:authTagHex:ciphertextHex
 */
export function encryptSmtpPassword(plaintext: string): string {
  const key = getEncryptionKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('hex'), tag.toString('hex'), encrypted.toString('hex')].join(':')
}

/**
 * Decrypts a string produced by encryptSmtpPassword.
 * Throws if the format is invalid or authentication fails (tampered ciphertext).
 */
export function decryptSmtpPassword(encoded: string): string {
  if (!encoded) return ''
  const key = getEncryptionKey()
  const parts = encoded.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted password format')
  }
  const [ivHex, tagHex, ciphertextHex] = parts
  const iv = Buffer.from(ivHex, 'hex')
  const tag = Buffer.from(tagHex, 'hex')
  const ciphertext = Buffer.from(ciphertextHex, 'hex')

  if (iv.length !== IV_BYTES) throw new Error('Invalid IV length in encrypted password')
  if (tag.length !== TAG_BYTES) throw new Error('Invalid auth tag length in encrypted password')

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return decrypted.toString('utf8')
}
