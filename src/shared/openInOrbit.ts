/**
 * What the Windows installer's "Open in Orbit" right-click item starts Orbit with:
 * `--open-in-orbit="C:\\…\\film.mkv"`. (One argument, so it survives Chromium reordering a
 * second copy's command line before handing it over.)
 */
export const OPEN_FLAG = '--open-in-orbit'

/** The files on a command line. */
export function pathsFromArgv(argv: string[]): string[] {
  const out: string[] = []
  argv.forEach((a, i) => {
    if (a.startsWith(`${OPEN_FLAG}=`)) {
      const path = a.slice(OPEN_FLAG.length + 1).replace(/^"(.*)"$/, '$1')
      if (path) out.push(path)
    } else if (a === OPEN_FLAG && argv[i + 1] && !argv[i + 1].startsWith('--')) out.push(argv[i + 1])
  })
  return out
}
