/**
 * Offline translate for the screen snip: the offline AI (see localAi.ts) turns the snipped text
 * into another language, on this computer. Nothing here goes online by itself; Google Translate
 * is only used when you press its button.
 *
 * The text reader (Tesseract) only comes with English. Text in other alphabets (Japanese,
 * Russian…) needs that language's reader too: a small one-off download (under 3 MB each),
 * fetched only when you ask for it, and checked against the size and SHA-256 below.
 * This file is plain data and text handling (no Electron), so it can be tested.
 */

/** Languages the offline AI can translate into. */
export const TRANSLATE_TARGETS = [
  'English',
  'Spanish',
  'French',
  'German',
  'Italian',
  'Portuguese',
  'Dutch',
  'Polish',
  'Turkish',
  'Russian',
  'Ukrainian',
  'Greek',
  'Arabic',
  'Hebrew',
  'Hindi',
  'Thai',
  'Vietnamese',
  'Japanese',
  'Chinese',
  'Korean'
] as const

export const DEFAULT_TARGET = 'English'

const GOOGLE_CODES: Record<string, string> = {
  English: 'en', Spanish: 'es', French: 'fr', German: 'de', Italian: 'it', Portuguese: 'pt', Dutch: 'nl', Polish: 'pl', Turkish: 'tr', Russian: 'ru',
  Ukrainian: 'uk', Greek: 'el', Arabic: 'ar', Hebrew: 'iw', Hindi: 'hi', Thai: 'th', Vietnamese: 'vi', Japanese: 'ja', Chinese: 'zh-CN', Korean: 'ko'
}

/** Google Translate's page for this text: used only when you press "Translate online". */
export const onlineTranslateUrl = (text: string, target: string): string =>
  `https://translate.google.com/?sl=auto&tl=${GOOGLE_CODES[target] ?? 'en'}&op=translate&text=${encodeURIComponent(text.slice(0, 4000))}`

export const isTarget = (s: unknown): s is string => typeof s === 'string' && (TRANSLATE_TARGETS as readonly string[]).includes(s)

/** A reader for one language (Tesseract's "best_int" model from the tesseract.js-data packages). */
export interface OcrLang {
  code: string
  name: string
  bytes: number
  sha256: string
}

