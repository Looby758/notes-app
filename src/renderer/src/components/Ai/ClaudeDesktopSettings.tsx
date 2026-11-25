import './ai.css'
import { useEffect, useState } from 'react'
import { Check, Copy, KeyRound, Plug, Unplug } from 'lucide-react'
import { CLAUDE_AREAS, type ClaudeArea, type ClaudeDesktopStatus, type ConnectResult } from '@shared/claudeDesktop'
import { IS_MAC } from '@shared/platform'
import { errorMessage } from '../../lib/paths'

function Switch({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)}>
      <span className="switch-knob" />
    </button>
  )
}

/**
 * Settings → AI → Claude Desktop: lets the Claude Desktop app look at Orbit (main/claudeDesktop.ts),
 * which parts it can see, and the button that sets Claude Desktop up.
 */
export default function ClaudeDesktopSettings() {
  const [status, setStatus] = useState<ClaudeDesktopStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ConnectResult | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void window.api.claudeDesktopStatus().then(setStatus)
  }, [])

  const run = async (job: () => Promise<ClaudeDesktopStatus | void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const next = await job()
      if (next) {
        setStatus(next)
        if (next.error) setError(next.error)
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const connect = (): Promise<void> =>
    run(async () => {
      const r = await window.api.connectClaudeDesktop()
      setResult(r)
      setCopied(false)
      return window.api.claudeDesktopStatus()
    })

  if (!status) return null
  return (
    <section className="settings-group cal-sources ai-settings" data-section="claude-desktop">
      <h3>Claude Desktop</h3>
      <p className="cal-sources-intro">
        Lets the Claude Desktop app look at Orbit, so you can ask it things like “look at the error in App Studio” or “what have I
        got on this week?” without copying and pasting. It uses your normal Claude plan, so there’s no API key and nothing extra to
        pay.
      </p>

      <div className="setting-row">
        <div className="setting-text">
          <label>Let Claude Desktop see Orbit</label>
          <p>Only this computer can reach it, and Orbit needs to be open while you use it.</p>
        </div>
        <div className="setting-control">
          <Switch on={status.on} label="Let Claude Desktop see Orbit" disabled={busy || (!status.on && !status.canEncrypt)} onChange={(on) => run(() => window.api.setClaudeDesktop(on))} />
        </div>
      </div>

      {status.on && (
        <>
          <div className="setting-row">
            <div className="setting-text">
              <label>{status.connected ? 'Connected to Claude Desktop' : 'Connect to Claude Desktop'}</label>
              <p>
                {status.connected
                  ? 'Claude Desktop is set up. If Orbit doesn’t show in its connectors, quit Claude Desktop completely and open it again.'
                  : 'Sets Claude Desktop up for you. Then quit Claude Desktop completely and open it again.'}
              </p>
            </div>
            <div className="setting-control">
              <button className={`btn ${status.connected ? '' : 'btn-primary'}`} disabled={busy} onClick={() => void connect()} data-claude-connect>
                <Plug size={14} /> {status.connected ? 'Connect again' : 'Connect to Claude Desktop'}
              </button>
            </div>
          </div>

          {result && (
            <div className={result.written ? 'cal-connected' : 'cal-help'} data-claude-result>
              {result.written && <span className="cal-connected-dot" />}
              <span>{result.message}</span>
            </div>
          )}
          {result?.text && (
            <div className="cal-client">
              <p className="cal-note">
                Open Claude Desktop, go to <strong>{IS_MAC ? 'Claude → Settings' : 'File → Settings'} → Developer → Edit Config</strong>, and
                put this in the file it shows (<code>{result.file}</code>). If the file already has an <code>mcpServers</code> part, add
                the <code>orbit</code> part inside it. Save, then quit Claude Desktop and open it again.
              </p>
              <textarea readOnly value={result.text} rows={10} spellCheck={false} />
              <div className="cal-client-actions">
                <button
                  className="btn"
                  onClick={() => {
                    void navigator.clipboard.writeText(result.text!).then(() => setCopied(true))
                  }}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          )}

          <h4 className="claude-areas-heading">What Claude can see</h4>
          {CLAUDE_AREAS.map((a) => (
            <div key={a.id} className="setting-row" data-claude-area={a.id}>
              <div className="setting-text">
                <label>{a.label}</label>
                <p>{a.what}</p>
              </div>
              <div className="setting-control">
                <Switch on={status.areas[a.id]} label={a.label} disabled={busy} onChange={(on) => run(() => window.api.setClaudeArea(a.id as ClaudeArea, on))} />
              </div>
            </div>
          ))}
          <p className="cal-note">
            Passwords, locked notes and sign-in keys are never shared. Claude can only change things in the parts that say so (notes,
            events, countdowns, flashcards, Ideas & bugs cards, music and playlists); everything else it can only read. Changed notes can be put
            back with Ctrl+Z, and deleted ones are in the bin.
          </p>

          <div className="cal-client-actions">
            <button className="btn" disabled={busy} onClick={() => run(() => window.api.newClaudeDesktopToken())} title="Makes a new secret code, so anything that had the old one stops working">
              <KeyRound size={14} /> New secret code
            </button>
            {status.connected && (
              <button className="btn" disabled={busy} onClick={() => run(() => window.api.disconnectClaudeDesktop())} title="Takes Orbit out of Claude Desktop’s connectors">
                <Unplug size={14} /> Remove from Claude Desktop
              </button>
            )}
          </div>
        </>
      )}
      {!status.canEncrypt && <p className="setting-warning">This computer can’t store the connection’s secret code securely, so it can’t be switched on.</p>}
      {error && <p className="setting-warning">{error}</p>}
    </section>
  )
}
