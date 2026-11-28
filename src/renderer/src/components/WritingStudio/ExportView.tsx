import { useDeferredValue, useMemo, useState, type CSSProperties } from 'react'
import { BookDown, Check, ClipboardCopy, FileText, FolderOpen, Plus, Tags, X } from 'lucide-react'
import { chapterWords, storyWords } from '@shared/writing'
import { notify } from '../../store/notify'
import { change, setStoryField, useWriting } from '../../store/writingStudio'
import { ao3Suggest, AO3_RATINGS, AO3_WARNINGS } from '@shared/writingTools'
import { copyForAo3, copyForWattpad, saveEpub, saveText } from '../../lib/writingExport'

/** Export: a chapter ready to paste into AO3 or Wattpad, or the whole story as an e-book or text file. Only the take in use of each scene goes out. */
export default function ExportView() {
  const story = useWriting((s) => s.story)!
  const [copied, setCopied] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const copy = async (key: string, run: () => Promise<void>): Promise<void> => {
    try {
      await run()
      setCopied(key)
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 2500)
    } catch (err) {
      notify(err)
    }
  }
  const save = async (run: () => Promise<string | null>): Promise<void> => {
    try {
      const path = await run()
      if (path) setSaved(path)
    } catch (err) {
      notify(err)
    }
  }

  return (
    <div className="ws-export" data-ws-export>
      <div className="ws-export-inner">
        <section className="ws-export-book">
          <h2>The whole story</h2>
          <p>
            {storyWords(story).toLocaleString()} words in {story.chapters.length} chapter{story.chapters.length === 1 ? '' : 's'}. Only the take you’re using for each scene is included.
          </p>
          <label className="ws-field">
            <span>Author name (on the e-book)</span>
            <input className="ws-input" defaultValue={story.author} maxLength={120} placeholder="Your name or pen name" onBlur={(e) => setStoryField({ author: e.target.value.trim() })} data-ws-author />
          </label>
          <div className="ws-export-buttons">
            <button className="btn btn-primary" onClick={() => void save(() => saveEpub(useWriting.getState().story!))} data-ws-save-epub>
              <BookDown size={14} /> Save as an e-book (.epub)
            </button>
            <button className="btn" onClick={() => void save(() => saveText(useWriting.getState().story!))} data-ws-save-txt>
              <FileText size={14} /> Save as text
            </button>
          </div>
          {saved && (
            <p className="ws-saved">
              Saved.{' '}
              <button className="link-button" onClick={() => void window.api.showExported(saved)}>
                <FolderOpen size={12} /> Show it
              </button>
            </p>
          )}
          <p className="ws-panel-tip">E-books open in Apple Books, Google Play Books and Calibre, and go onto a Kindle with Send to Kindle.</p>
        </section>

        <TagHelper />

        <section className="ws-export-chapters">
          <h2>One chapter at a time</h2>
          <p className="ws-panel-tip">
            <b>AO3:</b> paste into the chapter box (Rich Text or HTML, both work). <b>Wattpad:</b> paste into the part editor. Italics written as *like this* come through.
          </p>
          {story.chapters.map((c) => (
            <div key={c.id} className="ws-export-row" data-ws-export-chapter={c.id}>
              <span className="ws-export-title">{c.title}</span>
              <span className="ws-count">{chapterWords(c).toLocaleString()} words</span>
              <button className="btn" onClick={() => void copy(`ao3${c.id}`, () => copyForAo3(c))} data-ws-copy-ao3>
                {copied === `ao3${c.id}` ? <Check size={13} /> : <ClipboardCopy size={13} />} {copied === `ao3${c.id}` ? 'Copied' : 'Copy for AO3'}
              </button>
              <button className="btn" onClick={() => void copy(`wp${c.id}`, () => copyForWattpad(c))} data-ws-copy-wattpad>
                {copied === `wp${c.id}` ? <Check size={13} /> : <ClipboardCopy size={13} />} {copied === `wp${c.id}` ? 'Copied' : 'Copy for Wattpad'}
              </button>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}

// ---------- AO3 tags ----------

/** Tags for posting on AO3, worked out from the story brain, to check and copy into AO3's boxes. */
function TagHelper() {
  const story = useWriting((s) => s.story)!
  const deferred = useDeferredValue(story)
  const sug = useMemo(() => ao3Suggest(deferred), [deferred])
  const [copied, setCopied] = useState<string | null>(null)
  const [extra, setExtra] = useState('')
  const tags = story.tags
  const hidden = new Set(tags.hidden)
  const rating = tags.rating || sug.rating
  const warnings = tags.warnings.length ? tags.warnings : sug.warnings
  const relationships = sug.relationships.filter((t) => !hidden.has(t))
  const characters = sug.characters.filter((t) => !hidden.has(t))
  const freeform = [...sug.freeform.filter((t) => !hidden.has(t)), ...tags.extra]
  const fandom = tags.fandom || sug.fandom

  const copy = (key: string, text: string): void => {
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(key)
        setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000)
      })
      .catch(notify)
  }
  const hide = (t: string): void => change(`Took off “${t}”`, (s) => void (s.tags.hidden = [...new Set([...s.tags.hidden, t])]))
  const toggleWarning = (w: string): void =>
    change(null, (s) => {
      const now = s.tags.warnings.length ? s.tags.warnings : sug.warnings
      let next = now.includes(w) ? now.filter((x) => x !== w) : [...now, w]
      // "No warnings" and the real warnings don't go together.
      if (w === 'No Archive Warnings Apply' && next.includes(w)) next = [w]
      else next = next.filter((x) => x !== 'No Archive Warnings Apply' || w === x)
      s.tags.warnings = next.length ? next : ['No Archive Warnings Apply']
    })
  const addExtra = (): void => {
    const t = extra.trim().replace(/,/g, '')
    if (!t) return
    change(null, (s) => void (s.tags.extra = [...new Set([...s.tags.extra, t.slice(0, 150)])]))
    setExtra('')
  }
  const all = [
    `Rating: ${rating}`,
    `Archive Warnings: ${warnings.join(', ')}`,
    fandom ? `Fandoms: ${fandom}` : '',
    relationships.length ? `Relationships: ${relationships.join(', ')}` : '',
    characters.length ? `Characters: ${characters.join(', ')}` : '',
    freeform.length ? `Additional Tags: ${freeform.join(', ')}` : ''
  ]
    .filter(Boolean)
    .join('\n')

  const CopyBtn = ({ k, text }: { k: string; text: string }) => (
    <button className="icon-btn ws-tag-copy" onClick={() => copy(k, text)} disabled={!text} title="Copy (commas between, the way AO3 takes them)">
      {copied === k ? <Check size={13} /> : <ClipboardCopy size={13} />}
    </button>
  )
  const Chips = ({ list, k, removable = true, mine = [] as string[] }: { list: string[]; k: string; removable?: boolean; mine?: string[] }) => (
    <div className="ws-tag-chips">
      {!list.length && <span className="ws-hint">None yet</span>}
      {list.map((t, i) => (
        <span key={t} className="ws-tag" style={{ '--i': i } as CSSProperties}>
          {t}
          {removable && (
            <button onClick={() => (mine.includes(t) ? change(null, (s) => void (s.tags.extra = s.tags.extra.filter((x) => x !== t))) : hide(t))} title="Take this tag off">
              <X size={10} />
            </button>
          )}
        </span>
      ))}
      <CopyBtn k={k} text={list.join(', ')} />
    </div>
  )

  return (
    <section className="ws-export-tags" data-ws-tags>
      <h2>
        <Tags size={18} /> AO3 tags
      </h2>
      <p className="ws-panel-tip">Worked out from the story brain: who’s in it most, your relationships (“A/B” for a romance, “A & B” otherwise), and warnings from what happens. Check them, then copy each into AO3.</p>
      <div className="ws-tag-grid">
        <span className="ws-tag-label">Fandom</span>
        <div className="ws-tag-chips">
          <input className="ws-input" defaultValue={fandom} key={fandom} maxLength={200} placeholder="The Walking Dead (TV)" onBlur={(e) => change(null, (s) => void (s.tags.fandom = e.target.value.trim()))} data-ws-tag-fandom />
          <CopyBtn k="fandom" text={fandom} />
        </div>

        <span className="ws-tag-label">Rating</span>
        <div className="ws-tag-chips">
          <select className="ws-select" value={rating} onChange={(e) => change(null, (s) => void (s.tags.rating = e.target.value))} data-ws-tag-rating>
            {AO3_RATINGS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          {!tags.rating && <span className="ws-hint">Suggested: {sug.ratingWhy}</span>}
        </div>

        <span className="ws-tag-label">Warnings</span>
        <div className="ws-tag-chips">
          {AO3_WARNINGS.map((w) => (
            <button key={w} className={`ws-tag-pick ${warnings.includes(w) ? 'on' : ''}`} onClick={() => toggleWarning(w)} data-ws-tag-warning={w}>
              {warnings.includes(w) && <Check size={11} />} {w}
            </button>
          ))}
        </div>

        <span className="ws-tag-label">Relationships</span>
        <Chips list={relationships} k="rels" />

        <span className="ws-tag-label">Characters</span>
        <Chips list={characters} k="chars" />

        <span className="ws-tag-label">Additional tags</span>
        <div>
          <Chips list={freeform} k="free" mine={tags.extra} />
          <div className="ws-tag-add">
            <input className="ws-input" placeholder="Add a tag, like Hurt/Comfort" value={extra} maxLength={150} onChange={(e) => setExtra(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addExtra()} data-ws-tag-extra />
            <button className="btn" onClick={addExtra} disabled={!extra.trim()}>
              <Plus size={13} /> Add
            </button>
          </div>
        </div>
      </div>
      <div className="ws-export-buttons">
        <button className="btn btn-primary" onClick={() => copy('all', all)} data-ws-tags-copy>
          {copied === 'all' ? <Check size={14} /> : <ClipboardCopy size={14} />} {copied === 'all' ? 'Copied' : 'Copy all the tags'}
        </button>
        {tags.hidden.length > 0 && (
          <button className="link-button" onClick={() => change('Brought back the tags you took off', (s) => void (s.tags.hidden = []))}>
            Bring back {tags.hidden.length} tag{tags.hidden.length === 1 ? '' : 's'} you took off
          </button>
        )}
      </div>
    </section>
  )
}
