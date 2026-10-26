/**
 * Note properties: the `key: value` lines in a note's frontmatter (the `---` block at the top).
 * Only the simple YAML people actually write is understood: single values, `[a, b]` lists and
 * `- item` lists. Anything fancier is shown as-is and left untouched.
 */

export type PropValue = string | string[]

export interface Property {
  key: string
  /** null: something more complex than a value or a list, shown as text and left alone. */
  value: PropValue | null
  /** How a list is written, so editing keeps it the same. */
  listStyle?: 'inline' | 'block'
  /** The raw YAML lines this property spans. */
  raw: string
}

export interface Frontmatter {
  /** Offsets of the whole block (both `---` lines and the newline after the closing one). */
  from: number
  to: number
  /** The YAML between the fences. */
  yaml: string
  properties: Property[]
}

const OPEN = /^---[ \t]*\n/
const CLOSE = /^(---|\.\.\.)[ \t]*$/m
const KEY_LINE = /^([^\s#:\-][^:]*?)\s*:(?:\s+(.*?))?\s*$/

const unquote = (s: string): string => {
  const t = s.trim()
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) {
    return t[0] === '"' ? t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\') : t.slice(1, -1).replace(/''/g, "'")
  }
  return t
}

/** Splits `a, "b, c", d` on commas outside quotes. */
function splitList(inner: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: string | null = null
  for (const ch of inner) {
    if (quote) {
      if (ch === quote) quote = null
      cur += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      cur += ch
    } else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map(unquote).filter((s) => s !== '')
}

export function parseProperties(yaml: string): Property[] {
  const lines = yaml.split('\n')
  const props: Property[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = KEY_LINE.exec(lines[i])
    if (!m) continue
    const key = m[1].trim()
    const rest = (m[2] ?? '').replace(/\s+#.*$/, '')
    // The property's lines: this one plus any indented / "- " lines under it.
    let j = i + 1
    while (j < lines.length && (/^\s+\S/.test(lines[j]) || /^-\s/.test(lines[j]))) j++
    const children = lines.slice(i + 1, j)
    const raw = lines.slice(i, j).join('\n')
    let prop: Property
    if (children.length) {
      const items = children.map((l) => /^\s*-\s+(.*)$/.exec(l))
      prop = rest === '' && items.every(Boolean)
        ? { key, value: items.map((it) => unquote(it![1])), listStyle: 'block', raw }
        : { key, value: null, raw }
    } else if (/^\[.*\]$/.test(rest)) {
      prop = { key, value: splitList(rest.slice(1, -1)), listStyle: 'inline', raw }
    } else if (/^[|>{&*!]/.test(rest)) {
      prop = { key, value: null, raw }
    } else {
      prop = { key, value: unquote(rest), raw }
    }
    props.push(prop)
    i = j - 1
  }
  return props
}

/** The note's frontmatter block, or null if it has none. */
export function readFrontmatter(text: string): Frontmatter | null {
  const open = OPEN.exec(text)
  if (!open) return null
  const rest = text.slice(open[0].length)
  const close = CLOSE.exec(rest)
  if (!close) return null
  const yaml = rest.slice(0, close.index).replace(/\n$/, '')
  let to = open[0].length + close.index + close[0].length
  if (text[to] === '\n') to++
  return { from: 0, to, yaml, properties: parseProperties(yaml) }
}

/** Quotes a value only when YAML would otherwise misread it. */
export function yamlValue(v: string): string {
  if (v === '') return '""'
  if (/^[\s]|[\s]$|^[-?:,[\]{}#&*!|>'"%@`]|: | #|^(true|false|null|yes|no|on|off|~)$/i.test(v)) {
    return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return v
}

function serialize(key: string, value: PropValue, listStyle: 'inline' | 'block' = 'inline'): string {
  if (!Array.isArray(value)) return `${key}: ${yamlValue(value)}`
  if (listStyle === 'block' && value.length) return `${key}:\n${value.map((v) => `  - ${yamlValue(v)}`).join('\n')}`
  return `${key}: [${value.map((v) => (/[,\]]/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : yamlValue(v))).join(', ')}]`
}

function replaceYaml(text: string, fm: Frontmatter | null, yaml: string): string {
  if (!fm) return `---\n${yaml}\n---\n${text.startsWith('\n') ? '' : text ? '\n' : ''}${text}`
  if (!yaml.trim()) {
    // No properties left: drop the block (and the blank line after it).
    return text.slice(fm.to).replace(/^\n/, '')
  }
  return `---\n${yaml}\n---\n${text.slice(fm.to)}`
}

/**
 * Sets (or with `value` undefined, removes) one property, keeping every other line as it was.
 * Adds the frontmatter block if the note has none.
 */
export function setProperty(text: string, key: string, value: PropValue | undefined): string {
  const fm = readFrontmatter(text)
  const existing = fm?.properties.find((p) => p.key === key)
  let yaml = fm?.yaml ?? ''
  if (existing && fm) {
    const at = yaml.indexOf(existing.raw)
    const before = yaml.slice(0, at)
    const after = yaml.slice(at + existing.raw.length)
    if (value === undefined) {
      yaml = (before + after.replace(/^\n/, '')).replace(/\n$/, '')
    } else {
      yaml = before + serialize(key, value, existing.listStyle) + after
    }
  } else if (value !== undefined) {
    yaml = yaml ? `${yaml}\n${serialize(key, value)}` : serialize(key, value)
  } else {
    return text
  }
  return replaceYaml(text, fm, yaml)
}

/** Renames a property, keeping its value and position. */
export function renameProperty(text: string, from: string, to: string): string {
  const fm = readFrontmatter(text)
  const prop = fm?.properties.find((p) => p.key === from)
  if (!fm || !prop || !to.trim() || fm.properties.some((p) => p.key === to)) return text
  const renamed = prop.raw.replace(/^[^:]*:/, `${to.trim()}:`)
  return replaceYaml(text, fm, fm.yaml.replace(prop.raw, renamed))
}

// ---------- what kind of control each property gets ----------

export type PropKind = 'date' | 'tags' | 'list' | 'status' | 'priority' | 'checkbox' | 'number' | 'link' | 'text'

export const STATUS_OPTIONS = ['to do', 'in progress', 'waiting', 'done']
export const PRIORITY_OPTIONS = ['low', 'medium', 'high']
const DATE_KEYS = /^(date|due|created|updated|modified|start|end|deadline|birthday|when)$/i
const LIST_KEYS = /^(aliases|people|authors?|attendees|related|links)$/i

export function kindOf(p: Pick<Property, 'key' | 'value'>): PropKind {
  const key = p.key.toLowerCase()
  if (key === 'tags' || key === 'tag') return 'tags'
  if (Array.isArray(p.value) || LIST_KEYS.test(key)) return 'list'
  const v = (p.value ?? '').trim()
  if (DATE_KEYS.test(key) || /^\d{4}-\d{2}-\d{2}$/.test(v)) return 'date'
  if (key === 'status') return 'status'
  if (key === 'priority') return 'priority'
  if (/^(true|false)$/i.test(v)) return 'checkbox'
  if (v !== '' && /^-?\d+(\.\d+)?$/.test(v)) return 'number'
  if (/^https?:\/\//i.test(v)) return 'link'
  return 'text'
}

/** Properties offered by "Add property", with the value a new one starts with. */
export const SUGGESTED: { key: string; label: string; initial: () => PropValue }[] = [
  { key: 'tags', label: 'Tags', initial: () => [] },
  { key: 'date', label: 'Date', initial: () => today() },
  { key: 'due', label: 'Due date', initial: () => today() },
  { key: 'status', label: 'Status', initial: () => 'to do' },
  { key: 'priority', label: 'Priority', initial: () => 'medium' },
  { key: 'people', label: 'People', initial: () => [] },
  { key: 'aliases', label: 'Other names', initial: () => [] },
  { key: 'source', label: 'Link', initial: () => 'https://' }
]

function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
