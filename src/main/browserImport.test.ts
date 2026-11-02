import { describe, expect, it, vi } from 'vitest'
import { createCipheriv, pbkdf2Sync, randomBytes } from 'crypto'

vi.mock('electron', () => ({
  app: { getPath: () => '', on: () => undefined, whenReady: () => new Promise(() => undefined), isPackaged: true, getAppPath: () => '' },
  BrowserWindow: class {},
  dialog: {},
  ipcMain: { handle: () => undefined, on: () => undefined },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: {}
}))

const { decryptPassword } = await import('./operaImport')
const { registryFile } = await import('./defaultBrowser')

describe('reading Opera GX passwords', () => {
  it('reads Windows ones (AES-GCM, "v10")', () => {
    const key = randomBytes(32)
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, nonce)
    const body = Buffer.concat([cipher.update('hunter2', 'utf8'), cipher.final()])
    const blob = Buffer.concat([Buffer.from('v10'), nonce, body, cipher.getAuthTag()])
    expect(decryptPassword(blob, { kind: 'gcm', key })).toBe('hunter2')
    // The wrong key, or a password locked to Opera itself, gives nothing rather than rubbish.
    expect(decryptPassword(blob, { kind: 'gcm', key: randomBytes(32) })).toBeNull()
    expect(decryptPassword(Buffer.concat([Buffer.from('v20'), body]), { kind: 'gcm', key })).toBeNull()
  })

  it('reads Mac ones (AES-CBC from the Keychain secret)', () => {
    const key = pbkdf2Sync('secret', 'saltysalt', 1003, 16, 'sha1')
    const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20))
    const blob = Buffer.concat([Buffer.from('v10'), cipher.update('p@ss', 'utf8'), cipher.final()])
    expect(decryptPassword(blob, { kind: 'cbc', key })).toBe('p@ss')
  })
})

describe('registering Orbit as a Windows browser', () => {
  it('writes the keys Windows looks for, with the link passed on', () => {
    const reg = registryFile('"C:\\Program Files\\Orbit\\Orbit.exe"', 'C:\\Program Files\\Orbit\\Orbit.exe,0')
    expect(reg.startsWith('Windows Registry Editor Version 5.00')).toBe(true)
    expect(reg).toContain('[HKEY_CURRENT_USER\\Software\\Clients\\StartMenuInternet\\Orbit\\Capabilities\\URLAssociations]')
    expect(reg).toContain('"https"="OrbitURL"')
    expect(reg).toContain('"Orbit"="Software\\\\Clients\\\\StartMenuInternet\\\\Orbit\\\\Capabilities"')
    // The command, with its quotes and backslashes escaped for a .reg file.
    expect(reg).toContain('@="\\"C:\\\\Program Files\\\\Orbit\\\\Orbit.exe\\" \\"--orbit-url=%1\\""')
  })
})
