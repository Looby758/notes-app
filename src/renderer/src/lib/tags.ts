import { maskCode } from './links'

/** Characters allowed in a tag: letters, digits, _ - and / (for nesting like #project/alpha). */
export const TAG_BODY = /^[\p{L}\p{N}_/-]+/u

/** A tag needs at least one character that isn't a digit, so "#1" or "#2024" aren't tags. */
export function isValidTag(tag: string): boolean {
  return /[^\d/]/u.test(tag) && !tag.startsWith('/')
}

/**
 * Finds the YAML frontmatter block at the top of a note (between `---` lines).
 * Returns its end offset (after the closing line) and any tags it lists, or end 0 if there's none.
 */
export function parseFrontmatter(text: string): { end: number; tags: string[] } {
  const open = /^---[ \t]*\r?\n/.exec(text)
  if (!open) return { end: 0, tags: [] }
  const close = /^(---|\.\.\.)[ \t]*$/m
  const rest = text.slice(open[0].length)
  const m = close.exec(rest)
  if (!m) return { end: 0, tags: [] }
  const yaml = rest.slice(0, m.index)
  let end = open[0].length + m.index + m[0].length
  if (text[end] === '\r') end++
  if (text[end] === '\n') end++
  return { end, tags: yamlTags(yaml) }
}

const cleanTag = (t: string): string => t.trim().replace(/^["']|["']$/g, '').replace(/^#/, '').trim()

function yamlTags(yaml: string): string[] {
  const lines = yaml.split(/\r?\n/)
  const tags: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^(tags?)\s*:\s*(.*)$/i.exec(lines[i])
    if (!m) continue
    const value = m[2].trim()
    if (value) {
      // tags: [a, b]   or   tags: a, b   or   tags: a b
      const inner = value.replace(/^\[|\]$/g, '')
      tags.push(...inner.split(/[,\s]+/).map(cleanTag))
    } else {
      // tags:
      //   - a
      //   - b
      for (let j = i + 1; j < lines.length; j++) {
        const item = /^\s*-\s+(.*)$/.exec(lines[j])
        if (!item) break
        tags.push(cleanTag(item[1]))
      }
    }
  }
  return tags.filter((t) => t && isValidTag(t))
}

/** All tags in a note (frontmatter and inline #tags), deduplicated case-insensitively, first spelling wins. */
export function parseTags(text: string): string[] {
  const { end, tags: fromYaml } = parseFrontmatter(text)
  const body = maskCode(text.slice(end))
  const found = [...fromYaml]
  for (const m of body.matchAll(/(?<=^|[\s(,;!?"'])#([\p{L}\p{N}_/-]+)/gmu)) {
    const tag = m[1].replace(/\/+$/, '')
    if (isValidTag(tag)) found.push(tag)
  }
  const seen = new Map<string, string>()
  for (const t of found) if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t)
  return [...seen.values()]
}

/** Does a note tagged `noteTag` match a search for `wanted`? Nested tags count: #project matches #project/alpha. */
export function tagMatches(noteTag: string, wanted: string): boolean {
  const a = noteTag.toLowerCase()
  const b = wanted.toLowerCase()
  return a === b || a.startsWith(b + '/')
}
