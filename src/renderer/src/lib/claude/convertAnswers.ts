import type { ExportData, SaveFormat } from '@shared/types'
import { convertFile, describeSize, kindOf, outputName, targetsFor, whyNot } from '../convert'
import { num, str, strs, type Answer, type Args } from './common'

/**
 * The file converter for Claude Desktop: what a file can become, and converting files, each saved
 * in the same folder as the original (never over another file). Videos need the video converter,
 * which the user downloads once from the Convert page.
 */

const nameOf = (path: string): string => path.split(/[\\/]/).pop() ?? path
let nextId = 900_000

function formatsFor(args: Args): string {
  const paths = strs(args.paths).length ? strs(args.paths) : [str(args.path)]
  return paths
    .map((p) => {
      const targets = targetsFor(nameOf(p))
      return `${p}: ${targets.length ? targets.map((t) => `${t.format} (${t.label})`).join(', ') : whyNot(nameOf(p))}`
    })
    .join('\n')
}

const sizeOf = (data: ExportData): number => (typeof data === 'string' ? new Blob([data]).size : data instanceof Uint8Array ? data.byteLength : data.size)

async function convertOne(path: string, format: SaveFormat, maxSide: number | null, videoHeight: number | null): Promise<string> {
  const name = nameOf(path)
  const kind = kindOf(name)
  if (!kind) throw new Error(whyNot(name))
  if (!targetsFor(name).some((t) => t.format === format)) throw new Error(`${name} can’t become ${format}. It can become: ${targetsFor(name).map((t) => t.format).join(', ')}.`)
  let data: ExportData
  if (kind === 'video') {
    const ff = await window.api.videoConverterStatus()
    if (ff.state !== 'ready') throw new Error(ff.state === 'unsupported' ? 'Videos can’t be converted on this computer.' : 'The video converter isn’t downloaded yet. The user can get it once on Orbit’s Convert page (the Get button), then ask again.')
    try {
      data = await window.api.convertVideo({ id: nextId++, path, format, maxHeight: videoHeight })
    } catch (err) {
      throw new Error(String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  } else {
    const bytes = await window.api.readForConvert(path)
    const file = new File([bytes as BlobPart], name)
    data = await convertFile(file, format, { id: nextId++, image: { maxSide, quality: 0.9 }, videoHeight })
  }
  const saved = await window.api.saveBeside(path, outputName(name, format, new Set()), data)
  return `${name} → ${saved} (${describeSize(sizeOf(data))})`
}

async function convertFor(args: Args): Promise<string> {
  const paths = strs(args.paths)
  if (!paths.length) throw new Error('Give the full path of each file to convert (find them with search_files or get_downloads).')
  const format = str(args.to).toLowerCase().replace(/^\./, '').replace('jpeg', 'jpg') as SaveFormat
  const maxSide = typeof args.max_size === 'number' ? Math.max(16, Math.round(num(args.max_size, 0))) : null
  const videoHeight = typeof args.video_height === 'number' ? Math.max(144, Math.round(num(args.video_height, 0))) : null
  const done: string[] = []
  const failed: string[] = []
  for (const p of paths.slice(0, 50)) {
    try {
      done.push(await convertOne(p, format, maxSide, videoHeight))
    } catch (err) {
      failed.push(`${p}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  if (!done.length) throw new Error(failed.join('\n'))
  return `Converted (each saved beside the original):\n${done.join('\n')}${failed.length ? `\n\nDidn’t convert:\n${failed.join('\n')}` : ''}`
}

export const CONVERT_ANSWERS: Record<string, Answer> = {
  convert_formats: formatsFor,
  convert_file: convertFor
}
