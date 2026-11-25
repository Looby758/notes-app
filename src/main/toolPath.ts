import { execFile } from 'child_process'
import { existsSync, readdirSync } from 'fs'
import { homedir } from 'os'
import { delimiter, join } from 'path'
import { mergePaths, newestFirst, pathFromShellOutput, usualToolDirs } from '@shared/toolPath'

/**
 * The PATH Orbit runs npm with: Orbit's own, then what your login shell sets up (so a Mac app
 * opened from the Dock finds Homebrew's, nvm's or Volta's npm like the Terminal does), then the
 * usual places Node.js gets installed. Worked out once; looked at again if npm still can't be found.
 */

const WINDOWS = process.platform === 'win32'
const MARKER = '__ORBIT_PATH__'

/** The login shell's PATH (macOS and Linux), or null if it couldn't be read in a few seconds. */
function shellPath(): Promise<string | null> {
  if (WINDOWS) return Promise.resolve(null)
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  return new Promise((done) => {
    // -i -l: the same start-up files the Terminal app reads (nvm and friends live in .zshrc).
    execFile(shell, ['-ilc', `printf '${MARKER}%s${MARKER}' "$PATH"`], { timeout: 6000, env: { ...process.env, TERM: 'dumb' } }, (_err, stdout) =>
      done(pathFromShellOutput(String(stdout ?? ''), MARKER))
    )
  })
}

/** nvm's newest installed Node, as a folder to look for npm in. */
function nvmDirs(): string[] {
  const root = process.env.NVM_DIR || join(homedir(), '.nvm')
  try {
    return newestFirst(readdirSync(join(root, 'versions', 'node'))).map((v) => join(root, 'versions', 'node', v, 'bin'))
  } catch {
    return []
  }
}

export const hasNvm = (): boolean => !WINDOWS && existsSync(process.env.NVM_DIR || join(homedir(), '.nvm'))

let cached: Promise<string> | null = null

async function work(): Promise<string> {
  const shell = await shellPath()
  return mergePaths(delimiter, shell, process.env.PATH, usualToolDirs(process.platform, homedir(), process.env).join(delimiter), nvmDirs().join(delimiter))
}

/** The PATH to run tools with. */
export function toolPath(): Promise<string> {
  cached ??= work()
  return cached
}

/** Where a tool is (npm, node…) on the tool PATH, or null when it isn't anywhere. */
export async function findTool(name: string): Promise<string | null> {
  const names = WINDOWS ? [`${name}.cmd`, `${name}.exe`, name] : [name]
  const look = (path: string): string | null => {
    for (const dir of path.split(delimiter)) for (const n of names) if (dir && existsSync(join(dir, n))) return join(dir, n)
    return null
  }
  const found = look(await toolPath())
  if (found) return found
  // Installed since Orbit looked (the person just followed "install Node.js"): look again.
  cached = null
  return look(await toolPath())
}

/** Orbit's environment with the tool PATH, for running npm. */
export async function toolEnv(extra: NodeJS.ProcessEnv = {}): Promise<NodeJS.ProcessEnv> {
  const path = await toolPath()
  // Windows spells it Path; set whichever is there so there aren't two.
  const key = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
  return { ...process.env, ...extra, [key]: path }
}
