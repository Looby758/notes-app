import { useState } from 'react'
import { BookDown, Check, ClipboardCopy, FileText, FolderOpen } from 'lucide-react'
import { chapterWords, storyWords } from '@shared/writing'
import { notify } from '../../store/notify'
import { setStoryField, useWriting } from '../../store/writingStudio'
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
