import { dirname, join } from 'path'
import { createWorker, OEM, type Worker } from 'tesseract.js'
import { cleanReading } from '@shared/handwriting'
import { logError } from './log'

/**
 * Reading handwriting offline, with Tesseract (the open-source text reader) and its English
 * model, both shipped with the app, so nothing leaves this computer. It's made for printed text,
 * so neat letters read well and joined-up writing less so; the AI helper is the other option.
 */

// Tesseract runs in a worker thread, which can't load files from inside app.asar, so its
// packages are unpacked next to it (electron-builder.yml) and loaded from there.
const unpacked = (path: string): string => path.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')

let loading: Promise<Worker> | null = null
let idleTimer: ReturnType<typeof setTimeout> | undefined

/** Started when first needed (a second or two), stopped after a while unused to free its memory. */
function worker(): Promise<Worker> {
  loading ??= createWorker('eng', OEM.LSTM_ONLY, {
    workerPath: unpacked(require.resolve('tesseract.js/src/worker-script/node/index.js')),
    langPath: unpacked(join(dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int')),
    gzip: true,
    // The model is read from the app itself, so there's nothing to keep a copy of.
    cacheMethod: 'none'
  }).catch((err) => {
    loading = null
    throw err
  })
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    const done = loading
    loading = null
    void done?.then((w) => w.terminate()).catch(() => {})
  }, 5 * 60_000)
  return loading
}

// A worker that fails to start never answers, so don't wait for ever.
const TIMEOUT = 90_000

/** The raw text Tesseract reads in a picture (a sketch, a scanned receipt). */
async function recognize(image: Uint8Array): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const read = worker().then((w) => w.recognize(Buffer.from(image)))
    const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error('Tesseract took too long')), TIMEOUT)))
    return (await Promise.race([read, late])).data.text
  } catch (err) {
    loading = null
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export async function readHandwritingOffline(png: Uint8Array): Promise<string> {
  let text: string
  try {
    text = cleanReading(await recognize(png))
  } catch (err) {
    logError('handwriting', err)
    throw new Error('The offline reader couldn’t read this sketch. Try again, or use the AI helper.')
  }
  if (!text) throw new Error('No writing was found. Try writing larger and more clearly, or use the AI helper.')
  return text
}

/** The printed text in a photo (a receipt from the phone scanner); '' if it can't be read. */
export async function readPrintedText(image: Uint8Array): Promise<string> {
  try {
    return await recognize(image)
  } catch (err) {
    logError('scan text', err)
    return ''
  }
}
