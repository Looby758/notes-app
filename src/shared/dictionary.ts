/**
 * The dictionary and thesaurus: looking a word up in WordNet (built into the app at build time by
 * scripts/dictionaryPlugin.ts) and fitting a synonym into the sentence in place of the word.
 */

/** n noun, v verb, a adjective, r adverb. */
export type PartOfSpeech = 'n' | 'v' | 'a' | 'r'

/**
 * The built-in WordNet data, as the file holds it (kept as text, which takes far less memory than
 * the same as objects).
 * - s: every meaning, one per line: part of speech, its words (split by |), its definition and
 *   examples, and similar meanings (adjectives; line numbers split by ,), split by tabs
 * - w: one word (lower case) per line: the word, a tab, then its meanings as line numbers, each
 *   with ":how often it's used that way" when it's been seen, split by ,
 * - x: an irregular form (lower case) → what it's a form of, e.g. "went" → [["v", "go"]]
 */
export interface DictionaryFile {
  s: string
  w: string
  x: Record<string, [PartOfSpeech, string][]>
}

/** The file, ready to look words up in. */
export interface DictionaryData {
  meanings: string[]
  words: Map<string, string>
  x: Record<string, [PartOfSpeech, string][]>
}

export function readDictionary(file: DictionaryFile): DictionaryData {
  const words = new Map<string, string>()
  for (const line of file.w.split('\n')) {
    const tab = line.indexOf('\t')
    words.set(line.slice(0, tab), line.slice(tab + 1))
  }
  return { meanings: file.s.split('\n'), words, x: file.x }
}

function meaning(data: DictionaryData, id: number): { pos: PartOfSpeech; words: string[]; gloss: string; similar: number[] } {
  const [pos, words, gloss, similar] = data.meanings[id].split('\t')
  return { pos: pos as PartOfSpeech, words: words.split('|'), gloss, similar: similar ? similar.split(',').map(Number) : [] }
}

/** A word's meanings: [line number, how often it's used that way]. */
function meaningsOf(data: DictionaryData, word: string): [number, number][] {
  return (data.words.get(word) ?? '').split(',').filter(Boolean).map((m) => {
    const [id, count] = m.split(':')
    return [Number(id), Number(count ?? 0)]
  })
}

export interface Synonym {
  word: string
  /** The word ready to go in the note in place of the one looked up ("sprinting" for "running"), or null if it can't be fitted in. */
  replacement: string | null
}

export interface Sense {
  pos: PartOfSpeech
  definition: string
  examples: string[]
  /** Other words with this meaning. */
  synonyms: Synonym[]
}

export interface DictionaryEntry {
  /** The word as it appears in the note. */
  word: string
  /** Its dictionary form, e.g. "run" for "running". */
  lemma: string
  /** Most used meaning first. */
  senses: Sense[]
  /** The best synonyms across its meanings, for the right-click menu. */
  synonyms: Synonym[]
}

export const POS_NAMES: Record<PartOfSpeech, string> = { n: 'noun', v: 'verb', a: 'adjective', r: 'adverb' }

type Ending = 's' | 'ed' | 'ing' | 'er' | 'est'

/** WordNet's rules for undoing regular endings (its "morphy"), plus y → ied/ier/iest. */
const ENDINGS: [string, string][] = [
  ['ses', 's'], ['xes', 'x'], ['zes', 'z'], ['ches', 'ch'], ['shes', 'sh'], ['men', 'man'], ['ies', 'y'],
  ['es', 'e'], ['es', ''], ['ed', 'e'], ['ed', ''], ['ing', 'e'], ['ing', ''], ['ied', 'y'],
  ['er', ''], ['est', ''], ['er', 'e'], ['est', 'e'], ['ier', 'y'], ['iest', 'y'], ['s', '']
]

const own = <T>(record: Record<string, T>, key: string): T | undefined => (Object.hasOwn(record, key) ? record[key] : undefined)

/** The dictionary forms a word could be, in the order to try them. */
export function baseForms(word: string, data: Pick<DictionaryData, 'x'>): string[] {
  const w = word.toLowerCase()
  const forms = [w, ...(own(data.x, w) ?? []).map(([, base]) => base)]
  for (const [ending, replacement] of ENDINGS) {
    if (w.endsWith(ending) && w.length - ending.length >= 2) forms.push(w.slice(0, -ending.length) + replacement)
  }
  return [...new Set(forms)]
}

