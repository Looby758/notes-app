import { createHash } from 'crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { addonById } from './addons'
import { ADDON_HOST_API, ADDON_PACKAGES, manifestProblem, packageFileName, safePackagePath } from './addonPackages'
import HOST from './addonHostModules.json'

const ROOT = resolve(__dirname, '../..')
const SPECS = Object.fromEntries(
  Object.entries(JSON.parse(readFileSync(join(ROOT, 'addons/addons.json'), 'utf8')) as Record<string, { entry: string; own: string[] }>).filter(([k]) => !k.startsWith('//'))
)

describe('add-on packages', () => {
  it('only lets plain paths inside the package through', () => {
    expect(safePackagePath('index.js')).toBe(true)
    expect(safePackagePath('assets/piece-1.svg')).toBe(true)
    for (const bad of ['', '../x.js', 'a/../../x', '/etc/passwd', 'a\\b.js', './x.js', 'a//b', 'x y.js', 'C:/x.js']) expect(safePackagePath(bad)).toBe(false)
  })

  it('checks a manifest is the add-on and build it should be', () => {
    const pkg = { build: 'abc123abc123', file: 'x-abc123abc123.orbitaddon', sha256: 'f'.repeat(64), size: 1 }
    const good = { id: 'x', build: 'abc123abc123', api: ADDON_HOST_API, entry: 'index.js', style: 'style.css' }
    expect(manifestProblem(good, 'x', pkg)).toBeNull()
    expect(manifestProblem({ ...good, id: 'y' }, 'x', pkg)).not.toBeNull()
    expect(manifestProblem({ ...good, build: 'other' }, 'x', pkg)).not.toBeNull()
    expect(manifestProblem({ ...good, api: ADDON_HOST_API + 1 }, 'x', pkg)).not.toBeNull()
    expect(manifestProblem({ ...good, entry: '../index.js' }, 'x', pkg)).not.toBeNull()
    expect(manifestProblem(null, 'x', pkg)).not.toBeNull()
  })

  it('lists only real add-ons, each built from addons/addons.json', () => {
    for (const [id, pkg] of Object.entries(ADDON_PACKAGES)) {
      expect(addonById(id), id).toBeTruthy()
      expect(SPECS[id], id).toBeTruthy()
      expect(pkg.file).toBe(packageFileName(id, pkg.build))
      expect(pkg.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(pkg.size).toBeGreaterThan(0)
      // Orbit downloads it from addons/packages on main, so it has to be committed.
      const file = join(ROOT, 'addons/packages', pkg.file)
      expect(existsSync(file), `${pkg.file} is missing from addons/packages`).toBe(true)
      expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(pkg.sha256)
    }
    for (const id of Object.keys(SPECS)) expect(ADDON_PACKAGES[id], `${id} hasn't been built (npm run build-addon -- ${id})`).toBeTruthy()
  })
})

/** Every import in the renderer's code, as files. */
function importsOf(file: string): string[] {
  const src = readFileSync(file, 'utf8')
  const out: string[] = []
  for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const spec = m[1] ?? m[2] ?? m[3]
    let target: string | null = null
    if (spec.startsWith('.')) target = resolve(file, '..', spec)
    else if (spec.startsWith('@shared/')) target = join(ROOT, 'src/shared', spec.slice(8))
    else if (spec.startsWith('@renderer/')) target = join(ROOT, 'src/renderer/src', spec.slice(10))
    if (target) out.push(target.replace(/\.(tsx?|css)$/, ''))
  }
  return out
}

function* codeFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) yield* codeFiles(full)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) yield full
  }
}

describe('downloadable add-ons stay out of Orbit', () => {
  // A downloadable add-on's own code mustn't also be part of Orbit: that would be a second copy,
  // and Orbit would still carry it.
  for (const [id, spec] of Object.entries(SPECS)) {
    it(`nothing in Orbit uses ${id}'s own code`, () => {
      const own = spec.own.map((p) => resolve(ROOT, p) + (p.endsWith('/') ? '/' : ''))
      const isOwn = (f: string): boolean => own.some((o) => (o.endsWith('/') ? f.startsWith(o) : f === o.replace(/\.tsx?$/, '')))
      const leaks: string[] = []
      for (const file of codeFiles(join(ROOT, 'src/renderer/src'))) {
        if (isOwn(file) || isOwn(file.replace(/\.tsx?$/, ''))) continue
        for (const target of importsOf(file)) if (isOwn(target)) leaks.push(`${file.slice(ROOT.length + 1)} → ${target.slice(ROOT.length + 1)}`)
      }
      expect(leaks).toEqual([])
    })
  }

  it('lends add-ons every module listed in addonHostModules.json', () => {
    const host = readFileSync(join(ROOT, 'src/renderer/src/lib/addonHost.ts'), 'utf8')
    const block = /HOST_MODULES[^{]*\{([^}]*)\}/.exec(host)?.[1] ?? ''
    const keys = [...block.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]).sort()
    expect(keys).toEqual(Object.keys(HOST.modules).sort())
  })
})
