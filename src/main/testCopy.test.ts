import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// A test copy (not packaged), with "app data" in a temporary folder.
const env = vi.hoisted(() => ({ appData: '' }))
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => env.appData, getAppPath: () => '/code/notes-app' }
}))

const { realOrbitVault, sameFolder, testCopyReadOnly } = await import('./testCopy')

function realOrbitUses(vault: string | null): void {
  env.appData = mkdtempSync(join(tmpdir(), 'orbit-appdata-'))
  if (vault === null) return
  mkdirSync(join(env.appData, 'Notes'))
  writeFileSync(join(env.appData, 'Notes', 'settings.json'), JSON.stringify({ vaultPath: vault }))
}

afterEach(() => {
  if (env.appData) rmSync(env.appData, { recursive: true, force: true })
})

describe('test copies and synced settings', () => {
  it('finds the notes folder your installed Orbit uses', () => {
    realOrbitUses('/drive/My notes')
    expect(realOrbitVault()).toBe('/drive/My notes')
  })

  it('only reads from your real notes folder', () => {
    realOrbitUses('/drive/My notes')
    expect(testCopyReadOnly('/drive/My notes')).toBe(true)
    expect(testCopyReadOnly('/drive/My notes/')).toBe(true)
  })

  it('syncs normally with a separate test vault', () => {
    realOrbitUses('/drive/My notes')
    expect(testCopyReadOnly('/drive/Test vault')).toBe(false)
  })

  it('stays read-only when it can’t tell which notes folder is real', () => {
    realOrbitUses(null)
    expect(testCopyReadOnly('/drive/Test vault')).toBe(true)
    expect(testCopyReadOnly(null)).toBe(true)
  })

  it('treats a different case as the same folder on Windows', () => {
    expect(sameFolder('C:/Notes/Vault', 'c:/notes/vault/', true)).toBe(true)
    expect(sameFolder('/a/Vault', '/a/vault', false)).toBe(false)
  })
})
