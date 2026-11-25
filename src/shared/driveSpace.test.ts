import { describe, expect, it } from 'vitest'
import { describeDriveBytes, describeDriveSpace, driveSpaceFromStatfs, isDriveLow } from './explorer'

const GiB = 1024 ** 3

describe('drive space in Files', () => {
  it('works out size and free space from statfs, using the blocks this user can still fill', () => {
    // A 512 GB drive with 4 KB blocks: bfree counts blocks kept back for the system, bavail doesn't.
    expect(driveSpaceFromStatfs({ bsize: 4096, blocks: 125_000_000, bavail: 30_000_000 })).toEqual({ total: 512_000_000_000, free: 122_880_000_000 })
    // statfs({ bigint: true }) values work too.
    expect(driveSpaceFromStatfs({ bsize: 4096n, blocks: 1000n, bavail: 250n })).toEqual({ total: 4_096_000, free: 1_024_000 })
  })

  it('gives up on drives that report nothing sensible', () => {
    expect(driveSpaceFromStatfs({ bsize: 4096, blocks: 0, bavail: 0 })).toBeNull()
    expect(driveSpaceFromStatfs({ bsize: 0, blocks: 100, bavail: 10 })).toBeNull()
    expect(driveSpaceFromStatfs({ bsize: 4096, blocks: 10, bavail: -1 })).toBeNull()
    expect(driveSpaceFromStatfs({ bsize: NaN, blocks: 10, bavail: 1 })).toBeNull()
    // Never more free than the drive holds.
    expect(driveSpaceFromStatfs({ bsize: 1, blocks: 10, bavail: 20 })).toEqual({ total: 10, free: 10 })
  })

  it('writes sizes like File Explorer on Windows (1024s) and Finder on a Mac (1000s)', () => {
    expect(describeDriveBytes(512_000_000_000, true)).toBe('477 GB')
    expect(describeDriveBytes(512_000_000_000, false)).toBe('512 GB')
    expect(describeDriveBytes(55.25 * GiB, true)).toBe('55.3 GB')
    expect(describeDriveBytes(2 * 1024 ** 4, true)).toBe('2 TB')
    expect(describeDriveBytes(1.5e12, false)).toBe('1.5 TB')
    expect(describeDriveBytes(900, true)).toBe('900 bytes')
    expect(describeDriveBytes(0, false)).toBe('0 bytes')
  })

  it('describes a drive as used, free and total with how full the bar is', () => {
    const d = describeDriveSpace({ total: 476 * GiB, free: 119 * GiB }, true)
    expect(d.text).toBe('119 GB free of 476 GB')
    expect(d.usedPercent).toBeCloseTo(75)
    expect(d.title).toBe('357 GB used · 119 GB free · 476 GB in all (75% full)')
    expect(d.low).toBe(false)
  })

  it('turns the bar red when less than a tenth of the drive is free', () => {
    expect(isDriveLow({ total: 100 * GiB, free: 9 * GiB })).toBe(true)
    expect(isDriveLow({ total: 100 * GiB, free: 10 * GiB })).toBe(false)
    const full = describeDriveSpace({ total: 1000 * GiB, free: 0 }, false)
    expect(full.usedPercent).toBe(100)
    expect(full.low).toBe(true)
    expect(full.text).toBe('0 bytes free of 1.1 TB')
  })
})
