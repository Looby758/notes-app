import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Like a Mac app opened from the Dock: PATH has only the basics, and npm is somewhere the login shell adds.
describe.skipIf(process.platform === 'win32')('finding npm when Orbit was opened from the Dock', () => {
  const saved = { PATH: process.env.PATH, SHELL: process.env.SHELL, HOME: process.env.HOME, NVM_DIR: process.env.NVM_DIR }
  let dir: string
  beforeEach(() => {
    vi.resetModules()
    dir = mkdtempSync(join(tmpdir(), 'orbit-path-'))
    process.env.HOME = dir
    process.env.NVM_DIR = join(dir, 'no-nvm')
  })
  afterEach(() => {
    Object.assign(process.env, saved)
    rmSync(dir, { recursive: true, force: true })
  })

  // Named so a real npm on this computer can't be found instead.
  const TOOL = 'orbit-test-npm'
  const fakeNpm = (folder: string): string => {
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, TOOL), '#!/bin/sh\necho 10.0.0\n')
    chmodSync(join(folder, TOOL), 0o755)
    return join(folder, TOOL)
  }

  it('finds npm on the PATH the login shell sets up', async () => {
    const npm = fakeNpm(join(dir, 'brew', 'bin'))
    // A "shell" that prints a greeting, then its PATH the way Orbit asks for it.
    const shell = join(dir, 'fake-shell')
    writeFileSync(shell, `#!/bin/sh\necho "Welcome back"\nprintf '__ORBIT_PATH__%s__ORBIT_PATH__' "${join(dir, 'brew', 'bin')}:/usr/bin"\n`)
    chmodSync(shell, 0o755)
    process.env.SHELL = shell
    process.env.PATH = '/usr/bin:/bin'
    const { findTool, toolEnv } = await import('./toolPath')
    expect(await findTool(TOOL)).toBe(npm)
    expect((await toolEnv()).PATH?.split(':')[0]).toBe(join(dir, 'brew', 'bin'))
  })

  it('finds nvm’s npm even when the shell doesn’t say', async () => {
    process.env.NVM_DIR = join(dir, '.nvm')
    const npm = fakeNpm(join(dir, '.nvm', 'versions', 'node', 'v22.3.0', 'bin'))
    fakeNpm(join(dir, '.nvm', 'versions', 'node', 'v18.0.0', 'bin'))
    process.env.SHELL = '/bin/false'
    process.env.PATH = '/nowhere'
    const { findTool } = await import('./toolPath')
    expect(await findTool(TOOL)).toBe(npm)
  })

  it('says null when it truly isn’t there', async () => {
    process.env.SHELL = '/bin/false'
    process.env.PATH = '/nowhere'
    const { findTool } = await import('./toolPath')
    expect(await findTool('definitely-not-a-tool-orbit')).toBeNull()
  })
})
