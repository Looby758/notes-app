import { open, type FileHandle } from 'fs/promises'
import { inflateRaw } from 'zlib'
import { promisify } from 'util'
import type { ArchiveEntry } from '@shared/archive'

/**
 * Reads zip files (and .cbz comics, which are zips of pictures) straight from disk: only the list
 * at the end of the file is read up front, and each file inside is read when it's asked for, so
 * a 2 GB comic opens instantly and never has to fit in memory. Handles zip64 (files over 4 GB or
 * with over 65,535 entries). Files stored as-is or squashed the usual way (deflate) are read;
 * encrypted ones and rarer methods aren't.
 */

const inflate = promisify(inflateRaw)

interface ZipItem extends ArchiveEntry {
  method: number
  /** Where its local header starts. */
  offset: number
}

const EOCD = 0x06054b50
const ZIP64_LOCATOR = 0x07064b50
const ZIP64_EOCD = 0x06064b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50

const utf8 = new TextDecoder('utf-8', { fatal: true })
/** Names are UTF-8 when the zip says so, or (usually) when they happen to be valid UTF-8; otherwise the old DOS code page, read as Latin-1. */
function nameOf(bytes: Buffer, isUtf8: boolean): string {
  if (isUtf8) return bytes.toString('utf8')
  try {
    return utf8.decode(bytes)
  } catch {
    return bytes.toString('latin1')
  }
}

const big = (n: bigint): number => {
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('This zip is too big to read.')
  return Number(n)
}

export class ZipArchive {
  private constructor(
    private readonly file: FileHandle,
    private readonly items: ZipItem[]
  ) {}

  static async open(path: string): Promise<ZipArchive> {
    const file = await open(path, 'r')
    try {
      return new ZipArchive(file, await readDirectory(file))
    } catch (err) {
      await file.close()
      throw err
    }
  }

  get entries(): ArchiveEntry[] {
    return this.items.map(({ name, size, packedSize, isDir, encrypted }) => ({ name, size, packedSize, isDir, encrypted }))
  }

  /** One file's contents. */
  async read(name: string): Promise<Buffer> {
    const item = this.items.find((i) => i.name === name)
    if (!item || item.isDir) throw new Error(`“${name}” isn’t in this zip.`)
    if (item.encrypted) throw new Error(`“${name}” has a password.`)
    const head = Buffer.alloc(30)
    await this.file.read(head, 0, 30, item.offset)
    if (head.readUInt32LE(0) !== LOCAL) throw new Error('This zip is damaged.')
    const start = item.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28)
    const packed = Buffer.alloc(item.packedSize)
    const { bytesRead } = await this.file.read(packed, 0, item.packedSize, start)
    if (bytesRead < item.packedSize) throw new Error('This zip is cut short.')
    if (item.method === 0) return packed
    if (item.method === 8) return inflate(packed)
    throw new Error(`“${name}” is squashed in a way Orbit can’t open yet.`)
  }

  close(): Promise<void> {
    return this.file.close()
  }
}

async function readDirectory(file: FileHandle): Promise<ZipItem[]> {
  const { size } = await file.stat()
  // The end record is in the last 22 bytes, plus a comment of up to 64 KB.
  const tailSize = Math.min(size, 22 + 0xffff)
  const tail = Buffer.alloc(tailSize)
  await file.read(tail, 0, tailSize, size - tailSize)
  let end = -1
  for (let i = tailSize - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD) {
      end = i
      break
    }
  }
  if (end < 0) throw new Error('This isn’t a zip file, or it’s damaged.')

  let count = tail.readUInt16LE(end + 10)
  let dirSize = tail.readUInt32LE(end + 12)
  let dirOffset = tail.readUInt32LE(end + 16)
  // Zip64: the real numbers are in another record, found through a locator just before this one.
  if ((count === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff) && end >= 20 && tail.readUInt32LE(end - 20) === ZIP64_LOCATOR) {
    const at = big(tail.readBigUInt64LE(end - 20 + 8))
    const rec = Buffer.alloc(56)
    await file.read(rec, 0, 56, at)
    if (rec.readUInt32LE(0) !== ZIP64_EOCD) throw new Error('This zip is damaged.')
    count = big(rec.readBigUInt64LE(32))
    dirSize = big(rec.readBigUInt64LE(40))
    dirOffset = big(rec.readBigUInt64LE(48))
  }
  if (dirOffset + dirSize > size) throw new Error('This zip is cut short.')

  const dir = Buffer.alloc(dirSize)
  await file.read(dir, 0, dirSize, dirOffset)
  const items: ZipItem[] = []
  let p = 0
  for (let n = 0; n < count && p + 46 <= dir.length; n++) {
    if (dir.readUInt32LE(p) !== CENTRAL) throw new Error('This zip is damaged.')
    const flags = dir.readUInt16LE(p + 8)
    const method = dir.readUInt16LE(p + 10)
    let packedSize = dir.readUInt32LE(p + 20)
    let unpacked = dir.readUInt32LE(p + 24)
    const nameLen = dir.readUInt16LE(p + 28)
    const extraLen = dir.readUInt16LE(p + 30)
    const commentLen = dir.readUInt16LE(p + 32)
    let offset = dir.readUInt32LE(p + 42)
    const name = nameOf(dir.subarray(p + 46, p + 46 + nameLen), (flags & 0x800) !== 0).replace(/\\/g, '/')
    // Zip64 sizes and offsets, for the ones too big for the normal fields (in this order).
    let e = p + 46 + nameLen
    const extraEnd = e + extraLen
    while (e + 4 <= extraEnd) {
      const id = dir.readUInt16LE(e)
      const len = dir.readUInt16LE(e + 2)
      if (id === 0x0001) {
        let q = e + 4
        if (unpacked === 0xffffffff && q + 8 <= e + 4 + len) (unpacked = big(dir.readBigUInt64LE(q))), (q += 8)
        if (packedSize === 0xffffffff && q + 8 <= e + 4 + len) (packedSize = big(dir.readBigUInt64LE(q))), (q += 8)
        if (offset === 0xffffffff && q + 8 <= e + 4 + len) offset = big(dir.readBigUInt64LE(q))
      }
      e += 4 + len
    }
    items.push({ name, size: unpacked, packedSize, isDir: name.endsWith('/'), encrypted: (flags & 1) !== 0, method, offset })
    p = extraEnd + commentLen
  }
  return items
}
