import { generateKeyPairSync, randomBytes, sign } from 'crypto'

/**
 * A self-signed certificate for Orbit's own https address on the Wi-Fi. A phone's browser only
 * lets a page use the camera over https, and a computer at home has no real certificate, so Orbit
 * makes its own: the phone warns once that it isn't from a known company, and after that the page
 * works. Built by hand (a few bits of ASN.1) so nothing extra needs installing.
 */

// --- Just enough DER to write one certificate ---

function length(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n])
  const bytes: number[] = []
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff)
  return Buffer.from([0x80 | bytes.length, ...bytes])
}

const tlv = (tag: number, body: Buffer): Buffer => Buffer.concat([Buffer.from([tag]), length(body.length), body])
const seq = (...items: Buffer[]): Buffer => tlv(0x30, Buffer.concat(items))
const set = (...items: Buffer[]): Buffer => tlv(0x31, Buffer.concat(items))
const explicit = (n: number, body: Buffer): Buffer => tlv(0xa0 + n, body)
const octets = (body: Buffer): Buffer => tlv(0x04, body)
const bits = (body: Buffer, unused = 0): Buffer => tlv(0x03, Buffer.concat([Buffer.from([unused]), body]))
const utf8 = (text: string): Buffer => tlv(0x0c, Buffer.from(text, 'utf8'))
const NULL = Buffer.from([0x05, 0x00])

function integer(value: Buffer): Buffer {
  let v = value
  while (v.length > 1 && v[0] === 0 && v[1] < 0x80) v = v.subarray(1)
  if (v[0] >= 0x80) v = Buffer.concat([Buffer.from([0]), v])
  return tlv(0x02, v)
}

function oid(dotted: string): Buffer {
  const [a, b, ...rest] = dotted.split('.').map(Number)
  const out = [40 * a + b]
  for (const n of rest) {
    const chunk: number[] = [n & 0x7f]
    for (let v = Math.floor(n / 128); v > 0; v = Math.floor(v / 128)) chunk.unshift(0x80 | (v & 0x7f))
    out.push(...chunk)
  }
  return tlv(0x06, Buffer.from(out))
}

/** UTCTime (YYMMDDHHMMSSZ), fine until 2050. */
function time(date: Date): Buffer {
  const p = (n: number): string => String(n).padStart(2, '0')
  const text = `${p(date.getUTCFullYear() % 100)}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`
  return tlv(0x17, Buffer.from(text, 'ascii'))
}

const ipBytes = (ip: string): Buffer => Buffer.from(ip.split('.').map(Number))

export interface Certificate {
  /** PEM private key and certificate, ready for https.createServer. */
  key: string
  cert: string
}

/** Apple won't accept a server certificate that lasts longer than this. */
export const CERT_DAYS = 825

/** Makes a fresh key and certificate naming `ips` (the computer's Wi-Fi address) and localhost. */
export function makeCertificate(name: string, ips: string[], now = new Date()): Certificate {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048
  })
  const sha256WithRsa = seq(oid('1.2.840.113549.1.1.11'), NULL)
  const subject = seq(set(seq(oid('2.5.4.3'), utf8(name))))
  const serial = randomBytes(16)
  serial[0] &= 0x7f
  const notBefore = new Date(now.getTime() - 24 * 3600_000)
  const notAfter = new Date(now.getTime() + (CERT_DAYS - 2) * 24 * 3600_000)

  const altNames = seq(...ips.filter((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip)).map((ip) => tlv(0x87, ipBytes(ip))), tlv(0x82, Buffer.from('localhost')))
  const extensions = explicit(
    3,
    seq(
      seq(oid('2.5.29.19'), octets(seq())), // basic constraints: not a CA
      seq(oid('2.5.29.15'), tlv(0x01, Buffer.from([0xff])), octets(bits(Buffer.from([0xa0]), 5))), // key usage: signature, key encipherment
      seq(oid('2.5.29.37'), octets(seq(oid('1.3.6.1.5.5.7.3.1')))), // for a server
      seq(oid('2.5.29.17'), octets(altNames))
    )
  )
  const tbs = seq(
    explicit(0, integer(Buffer.from([2]))), // v3
    integer(serial),
    sha256WithRsa,
    subject,
    seq(time(notBefore), time(notAfter)),
    subject,
    publicKey.export({ type: 'spki', format: 'der' }),
    extensions
  )
  const der = seq(tbs, sha256WithRsa, bits(sign('sha256', tbs, privateKey)))
  const lines = der.toString('base64').match(/.{1,64}/g) ?? []
  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    cert: `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`
  }
}
