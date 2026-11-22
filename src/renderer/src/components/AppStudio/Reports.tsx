import { useEffect, useState } from 'react'
import { Bug, ChevronDown, EyeOff, ExternalLink, Inbox, Loader2, Megaphone, MessageSquare, Plus, RefreshCw } from 'lucide-react'
import { newReports, reportButtonCard, timeAgo, type BugReport } from '@shared/appStudio'
import { addItem, useAppBoard } from '../../store/appBoard'
import { addReportToBoard, hideReport, loadReports, useAppReports } from '../../store/appReports'
import { usePrefs } from '../../store/prefs'
import { notify } from '../../store/notify'

/** Reports are read from GitHub again when the board is opened after this long. */
const FRESH_MS = 3 * 60_000

/**
 * Above an app's board: bug reports from the people using it (the open issues on its GitHub
 * repository) that aren't on the board yet. Add one and it becomes a card, pictures and all;
 * hide the ones that don't need doing.
 */
export default function Reports({ app }: { app: { key: string; name: string; repo?: string } }) {
  const repo = app.repo
  const data = useAppReports((s) => (repo ? s.byRepo[repo] : undefined))
  const loading = useAppReports((s) => (repo ? !!s.loading[repo] : false))
  const hidden = useAppReports((s) => s.hidden)
  const items = useAppBoard((s) => s.items)
  const folder = usePrefs((s) => s.prefs.attachmentFolder)
  const [open, setOpen] = useState(true)
  const [adding, setAdding] = useState<number | null>(null)

  useEffect(() => {
    if (repo && (!data || Date.now() - data.at > FRESH_MS)) void loadReports(repo)
    // Only when the app changes.
  }, [repo])

  if (!repo) return null
  const list = newReports(data?.reports ?? [], items, hidden)
  const hasButtonCard = items.some((i) => i.app === app.key && /report a bug/i.test(i.title))

  const add = async (r: BugReport): Promise<void> => {
    setAdding(r.number)
    try {
      await addReportToBoard(r, app.key, folder)
      notify(`Put “${r.title}” on the board.`, 'info')
    } catch (err) {
      notify(err)
    } finally {
      setAdding(null)
    }
  }

  const askForButton = (): void => {
    const card = reportButtonCard({ name: app.name, repo })
    addItem(app.key, 'idea', card.title, card.details)
    notify('Put “Add a Report a bug button” on the board. Send it to Claude from there.', 'info')
  }

  return (
    <section className="reports">
      <button className="reports-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Inbox size={14} />
        <strong>Reports from people using {app.name}</strong>
        {list.length > 0 && <span className="appstudio-count accent">{list.length}</span>}
        <span className="board-spacer" />
        {data?.error && <span className="reports-error">{data.error}</span>}
        <span
          className="icon-btn"
          role="button"
          title="Check GitHub again"
          onClick={(e) => {
            e.stopPropagation()
            void loadReports(repo)
          }}
        >
          {loading ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
        </span>
        <ChevronDown size={14} className={open ? 'appstudio-health-chevron open' : 'appstudio-health-chevron'} />
      </button>
      {open && (
        <div className="reports-body">
          {list.map((r) => (
            <div key={r.number} className="report-row">
              <Bug size={13} className="board-kind bug" />
              <div className="report-text">
                <a href={r.url} target="_blank" rel="noreferrer" className="report-title">
                  {r.title}
                </a>
                <span className="muted">
                  {r.author} · {timeAgo(r.createdAt)}
                  {r.comments > 0 && (
                    <>
                      {' '}
                      · <MessageSquare size={10} /> {r.comments}
                    </>
                  )}
                  {r.labels.length > 0 && <> · {r.labels.join(', ')}</>}
                </span>
                {r.body.trim() && <span className="report-body">{r.body.replace(/<!--[\s\S]*?-->/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '[picture]').replace(/\s+/g, ' ').trim().slice(0, 220)}</span>}
              </div>
              <button className="btn" disabled={adding === r.number} onClick={() => void add(r)} title="Make it a card on the board (its pictures too)">
                {adding === r.number ? <Loader2 size={13} className="spin" /> : <Plus size={13} />} Add to board
              </button>
              <button className="icon-btn" title="Hide it from this list (it stays open on GitHub)" onClick={() => hideReport(r)}>
                <EyeOff size={13} />
              </button>
              <a className="icon-btn" href={r.url} target="_blank" rel="noreferrer" title="Open on GitHub">
                <ExternalLink size={13} />
              </a>
            </div>
          ))}
          {!list.length && !loading && (
            <p className="muted reports-empty">
              {data?.reports.length ? 'Every report is on the board.' : 'No reports yet.'} People report bugs as issues on{' '}
              <a href={`https://github.com/${repo}/issues`} target="_blank" rel="noreferrer">
                {repo}
              </a>
              .
              {!hasButtonCard && (
                <>
                  {' '}
                  <button className="link-button" onClick={askForButton}>
                    <Megaphone size={12} /> Ask Claude to add a Report a bug button
                  </button>{' '}
                  so they can do it from inside the app.
                </>
              )}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
