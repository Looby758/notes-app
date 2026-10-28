import { useMemo, useState } from 'react'
import { ChevronRight, FileText, Link2 } from 'lucide-react'
import { useEditor } from '../../store/editor'
import { useUI } from '../../store/ui'
import { notify } from '../../store/notify'
import { backlinksTo, linkNameFor, relatedNotes, unlinkedMentionsOf, useNoteIndex, type IndexedLink, type MentionGroup } from '../../store/noteIndex'
import type { Related } from '../../lib/related'

/** "shares #medical · links to Insurance · similar wording" */
function reasons(r: Related): string {
  const out: string[] = []
  if (r.sharedTags.length) out.push(`shares ${r.sharedTags.slice(0, 3).map((t) => `#${t}`).join(', ')}`)
  if (r.sharedLinks.length) out.push(`also links to ${r.sharedLinks.slice(0, 2).map((p) => noteTitle(p)).join(', ')}`)
  if (r.similarity >= 0.12) out.push('similar wording')
  return out.join(' · ')
}
import { isNoteTab, openNote } from '../../lib/editorController'
import { editNote } from '../../lib/daily'
import { linkMentions, type Mention } from '../../lib/mentions'
import { noteTitle, parentOf } from '../../lib/paths'
import EmptyArt from '../Motion/EmptyArt'

const CONTEXT = 60

/** A line, trimmed to a window around [from, to), with that part highlighted. */
function Snippet({ snippet, from, to }: { snippet: string; from: number; to: number }) {
  const start = Math.max(0, from - CONTEXT)
  const end = Math.min(snippet.length, to + CONTEXT)
  return (
    <>
      {start > 0 && '…'}
      {snippet.slice(start, from).trimStart()}
      <mark>{snippet.slice(from, to)}</mark>
      {snippet.slice(to, end).trimEnd()}
      {end < snippet.length && '…'}
    </>
  )
}

const LinkSnippet = ({ link }: { link: IndexedLink }) => <Snippet snippet={link.snippet} from={link.snipFrom} to={link.snipTo} />

/** Which mention on its line this is (0 = first), so it can be found again after edits elsewhere. */
function nthOnLine(mentions: Mention[], m: Mention): number {
  return mentions.filter((x) => x.line === m.line && x.from < m.from).length
}

/** Links mentions of `target` in `source`: one (by line and position on it) or, with no `only`, all. */
async function link(source: string, target: string, only?: { line: number; nth: number }): Promise<void> {
  try {
    await editNote(source, (text) => {
      const seen = new Map<number, number>()
      return linkMentions(text, noteTitle(target), linkNameFor(target), (m) => {
        if (!only) return true
        const n = seen.get(m.line) ?? 0
        seen.set(m.line, n + 1)
        return m.line === only.line && n === only.nth
      })
    })
  } catch (err) {
    notify(err)
  }
}

function MentionGroupRow({ group, target }: { group: MentionGroup; target: string }) {
  const { source, mentions } = group
  return (
    <div className="backlink-group" data-mention-source={source}>
      <div className="backlink-source-row">
        <button className="backlink-source" onClick={() => openNote(source)} title={source}>
          <FileText size={14} />
          <span className="backlink-title">{noteTitle(source)}</span>
          {parentOf(source) && <span className="backlink-folder">{parentOf(source)}</span>}
        </button>
        {mentions.length > 1 && (
          <button className="mention-link-btn" onClick={() => link(source, target)} title={`Link all ${mentions.length} mentions in this note`}>
            Link all
          </button>
        )}
      </div>
      {mentions.map((m) => (
        <div key={m.from} className="mention-row">
          <button className="backlink-snippet" onClick={() => openNote(source, { line: m.line })} title="Go to this line">
            <Snippet snippet={m.snippet} from={m.snipFrom} to={m.snipTo} />
          </button>
          <button
            className="mention-link-btn"
            onClick={() => link(source, target, { line: m.line, nth: nthOnLine(mentions, m) })}
            title={`Turn “${m.text}” into a link to ${noteTitle(target)}`}
          >
            <Link2 size={12} /> Link
          </button>
        </div>
      ))}
    </div>
  )
}

export default function Backlinks() {
  const active = useEditor((s) => (isNoteTab(s.active) ? s.active : null))
  const version = useNoteIndex((s) => s.version)
  const mentionsOpen = useUI((s) => s.mentionsOpen)
  const [linkingAll, setLinkingAll] = useState(false)
  // `version` changes whenever any note's links or text change.
  const groups = useMemo(() => (active ? backlinksTo(active) : []), [active, version])
  const mentions = useMemo(() => (active ? unlinkedMentionsOf(active) : []), [active, version])
  const mentionCount = mentions.reduce((n, g) => n + g.mentions.length, 0)
  const relatedOpen = useUI((s) => s.relatedOpen)
  const related = useMemo(() => (active && relatedOpen ? relatedNotes(active) : []), [active, version, relatedOpen])

  const linkEverywhere = async (): Promise<void> => {
    if (!active) return
    setLinkingAll(true)
    for (const g of mentions) await link(g.source, active)
    setLinkingAll(false)
  }

  return (
    <div className="backlinks">
      <div className="backlinks-list">
        {!active && <div className="panel-empty">Open a note to see what links to it.</div>}
        {active && groups.length === 0 && (
          <div className="panel-empty">
            <EmptyArt kind="link" size={44} />
            No notes link here yet. Link to this note from another one with <code>[[{noteTitle(active)}]]</code>.
          </div>
        )}
        {groups.map(({ source, links }) => (
          <div key={source} className="backlink-group">
            <button className="backlink-source" onClick={() => openNote(source)} title={source}>
              <FileText size={14} />
              <span className="backlink-title">{noteTitle(source)}</span>
              {parentOf(source) && <span className="backlink-folder">{parentOf(source)}</span>}
            </button>
            {links.map((l) => (
              <button
                key={l.from}
                className="backlink-snippet"
                onClick={() => openNote(source, { line: l.line })}
                title="Go to this line"
              >
                <LinkSnippet link={l} />
              </button>
            ))}
          </div>
        ))}

        {active && (
          <section className="mentions" data-unlinked-mentions>
            <div className="mentions-header">
              <button className="mentions-toggle" onClick={() => useUI.setState({ mentionsOpen: !mentionsOpen })}>
                <ChevronRight size={13} className={`tree-chevron ${mentionsOpen ? 'open' : ''}`} />
                Unlinked mentions
                <span className="panel-count">{mentionCount}</span>
              </button>
              {mentionsOpen && mentions.length > 1 && (
                <button className="mention-link-btn" disabled={linkingAll} onClick={linkEverywhere} title="Link every mention in every note">
                  Link all
                </button>
              )}
            </div>
            {mentionsOpen && mentions.length === 0 && (
              <div className="panel-empty small">No other notes mention “{noteTitle(active)}” without linking to it.</div>
            )}
            {mentionsOpen && mentions.map((g) => <MentionGroupRow key={g.source} group={g} target={active} />)}
          </section>
        )}

        {active && (
          <section className="mentions related" data-related>
            <div className="mentions-header">
              <button className="mentions-toggle" onClick={() => useUI.setState({ relatedOpen: !relatedOpen })}>
                <ChevronRight size={13} className={`tree-chevron ${relatedOpen ? 'open' : ''}`} />
                Related notes
                <span className="panel-count">{related.length}</span>
              </button>
            </div>
            {relatedOpen && related.length === 0 && <div className="panel-empty small">Nothing similar yet. Notes with shared tags, links or wording show up here.</div>}
            {relatedOpen &&
              related.map((r) => (
                <button key={r.path} className="related-row" onClick={() => openNote(r.path)} title={r.path} data-related-path={r.path}>
                  <span className="backlink-source">
                    <FileText size={14} />
                    <span className="backlink-title">{noteTitle(r.path)}</span>
                    {parentOf(r.path) && <span className="backlink-folder">{parentOf(r.path)}</span>}
                  </span>
                  <span className="related-why">{reasons(r)}</span>
                </button>
              ))}
          </section>
        )}
      </div>
    </div>
  )
}
