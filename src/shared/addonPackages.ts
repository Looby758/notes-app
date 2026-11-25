import packages from './addonPackages.json'

/**
 * Add-ons that are separate downloads rather than part of Orbit (the first step of the add-on
 * store). Each one is a .orbitaddon file (a zip of the add-on's code, built by
 * scripts/build-addon.mjs) kept in the repository's addons/packages folder. This Orbit asks for the exact
 * file listed in addonPackages.json and checks its fingerprint (SHA-256) before using it, so a
 * changed or broken download is never run.
 */

export interface AddonPackage {
  /** A fingerprint of the add-on's code (12 hex); a new build of it is a new package. */
  build: string
  /** The file's name on the release: `<id>-<build>.orbitaddon`. */
  file: string
  /** The whole file's SHA-256, checked before anything in it is used. */
  sha256: string
  /** In bytes, for "1.2 MB to download". */
  size: number
}

/** What a package's manifest.json holds. */
export interface AddonManifest {
  id: string
  /** The fingerprint of its code, the same as its catalog entry's. */
  build: string
  /** Which add-on host it was built for (ADDON_HOST_API); a different one isn't loaded. */
  api: number
  /** The script, relative to the package. */
  entry: string
  /** Its styles, if it has any. */
  style?: string
}

/** Bumped when what Orbit lends add-ons (addonHostModules.json) changes in a way old builds can't use. */
export const ADDON_HOST_API = 1

export const ADDON_PACKAGES: Readonly<Record<string, AddonPackage>> = packages as Record<string, AddonPackage>

/** Built packages live in the repository (addons/packages), so merging a new one is all it takes to publish it. */
export const ADDON_RELEASE_URL = 'https://raw.githubusercontent.com/Looby758/notes-app/main/addons/packages/'

/** Downloaded add-ons are served to the window from orbit-addon://<id>/<file>. */
export const ADDON_SCHEME = 'orbit-addon'

export const isDownloadable = (id: string): boolean => id in ADDON_PACKAGES

export const packageFileName = (id: string, build: string): string => `${id}-${build}.orbitaddon`

/** The global a downloaded add-on's script puts its exports in. */
export const addonGlobal = (id: string): string => `__orbitAddon_${id.replace(/[^a-zA-Z0-9]/g, '_')}`

/**
 * Whether a path inside a package is one Orbit will write out: plain relative paths of letters,
 * digits, dots, dashes and underscores, never leaving the folder.
 */
export function safePackagePath(path: string): boolean {
  if (!path || path.length > 200 || path.startsWith('/') || path.includes('\\')) return false
  return path.split('/').every((part) => /^[A-Za-z0-9_.-]+$/.test(part) && part !== '.' && part !== '..')
}

/** Checks a package's manifest against the add-on and catalog entry it's meant to be. */
export function manifestProblem(m: unknown, id: string, pkg: AddonPackage): string | null {
  if (!m || typeof m !== 'object') return 'no manifest'
  const man = m as Partial<AddonManifest>
  if (man.id !== id) return 'it’s a different add-on'
  if (man.build !== pkg.build) return 'it’s a different build'
  if (man.api !== ADDON_HOST_API) return 'it was made for a different Orbit'
  if (typeof man.entry !== 'string' || !safePackagePath(man.entry)) return 'it has no script'
  if (man.style !== undefined && (typeof man.style !== 'string' || !safePackagePath(man.style))) return 'its styles are missing'
  return null
}

/** The state of an add-on's download, for the window. */
export type AddonFileState =
  | { state: 'missing' }
  | { state: 'downloading'; received: number; total: number }
  | { state: 'ready' }
  | { state: 'failed'; error: string }
