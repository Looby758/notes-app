import { useEffect, useState } from 'react'
import { CalendarPlus, ChevronDown, ExternalLink, Link2, LogOut, RefreshCw, Trash2 } from 'lucide-react'
import type { CalendarSourcesStatus } from '@shared/types'
import { refreshExternal } from '../../store/externalEvents'
import { errorMessage } from '../../lib/paths'
import { SYSTEM_NAME } from '@shared/platform'

/** Settings → Calendar → "Google Calendar & calendar links". Everything here is read-only. */
export default function CalendarSources() {
  const [status, setStatus] = useState<CalendarSourcesStatus | null>(null)
  const [clientId, setClientId] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [feedName, setFeedName] = useState('')
  const [feedUrl, setFeedUrl] = useState('')
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => {
    window.api.calendarSources().then((s) => {
      setStatus(s)
      setClientId(s.google.clientId)
    })
  }, [])

  /** Runs a change, shows any error, and refreshes the calendars on success. */
  const run = async (label: string, job: () => Promise<CalendarSourcesStatus>): Promise<void> => {
    setBusy(label)
    setError(null)
    try {
      setStatus(await job())
      refreshExternal()
    } catch (err) {
      setError(errorMessage(err))
      setStatus(await window.api.calendarSources())
    } finally {
      setBusy(null)
    }
  }

  if (!status) return null
  const g = status.google
  const clientChanged = clientId.trim() !== g.clientId || secret.trim() !== ''

  return (
    <>
      <section className="settings-group cal-sources" data-section="google">
        <h3>Google Calendar</h3>
        <p className="cal-sources-intro">
          See your Google Calendar events next to your notes (read-only). Sign-in happens in your own browser; Notes only
          gets permission to <em>read</em> your calendars, and the sign-in is stored encrypted on this computer.
        </p>

        {g.connected ? (
          <div className="cal-connected">
            <span className="cal-connected-dot" />
            <span>
              Connected{g.email ? <> as <strong>{g.email}</strong></> : ''}
            </span>
            <button className="btn" disabled={!!busy} onClick={() => run('refresh', () => window.api.googleConnect())} title="Sign in again (e.g. to pick up new calendars)">
              <RefreshCw size={13} /> Reconnect
            </button>
            <button className="btn" disabled={!!busy} onClick={() => run('disconnect', () => window.api.googleDisconnect())}>
              <LogOut size={13} /> Disconnect
            </button>
          </div>
        ) : (
          <>
            <button className="cal-help-toggle" onClick={() => setHelpOpen(!helpOpen)}>
              <ChevronDown size={13} className={helpOpen ? 'open' : ''} /> How to get a client ID (one-time, about 5 minutes)
            </button>
            {helpOpen && (
              <ol className="cal-help">
                <li>
                  Go to <button className="link-btn" onClick={() => window.open('https://console.cloud.google.com/apis/credentials')}>Google Cloud Console → Credentials <ExternalLink size={11} /></button> and create a project (any name).
                </li>
                <li>
                  Enable the <strong>Google Calendar API</strong> for it (APIs &amp; Services → Library).
                </li>
                <li>
                  Under <strong>OAuth consent screen</strong>, choose “External”, fill in the app name, and add your own Google
                  account as a <strong>test user</strong>.
                </li>
                <li>
                  Under <strong>Credentials</strong>, create an <strong>OAuth client ID</strong> of type <strong>Desktop app</strong>, then
                  paste its client ID and secret below.
                </li>
              </ol>
            )}
            <div className="cal-client">
              <label>
                Client ID
                <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="…apps.googleusercontent.com" spellCheck={false} />
              </label>
              <label>
                Client secret
                <input
                  type="password"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder={g.hasSecret ? 'Saved (type to replace)' : 'GOCSPX-…'}
                  spellCheck={false}
                />
              </label>
              <div className="cal-client-actions">
                {clientChanged && (
                  <button
                    className="btn"
                    disabled={!!busy || !clientId.trim()}
                    onClick={() =>
                      run('save', async () => {
                        const s = await window.api.googleSetClient(clientId, secret)
                        setSecret('')
                        return s
                      })
                    }
                  >
                    Save
                  </button>
                )}
                <button
                  className="btn btn-primary"
                  disabled={!!busy || !status.canEncrypt || !clientId.trim() || (!g.hasSecret && !secret.trim())}
                  onClick={() =>
                    run('connect', async () => {
                      if (clientChanged) {
                        await window.api.googleSetClient(clientId, secret)
                        setSecret('')
                      }
                      return window.api.googleConnect()
                    })
                  }
                >
                  <CalendarPlus size={14} /> {busy === 'connect' ? 'Waiting for you in your browser…' : 'Connect Google Calendar'}
                </button>
              </div>
            </div>
            <p className="cal-note">
              While your Google project is in “Testing” mode, Google ends sign-ins after 7 days and you’ll need to reconnect.
              If that gets annoying, use a calendar link below instead: it never expires.
            </p>
          </>
        )}

        {g.error && <p className="setting-warning">{g.error}</p>}
        {!status.canEncrypt && <p className="setting-warning">{SYSTEM_NAME} can’t protect saved sign-ins on this computer, so connecting is turned off.</p>}

        {g.connected && g.calendars.length > 0 && (
          <div className="cal-list">
            {g.calendars.map((c) => (
              <div key={c.id} className="setting-row cal-row" data-calendar={c.id}>
                <span className="cal-color" style={{ background: c.color }} />
                <span className="cal-name">{c.name}</span>
                <button
                  role="switch"
                  aria-checked={c.enabled}
                  aria-label={`Show ${c.name}`}
                  className={`switch ${c.enabled ? 'on' : ''}`}
                  onClick={() => run('toggle', () => window.api.googleSetCalendarEnabled(c.id, !c.enabled))}
                >
                  <span className="switch-knob" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="settings-group cal-sources" data-section="feeds">
        <h3>Calendar links</h3>
        <p className="cal-sources-intro">
          No sign-in needed: in Google Calendar, open a calendar’s <strong>Settings and sharing</strong> and copy its{' '}
          <strong>Secret address in iCal format</strong>. Works with Outlook and Apple calendar links too. Links are
          stored encrypted.
        </p>
        {status.feeds.map((f) => (
          <div key={f.id} className="setting-row cal-row" data-feed={f.id}>
            <span className="cal-color" style={{ background: f.color }} />
            <span className="cal-name">
              {f.name}
              {f.error && <span className="setting-warning"> · {f.error}</span>}
            </span>
            <button className="icon-btn" title="Remove this calendar" onClick={() => run('remove', () => window.api.removeCalendarFeed(f.id))}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <form
          className="cal-feed-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (!feedUrl.trim()) return
            run('add', async () => {
              const s = await window.api.addCalendarFeed(feedName || 'Calendar', feedUrl)
              setFeedName('')
              setFeedUrl('')
              return s
            })
          }}
        >
          <input value={feedName} onChange={(e) => setFeedName(e.target.value)} placeholder="Name, e.g. Work" />
          <input value={feedUrl} onChange={(e) => setFeedUrl(e.target.value)} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" spellCheck={false} />
          <button className="btn" type="submit" disabled={!!busy || !feedUrl.trim()}>
            <Link2 size={13} /> Add link
          </button>
        </form>
        {error && <p className="setting-warning cal-error">{error}</p>}
      </section>
    </>
  )
}
