/**
 * The offline AI: a language model that runs on this computer's graphics card, so the AI helper
 * works without the internet and without sending anything anywhere. It isn't part of Orbit: it's
 * an optional download (the llama.cpp engine plus one model file) from Settings → AI helper or
 * the launcher. This file is the plain data and text handling (no Electron), so it can be tested;
 * src/main/localAi.ts downloads it and runs it.
 */

/** A model you can pick. Both are Qwen3 (Apache 2.0 licence), in the common 4-bit GGUF format. */
export interface LocalModel {
  id: string
  name: string
  blurb: string
  /** Hugging Face repository and file. */
  repo: string
  file: string
  /** About how big the download is, for the button (the exact size comes from Hugging Face). */
  gb: number
  /** Graphics memory (or a Mac's memory) it needs to run well, in GB. */
  needsGb: number
}

export const LOCAL_MODELS: LocalModel[] = [
  {
    id: 'qwen3-14b',
    name: 'Smart',
    blurb: 'Qwen3 14B. Best answers. For graphics cards with 12 GB or more (like an RTX 5080).',
    repo: 'Qwen/Qwen3-14B-GGUF',
    file: 'Qwen3-14B-Q4_K_M.gguf',
    gb: 9,
    needsGb: 12
  },
  {
    id: 'qwen3-8b',
    name: 'Quick',
    blurb: 'Qwen3 8B. Faster and smaller, a little less clever. For 8 GB graphics cards and Macs.',
    repo: 'Qwen/Qwen3-8B-GGUF',
    file: 'Qwen3-8B-Q4_K_M.gguf',
    gb: 5,
    needsGb: 8
  }
]

export const localModelById = (id: string | undefined): LocalModel | undefined => LOCAL_MODELS.find((m) => m.id === id)

/** The model to suggest: the smart one when there's room for it. `memoryGb` is the graphics card's memory (or a Mac's memory). */
export function suggestedModel(memoryGb: number | null, mac: boolean): LocalModel {
  const room = memoryGb ?? 0
  // A Mac shares its memory with everything else, so it needs more of it spare.
  const usable = mac ? room * 0.6 : room
  return usable >= LOCAL_MODELS[0].needsGb ? LOCAL_MODELS[0] : LOCAL_MODELS[1]
}

/** How much text the offline model is given at most (it reads ~16,000 tokens; a token is ~4 characters). */
export const LOCAL_CONTEXT_TOKENS = 16384
export const LOCAL_CONTEXT_CHARS = 30000

// ---------- the engine (llama.cpp) ----------

export interface ReleaseAsset {
  name: string
  url: string
  size: number
  /** GitHub's "sha256:<hex>" for the file. */
  digest?: string | null
}

export type EngineKind = 'cuda' | 'vulkan' | 'metal'

export interface EnginePick {
  kind: EngineKind
  /** The llama.cpp build with llama-server in it. */
  engine: ReleaseAsset
  /** NVIDIA's CUDA runtime files that go next to it (CUDA builds only). */
  runtime?: ReleaseAsset
}

export interface EngineTarget {
  platform: string
  arch: string
  /** An NVIDIA graphics card was found. */
  nvidia: boolean
}

/** The CUDA version a build is for, from its name ("…-cuda-12.8-x64.zip" → [12, 8]). */
const cudaVersion = (name: string): number[] | null => {
  const m = /-cuda-(\d+)\.(\d+)(?:\.\d+)?-x64\.zip$/i.exec(name)
  return m ? [+m[1], +m[2]] : null
}

const newer = (a: number[], b: number[]): boolean => a[0] !== b[0] ? a[0] > b[0] : a[1] > b[1]

/**
 * Which files of a llama.cpp release to download for this computer.
 * Windows with an NVIDIA card: the newest CUDA build (12.8 or later, which knows RTX 50 cards) and its runtime;
 * otherwise Vulkan (works on any recent graphics card). Apple Silicon Macs: the Metal build.
 */
export function pickEngine(assets: ReleaseAsset[], target: EngineTarget): EnginePick | null {
  const find = (re: RegExp): ReleaseAsset | undefined => assets.find((a) => re.test(a.name))
  if (target.platform === 'darwin') {
    if (target.arch !== 'arm64') return null
    const engine = find(/^llama-b\d+-bin-macos-arm64\.(zip|tar\.gz)$/i)
    return engine ? { kind: 'metal', engine } : null
  }
  if (target.platform !== 'win32' || target.arch !== 'x64') return null
  if (target.nvidia) {
    let best: { engine: ReleaseAsset; runtime: ReleaseAsset; version: number[] } | null = null
    for (const a of assets) {
      if (!/^llama-b\d+-bin-win-cuda-/i.test(a.name)) continue
      const version = cudaVersion(a.name)
      if (!version || newer([12, 8], version)) continue
      const runtime = assets.find((r) => /^cudart-llama-bin-win-cuda-/i.test(r.name) && cudaVersion(r.name)?.join('.') === version.join('.'))
      if (runtime && (!best || newer(version, best.version))) best = { engine: a, runtime, version }
    }
    if (best) return { kind: 'cuda', engine: best.engine, runtime: best.runtime }
  }
  const engine = find(/^llama-b\d+-bin-win-vulkan-x64\.zip$/i)
  return engine ? { kind: 'vulkan', engine } : null
}

/** The hex SHA-256 in a GitHub digest ("sha256:ab12…"), or null. */
export function sha256Of(digest: string | null | undefined): string | null {
  const m = /^sha256:([0-9a-f]{64})$/i.exec(digest?.trim() ?? '')
  return m ? m[1].toLowerCase() : null
}

