import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'crypto'
import { keyInput, type SendCode } from '@shared/fileSend'

/**
 * Locks the big file sender's setting-up messages with a key made from the code's words, so the
 * intro server (and anyone between) passes on messages it can't read or change. The WebRTC
 * connection those messages set up checks the other computer's certificate fingerprint, which is
 * inside them, so the file can only be unlocked by the computer that knows the code.
 *
 * scrypt makes each guess at the words slow; three wrong tries end a code (see MAX_BAD_TRIES).
 */

export function codeKey(code: SendCode): Promise<Buffer> {
  const { secret, salt } = keyInput(code)
  return new Promise((resolve, reject) =>
    scrypt(secret, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)))
  )
}

/** JSON in, `base64(nonce | locked | tag)` out. */
export function seal(key: Buffer, message: unknown): string {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const locked = Buffer.concat([cipher.update(JSON.stringify(message), 'utf8'), cipher.final()])
  return Buffer.concat([nonce, locked, cipher.getAuthTag()]).toString('base64')
}

/** The message, or null if it wasn't locked with this key (a wrong code) or was changed. */
export function unseal(key: Buffer, text: string): unknown {
  try {
    const raw = Buffer.from(text, 'base64')
    if (raw.length < 12 + 16 + 1) return null
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12))
    decipher.setAuthTag(raw.subarray(raw.length - 16))
    const plain = Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()])
    return JSON.parse(plain.toString('utf8'))
  } catch {
    return null
  }
}
