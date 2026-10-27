import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { join } from 'path'
import { gzipSync } from 'zlib'
import type { Plugin } from 'vite'
import type { DictionaryFile, PartOfSpeech } from '../src/shared/dictionary'

/**
 * Builds the dictionary the app looks words up in (src/shared/dictionary.ts) from Princeton's
 * WordNet: its definitions and synonyms come from the wordnet-db package, and the irregular forms
 * ("went" → "go") from scripts/wordnet/*.exc. Written next to the main process as dictionary.json.gz.
 */

const FILES: Record<string, PartOfSpeech> = { noun: 'n', verb: 'v', adj: 'a', adv: 'r' }

/** WordNet writes phrases with underscores and marks some adjectives' position, e.g. "galore(ip)". */
const tidy = (w: string): string => w.replace(/_/g, ' ').replace(/\([a-z]+\)$/, '')

const lines = (path: string): string[] => readFileSync(path, 'latin1').split('\n').filter((l) => l && !l.startsWith(' '))

export function buildDictionary(): DictionaryFile {
  const dict = join(createRequire(import.meta.url).resolve('wordnet-db/package.json'), '..', 'dict')

  // Meanings: "part of speech + offset" → line number.
  const meanings: { pos: PartOfSpeech; words: string[]; gloss: string; similar: string[] }[] = []
  const ids = new Map<string, number>()
  for (const [file, pos] of Object.entries(FILES)) {
    for (const line of lines(join(dict, `data.${file}`))) {
      const bar = line.indexOf(' | ')
      const f = line.slice(0, bar).split(' ')
      const count = parseInt(f[3], 16)
      const words = Array.from({ length: count }, (_, i) => tidy(f[4 + i * 2]))
      // Pointers follow the words, four fields each: symbol, offset, part of speech, source/target.
      const at = 4 + count * 2
      const similar: string[] = []
      for (let i = 0; i < parseInt(f[at], 10); i++) {
        const [symbol, offset, ptrPos] = f.slice(at + 1 + i * 4, at + 4 + i * 4)
        if (symbol === '&' && (ptrPos === 'a' || ptrPos === 's')) similar.push('a' + offset)
      }
      ids.set(pos + f[0], meanings.length)
      meanings.push({ pos, words, gloss: line.slice(bar + 3).trim(), similar })
    }
  }

  // How often each word was seen with each meaning in WordNet's sample texts: "lemma pos offset" → count.
  const SENSE_POS: Record<string, PartOfSpeech> = { 1: 'n', 2: 'v', 3: 'a', 4: 'r', 5: 'a' }
  const counts = new Map<string, string>()
  for (const line of lines(join(dict, 'index.sense'))) {
    const [key, offset, , count] = line.split(' ')
    if (count === '0') continue
    const [lemma, rest] = key.split('%')
    counts.set(`${lemma} ${SENSE_POS[rest[0]]} ${offset}`, count)
  }

  const words = new Map<string, string[]>()
  // No prototype, so words like "constructor" are just words.
  const x: DictionaryFile['x'] = Object.create(null)
  for (const [file, pos] of Object.entries(FILES)) {
    for (const line of lines(join(dict, `index.${file}`))) {
      const f = line.trim().split(' ')
      const word = tidy(f[0])
      const list = words.get(word) ?? []
      for (const offset of f.filter((v) => /^\d{8}$/.test(v))) {
        const count = counts.get(`${f[0]} ${pos} ${offset}`)
        list.push(`${ids.get(pos + offset)}${count ? ':' + count : ''}`)
      }
      words.set(word, list)
    }
    for (const line of lines(join(__dirname, 'wordnet', `${file}.exc`))) {
      const [form, ...bases] = line.trim().split(' ').map(tidy)
      if (!bases.length) continue
      const list = (x[form] ??= [])
      for (const b of bases) if (!list.some(([p, base]) => p === pos && base === b)) list.push([pos, b])
    }
  }

  return {
    s: meanings
      .map((m) => {
        const similar = m.similar.map((s) => ids.get(s)).filter((i) => i !== undefined)
        return [m.pos, m.words.join('|'), m.gloss, ...(similar.length ? [similar.join(',')] : [])].join('\t')
      })
      .join('\n'),
    w: [...words].map(([word, list]) => `${word}\t${list.join(',')}`).join('\n'),
    x
  }
}

/** Adds dictionary.json.gz to the main process's build. */
export function dictionaryPlugin(): Plugin {
  return {
    name: 'notes-dictionary',
    apply: 'build',
    generateBundle() {
      const json = JSON.stringify(buildDictionary())
      this.emitFile({ type: 'asset', fileName: 'dictionary.json.gz', source: gzipSync(json, { level: 9 }) })
    }
  }
}
