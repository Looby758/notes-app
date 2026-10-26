import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { PLACEHOLDERS } from '../Editor/slash'
import { fillTemplate } from '../../lib/templates'

/** Settings → Calendar: the placeholders a template can use, with what each becomes today. */
export default function PlaceholderHelp() {
  const [copied, setCopied] = useState<string | null>(null)
  const today = (code: string): string => (code === '{{title}}' ? 'the note’s name' : code === '{{cursor}}' ? '(where you start typing)' : fillTemplate(code, { title: '' }).text)
  return (
    <section className="settings-group placeholders" data-placeholder-help>
      <h3>Template placeholders</h3>
      <p className="settings-note">
        Put these in a template (any note in your templates folder). They’re filled in when a note is made from it; in a daily note, dates are that day’s.
        Mix your own: <code>dddd</code> weekday · <code>ddd</code> short weekday · <code>D</code> day · <code>MMMM</code> month · <code>MMM</code> short month ·{' '}
        <code>MM</code> month number · <code>YYYY</code> year.
      </p>
      <div className="placeholder-table">
        {PLACEHOLDERS.map((p) => (
          <div key={p.code} className="placeholder-row">
            <code>{p.code}</code>
            <span>{today(p.code)}</span>
            <button
              className="icon-btn"
              title="Copy"
              onClick={() =>
                navigator.clipboard.writeText(p.code).then(() => {
                  setCopied(p.code)
                  setTimeout(() => setCopied(null), 1200)
                })
              }
            >
              {copied === p.code ? <Check size={13} /> : <Copy size={13} />}
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
