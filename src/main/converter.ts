import { ipcMain } from 'electron'

/**
 * The file converter's one job here: reading iPhone photos (HEIC). The decoder is loaded the first
 * time it's needed, so it costs nothing until then. Everything else converts in the window.
 */

interface HeifImage {
  get_width(): number
  get_height(): number
  is_primary(): boolean
  display(target: { data: Uint8ClampedArray; width: number; height: number }, done: (result: unknown) => void): void
  free(): void
}
interface Libheif {
  HeifDecoder: new () => { decode(data: Uint8Array): HeifImage[] }
}

let libheif: Promise<Libheif> | null = null

async function decodeHeic(data: Uint8Array): Promise<{ width: number; height: number; data: Uint8Array }> {
  libheif ??= import('libheif-js/libheif-wasm/libheif-bundle.mjs').then((m) => (m.default as () => Libheif)())
  const images = new (await libheif).HeifDecoder().decode(new Uint8Array(data))
  // A HEIC can hold several pictures (bursts, depth maps); the main one is the photo.
  const image = images.find((i) => i.is_primary()) ?? images[0]
  if (!image) throw new Error('This doesn’t look like a HEIC photo.')
  try {
    const width = image.get_width()
    const height = image.get_height()
    const pixels = new Uint8ClampedArray(width * height * 4)
    await new Promise<void>((resolve, reject) =>
      image.display({ data: pixels, width, height }, (result) => (result ? resolve() : reject(new Error('The photo couldn’t be read.'))))
    )
    return { width, height, data: new Uint8Array(pixels.buffer) }
  } finally {
    for (const i of images) i.free()
  }
}

export function setupConverter(): void {
  ipcMain.handle('convert:heic', (_e, data: Uint8Array) => decodeHeic(data))
}
