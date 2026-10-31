import type { ConvertedFile, SaveFormat } from '@shared/types'

/**
 * Videos are converted by the ffmpeg program that comes with Orbit, outside the window, so even
 * long or large videos don't slow the app down or fill its memory. The result waits in a
 * temporary file until it's saved.
 */
export async function convertVideo(id: number, file: File, format: SaveFormat, maxHeight: number | null, onProgress?: (done: number) => void): Promise<ConvertedFile> {
  const path = window.api.pathForFile(file)
  if (!path) throw new Error('This video isn’t saved on this computer yet. Save it to a folder first, then add it again.')
  const stop = window.api.onVideoProgress((job, done) => job === id && onProgress?.(done))
  try {
    return await window.api.convertVideo({ id, path, format, maxHeight })
  } catch (err) {
    // Errors from the main process arrive as "Error invoking remote method …: Error: <message>".
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
  } finally {
    stop()
  }
}
