import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ shell: {}, app: { getPath: () => '/tmp' } }))
vi.mock('./undoBin', () => ({ heldItems: () => [], forgetHeld: async () => false, restoreHeld: async () => null }))

const { parseTrashInfo, parseWindowsInfo } = await import('./recycleBin')

/** A $I file as Windows 10 and 11 write it (version 2). */
function windowsInfo(from: string, size: number, when: Date): Buffer {
  const name = Buffer.from(`${from}\0`, 'utf16le')
  const buf = Buffer.alloc(28 + name.length)
  buf.writeBigInt64LE(2n, 0)
  buf.writeBigInt64LE(BigInt(size), 8)
  buf.writeBigInt64LE((BigInt(when.getTime()) + 11644473600000n) * 10000n, 16)
  buf.writeInt32LE(from.length + 1, 24)
  name.copy(buf, 28)
  return buf
}

describe('Recycle Bin', () => {
  it('reads where a Windows item came from, when, and how big it was', () => {
    const when = new Date('2026-11-21T23:10:00Z')
    expect(parseWindowsInfo(windowsInfo('C:\\Users\\me\\Documents\\Taxes 2026.pdf', 25_000, when))).toEqual({ from: 'C:\\Users\\me\\Documents\\Taxes 2026.pdf', deletedAt: when.getTime(), size: 25_000 })
  })

  it('reads the older Windows format too', () => {
    const buf = Buffer.alloc(24 + 520)
    buf.writeBigInt64LE(1n, 0)
    buf.writeBigInt64LE(10n, 8)
    buf.writeBigInt64LE((0n + 11644473600000n) * 10000n, 16)
    Buffer.from('D:\\Old\\a.txt', 'utf16le').copy(buf, 24)
    expect(parseWindowsInfo(buf)?.from).toBe('D:\\Old\\a.txt')
    expect(parseWindowsInfo(Buffer.alloc(4))).toBeNull()
  })

  it('reads a Linux .trashinfo', () => {
    expect(parseTrashInfo('[Trash Info]\nPath=/home/me/My%20Notes/plan.txt\nDeletionDate=2026-11-21T23:10:00\n')).toEqual({ from: '/home/me/My Notes/plan.txt', deletedAt: new Date('2026-11-21T23:10:00').getTime() })
    expect(parseTrashInfo('nothing')).toBeNull()
  })
})
