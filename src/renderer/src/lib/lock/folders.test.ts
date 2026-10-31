import { beforeEach, describe, expect, it } from 'vitest'

const written: string[] = []
;(globalThis as unknown as { window: unknown }).window = {
  api: { readAppData: async () => null, writeAppData: async (_: string, c: string) => void written.push(c) }
}
const f = await import('./folders')

describe('locked folders', () => {
  beforeEach(() => f.useLockedFolders.setState({ folders: [] }))

  it('covers notes and folders inside a locked folder', () => {
    f.addLockedFolder('Diary')
    expect(f.lockedFolderOf('Diary/2026/today.md')).toBe('Diary')
    expect(f.lockedFolderOf('Diary-old/a.md')).toBeUndefined()
  })

  it('a folder around locked ones replaces them, and one inside is already covered', () => {
    f.addLockedFolder('A/B')
    f.addLockedFolder('A')
    f.addLockedFolder('A/C')
    expect(f.useLockedFolders.getState().folders).toEqual(['A'])
  })

  it('follows renames and forgets deleted folders', () => {
    f.addLockedFolder('Work/Secret')
    f.remapLockedFolders('Work', 'Job')
    expect(f.useLockedFolders.getState().folders).toEqual(['Job/Secret'])
    f.removeLockedFoldersWithin('Job')
    expect(f.useLockedFolders.getState().folders).toEqual([])
    expect(written.length).toBeGreaterThan(0)
  })
})
