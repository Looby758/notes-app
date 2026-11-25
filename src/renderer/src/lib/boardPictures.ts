import { vaultUrl } from './fileKinds'

/** Turns a picture from the notes folder (a screenshot, or a sketch's SVG) into a PNG for the clipboard. */
export async function pictureAsPng(path: string): Promise<Blob> {
  const blob = await (await fetch(vaultUrl(path))).blob()
  if (blob.type === 'image/png') return blob
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth || 1200
    canvas.height = img.naturalHeight || 800
    const ctx = canvas.getContext('2d')!
    // Sketches are drawn on a see-through page; Claude sees them better on white.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const png = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
    if (!png) throw new Error('Couldn’t copy that picture.')
    return png
  } finally {
    URL.revokeObjectURL(url)
  }
}
