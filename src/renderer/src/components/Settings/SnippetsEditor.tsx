import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { cleanTrigger, saveSnippets, useSnippets, type Snippet } from '../../store/snippets'

/** Settings → Editor → Text snippets: ;code → saved text. */
export default function SnippetsEditor() {
  const saved = useSnippets((s) => s.snippets)
  const [rows, setRows] = useState<Snippet[]>(saved)
  // Pick up changes made elsewhere (another computer, via sync) when they're loaded.
  useEffect(() => setRows(saved), [saved])

  const commit = (next: Snippet[]): void => {
    setRows(next)
    saveSnippets(next.filter((s) => s.trigger))
  }
  const update = (i: number, patch: Partial<Snippet>): void => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const duplicate = (t: string, i: number): boolean => !!t && rows.some((r, j) => j !== i && r.trigger.toLowerCase() === t.toLowerCase())

  return (
    <section className="settings-group snippets" data-snippets-editor>
      <h3>Text snippets</h3>
      <p className="settings-note">
        Type <kbd>;</kbd> and a snippet’s name, then a space, and it’s replaced by its text (typing <kbd>;</kbd> also lists them). Snippets can use{' '}
        <code>{'{{date}}'}</code>, <code>{'{{time}}'}</code>, <code>{'{{title}}'}</code> and <code>{'{{cursor}}'}</code>. They’re saved in your notes folder,
        so they’re on every computer.
      </p>
      {rows.map((s, i) => (
        <div className="snippet-row" key={i} data-snippet-row={i}>
          <label className="snippet-trigger">
            <span>;</span>
            <input
              value={s.trigger}
              placeholder="sig"
              spellCheck={false}
              aria-label="Snippet name"
              onChange={(e) => update(i, { trigger: cleanTrigger(e.target.value) })}
              onBlur={() => commit(rows)}
            />
          </label>
          <textarea
            value={s.text}
            rows={Math.min(6, Math.max(2, s.text.split('\n').length))}
            placeholder="The text it becomes"
            aria-label="Snippet text"
            onChange={(e) => update(i, { text: e.target.value })}
            onBlur={() => commit(rows)}
          />
          <button className="icon-btn" title="Delete snippet" onClick={() => commit(rows.filter((_, j) => j !== i))}>
            <Trash2 size={14} />
          </button>
          {duplicate(s.trigger, i) && <p className="setting-warning">Another snippet is also called ;{s.trigger}. The first one is used.</p>}
        </div>
      ))}
      <button className="btn" data-snippet-add onClick={() => setRows([...rows, { trigger: '', text: '' }])}>
        <Plus size={14} /> Add a snippet
      </button>
    </section>
  )
}
