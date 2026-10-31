import { createCipheriv, createDecipheriv, createHash, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, type KeyObject } from 'crypto'

/**
 * The secure line between two computers sharing a mouse. Keystrokes go over it (passwords too),
 * so everything after the hello is encrypted (AES-256-GCM) with keys only the two computers know:
 *
 * - Each connection starts with a fresh X25519 key exchange.
 * - Pairing: both screens show a 6-digit code made from that exchange. If they match, nobody is in
 *   the middle, and both computers keep a pairing secret made from it.
 * - Later connections mix that secret into the keys, so only the paired computer can talk.
 *
 * No Electron in here, so it can be tested on its own.
 */

const SPKI_X25519 = Buffer.from('302a300506032b656e032100', 'hex')
const PAIR_SALT = Buffer.from('orbit-share-pair')
export const MAX_FRAME = 4 * 1024 * 1024

export interface Handshake {
  publicKey: Buffer
  privateKey: KeyObject
}

export function newHandshake(): Handshake {
  const { publicKey, privateKey } = generateKeyPairSync('x25519')
  const der = publicKey.export({ type: 'spki', format: 'der' })
  return { publicKey: Buffer.from(der.subarray(der.length - 32)), privateKey }
}

export interface LineKeys {
  /** For what this side sends, and what it receives. */
  send: Buffer
  receive: Buffer
  /** A digest of the exchange: the pairing code comes from it. */
  transcript: Buffer
  /** Kept by both computers after pairing (only meaningful on a pairing connection). */
  pairSecret: Buffer
}

/**
 * Works out the keys. `initiator` is the computer that connected. `secret` is the saved pairing
 * secret, or null while pairing.
 */
export function deriveKeys(own: Handshake, peerPublic: Buffer, initiator: boolean, secret: Buffer | null): LineKeys {
  if (peerPublic.length !== 32) throw new Error('bad key')
  const peerKey = createPublicKey({ key: Buffer.concat([SPKI_X25519, peerPublic]), format: 'der', type: 'spki' })
  const shared = diffieHellman({ privateKey: own.privateKey, publicKey: peerKey })
  const [first, second] = initiator ? [own.publicKey, peerPublic] : [peerPublic, own.publicKey]
  const transcript = createHash('sha256').update('orbit-share v1').update(first).update(second).digest()
  const material = Buffer.from(hkdfSync('sha256', shared, secret ?? PAIR_SALT, Buffer.concat([Buffer.from('keys'), transcript]), 64))
  const pairSecret = Buffer.from(hkdfSync('sha256', shared, PAIR_SALT, Buffer.concat([Buffer.from('secret'), transcript]), 32))
  const toResponder = material.subarray(0, 32)
  const toInitiator = material.subarray(32, 64)
  return {
    send: initiator ? toResponder : toInitiator,
    receive: initiator ? toInitiator : toResponder,
    transcript: createHash('sha256').update('code').update(transcript).digest(),
    pairSecret
  }
}

/** Seals and opens messages in order; a counter is the nonce, so nothing can be replayed or reordered. */
export class Line {
  private sent = 0n
  private received = 0n
  constructor(private keys: LineKeys) {}

  private static nonce(n: bigint): Buffer {
    const b = Buffer.alloc(12)
    b.writeBigUInt64BE(n, 4)
    return b
  }

  seal(plain: Buffer): Buffer {
    const c = createCipheriv('aes-256-gcm', this.keys.send, Line.nonce(this.sent++))
    const body = Buffer.concat([c.update(plain), c.final()])
    return Buffer.concat([body, c.getAuthTag()])
  }

  /** Throws if the message wasn't sealed by the other end of this line. */
  open(sealed: Buffer): Buffer {
    if (sealed.length < 16) throw new Error('short message')
    const d = createDecipheriv('aes-256-gcm', this.keys.receive, Line.nonce(this.received++))
    d.setAuthTag(sealed.subarray(sealed.length - 16))
    return Buffer.concat([d.update(sealed.subarray(0, sealed.length - 16)), d.final()])
  }
}

/** A frame on the wire: a 4-byte length, then the bytes. */
export const frame = (body: Buffer): Buffer => {
  const head = Buffer.alloc(4)
  head.writeUInt32BE(body.length)
  return Buffer.concat([head, body])
}

/** Collects bytes off the socket and hands back whole frames. */
export class FrameReader {
  private buffer: Buffer = Buffer.alloc(0)
  push(chunk: Buffer): Buffer[] {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk
    const out: Buffer[] = []
    while (this.buffer.length >= 4) {
      const size = this.buffer.readUInt32BE(0)
      if (size > MAX_FRAME) throw new Error('frame too big')
      if (this.buffer.length < 4 + size) break
      out.push(this.buffer.subarray(4, 4 + size))
      this.buffer = this.buffer.subarray(4 + size)
    }
    return out
  }
}