/** Splits WordNet's 'definition; "example"; "example"' into its parts. */
export function splitGloss(gloss: string): { definition: string; examples: string[] } {
  const examples = [...gloss.matchAll(/"([^"]+)"/g)].map((m) => m[1].trim())
  const quote = gloss.indexOf('"')
  const definition = (quote === -1 ? gloss : gloss.slice(0, quote)).replace(/[;:\s]+$/, '').trim()
  return { definition, examples }
}

const MAX_SYNONYMS = 10

/** Looks a word up, trying its dictionary forms ("running" → "run"). Null if it isn't in the dictionary. */
export function lookUp(data: DictionaryData, word: string): DictionaryEntry | null {
  const clean = word.trim().replace(/['’]s$/i, '').replace(/’/g, "'")
  if (!clean || clean.length > 60) return null
  const forms = baseForms(clean, data).filter((f) => data.words.has(f))
  if (!forms.length) return null

  // Every meaning of every form it could be ("saw": the tool, or the past of "see"), most used first.
  const seen = new Set<number>()
  const found: { id: number; form: string; count: number }[] = []
  for (const form of forms) {
    for (const [id, count] of meaningsOf(data, form)) {
      if (seen.has(id)) continue
      seen.add(id)
      found.push({ id, form, count })
    }
  }
  found.sort((a, b) => b.count - a.count) // stable, so otherwise in WordNet's order
  const lemma = found[0].form

  const same = new Set([clean.toLowerCase(), ...forms])
  const isOther = (s: string): boolean => !same.has(s.toLowerCase())
  const senses = found.map(({ id, form }) => {
    const { pos, words, gloss, similar } = meaning(data, id)
    const mine = words.filter(isOther)
    const like = similar.flatMap((i) => meaning(data, i).words).filter(isOther)
    const synonyms = [...new Set([...mine, ...like])].map((w): Synonym => ({ word: w, replacement: fitSynonym(data, clean, form, pos, w) }))
    return { sense: { pos, ...splitGloss(gloss), synonyms }, mine: synonyms.slice(0, mine.length), like: synonyms.slice(mine.length) }
  })

  // For the menu: words for the commonest few meanings, then similar words; not ones that won't fit.
  const synonyms: Synonym[] = []
  const add = (s: Synonym): void => {
    const key = s.replacement?.toLowerCase()
    if (key && synonyms.length < MAX_SYNONYMS && !synonyms.some((t) => t.replacement!.toLowerCase() === key)) synonyms.push(s)
  }
  senses.slice(0, 4).forEach((s) => s.mine.forEach(add))
  senses.slice(0, 3).forEach((s) => s.like.forEach(add))
  return { word: clean, lemma, senses: senses.map((s) => s.sense), synonyms }
}

// ---------- fitting a synonym in ----------

const syllables = (w: string): number => w.toLowerCase().replace(/e$/, '').match(/[aeiouy]+/g)?.length ?? 1
/** Short words ending consonant-vowel-consonant double the last letter: run → running. */
const doubles = (w: string): boolean => /^[^aeiou]*[aeiou][b-df-hj-np-tv-z]$/.test(w) && !/[wxy]$/.test(w)

/** A regular ending added to a word: "stop" + "ed" → "stopped". */
export function addEnding(base: string, ending: Ending, pos?: PartOfSpeech): string {
  // "hop-skip" → "hop-skipping"
  const hyphen = base.lastIndexOf('-')
  if (hyphen > 0) return base.slice(0, hyphen + 1) + addEnding(base.slice(hyphen + 1), ending, pos)
  const w = base.toLowerCase()
  if (ending === 's') {
    if (/(s|x|z|ch|sh)$/.test(w) || (pos === 'v' && /[^aeiou]o$/.test(w))) return base + 'es'
    if (/[^aeiou]y$/.test(w)) return base.slice(0, -1) + 'ies'
    return base + 's'
  }
  if (ending === 'ing') {
    if (w.endsWith('ie')) return base.slice(0, -2) + 'ying'
    if (/[^aeiou]e$/.test(w) || /[^e]ue$/.test(w)) return base.slice(0, -1) + 'ing'
  } else {
    if (/[^aeiou]y$/.test(w)) return base.slice(0, -1) + 'i' + ending
    if (w.endsWith('e')) return base + ending.slice(1)
  }
  if (doubles(w)) return base + base.slice(-1) + ending
  return base + ending
}

/** How "word" is formed from "lemma": "running" from "run" → "ing", "went" from "go" → "ed". */
export function endingOf(data: Pick<DictionaryData, 'x'>, word: string, lemma: string): Ending | null {
  const w = word.toLowerCase()
  if (w === lemma) return null
  for (const ending of ['ing', 'ed', 'est', 'er', 's'] as const) {
    if (addEnding(lemma, ending).toLowerCase() === w || addEnding(lemma, ending, 'v').toLowerCase() === w) return ending
  }
  const irregular = own(data.x, w)?.find(([, base]) => base === lemma)
  if (!irregular) return null
  const [pos] = irregular
  if (pos === 'n') return 's'
  if (pos === 'v') return w.endsWith('ing') ? 'ing' : w.endsWith('s') ? 's' : 'ed'
  return w.endsWith('st') ? 'est' : 'er'
}

/** Each word's irregular forms, per part of speech: "v give" → ["gave", "given"]. Worked out once. */
const irregulars = new WeakMap<object, Map<string, string[]>>()
function irregularForms(data: Pick<DictionaryData, 'x'>, pos: PartOfSpeech, base: string): string[] {
  let map = irregulars.get(data.x)
  if (!map) {
    map = new Map()
    for (const [form, list] of Object.entries(data.x)) {
      for (const [p, b] of list) map.set(`${p} ${b}`, [...(map.get(`${p} ${b}`) ?? []), form])
    }
    irregulars.set(data.x, map)
  }
  return map.get(`${pos} ${base.toLowerCase()}`) ?? []
}

/** A word with an ending, using its irregular form if it has one. Null when that's ambiguous (gave or given?). */
function inflect(data: Pick<DictionaryData, 'x'>, word: string, pos: PartOfSpeech, ending: Ending): string | null {
  const forms = irregularForms(data, pos, word)
  if (ending === 's') return (pos === 'n' ? forms[0] : forms.find((f) => f.endsWith('s'))) ?? addEnding(word, 's', pos)
  if (ending === 'ing') return forms.find((f) => f.endsWith('ing')) ?? addEnding(word, 'ing')
  if (ending === 'ed') {
    // Past tenses: not "-ing" or "-s" forms, or the ones only used after "have" (given, shown, gone).
    const past = forms.filter((f) => !f.endsWith('ing') && !/[^s]s$/.test(f) && !/(en|wn|ne)$/.test(f))
    const regular = past.find((f) => f.endsWith('ed'))
    if (regular) return regular
    if (past.length > 1) return null
    return past[0] ?? addEnding(word, 'ed')
  }
  // Comparing: bigger / more beautiful, biggest / most beautiful.
  const irregular = forms.find((f) => f.endsWith(ending === 'est' ? 'st' : 'er'))
  if (irregular) return irregular
  if (forms.length) return null
  const short = syllables(word) === 1 || (syllables(word) === 2 && /y$/i.test(word))
  return short ? addEnding(word, ending) : `${ending === 'er' ? 'more' : 'most'} ${word}`
}

/** "Hello" → "Hi" (keeps capitals: the first letter, or the whole word). */
export function matchCase(original: string, replacement: string): string {
  if (original.length > 1 && original === original.toUpperCase() && /[A-Z]/.test(original)) return replacement.toUpperCase()
  if (/^[A-Z]/.test(original) && /^[a-z]/.test(replacement)) return replacement[0].toUpperCase() + replacement.slice(1)
  return replacement
}

/**
 * A synonym ready to replace "word" (a form of "lemma"), with the same ending and capitals:
 * "Running" → "Sprinting".
 * Null when it can't be done reliably.
 */
export function fitSynonym(data: Pick<DictionaryData, 'x'>, word: string, lemma: string, pos: PartOfSpeech, synonym: string): string | null {
  const ending = endingOf(data, word, lemma)
  let out = synonym
  if (ending) {
    // Names don't take endings ("Canis familiaris" for "dogs").
    if (/[A-Z]/.test(synonym)) return null
    const words = synonym.split(' ')
    if (ending === 'er' || ending === 'est') {
      if (words.length > 1) return null
      // WordNet lists some comparisons as words of their own: "larger" for "bigger".
      if (synonym.toLowerCase().endsWith(ending)) return matchCase(word, synonym)
    }
    // The last word of a noun takes the ending ("computer mice"), the first of a verb ("tried out").
    const at = pos === 'n' ? words.length - 1 : 0
    const fitted = inflect(data, words[at], pos, ending)
    if (!fitted) return null
    words[at] = fitted
    out = words.join(' ')
  }
  return matchCase(word, out)
}