/** A Hugging Face file listing entry (api/models/<repo>/tree/main). */
export interface HfFile {
  path: string
  size?: number
  lfs?: { oid?: string; sha256?: string; size?: number }
}

/** The size and SHA-256 Hugging Face gives for a model file, or null if it isn't there. */
export function hfFileInfo(list: HfFile[], file: string): { size: number; sha256: string } | null {
  const f = list.find((x) => x.path === file)
  const sha = (f?.lfs?.sha256 ?? f?.lfs?.oid ?? '').toLowerCase()
  const size = f?.lfs?.size ?? f?.size ?? 0
  return f && /^[0-9a-f]{64}$/.test(sha) && size > 0 ? { size, sha256: sha } : null
}

// ---------- what the model sends back ----------

/** The line the offline model ends with when a question is too hard for it. */
export const HARD_MARK = '[HARD]'

/** Takes out the model's thinking (<think>…</think>) and the "too hard" mark. */
export function cleanReply(raw: string): { text: string; hard: boolean } {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '')
  // A reply cut off while still thinking.
  text = text.replace(/<think>[\s\S]*$/i, '')
  const hard = text.includes(HARD_MARK)
  text = text.split(HARD_MARK).join('').trim()
  return { text, hard }
}

/** Added to the offline model's instructions for questions and chat, so it can say when Claude would do better. */
export const HARD_NOTE = `If you can't answer this well (it needs facts you don't know, up-to-date information, or long careful work you aren't sure of), still give your best short answer, then end your reply with a line containing only ${HARD_MARK}.`

/** Keeps a list of texts under a total length, cutting the last one that fits. */
export function fitTexts<T extends { text: string }>(items: T[], budget: number): T[] {
  const out: T[] = []
  let used = 0
  for (const item of items) {
    if (used >= budget) break
    const room = budget - used
    const text = item.text.length > room ? item.text.slice(0, room) + '\n…' : item.text
    out.push({ ...item, text })
    used += text.length
  }
  return out
}

// ---------- sorting bank payments ----------

export interface SortRow {
  description: string
  /** Pence: negative is money out. */
  amount: number
}

export interface SortCategory {
  id: string
  name: string
  income?: boolean
}

/** The text that asks the model to put each payment in a category. */
export function moneySortPrompt(rows: SortRow[], categories: SortCategory[]): string {
  const out = categories.filter((c) => !c.income).map((c) => `${c.id} = ${c.name}`)
  const inc = categories.filter((c) => c.income).map((c) => `${c.id} = ${c.name}`)
  const lines = rows.map((r, i) => `${i + 1}. ${r.amount < 0 ? 'OUT' : 'IN'} £${(Math.abs(r.amount) / 100).toFixed(2)} ${r.description.replace(/\s+/g, ' ').slice(0, 80)}`)
  return `Spending categories: ${out.join(', ')}.
Money-in categories: ${inc.join(', ')}.

Bank statement lines:
${lines.join('\n')}

For each line, pick the best category id (OUT lines use a spending category, IN lines a money-in one). Use what the shop or company is known for: supermarkets and takeaways are food, Steam and PlayStation are games, Netflix and Spotify are subscriptions.
Reply with only one line per statement line, like:
1: food
2: games`
}

export const MONEY_SORT_SYSTEM = 'You sort bank statement lines into spending categories. You reply in the exact format asked for and nothing else.'

/** Reads the model's "1: food" lines back, keeping only category ids that exist (and fit money in or out). */
export function parseMoneySort(reply: string, rows: SortRow[], categories: SortCategory[]): Record<number, string> {
  const byId = new Map(categories.map((c) => [c.id.toLowerCase(), c]))
  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c]))
  const out: Record<number, string> = {}
  for (const line of cleanReply(reply).text.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s*[:.)\-]\s*([\w &'-]+?)\s*$/.exec(line)
    if (!m) continue
    const i = +m[1] - 1
    const row = rows[i]
    if (!row) continue
    const key = m[2].toLowerCase()
    const cat = byId.get(key) ?? byName.get(key)
    if (cat && !!cat.income === row.amount > 0) out[i] = cat.id
  }
  return out
}

// ---------- the dictionary card ----------

/** The sentence a word sits in (from the start of its sentence to the end), cut to a sensible length. */
export function sentenceAround(text: string, from: number, to: number, max = 400): string {
  const ends = /[.!?\n]/
  let start = from
  while (start > 0 && !ends.test(text[start - 1])) start--
  let end = to
  while (end < text.length && !ends.test(text[end])) end++
  if (end < text.length && text[end] !== '\n') end++
  let s = text.slice(start, end).replace(/\s+/g, ' ').trim()
  // Markdown that would only confuse it.
  s = s.replace(/^(#+|[-*+]|\d+\.)\s+(\[[ x]\]\s+)?/i, '')
  if (s.length > max) {
    const at = Math.max(0, from - start - max / 2)
    s = `…${s.slice(at, at + max)}…`
  }
  return s
}

export const MEANING_SYSTEM = `You explain what a word means in the sentence it's used in, for someone reading their own notes.
Reply in one or two short, plain sentences: what it means here (not every meaning it can have). If it's slang, a name or a word used in an unusual way, say so. No preamble, no quotes around the answer.`

export const meaningPrompt = (word: string, sentence: string): string => `Word: ${word}\nSentence: ${sentence}`