/** English (and anything in plain Latin letters) is built in; these are the extra readers. */
export const OCR_LANGS: OcrLang[] = [
  { code: 'jpn', name: 'Japanese', bytes: 2030256, sha256: '2b63ebfbf1484de4a08ce53b29ef98a1c17658a93cbd38acb665d7d316d0be88' },
  { code: 'chi_sim', name: 'Chinese (simplified)', bytes: 1718768, sha256: 'b8a23f10c7de500891eb458a8adc9cc58ab7f242f08b7d149f5e9aea4ad5db7c' },
  { code: 'chi_tra', name: 'Chinese (traditional)', bytes: 1656239, sha256: '11fe2610dab05d8a880d02f193ce70203f4c4bbe061b987d5529a2c038a22743' },
  { code: 'kor', name: 'Korean', bytes: 1572336, sha256: '78c21276ab14c9bb734d83be1055d9fe5469a4e7e977c51ad385be5737e61126' },
  { code: 'rus', name: 'Russian', bytes: 2679598, sha256: 'f51f5edc992249ff9b70a227b22f242dfa47b2b1bbc7ae0ea74908640c101f6a' },
  { code: 'ukr', name: 'Ukrainian', bytes: 2114206, sha256: 'ea2789a0ad99ff84bfd252a7410a1e8661a7bc5acaa41573d23b54b71446aa4c' },
  { code: 'ell', name: 'Greek', bytes: 1324749, sha256: 'e8a293abb398ec479176c1575aef24e2bacb0611c713f3fa996f97f0cd996fb3' },
  { code: 'ara', name: 'Arabic', bytes: 1661906, sha256: 'f4746c44b02342dd5b3d4f0198000f47d7c49f1a229e63e0f436c0592dcd9639' },
  { code: 'heb', name: 'Hebrew', bytes: 580576, sha256: '9c70b524200dae77fb25e3567566eee600ccbcae9aeb89722990ccae0e84e805' },
  { code: 'hin', name: 'Hindi', bytes: 1389692, sha256: 'f3b6a0d320df38d886178cdd727b90dbf9df3db053adb32bd9cf73f0463cda07' },
  { code: 'tha', name: 'Thai', bytes: 896631, sha256: '4550a5505184d1b79cf10416d5b19e643001d95411d5e717954dd26feef3ae74' },
  { code: 'vie', name: 'Vietnamese', bytes: 1423003, sha256: '2284f610f262a1b19ec8df9f196b9ff6ce38ddb4a66329e998941df4b8961c8d' },
  { code: 'spa', name: 'Spanish', bytes: 2100190, sha256: '40be52f97b5d4eb7460073dc1f94cd546b27150333c0bf854ed7e7132db6bceb' },
  { code: 'fra', name: 'French', bytes: 707406, sha256: 'd611139672b3752c7097e671e4a1d9209dfd37f2aeb081ef6487fba3351e9255' },
  { code: 'deu', name: 'German', bytes: 1333102, sha256: '306c4280d0cbed46fbff727486bd43b92730181bae80f56941a091f363bdf28b' },
  { code: 'ita', name: 'Italian', bytes: 1660998, sha256: 'f702fcfad297ce028ede3626d1467b67939f23ff23595f9badd54681cf25a4d3' },
  { code: 'por', name: 'Portuguese', bytes: 1392239, sha256: 'dacebc1386ddaaf8389f81094236cca0d690897cde693d48cbdaa881c86e2b4c' },
  { code: 'nld', name: 'Dutch', bytes: 3005696, sha256: 'a2d904b6ddc4feb0d31ecfcd7361a554102e7aa2e278c54f4fc029e0d0815571' },
  { code: 'pol', name: 'Polish', bytes: 2642356, sha256: 'a20fdec4ff99d8f8e84c708da3e42a4e935c26863055a0ed88aef5c66a59b91b' },
  { code: 'tur', name: 'Turkish', bytes: 2141291, sha256: '384ba0dc28040451b7818d7d60e0a88df0d3003fa5a01d713a468779bc3d8c04' }
]

export const ocrLangByCode = (code: unknown): OcrLang | undefined => OCR_LANGS.find((l) => l.code === code)

/**
 * "Detect automatically": which reader to use for the alphabet Tesseract spotted. `use` is the
 * reader to read with ('' for the built-in English one); `need` is the readers that would do,
 * best first, when none of them is downloaded yet. Latin letters need nothing extra: the offline
 * AI works out which language they are when it translates.
 */
export function readerForScript(script: string | null, have: string[]): { use: string; need: string[]; name: string } {
  const pick = (name: string, codes: string[]): { use: string; need: string[]; name: string } => {
    const got = codes.find((c) => have.includes(c))
    return got ? { use: got, need: [], name } : { use: '', need: codes, name }
  }
  switch (script) {
    case 'Japanese':
    case 'Hiragana':
    case 'Katakana':
      return pick('Japanese', ['jpn'])
    // Kanji on their own look the same as Chinese, so a reader you already have wins.
    case 'Han':
      return pick('Japanese or Chinese', ['jpn', 'chi_sim', 'chi_tra'])
    case 'Hangul':
    case 'Korean':
      return pick('Korean', ['kor'])
    case 'Cyrillic':
      return pick('Russian or Ukrainian', ['rus', 'ukr'])
    case 'Greek':
      return pick('Greek', ['ell'])
    case 'Arabic':
      return pick('Arabic', ['ara'])
    case 'Hebrew':
      return pick('Hebrew', ['heb'])
    case 'Devanagari':
      return pick('Hindi', ['hin'])
    case 'Thai':
      return pick('Thai', ['tha'])
    default:
      return { use: '', need: [], name: script === 'Latin' ? 'Latin letters' : '' }
  }
}

