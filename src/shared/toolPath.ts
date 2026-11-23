/**
 * Finding command-line tools (npm, node) the way the Terminal app would. A Mac app opened from the
 * Dock or Finder doesn't get the PATH your shell sets up, so npm from Homebrew, nvm, fnm or Volta
 * isn't found even when it's installed. These are the pure parts, tested without a shell.
 */

/** The places Node.js usually ends up, besides what PATH says. `home` is the user's home folder. */
export function usualToolDirs(platform: string, home: string, env: Record<string, string | undefined> = {}): string[] {
  if (platform === 'win32') {
    return [env.ProgramFiles && `${env.ProgramFiles}\\nodejs`, env['ProgramFiles(x86)'] && `${env['ProgramFiles(x86)']}\\nodejs`, env.APPDATA && `${env.APPDATA}\\npm`, env.NVM_SYMLINK, env.VOLTA_HOME && `${env.VOLTA_HOME}\\bin`].filter(
      (d): d is string => !!d
    )
  }
  return [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    `${home}/.volta/bin`,
    `${home}/.fnm/aliases/default/bin`,
    `${home}/.local/share/fnm/aliases/default/bin`,
    `${home}/.nodenv/shims`,
    `${home}/.asdf/shims`,
    `${home}/.local/bin`,
    '/usr/bin',
    '/bin'
  ]
}

/** PATH lists joined, keeping the first of each folder and leaving out blanks. */
export function mergePaths(sep: string, ...lists: (string | undefined | null)[]): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const list of lists) {
    for (const dir of (list ?? '').split(sep)) {
      const d = dir.trim()
      if (d && !seen.has(d)) {
        seen.add(d)
        out.push(d)
      }
    }
  }
  return out.join(sep)
}

/** The PATH a login shell printed between markers (shells can print other things as they start). */
export function pathFromShellOutput(out: string, marker = '__ORBIT_PATH__'): string | null {
  const m = new RegExp(`${marker}(.*?)${marker}`, 's').exec(out)
  return m && m[1].trim() ? m[1].trim() : null
}

/**
 * nvm's installed versions ("v20.11.0", "v22.3.1"…), newest first, so its npm can be found
 * even when the shell didn't say which one is in use.
 */
export function newestFirst(versions: string[]): string[] {
  const n = (v: string): number[] => v.replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0)
  return versions
    .filter((v) => /^v?\d+\.\d+\.\d+$/.test(v))
    .sort((a, b) => {
      const [x, y] = [n(a), n(b)]
      return y[0] - x[0] || y[1] - x[1] || y[2] - x[2]
    })
}

/** What to say when npm can't be found anywhere, by computer. */
export function npmMissingText(platform: string, hint: { nvm?: boolean } = {}): string {
  if (hint.nvm)
    return 'Node.js is set up with nvm, but no version is chosen as the default, so Orbit can’t find npm. In the Terminal, run nvm alias default node, then check again.'
  if (platform === 'darwin')
    return 'Orbit couldn’t find npm on this Mac (it looked in Homebrew, nvm, Volta, fnm and your Terminal’s settings). npm comes with Node.js: install it from nodejs.org, or run brew install node in the Terminal, then check again.'
  if (platform === 'win32') return 'Orbit couldn’t find npm on this PC. npm comes with Node.js: install it from nodejs.org, then check again.'
  return 'Orbit couldn’t find npm on this computer. npm comes with Node.js: install it (from nodejs.org or your package manager), then check again.'
}
