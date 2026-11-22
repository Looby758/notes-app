import { describe, expect, it } from 'vitest'
import { createHash } from 'crypto'
import { execFileSync, spawnSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { appBundleOf, download, isTranslocated, pickMacZip, releaseFileUrl, resultFile, SWAP_SCRIPT, takeLastResult } from './macUpdate'

const files = [
  { url: 'Orbit-1.14.0-arm64-mac.zip', sha512: 'a' },
  { url: 'Orbit-1.14.0-x64-mac.zip', sha512: 'b' },
  { url: 'Orbit-1.14.0-arm64.dmg', sha512: 'c' },
  { url: 'Orbit-1.14.0-x64.dmg', sha512: 'd' }
]

describe('pickMacZip', () => {
  it('picks the zip for this kind of Mac', () => {
    expect(pickMacZip(files, 'arm64')?.sha512).toBe('a')
    expect(pickMacZip(files, 'x64')?.sha512).toBe('b')
  })
  it('falls back to an Intel zip with no arch in its name, or a universal one', () => {
    expect(pickMacZip([{ url: 'Orbit-1.14.0-mac.zip', sha512: 'e' }], 'x64')?.sha512).toBe('e')
    expect(pickMacZip([{ url: 'Orbit-1.14.0-mac.zip', sha512: 'e' }], 'arm64')).toBeUndefined()
    expect(pickMacZip([{ url: 'Orbit-1.14.0-universal-mac.zip', sha512: 'f' }], 'arm64')?.sha512).toBe('f')
  })
  it('never picks a dmg', () => {
    expect(pickMacZip(files.slice(2), 'arm64')).toBeUndefined()
  })
})

describe('releaseFileUrl', () => {
  it('points at the release download on GitHub, or the test server', () => {
    expect(releaseFileUrl('Orbit-1.14.0-arm64-mac.zip', '1.14.0', 'Looby758/notes-app')).toBe(
      'https://github.com/Looby758/notes-app/releases/download/v1.14.0/Orbit-1.14.0-arm64-mac.zip'
    )
    expect(releaseFileUrl('a.zip', '1', 'x/y', 'http://127.0.0.1:8123')).toBe('http://127.0.0.1:8123/a.zip')
    expect(releaseFileUrl('https://example.com/a.zip', '1', 'x/y')).toBe('https://example.com/a.zip')
  })
})

describe('app bundle paths', () => {
  it('finds the .app from the running program', () => {
    expect(appBundleOf('/Applications/Orbit.app/Contents/MacOS/Orbit')).toBe('/Applications/Orbit.app')
    expect(appBundleOf('/usr/local/bin/electron')).toBeUndefined()
  })
  it('spots a copy macOS is running from a hidden read-only place', () => {
    expect(isTranslocated('/private/var/folders/xy/T/AppTranslocation/ABC/d/Orbit.app')).toBe(true)
    expect(isTranslocated('/Volumes/Orbit 1.14.0/Orbit.app')).toBe(true)
    expect(isTranslocated('/Applications/Orbit.app')).toBe(false)
  })
})

describe('download', () => {
  const body = Buffer.from('the new version')
  const sha = createHash('sha512').update(body).digest('base64')
  const fake = async (): Promise<Response> => new Response(body, { headers: { 'content-length': String(body.length) } })

  it('saves the file when the checksum matches', async () => {
    const dest = join(mkdtempSync(join(tmpdir(), 'orbit-dl-')), 'u.zip')
    const seen: number[] = []
    await download('x', dest, sha, (p) => seen.push(p), fake)
    expect(readFileSync(dest, 'utf8')).toBe('the new version')
    expect(seen.length).toBeGreaterThan(0)
  })
  it('throws away a damaged download', async () => {
    const dest = join(mkdtempSync(join(tmpdir(), 'orbit-dl-')), 'u.zip')
    await expect(download('x', dest, 'wrong', () => undefined, fake)).rejects.toThrow(/damaged/)
    expect(existsSync(dest)).toBe(false)
  })
})

// The swap script is plain sh, so it runs here too (with fake apps).
describe.skipIf(process.platform === 'win32')('swap script', () => {
  function setup(): { dir: string; target: string; fresh: string; script: string } {
    const dir = mkdtempSync(join(tmpdir(), 'orbit-swap-'))
    const target = join(dir, 'Applications', 'Orbit.app')
    const fresh = join(dir, 'new', 'Orbit.app')
    mkdirSync(target, { recursive: true })
    mkdirSync(fresh, { recursive: true })
    writeFileSync(join(target, 'version'), 'old')
    writeFileSync(join(fresh, 'version'), 'new')
    const script = join(dir, 'swap.sh')
    writeFileSync(script, SWAP_SCRIPT, { mode: 0o755 })
    return { dir, target, fresh, script }
  }

  it('swaps the new copy in once Orbit has quit', () => {
    const { dir, target, fresh, script } = setup()
    // A pid that's already gone stands in for Orbit having quit.
    const gone = spawnSync('true').pid
    execFileSync('/bin/sh', [script, String(gone), target, fresh, '0', resultFile(dir)])
    expect(readFileSync(join(target, 'version'), 'utf8')).toBe('new')
    expect(existsSync(fresh)).toBe(false)
    expect(takeLastResult(dir)).toBe('ok')
    expect(takeLastResult(dir)).toBeUndefined()
  })

  it('keeps the old copy when the new one can’t be moved in', () => {
    const { dir, target, script } = setup()
    const gone = spawnSync('true').pid
    execFileSync('/bin/sh', [script, String(gone), target, join(dir, 'missing.app'), '0', resultFile(dir)])
    expect(readFileSync(join(target, 'version'), 'utf8')).toBe('old')
    expect(takeLastResult(dir)).toMatch(/didn't let Orbit/)
  })
})
