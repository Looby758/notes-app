import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync } from 'fs'
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

/** Where the extra language readers (screen snip → Translate) are downloaded to; see snip.ts. */
export const ocrLangDir = (): string => join(app.getPath('userData'), 'ocr-langs')

const engPath = (): string => unpacked(join(dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int'))

// One reader at a time: English, or English plus one downloaded language ("jpn+eng").
let loading: Promise<Worker> | null = null
let loadedLangs = 'eng'
let idleTimer: ReturnType<typeof setTimeout> | undefined

/** Started when first needed (a second or two), stopped after a while unused to free its memory. */
function worker(langs = 'eng'): Promise<Worker> {
  if (loading && loadedLangs !== langs) {
    const old = loading
    loading = null
    void old.then((w) => w.terminate()).catch(() => {})
  }
  if (!loading) {
    let langPath = engPath()
    if (langs !== 'eng') {
      // Tesseract reads every language from one folder, so English goes next to the downloaded one.
      langPath = ocrLangDir()
      mkdirSync(langPath, { recursive: true })
      const eng = join(langPath, 'eng.traineddata.gz')
      if (!existsSync(eng)) copyFileSync(join(engPath(), 'eng.traineddata.gz'), eng)
    }
    loadedLangs = langs
    loading = createWorker(langs, OEM.LSTM_ONLY, {
      workerPath: unpacked(require.resolve('tesseract.js/src/worker-script/node/index.js')),
      langPath,
      gzip: true,
      // The model is read from disk, so there's nothing to keep a copy of.
      cacheMethod: 'none'
    }).catch((err) => {
      loading = null
      throw err
    })
  }
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    const done = loading
    loading = null
    void done?.then((w) => w.terminate()).catch(() => {})
  }, 5 * 60_000)
  return loading
}

// Which alphabet a picture is in (Tesseract's "orientation and script" model, shipped with the
// app, 4 MB), so the snip can pick a language reader by itself. Its own worker, as it needs
// Tesseract's older engine.
let osd: Promise<Worker> | null = null
let osdIdle: ReturnType<typeof setTimeout> | undefined

function osdWorker(): Promise<Worker> {
  osd ??= createWorker('osd', OEM.TESSERACT_ONLY, {
    workerPath: unpacked(require.resolve('tesseract.js/src/worker-script/node/index.js')),
    langPath: unpacked(join(dirname(require.resolve('@tesseract.js-data/osd/package.json')), '4.0.0_best_int')),
    gzip: true,
    cacheMethod: 'none',
    legacyCore: true,
    legacyLang: true
  }).catch((err) => {
    osd = null
    throw err
  })
  clearTimeout(osdIdle)
  osdIdle = setTimeout(() => {
    const done = osd
    osd = null
    void done?.then((w) => w.terminate()).catch(() => {})
  }, 5 * 60_000)
  return osd
}

/** The alphabet ("Latin", "Japanese", "Han", "Cyrillic"…) of the text in a picture, or null if it can't tell. */
export async function detectScript(image: Uint8Array): Promise<string | null> {
  try {
    const w = await osdWorker()
    const r = await Promise.race([w.detect(Buffer.from(image)), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('took too long')), 20_000))])
    return r.data.script || null
  } catch (err) {
    // "Too few characters" and the like: just not sure.
    logError('snip script', err)
    return null
  }
}

// A worker that fails to start never answers, so don't wait for ever.
const TIMEOUT = 90_000

/** The raw text Tesseract reads in a picture (a sketch, a scanned receipt). */
async function recognize(image: Uint8Array, langs = 'eng'): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const read = worker(langs).then((w) => w.recognize(Buffer.from(image)))
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
export async function readPrintedText(image: Uint8Array, langs = 'eng'): Promise<string> {
  try {
    return await recognize(image, langs)
  } catch (err) {
    logError('scan text', err)
    return ''
  }
}
