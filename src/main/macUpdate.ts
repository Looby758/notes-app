import { execFile, spawn } from 'child_process'
import { createHash } from 'crypto'
import { accessSync, constants, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname, join, posix } from 'path'
import { promisify } from 'util'

/**
 * Orbit updating itself on a Mac, without a paid Apple certificate.
 *
 * electron-updater's own Mac installer (Squirrel.Mac) only accepts an update signed by the same
 * Apple Developer ID as the running app. Orbit is signed "ad hoc" (no certificate), so Squirrel
 * refuses every update. Instead Orbit does what Squirrel would have: downloads the zip the release
 * publishes for this kind of Mac, checks it against the SHA-512 in latest-mac.yml, unpacks it, and
 * once Orbit quits, a small script swaps the new copy in place of the old one (and reopens it if
 * you pressed Restart).
 *
 * Because Orbit downloads it itself (not a browser), the new copy never gets macOS's "downloaded
 * from the internet" mark (com.apple.quarantine), so Gatekeeper doesn't ask about it again. Orbit
 * also clears that mark from itself each time it opens, so once you've let it open the first
 * time, macOS stops asking.
 */

const run = promisify(execFile)

export interface ReleaseFile {
  url: string
  sha512: string
  size?: number
}

/** The zip in a release for this kind of Mac ("arm64" for Apple Silicon, "x64" for Intel). */
export function pickMacZip(files: ReleaseFile[], arch: string): ReleaseFile | undefined {
  const zips = files.filter((f) => /\.zip$/i.test(f.url))
  const name = (f: ReleaseFile): string => decodeURIComponent(f.url.split('/').pop() ?? '')
  // Named like Orbit-1.14.0-arm64-mac.zip. A universal or single-arch build has no arch in it.
  return (
    zips.find((f) => new RegExp(`[-_.]${arch}[-_.]`, 'i').test(name(f))) ??
    (arch === 'x64' ? zips.find((f) => !/arm64|universal/i.test(name(f))) : undefined) ??
    zips.find((f) => /universal/i.test(name(f)))
  )
}

