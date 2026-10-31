import type { ExportData, GifSettings, SaveFormat } from '@shared/types'
import { kindOf } from './formats'
import { convertImage, type ImageFormat, type ImageOptions } from './image'
import { convertAudio, type AudioFormat } from './audio'
import { convertDocument, type DocumentFormat } from './document'
import { convertVideo } from './video'

export * from './formats'
export * from './caption'
export type { ImageOptions }

/** Converts one file to `format`. */
export async function convertFile(file: File, format: SaveFormat, opts: { id: number; image: ImageOptions; videoHeight: number | null; gif?: GifSettings; onProgress?: (done: number) => void }): Promise<ExportData> {
  switch (kindOf(file.name)) {
    case 'image':
      return convertImage(file, format as ImageFormat, opts.image)
    case 'audio':
      return convertAudio(file, format as AudioFormat, opts.onProgress)
    case 'video':
      return convertVideo(opts.id, file, format, opts.videoHeight, opts.onProgress, format === 'gif' ? opts.gif : undefined)
    case 'document':
      return convertDocument(file, format as DocumentFormat)
    default:
      throw new Error('This kind of file can’t be converted.')
  }
}
