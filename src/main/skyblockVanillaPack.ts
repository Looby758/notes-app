import { app, BrowserWindow, dialog, nativeImage } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { basename, extname, join, relative, sep } from 'path'
import JSZip from 'jszip'
import { CUSTOM_PACK, isoCube, pickTexture, type Pixels, type VanillaNames } from '@shared/skyblockTextures'
import NAMES from '@shared/skyblockVanillaNames.json'
import { addonPath, customPack, picturesChanged, skyblockAddonReady, writeJson } from './skyblockAddonFiles'

/**
 * Your own Minecraft pack under the SkyBlock packs: where the SkyBlock packs (and Hypixel's) have no
 * picture for an item, it's drawn from your pack instead of plain Minecraft. Takes a resource pack
 * .zip or folder (1.8 to current), and saves the pictures it has as textures/custom/<name>.png.
 */

const names = NAMES as VanillaNames
const MAX_PACK_BYTES = 1024 ** 3
const MAX_TEXTURE_WIDTH = 512

/** Reads a texture's bytes on demand, by its name under assets/minecraft/textures ("item/golden_sword"). */
type Source = Map<string, () => Promise<Buffer>>

async function zipSource(file: string): Promise<{ textures: Source; name: string }> {
  if (statSync(file).size > MAX_PACK_BYTES) throw new Error('That pack is over 1 GB, which is too big to be a Minecraft pack.')
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(readFileSync(file))
  } catch {
    throw new Error('That file isn’t a .zip Orbit can open.')
  }
  const textures: Source = new Map()
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue
    const m = /(?:^|\/)assets\/minecraft\/textures\/(.+)\.png$/i.exec(entry.name)
    if (m && !textures.has(m[1].toLowerCase())) textures.set(m[1].toLowerCase(), () => entry.async('nodebuffer'))
  }
  return { textures, name: basename(file, extname(file)) }
}

function folderSource(dir: string): { textures: Source; name: string } {
  const textures: Source = new Map()
  let seen = 0
  const walk = (d: string, depth: number): void => {
    if (depth > 12 || seen > 200_000) return
    for (const e of readdirSync(d, { withFileTypes: true })) {
      seen++
      const full = join(d, e.name)
      if (e.isDirectory()) walk(full, depth + 1)
      else if (e.isFile()) {
        const m = /(?:^|\/)assets\/minecraft\/textures\/(.+)\.png$/i.exec(relative(dir, full).split(sep).join('/'))
        if (m && !textures.has(m[1].toLowerCase())) textures.set(m[1].toLowerCase(), async () => readFileSync(full))
      }
    }
  }
  walk(dir, 0)
  return { textures, name: basename(dir) }
}

/** A PNG as pixels, cut to its first frame if it's an animation strip. */
function decode(png: Buffer): Pixels | null {
  const img = nativeImage.createFromBuffer(png)
  if (img.isEmpty()) return null
  const { width, height } = img.getSize()
  if (width > MAX_TEXTURE_WIDTH) return null
  const frame = height > width ? img.crop({ x: 0, y: 0, width, height: width }) : img
  const size = frame.getSize()
  return { width: size.width, height: size.height, data: new Uint8Array(frame.toBitmap()) }
}

const encode = (p: Pixels): Buffer => nativeImage.createFromBitmap(Buffer.from(p.data), { width: p.width, height: p.height }).toPNG()

async function importPack(src: { textures: Source; name: string }): Promise<number> {
  if (!src.textures.size) throw new Error('That doesn’t look like a Minecraft pack: it has no pictures in assets/minecraft/textures.')
  const tmp = addonPath('textures', `${CUSTOM_PACK}.new`)
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  const files: string[] = []
  const pixels = async (read: (() => Promise<Buffer>) | undefined): Promise<Pixels | null> => {
    if (!read) return null
    try {
      return decode(await read())
    } catch {
      return null
    }
  }
  try {
    for (const [t, candidates] of Object.entries(names.items)) {
      const pic = await pixels(pickTexture(candidates, src.textures))
      if (!pic) continue
      writeFileSync(join(tmp, `${t}.png`), encode(pic))
      files.push(t)
    }
    for (const [t, faces] of Object.entries(names.cubes)) {
      const top = await pixels(pickTexture(faces.top, src.textures))
      if (!top) continue
      const front = (await pixels(pickTexture(faces.front, src.textures))) ?? top
      const side = (await pixels(pickTexture(faces.side, src.textures))) ?? front
      writeFileSync(join(tmp, `${t}.png`), encode(isoCube(top, front, side)))
      files.push(t)
    }
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true })
    throw err
  }
  if (!files.length) {
    rmSync(tmp, { recursive: true, force: true })
    throw new Error('That pack doesn’t change any of the Minecraft pictures Orbit uses.')
  }
  rmSync(addonPath('textures', CUSTOM_PACK), { recursive: true, force: true })
  renameSync(tmp, addonPath('textures', CUSTOM_PACK))
  writeJson(addonPath('custom.json'), { name: src.name, files, at: Date.now() })
  picturesChanged()
  return files.length
}

/** Use your own pack, from a .zip or folder path. */
export async function useVanillaPack(path: string): Promise<number> {
  if (!skyblockAddonReady()) throw new Error('Get the SkyBlock add-on first.')
  let isDir: boolean
  try {
    isDir = statSync(path).isDirectory()
  } catch {
    throw new Error('That pack isn’t there any more.')
  }
  return importPack(isDir ? folderSource(path) : await zipSource(path))
}

/** Back to plain Minecraft's pictures. */
export function clearVanillaPack(): void {
  rmSync(addonPath('textures', CUSTOM_PACK), { recursive: true, force: true })
  rmSync(addonPath('custom.json'), { force: true })
  picturesChanged()
}

/** Asks for a pack (.zip, or a folder) and uses it. False if nothing was picked. */
export async function pickVanillaPack(win: BrowserWindow | null, folder: boolean): Promise<boolean> {
  const options: Electron.OpenDialogOptions = folder
    ? { title: 'Choose a Minecraft resource pack folder', properties: ['openDirectory'] }
    : { title: 'Choose a Minecraft resource pack', properties: ['openFile'], filters: [{ name: 'Resource packs', extensions: ['zip'] }] }
  const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (picked.canceled || !picked.filePaths[0]) return false
  await useVanillaPack(picked.filePaths[0])
  return true
}

/** Minecraft's own resource pack folders on this computer (the official launcher's). */
export function minecraftPackFolders(): string[] {
  const home = app.getPath('home')
  const candidates =
    process.platform === 'win32'
      ? [join(app.getPath('appData'), '.minecraft', 'resourcepacks')]
      : process.platform === 'darwin'
        ? [join(home, 'Library', 'Application Support', 'minecraft', 'resourcepacks')]
        : [join(home, '.minecraft', 'resourcepacks')]
  return candidates.filter((d) => existsSync(d))
}

export const vanillaPackInfo = (): { name: string; pictures: number } | null => {
  const c = customPack()
  return c ? { name: c.name, pictures: c.files.length } : null
}
