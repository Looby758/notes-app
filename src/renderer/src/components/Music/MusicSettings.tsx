import './music.css'
import { useEffect, useState } from 'react'
import { Check, ChevronDown, Copy, ExternalLink, LogOut, Music } from 'lucide-react'
import { refreshMusicStatus, setMusicOpen, useMusic } from '../../store/music'
import { errorMessage } from '../../lib/paths'
import { SYSTEM_NAME } from '@shared/platform'

/** Settings → Music: what the player can do straight away, and connecting your Spotify account. */
export default function MusicSettings() {
  const status = useMusic((s) => s.status)
  const [clientId, setClientId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [helpOpen, setHelpOpen] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    refreshMusicStatus().then((s) => setClientId(s.clientId))
  }, [])

  const run = async (job: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await job()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      await refreshMusicStatus()
      setBusy(false)
    }
  }

  const connect = (): Promise<void> =>
    run(async () => {
      await window.api.musicSetClient(clientId)
      await window.api.musicConnect()
      setMusicOpen(true)
    })

  if (!status) return null
  const open = (url: string) => () => window.open(url)
  return (
    <section className="settings-group cal-sources" data-section="music">
      <h3>Spotify</h3>
      <p className="cal-sources-intro">
        The music player sits in the bottom-left corner: show or hide it with <Music size={12} /> at the top. It shows what’s
        playing, with play/pause, skip, shuffle, repeat and volume.
      </p>
      {status.appControl && (
        <p className="cal-sources-intro">
          On a Mac it works straight away with the Spotify app, no sign-in needed. The first time, macOS asks whether Notes may
          control Spotify: press <strong>OK</strong>. You can also paste a Spotify link into the player to play it.
        </p>
      )}
      <p className="cal-sources-intro">
        Connect your Spotify account to also <strong>search</strong> Spotify, pick from <strong>your playlists</strong>, like
        songs, see <strong>what’s up next</strong> and <strong>what you’ve played</strong>, and choose where it plays
        {status.appControl ? ' (including your phone or speakers)' : ''}. Spotify only allows this with{' '}
        <strong>Spotify Premium</strong>, and you make a free “developer app” on Spotify’s site once (about 3 minutes).
      </p>

      {status.connected ? (
        <div className="cal-connected">
          <span className="cal-connected-dot" />
          <span>Connected{status.name ? ` as ${status.name}` : ''}.</span>
          <button className="btn" disabled={busy} onClick={() => run(() => window.api.musicDisconnect())} data-music-disconnect>
            <LogOut size={13} /> Disconnect
          </button>
        </div>
      ) : (
        <>
          <button className="cal-help-toggle" onClick={() => setHelpOpen(!helpOpen)}>
            <ChevronDown size={13} className={helpOpen ? 'open' : ''} /> How to connect (one-time)
          </button>
          {helpOpen && (
            <ol className="cal-help">
              <li>
                Open the{' '}
                <button className="link-btn" onClick={open('https://developer.spotify.com/dashboard')}>
                  Spotify developer dashboard <ExternalLink size={11} />
                </button>{' '}
                and log in with your normal Spotify account. Accept the terms if it asks.
              </li>
              <li>
                Press <strong>Create app</strong>. Give it any name (like “Notes”) and description.
              </li>
              <li>
                Under <strong>Redirect URIs</strong>, paste this exactly and press <strong>Add</strong>:{' '}
                <span className="music-redirect">
                  <code>{status.redirectUri}</code>
                  <button
                    className="link-btn"
                    onClick={async () => {
                      await navigator.clipboard.writeText(status.redirectUri)
                      setCopied(true)
                      setTimeout(() => setCopied(false), 1500)
                    }}
                  >
                    {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? 'Copied' : 'Copy'}
                  </button>
                </span>
              </li>
              <li>
                Under “Which API/SDKs are you planning to use?”, tick <strong>Web API</strong>. Tick the terms box and press{' '}
                <strong>Save</strong>.
              </li>
              <li>
                Copy the <strong>Client ID</strong> it shows (32 letters and numbers), paste it below, and press{' '}
                <strong>Connect Spotify</strong>.
              </li>
              <li>
                Your browser opens Spotify’s page: press <strong>Agree</strong>.
              </li>
            </ol>
          )}
          <div className="cal-client">
            <label style={{ gridColumn: '1 / -1' }}>
              Client ID
              <input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && clientId.trim() && connect()}
                placeholder="e.g. 1a2b3c4d5e6f…"
                spellCheck={false}
                data-music-client-id
              />
            </label>
            <div className="cal-client-actions">
              <button className="btn btn-primary" disabled={busy || !clientId.trim() || !status.canEncrypt} onClick={connect} data-music-connect>
                <Music size={14} /> {busy ? 'Waiting for Spotify…' : 'Connect Spotify'}
              </button>
            </div>
          </div>
          <p className="cal-note">
            There’s no password or secret to copy. Your sign-in is stored encrypted on this computer using the protection built
            into {SYSTEM_NAME}. If Spotify later says your account isn’t allowed, add your Spotify email under{' '}
            <strong>User Management</strong> in your app on the dashboard.
          </p>
        </>
      )}
      {status.connected && status.needsReconnect && (
        <p className="setting-warning" data-music-reconnect>
          To like songs and see what you’ve played recently, Orbit needs a little more permission: press <strong>Disconnect</strong>, then connect again.
        </p>
      )}
      {status.error && !error && <p className="setting-warning">{status.error}</p>}
      {!status.canEncrypt && <p className="setting-warning">This computer can’t encrypt the sign-in, so Spotify can’t be connected.</p>}
      {error && <p className="setting-warning">{error}</p>}
    </section>
  )
}
