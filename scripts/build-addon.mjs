// Builds an add-on that's a separate download (listed in addons/addons.json) into a .orbitaddon
// file, and writes its fingerprint into src/shared/addonPackages.json so Orbit asks for that file.
//
//   npm run build-addon -- mini-games      build it (addons/packages/<id>-<build>.orbitaddon)
//   npm run build-addon -- --all           build every one
//   npm run build-addon -- --check         fail if any add-on's code changed since it was last built
//
// The .orbitaddon file goes in addons/packages, which is committed: once it's merged into main,
// Orbit downloads it from there. Orbit only downloads the exact file whose fingerprint it has, so a
// changed add-on is a new file next to the old ones (old Orbits keep using theirs).
//
// The add-on's code is its entry plus whatever it reaches inside its own folders and files. Things
// Orbit lends it (src/shared/addonHostModules.json) are left out and come from Orbit when it runs.
// Anything else from Orbit's code it reaches stops the build, since a second copy of it would be
// out of step with Orbit's.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import JSZip from 'jszip'

const ROOT = resolve(fileURLToPath(import.meta.url), '../..')
const ADDONS = Object.fromEntries(Object.entries(JSON.parse(readFileSync(join(ROOT, 'addons/addons.json'), 'utf8'))).filter(([k]) => !k.startsWith('//')))
const HOST = JSON.parse(readFileSync(join(ROOT, 'src/shared/addonHostModules.json'), 'utf8')).modules
const CATALOG_FILE = join(ROOT, 'src/shared/addonPackages.json')
const OUT = join(ROOT, 'addons/packages')
const WORK = join(ROOT, 'dist-addons')
const API = Number(/ADDON_HOST_API = (\d+)/.exec(readFileSync(join(ROOT, 'src/shared/addonPackages.ts'), 'utf8'))[1])
/** Zips made at different times must come out the same, so every entry gets this date. */
const ZIP_DATE = new Date('2025-01-01T00:00:00Z')

const rel = (file) => relative(ROOT, file).split('\\').join('/')
const globalKey = (id) => id.replace(/[^a-zA-Z0-9]/g, '_')

/** Host modules by what an import resolves to: a package name, or a file in Orbit. */
const HOST_BY_ID = new Map(Object.entries(HOST).map(([key, mod]) => [mod.startsWith('src/') ? resolve(ROOT, mod) : mod, key]))

async function buildOne(id) {
  const spec = ADDONS[id]
  if (!spec) throw new Error(`No add-on called ${id} in addons/addons.json`)
  const own = spec.own.map((p) => resolve(ROOT, p) + (p.endsWith('/') ? '/' : ''))
  const isOwn = (file) => own.some((o) => (o.endsWith('/') ? file.startsWith(o) : file === o))
  const strays = new Set()
  const dir = join(WORK, id)
  rmSync(dir, { recursive: true, force: true })

  await build({
    root: ROOT,
    configFile: false,
    logLevel: 'warn',
    plugins: [
      react(),
      {
        name: 'orbit-addon-boundary',
        enforce: 'pre',
        async resolveId(source, importer, options) {
          if (!importer || source.startsWith('\0')) return null
          if (HOST_BY_ID.has(source)) return { id: source, external: true }
          const r = await this.resolve(source, importer, { ...options, skipSelf: true })
          if (!r || r.external) return r
          const file = r.id.split('?')[0]
          if (HOST_BY_ID.has(file)) return { id: file, external: true }
          if (file.startsWith(join(ROOT, 'src/')) && !isOwn(file) && !/\.css$/.test(file)) strays.add(`${rel(file)} (from ${rel(importer)})`)
          return r
        }
      }
    ],
    resolve: { alias: { '@shared': join(ROOT, 'src/shared'), '@renderer': join(ROOT, 'src/renderer/src') } },
    define: { 'process.env.NODE_ENV': '"production"' },
    build: {
      outDir: dir,
      emptyOutDir: true,
      minify: true,
      sourcemap: false,
      cssCodeSplit: false,
      lib: { entry: resolve(ROOT, spec.entry), formats: ['iife'], name: `__orbitAddon_${globalKey(id)}`, fileName: () => 'index.js', cssFileName: 'style' },
      rollupOptions: {
        external: (source) => HOST_BY_ID.has(source),
        output: {
          exports: 'named',
          globals: (source) => (HOST_BY_ID.has(source) ? `__orbitHost.${HOST_BY_ID.get(source)}` : undefined)
        }
      }
    }
  })

  if (strays.size) {
    throw new Error(
      `${id} uses parts of Orbit that aren't its own and that Orbit doesn't lend it. Add them to its "own" list in addons/addons.json (if only it uses them) or to src/shared/addonHostModules.json and lib/addonHost.ts:\n  ${[...strays].join('\n  ')}`
    )
  }

  const script = readFileSync(join(dir, 'index.js'))
  const style = existsSync(join(dir, 'style.css')) ? readFileSync(join(dir, 'style.css')) : null
  const buildId = createHash('sha256').update(script).update(style ?? '').update(String(API)).digest('hex').slice(0, 12)
  const manifest = { id, build: buildId, api: API, entry: 'index.js', ...(style ? { style: 'style.css' } : {}) }

  const zip = new JSZip()
  zip.file('manifest.json', JSON.stringify(manifest, null, 2), { date: ZIP_DATE })
  zip.file('index.js', script, { date: ZIP_DATE })
  if (style) zip.file('style.css', style, { date: ZIP_DATE })
  const data = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } })
  const file = `${id}-${buildId}.orbitaddon`
  if (!check) writeFileSync(join(OUT, file), data)
  return { build: buildId, file, sha256: createHash('sha256').update(data).digest('hex'), size: data.length }
}

const args = process.argv.slice(2)
const check = args.includes('--check')
const ids = args.includes('--all') || check ? Object.keys(ADDONS) : args.filter((a) => !a.startsWith('--'))
if (!ids.length) {
  console.error('Usage: npm run build-addon -- <id> | --all | --check')
  process.exit(1)
}
mkdirSync(OUT, { recursive: true })
mkdirSync(WORK, { recursive: true })
const catalog = JSON.parse(readFileSync(CATALOG_FILE, 'utf8'))
let stale = 0
for (const id of ids) {
  const pkg = await buildOne(id)
  const was = catalog[id]
  if (check) {
    if (was?.build !== pkg.build) {
      stale++
      console.error(`${id} changed since it was last built. Run: npm run build-addon -- ${id}, and commit what it makes.`)
    } else console.log(`${id} is up to date (${pkg.file}).`)
    continue
  }
  catalog[id] = pkg
  console.log(`${id}: addons/packages/${pkg.file} (${(pkg.size / 1024).toFixed(0)} KB). Commit it with src/shared/addonPackages.json.`)
}
if (!check) writeFileSync(CATALOG_FILE, JSON.stringify(catalog, null, 2) + '\n')
if (stale) process.exit(1)
