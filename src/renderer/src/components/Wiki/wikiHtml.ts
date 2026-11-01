import { imageUrl, wikiLink, type WikiPageView } from '@shared/wiki'

/**
 * Makes a downloaded wiki page safe and offline before it's shown: only plain page parts are
 * kept (no scripts, styles, forms or frames), links are turned into Orbit's own (another wiki
 * page, a heading, or the web in your browser), and only pictures that were downloaded are shown,
 * so nothing loads from the internet. Class names get a "w-" in front so they can't clash with Orbit's.
 */

const KEEP = new Set(
  'a abbr aside b big blockquote br caption center cite code dd del div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i img ins kbd li mark ol p pre q s section small span strong sub sup table tbody td tfoot th thead tr u ul'.split(' ')
)
/** Taken out with everything inside them. */
const DROP = new Set('script style noscript iframe frame frameset object embed form input button select textarea option link meta base svg math video audio source track template canvas dialog map area'.split(' '))
const ATTRS = new Set(['colspan', 'rowspan', 'alt', 'title'])

export function cleanWikiHtml(html: string, page: WikiPageView, base: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  const top = doc.body.firstElementChild
  if (!top) return ''
  clean(top, page, base)
  return top.innerHTML
}

function clean(el: Element, page: WikiPageView, base: string): void {
  for (const node of [...el.childNodes]) {
    if (node.nodeType === Node.COMMENT_NODE || node.nodeType === Node.PROCESSING_INSTRUCTION_NODE) {
      node.remove()
      continue
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue
    const child = node as Element
    const tag = child.tagName.toLowerCase()
    if (DROP.has(tag)) {
      child.remove()
      continue
    }
    clean(child, page, base)
    if (!KEEP.has(tag)) {
      child.replaceWith(...child.childNodes)
      continue
    }
    const attrs: Record<string, string> = {}
    for (const a of [...child.attributes]) attrs[a.name.toLowerCase()] = a.value
    for (const a of [...child.attributes]) child.removeAttribute(a.name)
    for (const [k, v] of Object.entries(attrs)) if (ATTRS.has(k)) child.setAttribute(k, v)
    if (attrs.class) child.setAttribute('class', attrs.class.split(/\s+/).filter(Boolean).map((c) => `w-${c}`).join(' '))
    if (attrs.id) child.setAttribute('id', `w-${attrs.id}`)
    if (tag === 'img') {
      const url = imageUrl(attrs)
      const file = url ? page.images[url] : undefined
      if (!file) {
        child.remove()
        continue
      }
      child.setAttribute('src', `vault://wiki/${encodeURIComponent(page.wikiId)}/${file}`)
      child.setAttribute('loading', 'lazy')
      const w = Number(attrs.width)
      const h = Number(attrs.height)
      if (w > 0 && w < 2000) child.setAttribute('width', String(w))
      if (h > 0 && h < 4000) child.setAttribute('height', String(h))
    }
    if (tag === 'a') {
      const link = attrs.href ? wikiLink(attrs.href, base) : null
      if (!link) {
        // A picture's link to its file page, a red link…: just the text (or picture).
        child.replaceWith(...child.childNodes)
        continue
      }
      child.classList.add('wiki-a')
      if (link.kind === 'page') {
        child.setAttribute('data-wiki', link.title)
        if (link.fragment) child.setAttribute('data-frag', link.fragment)
      } else if (link.kind === 'anchor') child.setAttribute('data-anchor', link.fragment)
      else {
        child.setAttribute('data-ext', link.url)
        child.classList.add('wiki-ext')
        child.setAttribute('title', link.url)
      }
      child.setAttribute('href', '#')
    }
  }
}

/** The heading a "#Season_1" link points to, in a cleaned page. */
export function findAnchor(root: HTMLElement, fragment: string): HTMLElement | null {
  const id = `w-${fragment.replace(/ /g, '_')}`
  return root.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`)
}