/** Where to download a release file from: next to latest-mac.yml on GitHub, or on a test server. */
export function releaseFileUrl(file: string, version: string, repo: string, testFeed?: string): string {
  if (/^https?:\/\//i.test(file)) return file
  if (testFeed) return new URL(file, testFeed.endsWith('/') ? testFeed : `${testFeed}/`).toString()
  return `https://github.com/${repo}/releases/download/v${version}/${encodeURIComponent(file)}`
}

/** The .app folder Orbit is running from (…/Orbit.app/Contents/MacOS/Orbit → …/Orbit.app). */
export function appBundleOf(execPath: string): string | undefined {
  // A macOS path, so posix even when the tests run on Windows (resolve would add a drive letter).
  const bundle = posix.dirname(posix.dirname(posix.dirname(execPath)))
  return /\.app$/i.test(bundle) ? bundle : undefined
}

/**
 * Opened from the disk image or Downloads without being moved, macOS runs a hidden read-only copy
 * ("App Translocation"), which can't be updated or have its quarantine mark cleared.
 */
export function isTranslocated(bundle: string): boolean {
  return /\/AppTranslocation\//.test(bundle) || bundle.startsWith('/Volumes/')
}

/** Can Orbit replace its own .app folder? (It's yours when you dragged it into Applications.) */
export function canReplace(bundle: string): boolean {
  if (isTranslocated(bundle)) return false
  try {
    accessSync(bundle, constants.W_OK)
    accessSync(dirname(bundle), constants.W_OK)
    return true
  } catch {
    return false
  }
}

/** Removes macOS's "downloaded from the internet" mark, so Gatekeeper stops asking about Orbit. */
export async function clearQuarantine(bundle: string): Promise<boolean> {
  try {
    await run('/usr/bin/xattr', ['-p', 'com.apple.quarantine', bundle])
  } catch {
    return false // Not marked: nothing to do (the usual case, so the whole app isn't walked each launch).
  }
  try {
    await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', bundle])
    return true
  } catch {
    return false
  }
}

/** Downloads a file, checking its SHA-512 (base64, as in latest-mac.yml) on the way. */
export async function download(
  url: string,
  dest: string,
  sha512: string,
  onProgress: (percent: number) => void,
  fetcher: (url: string) => Promise<Response> = fetch
): Promise<void> {
  const res = await fetcher(url)
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}).`)
  const total = Number(res.headers.get('content-length')) || 0
  const hash = createHash('sha512')
  const out = createWriteStream(dest)
  let got = 0
  let shown = -1
  try {
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      hash.update(value)
      got += value.length
      if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()))
      const percent = total ? Math.min(99, Math.floor((got / total) * 100)) : 0
      if (percent !== shown) onProgress((shown = percent))
    }
  } finally {
    await new Promise<void>((r) => out.end(r))
  }
  if (hash.digest('base64') !== sha512) {
    rmSync(dest, { force: true })
    throw new Error('The download was damaged (its checksum didn’t match). Try again later.')
  }
}

/** Unpacks the zip (keeping the links inside the app), and checks the app inside is whole and the right version. */
export async function unpack(zip: string, into: string, version: string): Promise<string> {
  rmSync(into, { recursive: true, force: true })
  mkdirSync(into, { recursive: true })
  await run('/usr/bin/ditto', ['-x', '-k', zip, into])
  const name = readdirSync(into).find((n) => n.endsWith('.app'))
  if (!name) throw new Error('The update didn’t contain the app.')
  const app = join(into, name)
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app])
  const { stdout } = await run('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', join(app, 'Contents/Info.plist')])
  if (stdout.trim() !== version) throw new Error(`The update is version ${stdout.trim()}, not ${version}.`)
  await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', app]).catch(() => undefined)
  return app
}

/**
 * Waits for Orbit to quit, swaps the new copy in (putting the old one back if that fails), and
 * reopens it if asked. Writes "ok" or what went wrong to the result file, which Orbit reads next time.
 */
export const SWAP_SCRIPT = `#!/bin/sh
pid="$1"; target="$2"; fresh="$3"; relaunch="$4"; result="$5"
i=0
while kill -0 "$pid" 2>/dev/null; do
  sleep 0.2
  i=$((i + 1))
  if [ "$i" -gt 600 ]; then echo "Orbit didn't quit, so the update wasn't installed." > "$result"; exit 1; fi
done
old="$target.old-$$"
if mv "$target" "$old" 2>/dev/null; then
  if mv "$fresh" "$target" 2>/dev/null; then
    rm -rf "$old"
    echo ok > "$result"
  else
    mv "$old" "$target"
    echo "macOS didn't let Orbit put the new version in place." > "$result"
  fi
else
  echo "macOS didn't let Orbit replace itself." > "$result"
fi
xattr -dr com.apple.quarantine "$target" 2>/dev/null
if [ "$relaunch" = 1 ]; then open "$target"; fi
exit 0
`

/** Starts the swap script, which carries on after Orbit has quit. */
export function startSwap(work: string, target: string, fresh: string, relaunch: boolean, pid = process.pid): void {
  if (!/\.app$/i.test(target) || !/\.app$/i.test(fresh)) throw new Error('Not an app.')
  const script = join(work, 'swap.sh')
  writeFileSync(script, SWAP_SCRIPT, { mode: 0o755 })
  rmSync(resultFile(work), { force: true })
  spawn('/bin/sh', [script, String(pid), target, fresh, relaunch ? '1' : '0', resultFile(work)], {
    detached: true,
    stdio: 'ignore'
  }).unref()
}

export function resultFile(work: string): string {
  return join(work, 'last-install.txt')
}

/** What the last swap said ("ok", or what went wrong), once: the note is removed after reading. */
export function takeLastResult(work: string): string | undefined {
  const file = resultFile(work)
  if (!existsSync(file)) return undefined
  try {
    return readFileSync(file, 'utf8').trim() || undefined
  } finally {
    rmSync(file, { force: true })
  }
}
