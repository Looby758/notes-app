import { useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { ArrowDown, ArrowUp, ClipboardPaste, Copy, ListOrdered, Plus, Star, Trash2, X } from 'lucide-react'
import {
  chapterProblems,
  chaptersText,
  chosenTitleText,
  descriptionCheck,
  DESCRIPTION_PREVIEW,
  formatTime,
  fullDescription,
  parseChapters,
  parseTags,
  parseTime,
  tagsLength,
  tagsText,
  TAGS_MAX,
  titleCheck,
  type Level,
  type VideoDraft
} from '../../lib/publishing'
import {
  addChapter,
  addTags,
  addTitle,
  chooseTitle,
  clearTags,
  deleteChapter,
  deleteTitle,
  moveTitle,
  removeTag,
  setChapter,
  setChapters,
  setChaptersInDescription,
  setDescription,
  setTitleText,
  sortVideoChapters,
  usePublishing
} from '../../store/publishing'
import { notify } from '../../store/notify'

/** Copies text and says so. */
function copy(text: string, what: string): void {
  if (!text.trim()) return notify(`There’s no ${what} to copy yet.`, 'info')
  navigator.clipboard.writeText(text).then(() => notify(`Copied the ${what}.`, 'info'), notify)
}

const Hint = ({ level, children }: { level: Level; children: React.ReactNode }) => <span className={`pub-hint pub-${level}`}>{children}</span>

function CopyButton({ text, what }: { text: string; what: string }) {
  return (
    <button className="link-button pub-copy" onClick={() => copy(text, what)} title={`Copy the ${what} for YouTube Studio`}>
      <Copy size={13} /> Copy
    </button>
  )
}

// ---------- titles ----------

function Titles({ d }: { d: VideoDraft }) {
  const [focusId, setFocusId] = useState<string | null>(null)
  const add = (): void => setFocusId(addTitle(d.id))
  return (
    <section className="pub-section" data-pub-titles>
      <header className="pub-section-head">
        <h3>Title options</h3>
        <CopyButton text={chosenTitleText(d)} what="title" />
      </header>
      <p className="pub-intro">Write a few, then star the one you’re going with.</p>
      {d.titles.map((t, i) => {
        const check = titleCheck(t.text)
        const chosen = d.chosenTitle === t.id
        return (
          <div key={t.id} className="pub-title" data-pub-title>
            <div className={`pub-title-row ${chosen ? 'chosen' : ''}`}>
              <button
                className={`icon-btn pub-star ${chosen ? 'on' : ''}`}
                onClick={() => chooseTitle(d.id, t.id)}
                title={chosen ? 'The title you’re going with' : 'Go with this title'}
                aria-pressed={chosen}
              >
                <Star size={15} />
              </button>
              <input
                className="text-input"
                value={t.text}
                autoFocus={focusId === t.id}
                placeholder="e.g. The Entire Life of Maggie Rhee"
                aria-label={`Title option ${i + 1}`}
                onChange={(e) => setTitleText(d.id, t.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') add()
                }}
              />
              <button className="icon-btn" disabled={i === 0} onClick={() => moveTitle(d.id, t.id, -1)} title="Move up">
                <ArrowUp size={14} />
              </button>
              <button className="icon-btn" disabled={i === d.titles.length - 1} onClick={() => moveTitle(d.id, t.id, 1)} title="Move down">
                <ArrowDown size={14} />
              </button>
              <button className="icon-btn" onClick={() => deleteTitle(d.id, t.id)} title="Remove this option">
                <Trash2 size={14} />
              </button>
            </div>
            <Hint level={check.level}>{check.message}</Hint>
          </div>
        )
      })}
      <button className="btn pub-add" onClick={add} data-pub-add-title>
        <Plus size={14} /> Add a title option
      </button>
    </section>
  )
}

// ---------- description ----------

function Description({ d }: { d: VideoDraft }) {
  const check = descriptionCheck(d)
  const full = fullDescription(d)
  return (
    <section className="pub-section" data-pub-description>
      <header className="pub-section-head">
        <h3>Description</h3>
        <Hint level={check.level}>{check.message}</Hint>
        <CopyButton text={full} what="description" />
      </header>
      <p className="pub-intro">The first {DESCRIPTION_PREVIEW} or so characters show above “…more”, so put the hook there.</p>
      <textarea
        className="text-input pub-description"
        value={d.description}
        rows={8}
        placeholder="What the video is about, sources, links…"
        aria-label="Description"
        onChange={(e) => setDescription(d.id, e.target.value)}
      />
      <label className="pub-check">
        <input type="checkbox" checked={d.chaptersInDescription} onChange={(e) => setChaptersInDescription(d.id, e.target.checked)} />
        Put the chapters at the end when copying (that’s how YouTube finds them)
      </label>
      <Preview d={d} />
    </section>
  )
}

/** Roughly how the title and the top of the description look on the watch page. */
function Preview({ d }: { d: VideoDraft }) {
  const title = chosenTitleText(d)
  const text = fullDescription(d)
  if (!title && !text) return null
  const cut = text.length > DESCRIPTION_PREVIEW
  return (
    <div className="pub-preview" aria-label="Preview">
      <div className="pub-preview-label">Preview</div>
      <div className="pub-preview-title">{title || 'No title yet'}</div>
      {text && (
        <div className="pub-preview-text">
          {cut ? text.slice(0, DESCRIPTION_PREVIEW).trimEnd() : text}
          {cut && <span className="pub-preview-more">…more</span>}
        </div>
      )}
    </div>
  )
}

// ---------- tags ----------

function Tags({ d }: { d: VideoDraft }) {
  const [typing, setTyping] = useState('')
  const used = tagsLength(d.tags)
  const level: Level = used > TAGS_MAX ? 'error' : used > TAGS_MAX * 0.9 ? 'warn' : 'ok'
  const commit = (text: string): void => {
    const tags = parseTags(text)
    if (tags.length) addTags(d.id, tags)
    setTyping('')
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commit(typing)
    } else if (e.key === 'Backspace' && !typing && d.tags.length) {
      removeTag(d.id, d.tags[d.tags.length - 1])
    }
  }
  const onPaste = (e: ClipboardEvent<HTMLInputElement>): void => {
    const text = e.clipboardData.getData('text')
    if (!/[,;\n]/.test(text)) return
    e.preventDefault()
    commit(typing + text)
  }
  return (
    <section className="pub-section" data-pub-tags>
      <header className="pub-section-head">
        <h3>Tags</h3>
        <Hint level={level}>
          {used}/{TAGS_MAX}
          {level === 'error' ? ': too many for YouTube' : ''}
        </Hint>
        {d.tags.length > 0 && (
          <button className="link-button" onClick={() => clearTags(d.id)}>
            Clear
          </button>
        )}
        <CopyButton text={tagsText(d.tags)} what="tags" />
      </header>
      <div className="pub-tags">
        {d.tags.map((t) => (
          <span key={t} className="pub-tag" data-pub-tag>
            {t}
            <button onClick={() => removeTag(d.id, t)} title={`Remove “${t}”`} aria-label={`Remove ${t}`}>
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          className="pub-tag-input"
          value={typing}
          placeholder={d.tags.length ? 'Add another…' : 'Type a tag and press Enter, or paste a list'}
          aria-label="Add a tag"
          onChange={(e) => setTyping(e.target.value)}
          onKeyDown={onKey}
          onPaste={onPaste}
          onBlur={() => typing.trim() && commit(typing)}
        />
      </div>
    </section>
  )
}

// ---------- chapters ----------

function Chapters({ d }: { d: VideoDraft }) {
  const [pasting, setPasting] = useState<string | null>(null)
  const problems = chapterProblems(d.chapters)
  const general = problems.filter((p) => p.id === null)
  const nextTime = (): string => {
    const last = d.chapters.length ? parseTime(d.chapters[d.chapters.length - 1].time) : null
    return d.chapters.length === 0 ? '0:00' : last === null ? '' : formatTime(last + 60)
  }
  const usePasted = (replace: boolean): void => {
    const found = parseChapters(pasting ?? '')
    if (!found.length) return notify('No chapters found. Put one on each line, like “2:14 The prison”.', 'info')
    setChapters(d.id, replace ? found : [...d.chapters, ...found], replace && d.chapters.length ? 'Replaced the chapters' : `Added ${found.length} chapters`)
    setPasting(null)
  }
  return (
    <section className="pub-section" data-pub-chapters>
      <header className="pub-section-head">
        <h3>Chapters</h3>
        {d.chapters.length > 0 && <Hint level={problems.length ? 'warn' : 'ok'}>{problems.length ? `${problems.length} to fix` : 'Ready for YouTube'}</Hint>}
        <button className="link-button" onClick={() => setPasting(pasting === null ? '' : null)} title="Paste a list of chapters">
          <ClipboardPaste size={13} /> Paste a list
        </button>
        {d.chapters.length > 1 && (
          <button className="link-button" onClick={() => sortVideoChapters(d.id)} title="Put them in time order">
            <ListOrdered size={13} /> Sort
          </button>
        )}
        <CopyButton text={chaptersText(d.chapters)} what="chapters" />
      </header>
      <p className="pub-intro">YouTube needs the first at 0:00, at least three, and each one 10 seconds or longer.</p>
      {pasting !== null && (
        <div className="pub-paste">
          <textarea
            className="text-input"
            autoFocus
            rows={5}
            value={pasting}
            placeholder={'0:00 Intro\n1:30 Before the outbreak\n6:45 The prison'}
            aria-label="Chapters to paste"
            onChange={(e) => setPasting(e.target.value)}
          />
          <div className="pub-paste-actions">
            <button className="btn btn-primary" onClick={() => usePasted(d.chapters.length === 0)}>
              {d.chapters.length ? 'Add these' : 'Use these'}
            </button>
            {d.chapters.length > 0 && (
              <button className="btn" onClick={() => usePasted(true)}>
                Replace all
              </button>
            )}
            <button className="link-button" onClick={() => setPasting(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {d.chapters.map((c, i) => {
        const mine = problems.filter((p) => p.id === c.id)
        return (
          <div key={c.id} className="pub-chapter" data-pub-chapter>
            <div className="pub-chapter-row">
              <input
                className={`text-input pub-chapter-time ${mine.length && parseTime(c.time) === null ? 'bad' : ''}`}
                value={c.time}
                placeholder="0:00"
                aria-label={`Chapter ${i + 1} time`}
                onChange={(e) => setChapter(d.id, c.id, { time: e.target.value })}
                onBlur={() => {
                  const at = parseTime(c.time)
                  if (at !== null && formatTime(at) !== c.time) setChapter(d.id, c.id, { time: formatTime(at) })
                }}
              />
              <input
                className="text-input"
                value={c.name}
                placeholder="What this part is about"
                aria-label={`Chapter ${i + 1} name`}
                onChange={(e) => setChapter(d.id, c.id, { name: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && i === d.chapters.length - 1) addChapter(d.id, nextTime())
                }}
              />
              <button className="icon-btn" onClick={() => deleteChapter(d.id, c.id)} title="Remove this chapter">
                <Trash2 size={14} />
              </button>
            </div>
            {mine.map((p) => (
              <Hint key={p.message} level="warn">
                {p.message}
              </Hint>
            ))}
          </div>
        )
      })}
      {general.map((p) => (
        <Hint key={p.message} level="warn">
          {p.message}
        </Hint>
      ))}
      <button className="btn pub-add" onClick={() => addChapter(d.id, nextTime())} data-pub-add-chapter>
        <Plus size={14} /> Add a chapter
      </button>
    </section>
  )
}

/**
 * A video's title options, description, tags and chapters. Shown on the Publishing page, and
 * meant to sit inside a video project too: give it the project's id (store/publishing's
 * videoDraftFor makes the record the first time).
 */
export default function PublishingDrafts({ videoId }: { videoId: string }) {
  const d = usePublishing((s) => s.videos.find((v) => v.id === videoId))
  if (!d) return null
  return (
    <div className="pub-drafts" data-pub-drafts>
      <Titles d={d} />
      <Description d={d} />
      <Tags d={d} />
      <Chapters d={d} />
    </div>
  )
}
