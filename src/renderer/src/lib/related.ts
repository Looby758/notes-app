/**
 * Related notes: ones that share tags, link to the same notes, or use a lot of the same
 * (unusual) words. Each result says why, e.g. "shares #medical · links to Dentist".
 */

export interface RelatedInput {
  path: string
  tags: string[]
  /** Paths of the notes it links to. */
  links: string[]
  text: string
}

export interface Related {
  path: string
  score: number
  sharedTags: string[]
  sharedLinks: string[]
  /** How alike the wording is, 0–1. */
  similarity: number
}

const STOP = new Set(
  'the and for are but not you all any can had her was one our out day get has him his how man new now old see two way who boy did its let put say she too use that with have this will your from they know want been good much some time very when come here just like long make many more only over such take than them well were what into also your there their about would which could other after first never these think where being every great might shall still those under while again'.split(' ')
)

/** Words worth comparing: 3+ letters, not too common, no markdown or links. */
export function words(text: string): string[] {
  return (
    text
      .replace(/^---[\s\S]*?\n---/, ' ')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/\[\[[^\]]*\]\]|\]\([^)]*\)|https?:\/\/\S+/g, ' ')
      .toLowerCase()
      .match(/[\p{L}][\p{L}\p{N}'’-]{2,}/gu) ?? []
  ).filter((w) => !STOP.has(w))
}

/** Word weights for each note (tf-idf), built once for all notes. */
export function buildVectors(notes: RelatedInput[]): Map<string, Map<string, number>> {
  const df = new Map<string, number>()
  const counts = new Map<string, Map<string, number>>()
  for (const n of notes) {
    const c = new Map<string, number>()
    for (const w of words(n.text)) c.set(w, (c.get(w) ?? 0) + 1)
    counts.set(n.path, c)
    for (const w of c.keys()) df.set(w, (df.get(w) ?? 0) + 1)
  }
  const total = notes.length
  const vectors = new Map<string, Map<string, number>>()
  for (const [path, c] of counts) {
    const v = new Map<string, number>()
    let norm = 0
    for (const [w, n] of c) {
      // Words in nearly every note say nothing about how notes relate.
      const d = df.get(w)!
      if (d < 2 && total > 1) continue
      const weight = (1 + Math.log(n)) * Math.log(1 + total / d)
      v.set(w, weight)
      norm += weight * weight
    }
    norm = Math.sqrt(norm) || 1
    for (const [w, x] of v) v.set(w, x / norm)
    vectors.set(path, v)
  }
  return vectors
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  const [small, big] = a.size < b.size ? [a, b] : [b, a]
  let sum = 0
  for (const [w, x] of small) {
    const y = big.get(w)
    if (y) sum += x * y
  }
  return sum
}

export function relatedTo(target: string, notes: RelatedInput[], vectors: Map<string, Map<string, number>>, limit = 8): Related[] {
  const me = notes.find((n) => n.path === target)
  if (!me) return []
  const myTags = new Set(me.tags.map((t) => t.toLowerCase()))
  const myLinks = new Set(me.links)
  const myVec = vectors.get(target) ?? new Map()
  const out: Related[] = []
  for (const n of notes) {
    if (n.path === target) continue
    // Notes that already link to each other show under Backlinks / in the note itself.
    if (myLinks.has(n.path) || n.links.includes(target)) continue
    const sharedTags = n.tags.filter((t) => myTags.has(t.toLowerCase()))
    const sharedLinks = [...new Set(n.links.filter((l) => myLinks.has(l)))]
    const similarity = cosine(myVec, vectors.get(n.path) ?? new Map())
    const score = sharedTags.length * 3 + sharedLinks.length * 2 + similarity * 10
    if (sharedTags.length || sharedLinks.length || similarity >= 0.12) out.push({ path: n.path, score, sharedTags, sharedLinks, similarity })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit)
}