/** Where a reader is downloaded from (jsDelivr's copy of the tesseract.js-data package, pinned to its version). */
export const ocrLangUrl = (l: OcrLang): string => `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${l.code}@1.0.0/4.0.0_best_int/${l.code}.traineddata.gz`

/** Tesseract's language setting: English plus the extra reader, so English words mixed in still read. */
export const ocrLangSetting = (code: string | undefined): string => {
  const l = ocrLangByCode(code)
  return l ? `${l.code}+eng` : 'eng'
}

/** "2.0 MB" for the download button. */
export const megabytes = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`

/**
 * Tesseract puts spaces between Chinese and Japanese characters (it reads them as words);
 * they'd only confuse the translation and the copy.
 */
export function tidyReading(text: string, code: string | undefined): string {
  let t = text.replace(/[ \t]+\n/g, '\n').trim()
  if (code === 'jpn' || code === 'chi_sim' || code === 'chi_tra') {
    const cjk = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}ー、。「」！？（）・'
    t = t.replace(new RegExp(`([${cjk}]) +(?=[${cjk}])`, 'gu'), '$1')
  }
  return t
}

/** The longest snip the offline AI is asked to translate in one go (it reads ~30,000 characters). */
export const TRANSLATE_MAX_CHARS = 8000

export const TRANSLATE_SYSTEM = `You translate text that someone snipped from their screen (a game, a website, a message, a menu).
The text was read from a picture, so it may have small reading mistakes or broken lines: translate what it most likely says.
Reply in exactly this form and nothing else:
From: <the language the text is in, in English, e.g. Japanese>
<the translation>
If the text is already in the language asked for, still reply in that form with the text unchanged. Keep names, numbers and line breaks. No notes, no explanations, no quotes around the translation.`

export const translatePrompt = (text: string, target: string): string => `Translate into ${target}:\n\n${text.slice(0, TRANSLATE_MAX_CHARS)}`

/** The offline AI's reply, split into the language it found and the translation. */
export function parseTranslation(reply: string): { from: string; text: string } {
  let t = reply.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '').trim()
  let from = ''
  const m = /^\s*\**\s*(?:From|Language|Source(?: language)?)\s*\**\s*[:：]\s*\**\s*([^\n*]{1,40}?)\s*\**\s*(?:\n|$)/i.exec(t)
  if (m) {
    from = m[1].trim().replace(/[.。]$/, '')
    t = t.slice(m[0].length)
  }
  // A "Translation:" label some models add anyway.
  t = t.replace(/^\s*\**\s*(?:Translation|Translated)\s*\**\s*[:：]\s*\**[ \t]*\n?/i, '')
  // Quotes or a code fence round the whole thing.
  t = t.trim()
  const fence = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(t)
  if (fence) t = fence[1].trim()
  if (t.length > 1 && /^["“「]/.test(t) && /["”」]$/.test(t) && !/["“”「」]/.test(t.slice(1, -1))) t = t.slice(1, -1).trim()
  return { from, text: t }
}

/** Whether the language it found is the one it was asked to translate into (so "already in English"). */
export const sameLanguage = (from: string, target: string): boolean => {
  const a = from.toLowerCase().replace(/\s*\(.*\)$/, '').trim()
  const b = target.toLowerCase().trim()
  return !!a && (a === b || a.startsWith(`${b} `) || (b === 'chinese' && a.startsWith('chinese')))
}

/** What goes in today's note when you save a translation. */
export function translationNote(original: string, translation: string, from: string, target: string): string {
  const label = from ? `${from} → ${target}` : `→ ${target}`
  return `Snipped (${label}):\n${original.trim()}\n\nTranslation:\n${translation.trim()}`
}
