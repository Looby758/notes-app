import type { SaveFormat } from '@shared/types'
import { kindOf } from './formats'
import { convertImage, type ImageFormat, type ImageOptions } from './image'
import { convertAudio, type AudioFormat } from './audio'
import { convertDocument, type DocumentFormat } from './document'

export * from './formats'
export type { ImageOptions }

/** Converts one file to `format`. */
export async function convertFile(file: File, format: SaveFormat, opts: { image: ImageOptions; onProgress?: (done: number) => void }): Promise<Uint8Array | string> {
  switch (kindOf(file.name)) {
    case 'image':
      return convertImage(file, format as ImageFormat, opts.image)
    case 'audio':
      return convertAudio(file, format as AudioFormat, opts.onProgress)
    case 'document':
      return convertDocument(file, format as DocumentFormat)
    default:
      throw new Error('This kind of file can’t be converted.')
  }
}
