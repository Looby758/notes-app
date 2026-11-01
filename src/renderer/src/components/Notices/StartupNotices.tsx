import { useEffect, useState } from 'react'
import { RotateCcw, Sparkles, TriangleAlert } from 'lucide-react'
import { GITHUB_REPO } from '@shared/release'
import { checkOnStart, closeWhatsNew, useNotices } from '../../store/notices'

/** "Fix your settings" (when a settings file is broken), then "What's new" after an update. */
export default function StartupNotices() {
  const broken = useNotices((s) => s.broken)
  const whatsNew = useNotices((s) => s.whatsNew)
  useEffect(() => void checkOnStart(), [])
  if (broken) return <BrokenSettings />
  if (whatsNew) return <WhatsNew />
  return null
}

function BrokenSettings() {
  const broken = useNotices((s) => s.broken) ?? []
  const [busy, setBusy] = useState<string | null>(null)
  const [restarting, setRestarting] = useState(false)
  const [error, setError] = useState('')
  const close = (): void => useNotices.setState({ broken: null })

  const reset = async (file: string): Promise<void> => {
    setBusy(file)
    setError('')
    try {
      const result = await window.api.resetSettingsFile(file)
      if (result.restarting) setRestarting(true)
      else {
        const left = broken.filter((b) => b.file !== file)
        useNotices.setState({ broken: left.length ? left : null })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal notice-dialog" data-broken-settings onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && close()} tabIndex={-1} ref={(el) => el?.focus()}>
        <h3>
          <TriangleAlert size={16} /> Some settings need a reset
        </h3>
        {restarting ? (
          <p className="notice-intro">Restarting Orbit…</p>
        ) : (
          <>
            <ul className="notice-broken">
              {broken.map((b) => (
                <li key={b.file}>
                  <p>{b.detail}</p>
                  <button className="btn btn-primary" disabled={!!busy} onClick={() => void reset(b.file)} data-reset-settings={b.file}>
                    <RotateCcw size={13} /> {busy === b.file ? 'Resetting…' : `Reset ${b.label}`}
                  </button>
                </li>
              ))}
            </ul>
            <p className="notice-small">
              Only that part starts fresh. The old file stays in Orbit’s settings folder with “broken” in its name, in case you want it back.
            </p>
            {error && (
              <p className="setting-warning" role="alert">
                {error}
              </p>
            )}
            <div className="notice-foot">
              <button className="btn" onClick={close}>
                Not now
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function WhatsNew() {
  const notes = useNotices((s) => s.whatsNew) ?? []
  const newest = notes[0]?.version
  return (
    <div className="modal-backdrop" onMouseDown={closeWhatsNew}>
      <div className="modal notice-dialog" data-whats-new onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && closeWhatsNew()} tabIndex={-1} ref={(el) => el?.focus()}>
        <h3>
          <Sparkles size={16} /> What’s new in Orbit {newest}
        </h3>
        <div className="notice-releases">
          {notes.map((n) => (
            <section key={n.version}>
              {notes.length > 1 && <h4>{n.version}</h4>}
              {n.items.length ? (
                <ul>
                  {n.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="notice-intro">Orbit was updated to {n.version}.</p>
              )}
            </section>
          ))}
        </div>
        <div className="notice-foot">
          <button className="btn" onClick={() => window.open(`https://github.com/${GITHUB_REPO}/releases`)}>
            All releases
          </button>
          <button className="btn btn-primary" onClick={closeWhatsNew} data-whats-new-close>
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}
