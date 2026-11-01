import { crc32, deflateSync } from 'zlib'

/**
 * Makes RAR 4 files for tests, with each file stored as-is (RAR's "store" method), since there's
 * no free tool to make RARs. Enough of the format for unrar to read it.
 */
export function storedRar(files: { name: string; data: Uint8Array }[]): Buffer {
  const parts: Buffer[] = [Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00])]
  const block = (type: number, flags: number, body: Buffer): Buffer => {
    const head = Buffer.alloc(5)
    head.writeUInt8(type, 0)
    head.writeUInt16LE(flags, 1)
    head.writeUInt16LE(7 + body.length, 3)
    const crc = crc32(Buffer.concat([head, body])) & 0xffff
    const out = Buffer.alloc(2)
    out.writeUInt16LE(crc, 0)
    return Buffer.concat([out, head, body])
  }
  // Archive header.
  parts.push(block(0x73, 0, Buffer.alloc(6)))
  for (const f of files) {
    const name = Buffer.from(f.name.replace(/\//g, '\\'), 'latin1')
    const body = Buffer.alloc(25 + name.length)
    body.writeUInt32LE(f.data.length, 0) // packed size
    body.writeUInt32LE(f.data.length, 4) // unpacked size
    body.writeUInt8(2, 8) // made on Windows
    body.writeUInt32LE(crc32(f.data) >>> 0, 9)
    body.writeUInt32LE(0x5b5a0000, 13) // a DOS date in 2025
    body.writeUInt8(29, 17) // needs unrar 2.9
    body.writeUInt8(0x30, 18) // stored
    body.writeUInt16LE(name.length, 19)
    body.writeUInt32LE(0x20, 21) // an ordinary file
    name.copy(body, 25)
    // 0x8000: the data follows the header.
    parts.push(block(0x74, 0x8000, body), Buffer.from(f.data))
  }
  // End of archive.
  parts.push(block(0x7b, 0x4000, Buffer.alloc(0)))
  return Buffer.concat(parts)
}

/** A small PNG of one colour, `w` × `h`. */
export function tinyPng(w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td) >>> 0)
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr.writeUInt8(8, 8) // 8 bits
  ihdr.writeUInt8(0, 9) // grey
  const rows = Buffer.alloc((w + 1) * h, 0x80)
  for (let y = 0; y < h; y++) rows[y * (w + 1)] = 0
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}
